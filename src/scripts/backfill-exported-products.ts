/* eslint-disable no-console */
/**
 * backfill-exported-products.ts
 *
 * Reads a canonical OTTO export CSV (the one written by CsvExportAgent)
 * and upserts its rows into `validated_products`, attaching them to the
 * matching `export_batches` row.  Useful for older runs whose exports
 * predate the in-pipeline persistence path.
 *
 * Usage:
 *   npm run backfill:exported-products -- --file=exports/otto-validated-2026-05-26T22-09-07-544Z.csv
 *   npm run backfill:exported-products -- --file=...  --export-batch-id=f22df9a5-...
 *   npm run backfill:exported-products -- --latest
 *
 * Behavior:
 *   - If --export-batch-id is provided, rows are attached to that batch.
 *   - Otherwise the script looks for an existing export_batches row with
 *     file_path matching the CSV; if not found, it inserts a new
 *     export_batches row using the CSV row count as row_count.
 *   - Idempotent: upsert keyed on (export_batch_id, asin).  Re-running
 *     does not duplicate rows.
 *   - Synthetic / test-pipeline CSVs (rows with brand='OttoMock' or
 *     titles starting with 'Mock product ') are persisted with
 *     is_synthetic=true.
 *
 * Prints:
 *   csv path / row count / matched-or-created batch_id / inserted /
 *   updated / skipped (zero-asin) / failed counts.
 */

import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import { v4 as uuidv4 } from 'uuid';
import { getSupabase } from '@/clients/supabaseClient';
import { logger } from '@/utils/logger';

const log = logger.child('backfill-exported-products');

interface Args {
  file?: string;
  exportBatchId?: string;
  latest?: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--file=')) out.file = arg.slice('--file='.length);
    else if (arg.startsWith('--export-batch-id=')) out.exportBatchId = arg.slice('--export-batch-id='.length);
    else if (arg === '--latest') out.latest = true;
  }
  return out;
}

function parseBool(v: unknown): boolean | null {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v).toLowerCase().trim();
  if (s === 'true' || s === 't' || s === '1' || s === 'yes') return true;
  if (s === 'false' || s === 'f' || s === '0' || s === 'no') return false;
  return null;
}

