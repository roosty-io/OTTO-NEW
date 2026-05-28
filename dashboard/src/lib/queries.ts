import { useQuery } from '@tanstack/react-query';
import { MOCK, SUPABASE_CONFIGURED, supabase } from './supabase';
import * as mock from './mockData';
import type {
  AgentLog,
  AgentVote,
  AmazonSourceCheck,
  BusinessFitCheck,
  AmazonEnvCheck,
  DiscoveryRun,
  ExportBatch,
  ExportExclusion,
  LatestRun,
  ManualQaReview,
  RejectedProduct,
  ValidatedProduct,
} from './types';

async function fetchTable<T>(table: string, opts: {
  order?: { col: string; ascending: boolean };
  limit?: number;
} = {}): Promise<T[]> {
  if (MOCK || !SUPABASE_CONFIGURED) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (mock as any)[table] ?? [];
  }
  let q = supabase().from(table).select('*');
  if (opts.order) q = q.order(opts.order.col, { ascending: opts.order.ascending });
  if (opts.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) throw new Error(`${table}: ${error.message}`);
  return (data ?? []) as T[];
}

// ---------------------------------------------------------------------------
// Latest run aggregation
// ---------------------------------------------------------------------------

export function useLatestRun() {
  return useQuery<LatestRun>({
    queryKey: ['latest-run'],
    queryFn: async () => {
      if (MOCK || !SUPABASE_CONFIGURED) return mock.latestRun;
      // Most recent NON-SYNTHETIC export_batch is the canonical "latest run".
      // Synthetic batches (run-test-pipeline + offline tests) are excluded
      // so the Command Center always reflects real QA work.
      const { data: batchRows, error: batchErr } = await supabase()
        .from('export_batches')
        .select('*')
        .eq('is_synthetic', false)
        .order('created_at', { ascending: false })
        .limit(1);
      if (batchErr) throw new Error(`export_batches: ${batchErr.message}`);
      const latestBatch = ((batchRows ?? []) as ExportBatch[])[0];
      if (!latestBatch) {
        return {
          runId: '',
          exportBatchId: null,
          csvPath: null,
          manualQaCsvPath: null,
          metrics: emptyMetrics(),
        };
      }
      const runId = latestBatch.discovery_run_id ?? '';

      // Discovery run for raw candidate count.
      let rawCandidates = 0;
      if (runId) {
        const { count, error } = await supabase()
          .from('raw_candidates')
          .select('*', { count: 'exact', head: true })
          .eq('discovery_run_id', runId);
        if (!error) rawCandidates = count ?? 0;
      }

      // Stage counts.  Pull just the most recent N rows per stage and
      // filter by run window (created_at within 2h of the export batch).
      const since = new Date(new Date(latestBatch.created_at).getTime() - 2 * 60 * 60 * 1000).toISOString();
      const inWindow = (col: string) => ({
        gte: { col, value: since },
      });
      const counts = await Promise.all([
        // asin_candidates writes one row per resolver attempt, so a naive
        // count over accepted=true overcounts (the resolver tries several
        // search variations and may accept more than one match per
        // raw_candidate). Count distinct products instead.
        countDistinctProducts('asin_candidates', { ...inWindow('created_at'), eq: { col: 'accepted', value: true } }),
        countWhere('amazon_source_checks', { ...inWindow('created_at'), eq: { col: 'source_valid', value: true } }),
        countWhere('amazon_source_checks', { ...inWindow('created_at'), eq: { col: 'source_valid', value: false } }),
        countWhere('ebay_demand_checks', { ...inWindow('created_at'), eq: { col: 'demand_passed', value: true } }),
        countWhere('ebay_demand_checks', { ...inWindow('created_at'), eq: { col: 'demand_passed', value: false } }),
        countWhere('compliance_checks', { ...inWindow('created_at'), eq: { col: 'compliance_passed', value: true } }),
        countWhere('compliance_checks', { ...inWindow('created_at'), eq: { col: 'compliance_passed', value: false } }),
        countWhere('business_fit_checks', { ...inWindow('created_at'), eq: { col: 'business_fit_passed', value: true } }),
        countWhere('business_fit_checks', { ...inWindow('created_at'), eq: { col: 'business_fit_passed', value: false } }),
        countWhere('final_validation_results', { ...inWindow('created_at'), eq: { col: 'passed', value: true } }),
      ]);
      const [
        asinResolved,
        amazonSourceValid,
        amazonSourceFailed,
        demandPassed,
        demandFailed,
        compliancePassed,
        complianceFailed,
        businessFitPassed,
        businessFitFailed,
        finalValidated,
      ] = counts;
      const asinFailed = Math.max(0, rawCandidates - asinResolved);

      // Prefer the export_batch's own final count over the window count
      // for the funnel "final validated" stage -- the window can include
      // products that passed final-validation but were filtered out by
      // business-fit / dedupe afterwards.  Keeping the chart consistent
      // with what was actually exported.
      const finalValidatedFromBatch = latestBatch.final_validated_before_dedupe ?? finalValidated;
      const finalValidatedForChart = finalValidatedFromBatch;

      // Shipping review required (current run window).
      const shippingReviewRequired = await countWhere('amazon_source_checks', {
        ...inWindow('created_at'),
        eq: { col: 'shipping_review_required', value: true },
      });

      // Top rejection reason for this window.
      const { data: rejs } = await supabase()
        .from('rejected_products')
        .select('reason')
        .gte('created_at', since)
        .limit(500);
      const reasonCounts: Record<string, number> = {};
      for (const r of (rejs ?? []) as { reason: string }[]) {
        reasonCounts[r.reason] = (reasonCounts[r.reason] ?? 0) + 1;
      }
      const topRejection = Object.entries(reasonCounts).sort((a, b) => b[1] - a[1])[0];

      // Most recent manual QA approval rate.
      const { data: latestQa } = await supabase()
        .from('manual_qa_reviews')
        .select('batch_label, would_list_yes_no')
        .order('created_at', { ascending: false })
        .limit(200);
      const latestBatchLabel = (latestQa?.[0] as { batch_label: string | null } | undefined)?.batch_label ?? null;
      const sameBatch = (latestQa ?? []).filter(
        (r) => (r as { batch_label: string | null }).batch_label === latestBatchLabel,
      ) as { would_list_yes_no: string | null }[];
      const reviewed = sameBatch.filter((r) => r.would_list_yes_no === 'yes' || r.would_list_yes_no === 'no');
      const yes = reviewed.filter((r) => r.would_list_yes_no === 'yes').length;
      const latestManualQaApprovalRate = reviewed.length > 0 ? (yes / reviewed.length) * 100 : null;

      const endToEndPassRate = rawCandidates > 0 ? (finalValidatedForChart / rawCandidates) * 100 : 0;

      return {
        runId,
        exportBatchId: latestBatch.id,
        csvPath: latestBatch.file_path ?? null,
        manualQaCsvPath: deriveQaPath(latestBatch.file_path),
        metrics: {
          rawCandidates,
          asinResolved,
          asinFailed,
          amazonSourceValid,
          amazonSourceFailed,
          demandPassed,
          demandFailed,
          compliancePassed,
          complianceFailed,
          businessFitPassed,
          businessFitFailed,
          finalValidated: finalValidatedForChart,
          finalValidatedBeforeDedupe: finalValidatedFromBatch,
          duplicateAsinsRemoved: latestBatch.duplicate_asins_removed ?? 0,
          sameBatchDuplicatesRemoved:
            latestBatch.same_batch_duplicates_removed ?? latestBatch.duplicate_asins_removed ?? 0,
          crossBatchRepeatsRemoved: latestBatch.cross_batch_repeats_removed ?? 0,
          exportedAfterDedupe: latestBatch.final_exported_after_dedupe ?? latestBatch.row_count,
          exportedAfterAllFilters: latestBatch.exported_after_all_filters ?? latestBatch.row_count,
          repeatPolicy: latestBatch.repeat_policy ?? null,
          repeatLookbackDays: latestBatch.repeat_lookback_days ?? null,
          endToEndPassRate,
          shippingReviewRequired,
          topRejectionReason: topRejection ? `${topRejection[0]} (${topRejection[1]})` : null,
          latestManualQaApprovalRate,
        },
      };
    },
  });
}

