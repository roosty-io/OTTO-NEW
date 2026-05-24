/* eslint-disable no-console */
/**
 * import-manual-qa.ts
 *
 * Reads a filled-in manual QA review CSV (the one produced by
 * `run:real-qa`) and inserts rows into `manual_qa_reviews`, then prints
 * and writes a Markdown approval-rate summary.
 *
 * Usage:
 *   npm run import:manual-qa -- --file=exports/otto_manual_qa_review_2026-05-24.csv
 *   npm run import:manual-qa -- --file=... --batch-label="first real QA batch"
 *
 * The script does not invent reviewer answers - blank cells stay blank.
 * Only the approval rate over rows that actually have a `would_list_yes_no`
 * value (yes or no) is reported.
 */

import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import { getSupabase } from '@/clients/supabaseClient';
import { logger } from '@/utils/logger';

const log = logger.child('import-manual-qa');

interface CsvRow {
  otto_product_id?: string;
  asin?: string;
  amazon_url?: string;
  product_title?: string;
  brand?: string;
  amazon_price?: string;
  delivery_days?: string;
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

interface ApprovalSummary {
  totalRows: number;
  reviewedRows: number;
  wouldListYes: number;
  wouldListNo: number;
  wouldListBlank: number;
  approvalRate: number;
  asinRealYesRate: number;
  demandMakesSenseYesRate: number;
  lowRiskYesRate: number;
  productsWithNotes: number;
  failedQaRows: { asin?: string; title?: string; notes?: string }[];
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let file: string | undefined;
  let batchLabel: string | undefined;
  for (const a of args) {
    if (a.startsWith('--file=')) file = a.substring('--file='.length);
    else if (a.startsWith('--batch-label=')) {
      batchLabel = a.substring('--batch-label='.length).trim().replace(/^"|"$/g, '');
    }
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

function toNum(v: string | undefined): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function summarize(rows: CsvRow[]): ApprovalSummary {
  const totalRows = rows.length;
  let reviewedRows = 0;
  let wouldListYes = 0;
  let wouldListNo = 0;
  let wouldListBlank = 0;
  let asinRealYes = 0;
  let asinRealReviewed = 0;
  let demandYes = 0;
  let demandReviewed = 0;
  let lowRiskYes = 0;
  let lowRiskReviewed = 0;
  let productsWithNotes = 0;
  const failedQaRows: { asin?: string; title?: string; notes?: string }[] = [];

  for (const r of rows) {
    const wl = normYesNo(r.would_list_yes_no);
    if (wl) {
      reviewedRows++;
      if (wl === 'yes') wouldListYes++;
      else {
        wouldListNo++;
        failedQaRows.push({ asin: r.asin, title: r.product_title, notes: r.notes });
      }
    } else {
      wouldListBlank++;
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
    if ((r.notes ?? '').trim().length > 0) productsWithNotes++;
  }

  const approvalRate = reviewedRows > 0 ? (wouldListYes / reviewedRows) * 100 : 0;
  const asinRealYesRate = asinRealReviewed > 0 ? (asinRealYes / asinRealReviewed) * 100 : 0;
  const demandMakesSenseYesRate = demandReviewed > 0 ? (demandYes / demandReviewed) * 100 : 0;
  const lowRiskYesRate = lowRiskReviewed > 0 ? (lowRiskYes / lowRiskReviewed) * 100 : 0;
  return {
    totalRows,
    reviewedRows,
    wouldListYes,
    wouldListNo,
    wouldListBlank,
    approvalRate,
    asinRealYesRate,
    demandMakesSenseYesRate,
    lowRiskYesRate,
    productsWithNotes,
    failedQaRows,
  };
}

async function persist(rows: CsvRow[], sourceFile: string, batchLabel: string | undefined): Promise<number> {
  const supabase = getSupabase();
  const reviewedAt = new Date().toISOString();
  const records = rows.map((r) => ({
    otto_product_id: r.otto_product_id ?? null,
    asin: r.asin ?? null,
    amazon_url: r.amazon_url ?? null,
    product_title: r.product_title ?? null,
    brand: r.brand ?? null,
    amazon_price: toNum(r.amazon_price),
    delivery_days: toNum(r.delivery_days),
    sell_within_30_days_confidence: toNum(r.sell_within_30_days_confidence),
    stagnation_risk_score: toNum(r.stagnation_risk_score),
    policy_risk_score: toNum(r.policy_risk_score),
    final_validation_score: toNum(r.final_validation_score),
    would_list_yes_no: normYesNo(r.would_list_yes_no) ?? null,
    asin_real_yes_no: normYesNo(r.asin_real_yes_no) ?? null,
    demand_makes_sense_yes_no: normYesNo(r.demand_makes_sense_yes_no) ?? null,
    low_risk_yes_no: normYesNo(r.low_risk_yes_no) ?? null,
    notes: (r.notes ?? '').trim() || null,
    reviewed_at: reviewedAt,
    source_file: sourceFile,
    batch_label: batchLabel ?? null,
  }));
  try {
    await supabase.from('manual_qa_reviews').insert(records);
    return records.length;
  } catch (err) {
    log.warn('manual_qa_reviews insert failed', { err: (err as Error).message });
    return 0;
  }
}

function reportsDir(): string {
  const dir = path.resolve(process.cwd(), 'reports');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeSummary(args: {
  file: string;
  batchLabel?: string;
  rows: CsvRow[];
  summary: ApprovalSummary;
  insertedRows: number;
}): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const out = path.join(reportsDir(), `otto-manual-qa-summary-${stamp}.md`);
  const s = args.summary;
  const passed = s.reviewedRows > 0 && s.approvalRate >= 70;
  const lines: string[] = [];
  lines.push(`# OTTO Manual QA Summary`);
  lines.push('');
  lines.push(`- **Generated**: ${new Date().toISOString()}`);
  lines.push(`- **Source file**: \`${args.file}\``);
  if (args.batchLabel) lines.push(`- **Batch label**: ${args.batchLabel}`);
  lines.push(`- **Inserted rows into \`manual_qa_reviews\`**: ${args.insertedRows}`);
  lines.push('');
  lines.push(`## Counts`);
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`| --- | --- |`);
  lines.push(`| total rows | ${s.totalRows} |`);
  lines.push(`| reviewed rows (would_list_yes_no filled) | ${s.reviewedRows} |`);
  lines.push(`| would-list yes | ${s.wouldListYes} |`);
  lines.push(`| would-list no | ${s.wouldListNo} |`);
  lines.push(`| would-list blank | ${s.wouldListBlank} |`);
  lines.push(`| would-list approval rate | ${s.approvalRate.toFixed(1)}% |`);
  lines.push(`| ASIN-real yes rate | ${s.asinRealYesRate.toFixed(1)}% |`);
  lines.push(`| demand-makes-sense yes rate | ${s.demandMakesSenseYesRate.toFixed(1)}% |`);
  lines.push(`| low-risk yes rate | ${s.lowRiskYesRate.toFixed(1)}% |`);
  lines.push(`| products with reviewer notes | ${s.productsWithNotes} |`);
  lines.push('');
  lines.push(`## Verdict`);
  lines.push('');
  if (s.reviewedRows === 0) {
    lines.push('No `would_list_yes_no` values were filled in. **The CSV has not been reviewed yet.** ' +
      'Open the CSV, fill the reviewer columns, and re-run this script.');
  } else if (passed) {
    lines.push(`**PASS** - would-list approval rate ${s.approvalRate.toFixed(1)}% meets the >= 70% target.`);
    lines.push('Safe to scale to a larger batch.');
  } else {
    lines.push(`**HOLD** - would-list approval rate ${s.approvalRate.toFixed(1)}% is below the 70% target.`);
    lines.push('Do not scale yet.  Tune the failing axis (most often policy risk or demand thresholds) ' +
      'and re-run a fresh QA batch.');
  }
  lines.push('');
  if (s.failedQaRows.length > 0) {
    lines.push(`## Failed-QA rows (would_list = no)`);
    lines.push('');
    for (const f of s.failedQaRows) {
      const t = (f.title ?? '').slice(0, 90);
      const note = f.notes ? `  _(${f.notes})_` : '';
      lines.push(`- **${f.asin ?? '(no ASIN)'}** ${t}${note}`);
    }
    lines.push('');
  }
  fs.writeFileSync(out, lines.join('\n'), 'utf8');
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const rows = readCsv(args.file);
  if (rows.length === 0) {
    log.error('CSV had zero data rows.');
    process.exit(1);
  }
  const summary = summarize(rows);
  const insertedRows = await persist(rows, args.file, args.batchLabel);

  console.log('\n========== OTTO MANUAL QA SUMMARY ==========');
  console.log(`  source file               : ${args.file}`);
  if (args.batchLabel) console.log(`  batch label               : ${args.batchLabel}`);
  console.log(`  inserted into DB          : ${insertedRows}`);
  console.log(`  total reviewed            : ${summary.reviewedRows}`);
  console.log(`  would-list yes            : ${summary.wouldListYes}`);
  console.log(`  would-list no             : ${summary.wouldListNo}`);
  console.log(`  would-list blank          : ${summary.wouldListBlank}`);
  console.log(`  would-list approval rate  : ${summary.approvalRate.toFixed(1)}%`);
  console.log(`  ASIN-real yes rate        : ${summary.asinRealYesRate.toFixed(1)}%`);
  console.log(`  demand makes sense rate   : ${summary.demandMakesSenseYesRate.toFixed(1)}%`);
  console.log(`  low-risk yes rate         : ${summary.lowRiskYesRate.toFixed(1)}%`);
  console.log(`  products with notes       : ${summary.productsWithNotes}`);
  if (summary.failedQaRows.length > 0) {
    console.log(`  failed-QA products        :`);
    for (const f of summary.failedQaRows) {
      console.log(`    - ${f.asin ?? '(no asin)'}  ${(f.title ?? '').slice(0, 80)}`);
    }
  }
  if (summary.reviewedRows === 0) {
    console.log('  verdict                   : NOT REVIEWED  (fill would_list_yes_no in the CSV)');
  } else if (summary.approvalRate >= 70) {
    console.log(`  verdict                   : PASS  (>= 70% approval, safe to scale)`);
  } else {
    console.log(`  verdict                   : HOLD  (< 70% approval, do not scale)`);
  }
  const out = writeSummary({ file: args.file, batchLabel: args.batchLabel, rows, summary, insertedRows });
  console.log(`  summary written to        : ${out}`);
  console.log('=============================================\n');
}

main().catch((err) => {
  logger.error('import-manual-qa failed', { err: (err as Error).message, stack: (err as Error).stack });
  process.exit(1);
});
