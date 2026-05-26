/* eslint-disable no-console */
/**
 * analyze-manual-qa.ts
 *
 * Reads a filled manual QA review CSV, identifies the most common
 * rejection patterns, lists the rejected ASINs, and writes a Markdown
 * analysis with concrete threshold-tuning recommendations.
 *
 * Usage:
 *   npm run analyze:manual-qa -- --file=exports/otto_manual_qa_review_2026-05-25.csv
 *   npm run analyze:manual-qa -- --file=... --batch-label="..."
 *
 * The script does not invent reviewer answers - blank rows are
 * surfaced as "not reviewed".
 */

import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import { logger } from '@/utils/logger';

const log = logger.child('analyze-manual-qa');

interface CsvRow {
  otto_product_id?: string;
  asin?: string;
  amazon_url?: string;
  product_title?: string;
  brand?: string;
  amazon_price?: string;
  delivery_days?: string;
  raw_delivery_text?: string;
  prime_signal_detected?: string;
  shipping_gate_result?: string;
  sell_within_30_days_confidence?: string;
  stagnation_risk_score?: string;
  policy_risk_score?: string;
  final_validation_score?: string;
  would_list_yes_no?: string;
  asin_real_yes_no?: string;
  demand_makes_sense_yes_no?: string;
  low_risk_yes_no?: string;
  notes?: string;
}

interface CliArgs {
  file: string;
  batchLabel?: string;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let file: string | undefined;
  let batchLabel: string | undefined;
  for (const a of args) {
    if (a.startsWith('--file=')) file = a.substring('--file='.length);
    else if (a.startsWith('--batch-label=')) batchLabel = a.substring('--batch-label='.length).replace(/^"|"$/g, '');
  }
  if (!file) {
    log.error('Missing required --file=<path-to-csv>');
    process.exit(2);
  }
  return { file, batchLabel };
}

function readCsv(file: string): CsvRow[] {
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) {
    log.error(`File not found: ${abs}`);
    process.exit(2);
  }
  const text = fs.readFileSync(abs, 'utf8');
  return parse(text, { columns: true, skip_empty_lines: true, trim: true }) as CsvRow[];
}

function normYesNo(v: string | undefined): 'yes' | 'no' | undefined {
  const s = (v ?? '').trim().toLowerCase();
  if (s === 'yes' || s === 'y' || s === 'true' || s === '1') return 'yes';
  if (s === 'no' || s === 'n' || s === 'false' || s === '0') return 'no';
  return undefined;
}

function toNum(v: string | undefined): number | undefined {
  const n = Number((v ?? '').trim());
  return Number.isFinite(n) ? n : undefined;
}

// ---------------------------------------------------------------------------
// Pattern detection in reviewer notes + product fields
// ---------------------------------------------------------------------------

interface PatternHit {
  asin?: string;
  title?: string;
  brand?: string;
  price?: number;
  matchedPatterns: string[];
  noteSnippet: string;
}

const PATTERNS: { name: string; regex: RegExp }[] = [
  { name: 'too_cheap', regex: /\b(too\s*cheap|cheap|low\s*price|low\s*ticket)\b/i },
  { name: 'too_many_similar_listings', regex: /\b(too\s*many\s*similar|similar\s*listings|saturated|competit|too\s*many\s*sellers|many\s*sellers|too\s*many\s*comp)\b/i },
  { name: 'bulky_or_high_ticket', regex: /\b(bulky|high[- ]?ticket|heavy|oversized|garage\s*rack|tire\s*rack|too\s*big|too\s*large)\b/i },
  { name: 'brand_risk', regex: /\b(vero|brand[- ]risk|fiskars|nike|disney|apple|gucci|chanel|stanley|yeti|name[- ]?brand|trademark|copyright)\b/i },
  { name: 'low_margin', regex: /\b(low\s*margin|no\s*margin|thin\s*margin)\b/i },
  { name: 'return_risk', regex: /\b(return|fragile|breakable)\b/i },
];

function detectPatterns(notes: string, row: CsvRow): string[] {
  const matched: string[] = [];
  if (!notes) return matched;
  for (const p of PATTERNS) if (p.regex.test(notes)) matched.push(p.name);
  // Augment from row data: if note mentions cheap/similar without matching
  // a regex we still classify by the numeric signal.
  const price = toNum(row.amazon_price);
  if (price !== undefined && price < 10) matched.push('price_lt_10');
  if (price !== undefined && price < 12) matched.push('price_lt_12');
  return Array.from(new Set(matched));
}

interface AnalyzeOutput {
  totalRows: number;
  reviewedRows: number;
  approvedRows: number;
  rejectedRows: number;
  approvalRate: number;
  asinRealYesRate: number;
  demandYesRate: number;
  lowRiskYesRate: number;
  rejectedAsins: { asin?: string; title?: string; brand?: string; price?: number; notes: string }[];
  patternCounts: Record<string, number>;
  patternHits: PatternHit[];
  recommendations: string[];
}