interface CountWhere {
  eq?: { col: string; value: unknown };
  gte?: { col: string; value: unknown };
}

async function countWhere(table: string, where: CountWhere): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = supabase().from(table).select('*', { count: 'exact', head: true });
  if (where.eq) q = q.eq(where.eq.col, where.eq.value);
  if (where.gte) q = q.gte(where.gte.col, where.gte.value);
  const { count, error } = await q;
  if (error) return 0;
  return count ?? 0;
}

// Distinct-products count.  PostgREST doesn't support SELECT DISTINCT
// counts, so we fetch the otto_product_id column for the filter window
// and dedupe in JS.  Cheap for V1 row counts.
async function countDistinctProducts(table: string, where: CountWhere): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = supabase().from(table).select('otto_product_id');
  if (where.eq) q = q.eq(where.eq.col, where.eq.value);
  if (where.gte) q = q.gte(where.gte.col, where.gte.value);
  const { data, error } = await q;
  if (error || !data) return 0;
  const ids = new Set<string>();
  for (const row of data as { otto_product_id: string | null }[]) {
    if (row.otto_product_id) ids.add(row.otto_product_id);
  }
  return ids.size;
}

function emptyMetrics(): LatestRun['metrics'] {
  return {
    rawCandidates: 0,
    asinResolved: 0,
    asinFailed: 0,
    amazonSourceValid: 0,
    amazonSourceFailed: 0,
    demandPassed: 0,
    demandFailed: 0,
    compliancePassed: 0,
    complianceFailed: 0,
    businessFitPassed: 0,
    businessFitFailed: 0,
    finalValidated: 0,
    finalValidatedBeforeDedupe: 0,
    duplicateAsinsRemoved: 0,
    sameBatchDuplicatesRemoved: 0,
    crossBatchRepeatsRemoved: 0,
    exportedAfterDedupe: 0,
    exportedAfterAllFilters: 0,
    repeatPolicy: null,
    repeatLookbackDays: null,
    endToEndPassRate: 0,
    shippingReviewRequired: 0,
    topRejectionReason: null,
    latestManualQaApprovalRate: null,
  };
}

