// Pure Keepa candidate filtering with diagnostic reason codes.  Used by
// KeepaRankMovementDiscoveryAgent and unit-tested directly.  This only
// decides what Keepa input enters the pipeline; it never affects the
// downstream validation gates.

import { isCategoryAllowed } from '@/utils/keepaCategories';
import type { NormalizedKeepaProduct } from '@/clients/keepaClient';

export const KeepaFilterReason = {
  KEEPA_CATEGORY_EXCLUDED: 'KEEPA_CATEGORY_EXCLUDED',
  KEEPA_PRICE_TOO_LOW: 'KEEPA_PRICE_TOO_LOW',
  KEEPA_PRICE_TOO_HIGH: 'KEEPA_PRICE_TOO_HIGH',
  KEEPA_RANK_IMPROVEMENT_TOO_LOW: 'KEEPA_RANK_IMPROVEMENT_TOO_LOW',
  KEEPA_MISSING_ASIN: 'KEEPA_MISSING_ASIN',
  KEEPA_MISSING_TITLE: 'KEEPA_MISSING_TITLE',
  KEEPA_MISSING_PRICE: 'KEEPA_MISSING_PRICE',
  KEEPA_UNSUPPORTED_CATEGORY: 'KEEPA_UNSUPPORTED_CATEGORY',
} as const;

export type KeepaFilterReasonCode = (typeof KeepaFilterReason)[keyof typeof KeepaFilterReason];

export interface KeepaFilterOpts {
  minRankImprovementPercent: number;
  minAmazonPrice: number;
  maxAmazonPrice: number;
  excludedCategoriesCsv?: string;
  /** When true, a missing Amazon price snapshot is a rejection (default: allow). */
  requirePrice?: boolean;
}

export interface KeepaFilterDecision {
  accepted: boolean;
  reason?: KeepaFilterReasonCode;
}

/**
 * Decide whether a normalized Keepa product should enter the pipeline.
 * Order matters: structural problems first, then category, then movement,
 * then price.  Missing/undefined movement is NOT rejected (we can't judge
 * it) so downstream gates still get a look.
 */
export function classifyKeepaCandidate(
  norm: NormalizedKeepaProduct | null,
  opts: KeepaFilterOpts,
): KeepaFilterDecision {
  if (!norm || !norm.asin) {
    return { accepted: false, reason: KeepaFilterReason.KEEPA_MISSING_ASIN };
  }
  if (!norm.title || norm.title.trim().length === 0) {
    return { accepted: false, reason: KeepaFilterReason.KEEPA_MISSING_TITLE };
  }
  // No category info at all -> can't classify safely.
  if (!norm.amazonCategory && norm.rootCategory === undefined) {
    return { accepted: false, reason: KeepaFilterReason.KEEPA_UNSUPPORTED_CATEGORY };
  }
  if (!isCategoryAllowed(norm.amazonCategory, norm.title, opts.excludedCategoriesCsv)) {
    return { accepted: false, reason: KeepaFilterReason.KEEPA_CATEGORY_EXCLUDED };
  }
  if (
    opts.minRankImprovementPercent > 0 &&
    typeof norm.rankImprovement30d === 'number' &&
    norm.rankImprovement30d < opts.minRankImprovementPercent
  ) {
    return { accepted: false, reason: KeepaFilterReason.KEEPA_RANK_IMPROVEMENT_TOO_LOW };
  }
  if (typeof norm.amazonPrice === 'number') {
    if (norm.amazonPrice < opts.minAmazonPrice) {
      return { accepted: false, reason: KeepaFilterReason.KEEPA_PRICE_TOO_LOW };
    }
    if (norm.amazonPrice > opts.maxAmazonPrice) {
      return { accepted: false, reason: KeepaFilterReason.KEEPA_PRICE_TOO_HIGH };
    }
  } else if (opts.requirePrice) {
    return { accepted: false, reason: KeepaFilterReason.KEEPA_MISSING_PRICE };
  }
  return { accepted: true };
}
