import type { ProductCandidate } from '@/types/product';

export interface ResolvedAsin {
  asin: string;
  amazonUrl: string;
  score: number;
  price?: number;
  productMatchType: 'exact' | 'similar';
  /** true when the ASIN came from discovery (Keepa) and the resolver was skipped. */
  bypassed: boolean;
}

/**
 * Pure decision for ASIN-native candidates: if the discovery agent
 * already provided an ASIN (e.g. Keepa), return a high-confidence
 * resolution and signal that the BasicAmazonAsinResolverAgent should be
 * bypassed.  Returns null when there is no ASIN, meaning the caller must
 * fall back to the real resolver.
 */
export function asinNativeResolution(candidate: ProductCandidate): ResolvedAsin | null {
  const asin = (candidate.asin ?? '').trim();
  if (!asin) return null;
  return {
    asin,
    amazonUrl: candidate.amazonUrl ?? `https://www.amazon.com/dp/${asin}`,
    score: candidate.sourceConfidenceScore ?? 90,
    price: candidate.priceHint,
    productMatchType: 'exact',
    bypassed: true,
  };
}
