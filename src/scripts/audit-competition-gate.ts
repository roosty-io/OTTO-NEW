/* eslint-disable no-console */
/**
 * audit-competition-gate.ts
 *
 * Audits the V1.4 competition gate against the most recent
 * business_fit_checks rows. Lists every product that reached business
 * fit, classifies it into one of four buckets, and writes a Markdown
 * report so the operator can see which gate rules fired.
 *
 * Usage:
 *   npm run audit:competition-gate -- --latest-run
 *   npm run audit:competition-gate -- --limit=50
 */

import * as fs from 'fs';
import * as path from 'path';
import { getSupabase } from '@/clients/supabaseClient';
import { logger } from '@/utils/logger';

const log = logger.child('audit-competition-gate');

interface BfRow {
  otto_product_id: string;
  asin: string | null;
  product_title: string | null;
  brand: string | null;
  amazon_price: number | null;
  business_fit_score: number | null;
  price_quality_score: number | null;
  saturation_quality_score: number | null;
  differentiation_score: number | null;
  competition_quality_score: number | null;
  seller_competition_score: number | null;
  exact_match_saturation_score: number | null;
  duplicate_listing_score: number | null;
  price_compression_score: number | null;
  same_source_likelihood_score: number | null;
  is_generic_commodity: boolean | null;
  competition_gate_result: string | null;
  competition_rejection_reason: string | null;
  seller_count: number | null;
  exact_or_similar_match_count: number | null;
  duplicate_ratio: number | null;
  business_fit_passed: boolean | null;
  business_fit_rejection_reason: string | null;
  reason_codes: string[] | null;
  notes: string[] | null;
  created_at: string;
}

interface DemandRow {
  otto_product_id: string;
  sell_within_30_days_confidence: number | null;
  demand_score: number | null;
  stagnation_risk_score: number | null;
  relevant_comparable_count: number | null;
  competition_density_score: number | null;
  price_viability_score: number | null;
}

interface ComplianceRow {
  otto_product_id: string;
  policy_risk_score: number | null;
}

interface Combined extends BfRow {
  sell_within_30_days_confidence?: number | null;
  demand_score?: number | null;
  stagnation_risk_score?: number | null;
  relevant_comparable_count?: number | null;
  competition_density_score?: number | null;
  price_viability_score?: number | null;
  policy_risk_score?: number | null;
}

type Bucket = 'correctly_rejected' | 'likely_over_filtered' | 'borderline' | 'passed';

function parseArgs(): { limit: number } {
  const args = process.argv.slice(2);
  let limit = 50;
  for (const a of args) {
    if (a.startsWith('--limit=')) {
      const n = Number(a.split('=')[1]);
      if (Number.isFinite(n) && n > 0) limit = Math.min(n, 200);
    }
  }
  return { limit };
}

async function loadLatest(limit: number): Promise<Combined[]> {
  const supabase = getSupabase();
  // Pull last N business_fit_checks rows by created_at.  All rows from the
  // same QA batch are written within a few minutes, so a 50-row window is
  // a reliable proxy for "latest run".
  // The wrapper doesn't expose .order/.limit on its return type; cast.
  const bfQuery = supabase.from('business_fit_checks').select('*') as unknown as {
    order: (col: string, opts: { ascending: boolean }) => {
      limit: (n: number) => Promise<{ data: BfRow[] | null; error: { message: string } | null }>;
    };
  };
  const bfRes = await bfQuery.order('created_at', { ascending: false }).limit(limit);
  if (bfRes.error) {
    log.error('business_fit_checks query failed', { err: bfRes.error.message });
    return [];
  }
  const rows = bfRes.data ?? [];
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.otto_product_id);

  // Demand
  const demQuery = supabase
    .from('ebay_demand_checks')
    .select('otto_product_id, sell_within_30_days_confidence, demand_score, stagnation_risk_score, relevant_comparable_count, competition_density_score, price_viability_score') as unknown as {
    in: (col: string, vals: string[]) => Promise<{ data: DemandRow[] | null; error: { message: string } | null }>;
  };
  const demRes = await demQuery.in('otto_product_id', ids);
  const demMap = new Map<string, DemandRow>();
  for (const d of demRes.data ?? []) demMap.set(d.otto_product_id, d);

  // Compliance
  const cmpQuery = supabase
    .from('compliance_checks')
    .select('otto_product_id, policy_risk_score') as unknown as {
    in: (col: string, vals: string[]) => Promise<{ data: ComplianceRow[] | null; error: { message: string } | null }>;
  };
  const cmpRes = await cmpQuery.in('otto_product_id', ids);
  const cmpMap = new Map<string, ComplianceRow>();
  for (const c of cmpRes.data ?? []) cmpMap.set(c.otto_product_id, c);

  return rows.map((r) => ({
    ...r,
    sell_within_30_days_confidence: demMap.get(r.otto_product_id)?.sell_within_30_days_confidence,
    demand_score: demMap.get(r.otto_product_id)?.demand_score,
    stagnation_risk_score: demMap.get(r.otto_product_id)?.stagnation_risk_score,
    relevant_comparable_count: demMap.get(r.otto_product_id)?.relevant_comparable_count,
    competition_density_score: demMap.get(r.otto_product_id)?.competition_density_score,
    price_viability_score: demMap.get(r.otto_product_id)?.price_viability_score,
    policy_risk_score: cmpMap.get(r.otto_product_id)?.policy_risk_score,
  }));
}