function analyze(rows: CsvRow[]): AnalyzeOutput {
  let reviewed = 0;
  let approved = 0;
  let asinRealReviewed = 0;
  let asinRealYes = 0;
  let demandReviewed = 0;
  let demandYes = 0;
  let lowRiskReviewed = 0;
  let lowRiskYes = 0;
  const rejectedAsins: AnalyzeOutput['rejectedAsins'] = [];
  const patternHits: PatternHit[] = [];
  const patternCounts: Record<string, number> = {};

  for (const r of rows) {
    const wl = normYesNo(r.would_list_yes_no);
    if (wl) reviewed++;
    if (wl === 'yes') approved++;
    if (wl === 'no') {
      rejectedAsins.push({
        asin: r.asin,
        title: r.product_title,
        brand: r.brand,
        price: toNum(r.amazon_price),
        notes: (r.notes ?? '').trim(),
      });
      const matched = detectPatterns(r.notes ?? '', r);
      for (const m of matched) patternCounts[m] = (patternCounts[m] ?? 0) + 1;
      patternHits.push({
        asin: r.asin,
        title: r.product_title,
        brand: r.brand,
        price: toNum(r.amazon_price),
        matchedPatterns: matched,
        noteSnippet: (r.notes ?? '').slice(0, 120),
      });
    }
    const ar = normYesNo(r.asin_real_yes_no);
    if (ar) {
      asinRealReviewed++;
      if (ar === 'yes') asinRealYes++;
    }
    const dm = normYesNo(r.demand_makes_sense_yes_no);
    if (dm) {
      demandReviewed++;
      if (dm === 'yes') demandYes++;
    }
    const lr = normYesNo(r.low_risk_yes_no);
    if (lr) {
      lowRiskReviewed++;
      if (lr === 'yes') lowRiskYes++;
    }
  }

  const approvalRate = reviewed > 0 ? (approved / reviewed) * 100 : 0;
  const asinRealYesRate = asinRealReviewed > 0 ? (asinRealYes / asinRealReviewed) * 100 : 0;
  const demandYesRate = demandReviewed > 0 ? (demandYes / demandReviewed) * 100 : 0;
  const lowRiskYesRate = lowRiskReviewed > 0 ? (lowRiskYes / lowRiskReviewed) * 100 : 0;

  const recommendations = buildRecommendations(approvalRate, patternCounts, rejectedAsins);

  return {
    totalRows: rows.length,
    reviewedRows: reviewed,
    approvedRows: approved,
    rejectedRows: reviewed - approved,
    approvalRate,
    asinRealYesRate,
    demandYesRate,
    lowRiskYesRate,
    rejectedAsins,
    patternCounts,
    patternHits,
    recommendations,
  };
}

function buildRecommendations(
  approvalRate: number,
  patternCounts: Record<string, number>,
  rejected: AnalyzeOutput['rejectedAsins'],
): string[] {
  const recs: string[] = [];
  const top = Object.entries(patternCounts).sort((a, b) => b[1] - a[1]);
  if (top.length === 0 && rejected.length > 0) {
    recs.push('No clear rejection pattern detected in notes. Consider re-reviewing with explicit notes per failed product.');
  }
  if (approvalRate < 70) {
    recs.push(`Approval rate ${approvalRate.toFixed(1)}% < 70% target. Tighten the BusinessFitAgent on the dominant rejection patterns below.`);
  } else {
    recs.push(`Approval rate ${approvalRate.toFixed(1)}% meets the 70% target. Safe to scale --limit.`);
  }
  for (const [pat, count] of top) {
    switch (pat) {
      case 'too_cheap':
      case 'price_lt_10':
      case 'price_lt_12':
        recs.push(`Pattern "${pat}" hit ${count} times. Consider raising MIN_AMAZON_PRICE_DEFAULT or MIN_AMAZON_PRICE_STRICT, or making the price_quality_score weight heavier.`);
        break;
      case 'too_many_similar_listings':
        recs.push(`Pattern "${pat}" hit ${count} times. Consider lowering MAX_SATURATION_QUALITY_RISK or tightening exact_or_similar / duplicate_ratio penalties in scoreSaturationQuality.`);
        break;
      case 'bulky_or_high_ticket':
        recs.push(`Pattern "${pat}" hit ${count} times. Consider lowering MAX_BULKY_PRICE_WITHOUT_HIGH_CONFIDENCE or expanding BULKY_CUES in businessFitScoring.`);
        break;
      case 'brand_risk':
        recs.push(`Pattern "${pat}" hit ${count} times. Add the flagged brand(s) to BRAND_ENTRIES with hardBlock=true.`);
        break;
      case 'low_margin':
        recs.push(`Pattern "${pat}" hit ${count} times. Tighten the eBay demand price viability gate to require larger margin over Amazon price.`);
        break;
      case 'return_risk':
        recs.push(`Pattern "${pat}" hit ${count} times. Strengthen fragility / weight heuristics in BusinessFit's bulkiness scorer.`);
        break;
    }
  }
  return recs;
}