function parseNumber(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(String(v).replace(/[$,]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function parseInt32(v: unknown): number | null {
  const n = parseNumber(v);
  return n === null ? null : Math.trunc(n);
}

function parseArray(v: unknown): string[] {
  if (v === undefined || v === null || v === '') return [];
  const s = String(v).trim();
  if (s.startsWith('[')) {
    try {
      const arr = JSON.parse(s);
      return Array.isArray(arr) ? arr.map(String) : [];
    } catch {
      // fall through to delimiter parse
    }
  }
  return s.split('|').map((x) => x.trim()).filter(Boolean);
}

function parseJsonObject(v: unknown): Record<string, unknown> {
  if (v === undefined || v === null || v === '') return {};
  try {
    const obj = JSON.parse(String(v));
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? (obj as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function isSyntheticRow(row: Record<string, string>): boolean {
  const brand = (row.brand ?? '').trim();
  const title = (row.product_title ?? '').trim();
  return brand === 'OttoMock' || title.startsWith('Mock product ');
}

async function resolveLatestCsvPath(): Promise<string | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('export_batches')
    .select('file_path,created_at')
    .order('created_at', { ascending: false })
    .limit(1);
  if (error || !data || data.length === 0) return null;
  const fp = (data[0] as { file_path: string | null }).file_path;
  return fp ?? null;
}

async function resolveBatchIdForCsv(csvPath: string, csvRowCount: number, runIdHint?: string): Promise<{ id: string; created: boolean }> {
  const supabase = getSupabase();
  // Try to find an existing export_batches row by file_path.
  const { data: existing, error: lookupErr } = await supabase
    .from('export_batches')
    .select('id, discovery_run_id, file_path')
    .eq('file_path', csvPath)
    .limit(1);
  if (lookupErr) {
    log.warn('export_batches lookup failed', { err: lookupErr.message });
  }
  if (existing && existing.length > 0) {
    return { id: (existing[0] as { id: string }).id, created: false };
  }
  // No matching batch; create one.
  const id = uuidv4();
  const { error: insertErr } = await supabase.from('export_batches').insert({
    id,
    discovery_run_id: runIdHint ?? null,
    file_path: csvPath,
    row_count: csvRowCount,
    final_validated_before_dedupe: csvRowCount,
    duplicate_asins_removed: 0,
    final_exported_after_dedupe: csvRowCount,
    status: 'completed',
  });
  if (insertErr) {
    log.warn('export_batches insert failed', { err: insertErr.message });
  }
  return { id, created: true };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  let csvPath = args.file;
  if (args.latest && !csvPath) {
    const resolved = await resolveLatestCsvPath();
    if (!resolved) {
      console.error('No --latest export_batches row found in Supabase.');
      process.exit(1);
    }
    csvPath = resolved;
    log.info('Resolved --latest CSV path', { csvPath });
  }
  if (!csvPath) {
    console.error('Usage: npm run backfill:exported-products -- --file=<csv> | --latest');
    process.exit(1);
  }

  const absolutePath = path.resolve(process.cwd(), csvPath);
  if (!fs.existsSync(absolutePath)) {
    console.error(`CSV not found: ${absolutePath}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(absolutePath, 'utf8');
  const rows = parse(raw, { columns: true, skip_empty_lines: true, trim: true }) as Record<string, string>[];
  if (rows.length === 0) {
    console.error('CSV has no data rows.');
    process.exit(1);
  }

  // Discovery run id is not in the CSV, but every row has the same
  // export_batch_id written by CsvExportAgent.  Use that to look up the
  // run id from export_batches if present.
  const csvExportBatchId = rows[0].export_batch_id?.trim();
  const supabase = getSupabase();

  let resolvedBatchId = args.exportBatchId;
  let createdNewBatch = false;
  let discoveryRunId: string | null = null;

  if (!resolvedBatchId && csvExportBatchId) {
    // CSV row already has an export_batch_id from the original export.
    resolvedBatchId = csvExportBatchId;
  }

  if (resolvedBatchId) {
    const { data, error } = await supabase
      .from('export_batches')
      .select('id, discovery_run_id, file_path')
      .eq('id', resolvedBatchId)
      .limit(1);
    if (error || !data || data.length === 0) {
      log.warn('Provided export-batch-id not found, will create a new batch row', { id: resolvedBatchId });
      resolvedBatchId = undefined;
    } else {
      discoveryRunId = (data[0] as { discovery_run_id: string | null }).discovery_run_id ?? null;
    }
  }

  if (!resolvedBatchId) {
    const created = await resolveBatchIdForCsv(csvPath, rows.length, undefined);
    resolvedBatchId = created.id;
    createdNewBatch = created.created;
  }

  const exportedAt = new Date().toISOString();
  const dbRows = rows.map((r) => {
    if (!r.asin || r.asin.trim() === '') return null;
    return {
      otto_product_id: r.otto_product_id || `OTTO-backfill-${r.asin}-${resolvedBatchId}`,
      export_batch_id: resolvedBatchId,
      discovery_run_id: discoveryRunId,
      asin: r.asin.trim(),
      parent_asin: r.parent_asin || null,
      child_asin: r.child_asin || null,
      amazon_url: r.amazon_url || `https://www.amazon.com/dp/${r.asin}`,
      product_title: r.product_title || '',
      brand: r.brand || null,
      amazon_category: r.amazon_category || null,
      variation_attributes: parseJsonObject(r.variation_attributes),
      amazon_price: parseNumber(r.amazon_price) ?? 0,
      coupon_detected: parseBool(r.coupon_detected) ?? false,
      delivery_days: parseInt32(r.delivery_days),
      raw_delivery_text: r.raw_delivery_text || null,
      delivery_context: r.delivery_context || null,
      prime_signal_detected: parseBool(r.prime_signal_detected),
      prime_signal_source: r.prime_signal_source || null,
      fba_signal_detected: parseBool(r.fba_signal_detected),
      ships_from_amazon: parseBool(r.ships_from_amazon),
      sold_by_amazon: parseBool(r.sold_by_amazon),
      fulfilled_by_amazon: parseBool(r.fulfilled_by_amazon),
      shipping_gate_result: r.shipping_gate_result || null,
      shipping_review_required: parseBool(r.shipping_review_required),
      stock_status: r.stock_status || 'unknown',
      rating: parseNumber(r.rating),
      review_count: parseInt32(r.review_count),
      source_confidence_score: parseNumber(r.source_confidence_score),
      product_match_type: r.product_match_type || 'unknown',
      opportunity_type: r.opportunity_type || 'unknown',
      marketplace_signal_sources: parseArray(r.marketplace_signal_sources),
      primary_discovery_source: r.primary_discovery_source || 'unknown',
      secondary_discovery_sources: parseArray(r.secondary_discovery_sources),
      core_keyword: r.core_keyword || '',
      related_keywords: parseArray(r.related_keywords),
      ebay_category_hint: r.ebay_category_hint || null,
      demand_type: r.demand_type || 'unknown',
      sell_within_30_days_confidence: parseNumber(r.sell_within_30_days_confidence) ?? 0,
      stagnation_risk_score: parseNumber(r.stagnation_risk_score) ?? 0,
      demand_score: parseNumber(r.demand_score) ?? 0,
      category_velocity_score: parseNumber(r.category_velocity_score) ?? 0,
      keyword_demand_score: parseNumber(r.keyword_demand_score) ?? 0,
      competitor_success_score: parseNumber(r.competitor_success_score) ?? 0,
      saturation_score: parseNumber(r.saturation_score) ?? 0,
      trend_momentum_score: parseNumber(r.trend_momentum_score) ?? 0,
      policy_risk_score: parseNumber(r.policy_risk_score) ?? 0,
      vero_risk_score: parseNumber(r.vero_risk_score) ?? 0,
      restricted_category_risk_score: parseNumber(r.restricted_category_risk_score) ?? 0,
      ip_risk_score: parseNumber(r.ip_risk_score) ?? 0,
      edge_case_risk_score: parseNumber(r.edge_case_risk_score) ?? 0,
      fragility_score: parseNumber(r.fragility_score) ?? 0,
      variation_confusion_score: parseNumber(r.variation_confusion_score) ?? 0,
      business_fit_score: parseNumber(r.business_fit_score),
      competition_quality_score: parseNumber(r.competition_quality_score),
      total_cost_estimate: parseNumber(r.total_cost_estimate) ?? 0,
      predicted_monthly_profit_per_100_listings: parseNumber(r.predicted_monthly_profit_per_100_listings) ?? 0,
      final_validation_score: parseNumber(r.final_validation_score) ?? 0,
      validation_status: r.validation_status || 'validated',
      validated_at: r.validated_at || exportedAt,
      exported_at: exportedAt,
      csv_export_path: csvPath,
      is_synthetic: isSyntheticRow(r),
    };
  }).filter((x): x is NonNullable<typeof x> => x !== null);

  const skippedZeroAsin = rows.length - dbRows.length;

  // Check how many rows already exist (to report insert vs update).
  const { data: existingRows } = await supabase
    .from('validated_products')
    .select('asin')
    .eq('export_batch_id', resolvedBatchId);
  const existingAsins = new Set(((existingRows ?? []) as { asin: string }[]).map((r) => r.asin));
  const inserted = dbRows.filter((r) => !existingAsins.has(r.asin)).length;
  const updated = dbRows.length - inserted;

  const { error: upsertErr } = await supabase
    .from('validated_products')
    .upsert(dbRows, { onConflict: 'export_batch_id,asin' } as never);

  const failed = upsertErr ? dbRows.length : 0;
  if (upsertErr) {
    console.error(`Upsert failed: ${upsertErr.message}`);
  }

  console.log('\n========== BACKFILL EXPORT PRODUCTS ==========');
  console.log(`  csv path             : ${csvPath}`);
  console.log(`  csv data rows        : ${rows.length}`);
  console.log(`  export_batch_id      : ${resolvedBatchId}${createdNewBatch ? ' (created)' : ''}`);
  console.log(`  discovery_run_id     : ${discoveryRunId ?? '(none)'}`);
  console.log(`  inserted (new)       : ${inserted}`);
  console.log(`  updated (re-upsert)  : ${updated}`);
  console.log(`  skipped (no asin)    : ${skippedZeroAsin}`);
  console.log(`  failed               : ${failed}`);
  console.log('==============================================\n');

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  logger.error('backfill-exported-products failed', { err: (err as Error).message, stack: (err as Error).stack });
  process.exit(1);
});