function classify(r: Combined): Bucket {
  if (r.business_fit_passed) return 'passed';
  const failedCompetition =
    r.competition_gate_result === 'saturated' ||
    (r.business_fit_rejection_reason ?? '').startsWith('HIGH_') ||
    r.business_fit_rejection_reason === 'COMPETITION_GATE_FAILED' ||
    r.business_fit_rejection_reason === 'EXACT_MATCH_SATURATION' ||
    r.business_fit_rejection_reason === 'PRICE_COMPRESSED_MARKET' ||
    r.business_fit_rejection_reason === 'SATURATED_GENERIC_PRODUCT';

  if (!failedCompetition) return 'correctly_rejected';

  // "Likely over-filtered" criteria per task spec.
  const sell = r.sell_within_30_days_confidence ?? 0;
  const policy = r.policy_risk_score ?? 0;
  const price = r.amazon_price ?? 0;
  const pc = r.price_compression_score ?? 0;
  const stag = r.stagnation_risk_score ?? 0;
  const sellerOnly = r.business_fit_rejection_reason === 'HIGH_SELLER_COMPETITION';
  if (
    sell >= 85 &&
    policy <= 15 &&
    price >= 12 &&
    pc <= 50 &&
    stag <= 25 &&
    sellerOnly
  ) {
    return 'likely_over_filtered';
  }
  // Borderline if compeition_quality_score is mid-band and at least one
  // healthy signal is present.
  const cq = r.competition_quality_score ?? 0;
  if (cq >= 40 && cq < 60 && sell >= 80) return 'borderline';
  return 'correctly_rejected';
}

function wouldHavePassedWithoutCompetition(r: Combined): boolean {
  // Rough estimate: take the recorded business_fit_score and add back the
  // contribution of competition_quality_score, then see if it would clear
  // the 70 floor.  Weight 2 of total 12 = ~17% of the composite.
  const bf = r.business_fit_score ?? 0;
  const cq = r.competition_quality_score ?? 0;
  if (cq <= 0) return false;
  const competitionPenalty = (100 - cq) * (2 / 12);
  const estimatedWithout = Math.min(100, bf + competitionPenalty);
  return estimatedWithout >= 70;
}

