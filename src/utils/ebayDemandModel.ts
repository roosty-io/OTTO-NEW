import { clamp, weightedAverage } from '@/utils/scoring';
import type { ScoredComparable } from '@/utils/ebayComparableScoring';

export interface DemandAggregates {
  activeListingCount: number;
  relevantComparableCount: number;
  exactOrSimilarMatchCount: number;
  sellerCount: number;
  sellerConcentrationScore: number;
  medianComparablePrice?: number;
  avgComparablePrice?: number;
  priceBandMin?: number;
  priceBandMax?: number;
  lowPrice?: number;
  highPrice?: number;
  listingQualityGapScore: number;
  competitionDensityScore: number;
  priceViabilityScore: number;
  duplicateRatio: number;
}

export interface DemandModelInput {
  scored: ScoredComparable[];
  amazonPrice?: number;
  sourceConfidenceScore?: number; // from ASIN resolver
  sourceValidityScore?: number; // from Amazon source agent
  policyRiskScore?: number; // optional pre-existing compliance risk
}

export interface DemandModelOutput extends DemandAggregates {
  demandScore: number;
  sellWithin30DaysConfidence: number;
  stagnationRiskScore: number;
  categoryVelocityScore: number;
  keywordDemandScore: number;
  competitorSuccessScore: number;
  saturationScore: number;
  trendMomentumScore: number;
  demandType: 'high_velocity' | 'steady' | 'seasonal' | 'niche' | 'unknown';
}

export function aggregateComparables(scored: ScoredComparable[]): DemandAggregates {
  const activeListingCount = scored.length;
  const relevant = scored.filter((c) => c.relevant);
  const relevantComparableCount = relevant.length;
  const exactOrSimilarMatchCount = relevant.filter(
    (c) => c.comparableMatchType === 'EXACT_MATCH' || c.comparableMatchType === 'SIMILAR_MATCH',
  ).length;

  const sellers = new Set<string>();
  const sellerHits = new Map<string, number>();
  for (const c of relevant) {
    if (c.sellerUsername) {
      sellers.add(c.sellerUsername);
      sellerHits.set(c.sellerUsername, (sellerHits.get(c.sellerUsername) ?? 0) + 1);
    }
  }
  const sellerCount = sellers.size;
  const topSellerCount = Math.max(0, ...Array.from(sellerHits.values()));
  const sellerConcentrationScore = relevantComparableCount > 0
    ? clamp((topSellerCount / relevantComparableCount) * 100)
    : 0;

  const prices = relevant.map((c) => c.price).filter((p): p is number => typeof p === 'number' && p > 0);
  const sorted = [...prices].sort((a, b) => a - b);
  const medianComparablePrice = sorted.length > 0
    ? (sorted.length % 2 === 1 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2)
    : undefined;
  const avgComparablePrice = sorted.length > 0
    ? sorted.reduce((a, b) => a + b, 0) / sorted.length
    : undefined;
  const lowPrice = sorted[0];
  const highPrice = sorted[sorted.length - 1];
  const priceBandMin = lowPrice;
  const priceBandMax = highPrice;

  const listingQualityGapScore = listingQualityGap(relevant);
  const competitionDensityScore = competitionDensity(relevantComparableCount, sellerCount);
  const duplicateRatio = duplicateTitleRatio(relevant);

  return {
    activeListingCount,
    relevantComparableCount,
    exactOrSimilarMatchCount,
    sellerCount,
    sellerConcentrationScore,
    medianComparablePrice,
    avgComparablePrice,
    priceBandMin,
    priceBandMax,
    lowPrice,
    highPrice,
    listingQualityGapScore,
    competitionDensityScore,
    priceViabilityScore: 0, // overwritten by buildDemandModel
    duplicateRatio,
  };
}

