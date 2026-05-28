import type { ValidatedProduct } from '@/types/product';
import { RejectionReason } from '@/utils/rejectionReasons';

export type RepeatPolicy = 'allow_repeats' | 'exclude_recent' | 'never_repeat';

export const REPEAT_POLICIES: RepeatPolicy[] = ['allow_repeats', 'exclude_recent', 'never_repeat'];

export function isRepeatPolicy(v: string): v is RepeatPolicy {
  return (REPEAT_POLICIES as string[]).includes(v);
}

/** Normalize an arbitrary string into a known policy, falling back to a default. */
export function normalizeRepeatPolicy(v: string | undefined, fallback: RepeatPolicy = 'exclude_recent'): RepeatPolicy {
  if (v && isRepeatPolicy(v)) return v;
  return fallback;
}

/** A prior export of an ASIN, from non-synthetic validated_products. */
export interface PriorExport {
  asin: string;
  exportBatchId: string | null;
  exportedAt: string | null; // ISO timestamp; null = unknown
}

export interface CrossBatchExclusion {
  ottoProductId: string;
  asin: string;
  exclusionReason: typeof RejectionReason.PREVIOUSLY_EXPORTED_ASIN | typeof RejectionReason.PREVIOUSLY_EXPORTED_RECENTLY;
  priorExportBatchId: string | null;
  priorExportedAt: string | null;
}

export interface CrossBatchFilterInput {
  /** Products that already survived same-batch ASIN dedupe. */
  products: ValidatedProduct[];
  /** Prior exports (non-synthetic) keyed by ASIN; multiple rows per ASIN ok. */
  priorExports: PriorExport[];
  policy: RepeatPolicy;
  lookbackDays: number;
  /** Defaults to now; injectable for tests. */
  now?: Date;
}

export interface CrossBatchFilterResult {
  keptProducts: ValidatedProduct[];
  exclusions: CrossBatchExclusion[];
}

/**
 * Filter out ASINs that were already exported in earlier batches,
 * according to the repeat policy.  Pure function: no I/O.
 *
 *  - allow_repeats : keep everything (same-batch dedupe already ran upstream)
 *  - never_repeat  : drop any ASIN that has ever been exported before
 *  - exclude_recent: drop any ASIN exported within `lookbackDays`
 *
 * `priorExports` MUST already exclude synthetic rows so test/mock exports
 * never block real ones.
 */
export function filterCrossBatch(input: CrossBatchFilterInput): CrossBatchFilterResult {
  const { products, priorExports, policy, lookbackDays } = input;
  const now = input.now ?? new Date();

  if (policy === 'allow_repeats') {
    return { keptProducts: products, exclusions: [] };
  }

  // Build the most-relevant prior export per ASIN (most recent wins).
  const priorByAsin = new Map<string, PriorExport>();
  for (const prior of priorExports) {
    const key = (prior.asin ?? '').trim();
    if (!key) continue;
    const existing = priorByAsin.get(key);
    if (!existing) {
      priorByAsin.set(key, prior);
      continue;
    }
    const a = prior.exportedAt ? Date.parse(prior.exportedAt) : 0;
    const b = existing.exportedAt ? Date.parse(existing.exportedAt) : 0;
    if (a >= b) priorByAsin.set(key, prior);
  }

  const cutoffMs = now.getTime() - lookbackDays * 24 * 60 * 60 * 1000;

  const kept: ValidatedProduct[] = [];
  const exclusions: CrossBatchExclusion[] = [];

  for (const product of products) {
    const asin = (product.asin ?? '').trim();
    const prior = asin ? priorByAsin.get(asin) : undefined;
    if (!prior) {
      kept.push(product);
      continue;
    }

    if (policy === 'never_repeat') {
      exclusions.push({
        ottoProductId: product.ottoProductId,
        asin,
        exclusionReason: RejectionReason.PREVIOUSLY_EXPORTED_ASIN,
        priorExportBatchId: prior.exportBatchId,
        priorExportedAt: prior.exportedAt,
      });
      continue;
    }

    // exclude_recent
    const exportedMs = prior.exportedAt ? Date.parse(prior.exportedAt) : NaN;
    const isRecent = Number.isFinite(exportedMs) ? exportedMs >= cutoffMs : true;
    if (isRecent) {
      exclusions.push({
        ottoProductId: product.ottoProductId,
        asin,
        exclusionReason: RejectionReason.PREVIOUSLY_EXPORTED_RECENTLY,
        priorExportBatchId: prior.exportBatchId,
        priorExportedAt: prior.exportedAt,
      });
      continue;
    }
    kept.push(product);
  }

  return { keptProducts: kept, exclusions };
}