function reportsDir(): string {
  const dir = path.resolve(process.cwd(), 'reports');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function fmtRow(r: Combined): string[] {
  const lines: string[] = [];
  lines.push(`### [${r.asin ?? '(no ASIN)'}] ${(r.product_title ?? '').slice(0, 90)}`);
  lines.push('');
  lines.push(`| Field | Value |`);
  lines.push(`| --- | ---:|`);
  lines.push(`| brand | ${r.brand ?? '(none)'} |`);
  lines.push(`| amazon_price | ${r.amazon_price ?? '(n/a)'} |`);
  lines.push(`| sell_within_30_days_confidence | ${fmtNum(r.sell_within_30_days_confidence)} |`);
  lines.push(`| demand_score | ${fmtNum(r.demand_score)} |`);
  lines.push(`| stagnation_risk_score | ${fmtNum(r.stagnation_risk_score)} |`);
  lines.push(`| relevant_comparable_count | ${r.relevant_comparable_count ?? '(n/a)'} |`);
  lines.push(`| exact_or_similar_match_count | ${r.exact_or_similar_match_count ?? '(n/a)'} |`);
  lines.push(`| seller_count | ${r.seller_count ?? '(n/a)'} |`);
  lines.push(`| duplicate_ratio | ${fmtNum(r.duplicate_ratio)} |`);
  lines.push(`| competition_density_score | ${fmtNum(r.competition_density_score)} |`);
  lines.push(`| price_compression_score | ${fmtNum(r.price_compression_score)} |`);
  lines.push(`| competition_quality_score | ${fmtNum(r.competition_quality_score)} |`);
  lines.push(`| differentiation_score | ${fmtNum(r.differentiation_score)} |`);
  lines.push(`| business_fit_score | ${fmtNum(r.business_fit_score)} |`);
  lines.push(`| business_fit_passed | ${r.business_fit_passed} |`);
  lines.push(`| business_fit_rejection_reason | ${r.business_fit_rejection_reason ?? '(none)'} |`);
  lines.push(`| competition_gate_result | ${r.competition_gate_result ?? '(none)'} |`);
  lines.push(`| reason_codes | ${(r.reason_codes ?? []).join(', ') || '(none)'} |`);
  lines.push(`| would have passed w/o competition penalty | ${wouldHavePassedWithoutCompetition(r)} |`);
  lines.push('');
  return lines;
}

function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined) return '(n/a)';
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2);
}

async function main(): Promise<void> {
  const args = parseArgs();
  const rows = await loadLatest(args.limit);
  if (rows.length === 0) {
    log.error('No business_fit_checks rows found.');
    process.exit(1);
  }

  const groups: Record<Bucket, Combined[]> = {
    correctly_rejected: [],
    likely_over_filtered: [],
    borderline: [],
    passed: [],
  };
  for (const r of rows) groups[classify(r)].push(r);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const out = path.join(reportsDir(), `otto-competition-gate-audit-${stamp}.md`);
  const lines: string[] = [];
  lines.push(`# OTTO Competition Gate Audit`);
  lines.push('');
  lines.push(`- **Generated**: ${new Date().toISOString()}`);
  lines.push(`- **Rows audited**: ${rows.length} (most recent by created_at)`);
  lines.push(`- **Earliest row**: ${rows[rows.length - 1].created_at}`);
  lines.push(`- **Latest row**: ${rows[0].created_at}`);
  lines.push('');
  lines.push(`## Bucket counts`);
  lines.push('');
  lines.push(`| Bucket | Count |`);
  lines.push(`| --- | ---:|`);
  lines.push(`| Products that passed | ${groups.passed.length} |`);
  lines.push(`| Likely over-filtered | ${groups.likely_over_filtered.length} |`);
  lines.push(`| Borderline | ${groups.borderline.length} |`);
  lines.push(`| Correctly rejected | ${groups.correctly_rejected.length} |`);
  lines.push('');
  for (const [bucket, label] of [
    ['likely_over_filtered', 'Products likely over-filtered'],
    ['borderline', 'Borderline products'],
    ['correctly_rejected', 'Products correctly rejected by competition'],
    ['passed', 'Products that passed'],
  ] as [Bucket, string][]) {
    lines.push(`## ${label} (${groups[bucket].length})`);
    lines.push('');
    if (groups[bucket].length === 0) {
      lines.push('_(none)_');
      lines.push('');
      continue;
    }
    for (const r of groups[bucket]) for (const ln of fmtRow(r)) lines.push(ln);
  }
  fs.writeFileSync(out, lines.join('\n'), 'utf8');

  console.log('\n========== OTTO COMPETITION GATE AUDIT ==========');
  console.log(`  rows audited        : ${rows.length}`);
  console.log(`  passed              : ${groups.passed.length}`);
  console.log(`  likely over-filtered: ${groups.likely_over_filtered.length}`);
  console.log(`  borderline          : ${groups.borderline.length}`);
  console.log(`  correctly rejected  : ${groups.correctly_rejected.length}`);
  console.log(`  report written      : ${out}`);
  console.log('=================================================\n');
}

main().catch((e) => {
  logger.error('audit-competition-gate failed', { err: (e as Error).message });
  process.exit(1);
});