function reportsDir(): string {
  const dir = path.resolve(process.cwd(), 'reports');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeMarkdown(args: { file: string; batchLabel?: string; analysis: AnalyzeOutput }): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const out = path.join(reportsDir(), `otto-manual-qa-analysis-${stamp}.md`);
  const a = args.analysis;
  const lines: string[] = [];
  lines.push(`# OTTO Manual QA Analysis`);
  lines.push('');
  lines.push(`- **Generated**: ${new Date().toISOString()}`);
  lines.push(`- **Source**: \`${args.file}\``);
  if (args.batchLabel) lines.push(`- **Batch**: ${args.batchLabel}`);
  lines.push('');
  lines.push(`## Headline numbers`);
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`| --- | ---:|`);
  lines.push(`| rows in CSV | ${a.totalRows} |`);
  lines.push(`| rows reviewed (would_list filled) | ${a.reviewedRows} |`);
  lines.push(`| would_list yes | ${a.approvedRows} |`);
  lines.push(`| would_list no | ${a.rejectedRows} |`);
  lines.push(`| would_list approval rate | ${a.approvalRate.toFixed(1)}% |`);
  lines.push(`| asin_real yes rate | ${a.asinRealYesRate.toFixed(1)}% |`);
  lines.push(`| demand_makes_sense yes rate | ${a.demandYesRate.toFixed(1)}% |`);
  lines.push(`| low_risk yes rate | ${a.lowRiskYesRate.toFixed(1)}% |`);
  lines.push('');
  lines.push(`## Rejection patterns`);
  lines.push('');
  const ranked = Object.entries(a.patternCounts).sort((x, y) => y[1] - x[1]);
  if (ranked.length === 0) {
    lines.push('_(no patterns detected from reviewer notes)_');
  } else {
    lines.push(`| Pattern | Count |`);
    lines.push(`| --- | ---:|`);
    for (const [pat, n] of ranked) lines.push(`| \`${pat}\` | ${n} |`);
  }
  lines.push('');
  lines.push(`## Rejected ASINs`);
  lines.push('');
  if (a.rejectedAsins.length === 0) {
    lines.push('_(none)_');
  } else {
    for (const r of a.rejectedAsins) {
      const t = (r.title ?? '').slice(0, 90);
      const note = r.notes ? `  _(${r.notes})_` : '';
      const price = r.price !== undefined ? `$${r.price.toFixed(2)}` : '?';
      lines.push(`- **${r.asin ?? '(no ASIN)'}** [${r.brand ?? 'no brand'}, ${price}] ${t}${note}`);
    }
  }
  lines.push('');
  lines.push(`## Recommendations`);
  lines.push('');
  for (const rec of a.recommendations) lines.push(`- ${rec}`);
  lines.push('');
  fs.writeFileSync(out, lines.join('\n'), 'utf8');
  return out;
}

function main(): void {
  const args = parseArgs();
  const rows = readCsv(args.file);
  const analysis = analyze(rows);

  console.log('\n========== OTTO MANUAL QA ANALYSIS ==========');
  console.log(`  source                  : ${args.file}`);
  if (args.batchLabel) console.log(`  batch label             : ${args.batchLabel}`);
  console.log(`  rows in CSV             : ${analysis.totalRows}`);
  console.log(`  rows reviewed           : ${analysis.reviewedRows}`);
  console.log(`  would_list yes          : ${analysis.approvedRows}`);
  console.log(`  would_list no           : ${analysis.rejectedRows}`);
  console.log(`  approval rate           : ${analysis.approvalRate.toFixed(1)}%`);
  console.log(`  asin_real yes rate      : ${analysis.asinRealYesRate.toFixed(1)}%`);
  console.log(`  demand_makes_sense rate : ${analysis.demandYesRate.toFixed(1)}%`);
  console.log(`  low_risk yes rate       : ${analysis.lowRiskYesRate.toFixed(1)}%`);
  console.log(`  ----- rejection patterns -----`);
  const ranked = Object.entries(analysis.patternCounts).sort((a, b) => b[1] - a[1]);
  for (const [pat, n] of ranked) console.log(`    ${pat.padEnd(34)} ${n}`);
  console.log(`  ----- recommendations -----`);
  for (const rec of analysis.recommendations) console.log(`    - ${rec}`);
  const out = writeMarkdown({ file: args.file, batchLabel: args.batchLabel, analysis });
  console.log(`  analysis written to     : ${out}`);
  console.log('============================================\n');
}

main();