function deriveQaPath(csvPath: string | null): string | null {
  if (!csvPath) return null;
  const m = csvPath.match(/otto-validated-(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return `exports/otto_manual_qa_review_${m[1]}-${m[2]}-${m[3]}.csv`;
}

// ---------------------------------------------------------------------------
// Per-page queries
// ---------------------------------------------------------------------------

export interface ValidatedProductsOptions {
  limit?: number;
  /** When set, filter to this export batch (uuid). */
  exportBatchId?: string | null;
  /** Include is_synthetic=true rows. Defaults to false (real exports only). */
  includeSynthetic?: boolean;
}

export function useValidatedProducts(opts: ValidatedProductsOptions = {}) {
  const { limit = 500, exportBatchId, includeSynthetic = false } = opts;
  return useQuery<ValidatedProduct[]>({
    queryKey: ['validated_products', limit, exportBatchId ?? null, includeSynthetic],
    queryFn: async () => {
      if (MOCK || !SUPABASE_CONFIGURED) {
        const all = (mock.validated_products ?? []) as ValidatedProduct[];
        return all.filter((p) => (includeSynthetic ? true : !p.is_synthetic))
          .filter((p) => (exportBatchId ? p.export_batch_id === exportBatchId : true))
          .slice(0, limit);
      }
      let q = supabase()
        .from('validated_products')
        .select('*')
        .order('validated_at', { ascending: false })
        .limit(limit);
      if (!includeSynthetic) q = q.eq('is_synthetic', false);
      if (exportBatchId) q = q.eq('export_batch_id', exportBatchId);
      const { data, error } = await q;
      if (error) throw new Error(`validated_products: ${error.message}`);
      return (data ?? []) as ValidatedProduct[];
    },
  });
}

/**
 * Distinct export batches that have validated_products rows, latest first.
 * Used by the page-level batch selector.
 */
export function useValidatedProductBatches(includeSynthetic = false) {
  return useQuery<{ exportBatchId: string; latestExportedAt: string | null; rowCount: number }[]>({
    queryKey: ['validated_product_batches', includeSynthetic],
    queryFn: async () => {
      if (MOCK || !SUPABASE_CONFIGURED) {
        const rows = (mock.validated_products ?? []) as ValidatedProduct[];
        const map = new Map<string, { latest: string | null; n: number }>();
        for (const r of rows) {
          if (!r.export_batch_id) continue;
          if (!includeSynthetic && r.is_synthetic) continue;
          const cur = map.get(r.export_batch_id) ?? { latest: null, n: 0 };
          cur.n += 1;
          if (!cur.latest || (r.exported_at ?? '') > cur.latest) cur.latest = r.exported_at ?? null;
          map.set(r.export_batch_id, cur);
        }
        return [...map.entries()].map(([exportBatchId, v]) => ({
          exportBatchId,
          latestExportedAt: v.latest,
          rowCount: v.n,
        })).sort((a, b) => (b.latestExportedAt ?? '').localeCompare(a.latestExportedAt ?? ''));
      }
      let q = supabase()
        .from('validated_products')
        .select('export_batch_id, exported_at, is_synthetic')
        .limit(5000);
      if (!includeSynthetic) q = q.eq('is_synthetic', false);
      const { data, error } = await q;
      if (error) throw new Error(`validated_products batches: ${error.message}`);
      const map = new Map<string, { latest: string | null; n: number }>();
      for (const row of (data ?? []) as { export_batch_id: string | null; exported_at: string | null }[]) {
        if (!row.export_batch_id) continue;
        const cur = map.get(row.export_batch_id) ?? { latest: null, n: 0 };
        cur.n += 1;
        if (!cur.latest || (row.exported_at ?? '') > cur.latest) cur.latest = row.exported_at ?? null;
        map.set(row.export_batch_id, cur);
      }
      return [...map.entries()].map(([exportBatchId, v]) => ({
        exportBatchId,
        latestExportedAt: v.latest,
        rowCount: v.n,
      })).sort((a, b) => (b.latestExportedAt ?? '').localeCompare(a.latestExportedAt ?? ''));
    },
  });
}

export function useRejectedProducts(limit = 500) {
  return useQuery<RejectedProduct[]>({
    queryKey: ['rejected_products', limit],
    queryFn: () => fetchTable('rejected_products', { order: { col: 'created_at', ascending: false }, limit }),
  });
}

export function useBusinessFitChecks(limit = 500) {
  return useQuery<BusinessFitCheck[]>({
    queryKey: ['business_fit_checks', limit],
    queryFn: () => fetchTable('business_fit_checks', { order: { col: 'created_at', ascending: false }, limit }),
  });
}

export function useAmazonSourceChecks(limit = 500) {
  return useQuery<AmazonSourceCheck[]>({
    queryKey: ['amazon_source_checks', limit],
    queryFn: () => fetchTable('amazon_source_checks', { order: { col: 'created_at', ascending: false }, limit }),
  });
}

export function useExportBatches(limit = 50) {
  return useQuery<ExportBatch[]>({
    queryKey: ['export_batches', limit],
    queryFn: () => fetchTable('export_batches', { order: { col: 'created_at', ascending: false }, limit }),
  });
}

export function useLatestAmazonEnvCheck() {
  return useQuery<AmazonEnvCheck | null>({
    queryKey: ['amazon_environment_checks', 'latest'],
    queryFn: async () => {
      if (MOCK || !SUPABASE_CONFIGURED) return (mock.amazonEnvCheck ?? null) as AmazonEnvCheck | null;
      const { data, error } = await supabase()
        .from('amazon_environment_checks')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1);
      if (error) throw new Error(`amazon_environment_checks: ${error.message}`);
      return ((data ?? []) as AmazonEnvCheck[])[0] ?? null;
    },
  });
}

export function useExportExclusions(limit = 500) {
  return useQuery<ExportExclusion[]>({
    queryKey: ['export_exclusions', limit],
    queryFn: () => fetchTable('export_exclusions', { order: { col: 'created_at', ascending: false }, limit }),
  });
}

export function useManualQaReviews(limit = 500) {
  return useQuery<ManualQaReview[]>({
    queryKey: ['manual_qa_reviews', limit],
    queryFn: () => fetchTable('manual_qa_reviews', { order: { col: 'created_at', ascending: false }, limit }),
  });
}

export function useAgentLogs(limit = 300) {
  return useQuery<AgentLog[]>({
    queryKey: ['agent_logs', limit],
    queryFn: () => fetchTable('agent_logs', { order: { col: 'created_at', ascending: false }, limit }),
  });
}

export function useAgentVotes(limit = 300) {
  return useQuery<AgentVote[]>({
    queryKey: ['agent_votes', limit],
    queryFn: () => fetchTable('agent_votes', { order: { col: 'created_at', ascending: false }, limit }),
  });
}

export function useDiscoveryRuns(limit = 30) {
  return useQuery<DiscoveryRun[]>({
    queryKey: ['discovery_runs', limit],
    queryFn: () => fetchTable('discovery_runs', { order: { col: 'started_at', ascending: false }, limit }),
  });
}