export function buildDemandModel(input: DemandModelInput): DemandModelOutput {
  const aggregates = aggregateComparables(input.scored);
  const relevant = input.scored.filter((c) => c.relevant);

  // ---------- Sub-scores ----------
  // Higher when we see strong evidence of demand.

  const keywordDemandScore = clamp(40 + Math.min(60, aggregates.relevantComparableCount * 4));
  const categoryVelocityScore = categoryVelocity(relevant);
  const competitorSuccessScore = competitorSuccess(relevant);
  const saturationScore = saturationFrom(aggregates);
  const trendMomentumScore = trendMomentum(input.scored, aggregates);

  // Price viability: share of relevant listings priced above amazonPrice * markup.
  const priceViabilityScore = priceViability(relevant, input.amazonPrice);
  aggregates.priceViabilityScore = priceViabilityScore;

  // ---------- Combined demand & confidence ----------
  const demandScore = clamp(
    weightedAverage([
      { value: keywordDemandScore, weight: 1.5 },
      { value: categoryVelocityScore, weight: 1 },
      { value: competitorSuccessScore, weight: 2 },
      { value: 100 - saturationScore, weight: 1.5 },
      { value: trendMomentumScore, weight: 1 },
      { value: priceViabilityScore, weight: 2 },
    ]),
  );

  const sourceBoost = input.sourceConfidenceScore !== undefined ? (input.sourceConfidenceScore - 75) * 0.1 : 0;
  const validityBoost = input.sourceValidityScore !== undefined ? (input.sourceValidityScore - 75) * 0.1 : 0;
  const policyDrag = input.policyRiskScore !== undefined ? input.policyRiskScore * 0.2 : 0;

  const sellWithin30DaysConfidence = clamp(
    demandScore * 0.85 +
      Math.min(aggregates.exactOrSimilarMatchCount, 10) * 1.5 +
      (priceViabilityScore - 50) * 0.2 +
      sourceBoost +
      validityBoost -
      policyDrag,
  );

  const stagnationRiskScore = stagnationRisk(aggregates, relevant);

  const demandType = classifyDemandType({
    sellWithin30DaysConfidence,
    relevantComparableCount: aggregates.relevantComparableCount,
    exactOrSimilarMatchCount: aggregates.exactOrSimilarMatchCount,
    stagnationRiskScore,
  });

  return {
    ...aggregates,
    demandScore,
    sellWithin30DaysConfidence,
    stagnationRiskScore,
    categoryVelocityScore,
    keywordDemandScore,
    competitorSuccessScore,
    saturationScore,
    trendMomentumScore,
    demandType,
  };
}

// ---------------------------------------------------------------------------
// Sub-score helpers
// ---------------------------------------------------------------------------

function competitorSuccess(relevant: ScoredComparable[]): number {
  if (relevant.length === 0) return 0;
  const fbs = relevant
    .map((c) => c.sellerFeedbackPercent)
    .filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0);
  if (fbs.length === 0) return 50;
  const avg = fbs.reduce((a, b) => a + b, 0) / fbs.length;
  const highFb = relevant.filter((c) => (c.sellerFeedbackScore ?? 0) > 1000).length / relevant.length;
  return clamp((avg - 90) * 5 + highFb * 30);
}

function categoryVelocity(relevant: ScoredComparable[]): number {
  if (relevant.length === 0) return 0;
  // Proxy: average category match score weighted by listing quality.
  const parts = relevant.map((c) => ({
    value: (c.categoryMatchScore + c.listingQualityScore) / 2,
    weight: 1,
  }));
  return clamp(weightedAverage(parts));
}

function saturationFrom(aggregates: DemandAggregates): number {
  // High concentration + high active count + low seller diversity = saturated.
  const active = aggregates.activeListingCount;
  const sellers = aggregates.sellerCount;
  if (active < 5) return 30; // not enough data to call saturated
  const sellerDiversity = sellers === 0 ? 0 : Math.min(100, (sellers / Math.max(active, 1)) * 100);
  // If many active listings but few sellers, saturation is high.
  const base = clamp(Math.min(active, 60) - sellerDiversity * 0.5 + aggregates.sellerConcentrationScore * 0.5);
  return base;
}

function trendMomentum(scored: ScoredComparable[], aggregates: DemandAggregates): number {
  // V1: we don't have historical sold-data, so trend momentum is a soft proxy
  // mixing listing freshness (top rated, fresh sellers) with relevance density.
  const topRated = scored.filter((c) => (c.listingQualityScore ?? 0) >= 80).length;
  const relevance = aggregates.relevantComparableCount;
  return clamp(40 + Math.min(30, topRated * 2) + Math.min(30, relevance));
}

function priceViability(relevant: ScoredComparable[], amazonPrice: number | undefined): number {
  if (!amazonPrice || amazonPrice <= 0) return 50;
  if (relevant.length === 0) return 0;
  const target = amazonPrice * 1.25;
  const above = relevant.filter((c) => typeof c.price === 'number' && c.price >= target).length;
  return clamp((above / relevant.length) * 100);
}

function listingQualityGap(relevant: ScoredComparable[]): number {
  if (relevant.length === 0) return 0;
  // High score when many low-quality listings dominate (gap opportunity).
  const low = relevant.filter((c) => c.listingQualityScore < 50).length;
  const high = relevant.filter((c) => c.listingQualityScore >= 80).length;
  if (relevant.length === 0) return 0;
  return clamp(((low - high) / relevant.length) * 100 + 50);
}

function competitionDensity(relevantCount: number, sellerCount: number): number {
  if (sellerCount === 0) return 0;
  // listings per seller; > 3 implies templated / saturated competition.
  const density = relevantCount / sellerCount;
  if (density <= 1.2) return 100;
  if (density <= 1.8) return 80;
  if (density <= 2.5) return 60;
  if (density <= 3.5) return 40;
  return 20;
}

function duplicateTitleRatio(relevant: ScoredComparable[]): number {
  if (relevant.length === 0) return 0;
  const seen = new Map<string, number>();
  for (const c of relevant) {
    const sig = signature(c.title);
    seen.set(sig, (seen.get(sig) ?? 0) + 1);
  }
  const duplicates = Array.from(seen.values()).filter((n) => n >= 2).reduce((a, b) => a + b, 0);
  return clamp((duplicates / Math.max(relevant.length, 1)) * 100);
}

function signature(title: string): string {
  const tokens = title.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 6);
  return tokens.sort().join('|');
}

function stagnationRisk(aggregates: DemandAggregates, relevant: ScoredComparable[]): number {
  let score = 0;
  // Lots of active listings but few are relevant -> generic / low-intent.
  if (aggregates.activeListingCount >= 10) {
    const relevanceRatio = aggregates.relevantComparableCount / aggregates.activeListingCount;
    if (relevanceRatio < 0.2) score += 35;
    else if (relevanceRatio < 0.35) score += 20;
  }
  // Single seller dominates the market.
  if (aggregates.sellerConcentrationScore >= 60) score += 25;
  else if (aggregates.sellerConcentrationScore >= 40) score += 10;
  // Heavy duplicate / templated listings.
  if (aggregates.duplicateRatio >= 40) score += 25;
  else if (aggregates.duplicateRatio >= 20) score += 10;
  // No exact / similar matches at all.
  if (aggregates.exactOrSimilarMatchCount === 0) score += 20;
  // Compressed price band (low entropy) suggests a race to the bottom.
  if (
    typeof aggregates.priceBandMin === 'number' &&
    typeof aggregates.priceBandMax === 'number' &&
    aggregates.priceBandMin > 0
  ) {
    const compression = aggregates.priceBandMax / aggregates.priceBandMin;
    if (compression < 1.1) score += 15;
  }
  // Very few relevant comparables overall.
  if (aggregates.relevantComparableCount < 3) score += 10;
  return clamp(score);
  void relevant; // listed for future per-listing recency signals
}

function classifyDemandType(args: {
  sellWithin30DaysConfidence: number;
  relevantComparableCount: number;
  exactOrSimilarMatchCount: number;
  stagnationRiskScore: number;
}): 'high_velocity' | 'steady' | 'seasonal' | 'niche' | 'unknown' {
  if (args.sellWithin30DaysConfidence >= 85 && args.relevantComparableCount >= 20) return 'high_velocity';
  if (args.sellWithin30DaysConfidence >= 70 && args.relevantComparableCount >= 10) return 'steady';
  if (args.sellWithin30DaysConfidence >= 60 && args.relevantComparableCount >= 5) return 'niche';
  if (args.stagnationRiskScore > 60) return 'unknown';
  return 'unknown';
}
