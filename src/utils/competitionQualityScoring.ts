// V1.2 competition / saturation quality scoring.
//
// Learned from manual QA: products with strong demand (sell_within_30_days
// confidence 85+) still got operator-rejected for "too many sellers /
// too many similar listings" when the eBay market was a crowded commodity
// race.  This module turns that signal into explicit per-axis scores plus
// a final competition_gate_result so the BusinessFit agent can reject
// saturated markets rather than letting them slip through on demand alone.
//
// Axis convention: each *_score is 0-100 with higher = more concerning,
// EXCEPT competitionQualityScore which is 0-100 higher = healthier market.

import { clamp } from '@/utils/scoring';
import { containsAny } from '@/utils/normalize';
import { THRESHOLDS } from '@/config/thresholds';
import { RejectionReason } from '@/utils/rejectionReasons';

export interface CompetitionInput {
  amazonPrice?: number;
  productTitle?: string;
  // Demand-side aggregates (from EbayDemandScoringAgent).
  relevantComparableCount?: number;
  exactOrSimilarMatchCount?: number;
  sellerCount?: number;
  sellerConcentrationScore?: number;
  duplicateRatio?: number;
  competitionDensityScore?: number;
  medianComparablePrice?: number;
  avgComparablePrice?: number;
  priceBandMin?: number;
  priceBandMax?: number;
  priceViabilityScore?: number;
  // Sell-side signals.
  sellWithin30DaysConfidence?: number;
  stagnationRiskScore?: number;
  // Compliance-side signal (so the gate can apply the healthy-competition
  // rescue only when policy risk is low).
  policyRiskScore?: number;
}

export type CompetitionGateResult = 'healthy' | 'borderline' | 'saturated';

export interface CompetitionOutput {
  competitionQualityScore: number; // higher = healthier
  sellerCompetitionScore: number;
  exactMatchSaturationScore: number;
  duplicateListingScore: number;
  priceCompressionScore: number;
  differentiationScore: number;
  sameSourceLikelihoodScore: number;
  isGenericCommodity: boolean;
  competitionGateResult: CompetitionGateResult;
  competitionRejectionReason?: string;
  reasonCodes: string[];
  notes: string[];
}

// Commodity-product cues drawn from operator-rejected examples plus common
// V1 keyword categories.  These are NOT a blacklist - they're only used as
// a multiplier when other saturation signals are also hot.
const COMMODITY_CUES = [
  'cable tray', 'cable management', 'cord organizer',
  'kneeling pad', 'knee pad',
  'craft storage box', 'storage box', 'bead organizer',
  'drawer organizer', 'drawer divider',
  'under sink organizer',
  'garage rack', 'storage rack',
  'storage bin', 'plastic organizer',
  'parts organizer',
];

export function scoreCompetitionQuality(input: CompetitionInput): CompetitionOutput {
  const reasonCodes: string[] = [];
  const notes: string[] = [];

  const isGenericCommodity = Boolean(containsAny(input.productTitle ?? '', COMMODITY_CUES));
  if (isGenericCommodity) notes.push('generic commodity title detected');

  const sellerCompetition = computeSellerCompetition(input, notes);
  const exactMatchSaturation = computeExactMatchSaturation(input, notes);
  const duplicateListing = computeDuplicateListing(input, notes);
  const priceCompression = computePriceCompression(input, notes);
  const differentiationScore = computeDifferentiation(input);
  const sameSourceLikelihoodScore = computeSameSource(input, notes);

  // The isGenericCommodity flag is informational - we surface it in the
  // CSV and the manual QA review so reviewers can spot patterns. We
  // intentionally do NOT auto-bump per-axis scores when commodity=true
  // because a previous run showed it stacked with the normal curves and
  // over-rejected commodity-organizer products that were actually fine.

  // Overall competition health: start at 100, drag down by the strongest
  // concerning axes (weighted).  Highest single axis dominates so a single
  // very-bad signal still surfaces.
  const drag =
    sellerCompetition * 0.25 +
    exactMatchSaturation * 0.30 +
    duplicateListing * 0.20 +
    priceCompression * 0.25;
  const competitionQualityScore = clamp(100 - drag);

  // Gate decision (V1.4: combined-evidence, healthy-competition rescue).
  const { result, code } = decideGate({
    competitionQualityScore,
    sellerCompetitionScore: sellerCompetition,
    exactMatchSaturationScore: exactMatchSaturation,
    duplicateListingScore: duplicateListing,
    priceCompressionScore: priceCompression,
    sellConfidence: input.sellWithin30DaysConfidence ?? 0,
    priceViability: input.priceViabilityScore ?? 0,
    differentiationScore,
    isGenericCommodity,
    sellerCount: input.sellerCount ?? 0,
    exactOrSimilarMatchCount: input.exactOrSimilarMatchCount ?? 0,
    duplicateRatio: input.duplicateRatio ?? 0,
    stagnationRiskScore: input.stagnationRiskScore ?? 0,
    competitionDensityScore: input.competitionDensityScore ?? 0,
    amazonPrice: input.amazonPrice ?? 0,
    policyRiskScore: input.policyRiskScore ?? 0,
    notes,
    reasonCodes,
  });

  return {
    competitionQualityScore,
    sellerCompetitionScore: sellerCompetition,
    exactMatchSaturationScore: exactMatchSaturation,
    duplicateListingScore: duplicateListing,
    priceCompressionScore: priceCompression,
    differentiationScore,
    sameSourceLikelihoodScore,
    isGenericCommodity,
    competitionGateResult: result,
    competitionRejectionReason: code,
    reasonCodes,
    notes,
  };
}

// ---------------------------------------------------------------------------
// Per-axis sub-scores
// ---------------------------------------------------------------------------

function computeSellerCompetition(input: CompetitionInput, notes: string[]): number {
  // Commodity categories on eBay routinely return 20-30 unique sellers
  // without that being a problem - only crowd-race levels of seller count
  // should trigger the gate. Curve tuned so a typical organizer market
  // (sellers=22, low concentration) stays under MAX=80.
  const sellerCount = input.sellerCount ?? 0;
  const concentration = input.sellerConcentrationScore ?? 0;
  let s = 0;
  if (sellerCount >= 45) s += 75;
  else if (sellerCount >= 32) s += 55;
  else if (sellerCount >= 22) s += 30;
  else if (sellerCount >= 12) s += 10;
  // Very low concentration (no brand owns the market) + many sellers
  // = commodity race; tighten only when both are clearly hot.
  if (sellerCount >= 25 && concentration < 18) s += 20;
  // Extreme concentration (1 seller > 80%) is suspicious.
  if (concentration >= 80) s += 10;
  if (s > 0) notes.push(`seller_competition sellers=${sellerCount} conc=${concentration.toFixed(0)}`);
  return clamp(s);
}

function computeExactMatchSaturation(input: CompetitionInput, notes: string[]): number {
  // Tolerate commodity organizer ranges (8-18 exact matches is normal for
  // a healthy market); only fire hard once exact saturation is extreme.
  const exact = input.exactOrSimilarMatchCount ?? 0;
  const relevant = input.relevantComparableCount ?? 0;
  let s = 0;
  if (exact >= 30) s = 85;
  else if (exact >= 20) s = 70;
  else if (exact >= 14) s = 50;
  else if (exact >= 9) s = 25;
  // If exact matches dominate the relevant set AND there are a lot of
  // them, push the score up further. Only fires when both are true so it
  // doesn't trip on small data sets.
  if (relevant >= 10) {
    const ratio = exact / relevant;
    if (ratio >= 0.85 && exact >= 14) s = Math.max(s, 80);
  }
  if (s > 0) notes.push(`exact_match_saturation exact=${exact} relevant=${relevant}`);
  return clamp(s);
}

function computeDuplicateListing(input: CompetitionInput, notes: string[]): number {
  // duplicateRatio is computed from first-6-token signatures across
  // relevant comparables. Commodity organizer markets (kneeling pads,
  // craft storage boxes) naturally share signatures across many sellers
  // without being actual duplicate listings, so the curve below tolerates
  // moderate duplication and only fires hard on extreme overlap.
  const dup = input.duplicateRatio ?? 0;
  let s = 0;
  if (dup >= 75) s = 80;
  else if (dup >= 60) s = 60;
  else if (dup >= 45) s = 35;
  else if (dup >= 30) s = 15;
  if (s > 0) notes.push(`duplicate_listing dup_ratio=${dup.toFixed(0)}`);
  return clamp(s);
}

function computePriceCompression(input: CompetitionInput, notes: string[]): number {
  const amazonPrice = input.amazonPrice;
  if (!amazonPrice || amazonPrice <= 0) return 0;
  let s = 0;
  const median = input.medianComparablePrice;
  if (typeof median === 'number') {
    const ratio = median / amazonPrice;
    if (ratio < 1.1) s = 90; // eBay market priced AT or below Amazon cost
    else if (ratio < 1.25) s = 70; // < 25% gross margin before fees
    else if (ratio < 1.4) s = 45;
    else if (ratio < 1.6) s = 20;
  } else {
    s = 40;
    notes.push('price_compression: median comparable price unavailable');
  }
  // Narrow price band is its own compression signal.
  const lo = input.priceBandMin;
  const hi = input.priceBandMax;
  if (typeof lo === 'number' && typeof hi === 'number' && lo > 0) {
    const spread = hi / lo;
    if (spread < 1.15 && lo > 0) s = Math.max(s, 75);
    else if (spread < 1.3) s = Math.max(s, 55);
  }
  // Price viability is the inverse of compression and the most direct
  // signal of margin headroom; pull from the demand engine when available.
  const pv = input.priceViabilityScore;
  if (typeof pv === 'number') {
    if (pv < 30) s = Math.max(s, 80);
    else if (pv < 50) s = Math.max(s, 60);
    else if (pv < 70) s = Math.max(s, 35);
  }
  if (s > 0) notes.push(`price_compression compression_score=${s.toFixed(0)}`);
  return clamp(s);
}

function computeDifferentiation(input: CompetitionInput): number {
  // Higher = more differentiated.  Combines sale-confidence vs saturation
  // pressure: a product can have low differentiation even when demand is
  // strong if competitors are nearly identical.
  let s = 100;
  s -= (input.exactOrSimilarMatchCount ?? 0) >= 15 ? 25 : 0;
  s -= (input.duplicateRatio ?? 0) >= 30 ? 20 : 0;
  s -= (input.sellerCount ?? 0) >= 20 ? 15 : 0;
  s += (input.stagnationRiskScore ?? 0) > 0 ? -(input.stagnationRiskScore ?? 0) * 0.2 : 0;
  return clamp(s);
}

function computeSameSource(input: CompetitionInput, notes: string[]): number {
  // Heuristic: many sellers + high duplicate ratio = same product
  // dropshipped by lots of sellers from the same wholesaler.
  const sellers = input.sellerCount ?? 0;
  const dup = input.duplicateRatio ?? 0;
  let s = 0;
  if (sellers >= 15 && dup >= 35) s = 80;
  else if (sellers >= 10 && dup >= 25) s = 55;
  else if (sellers >= 8 && dup >= 15) s = 30;
  if (s > 0) notes.push(`same_source_likelihood sellers=${sellers} dup=${dup.toFixed(0)}`);
  return clamp(s);
}

// ---------------------------------------------------------------------------
// Gate decision
// ---------------------------------------------------------------------------

interface GateInput {
  competitionQualityScore: number;
  sellerCompetitionScore: number;
  exactMatchSaturationScore: number;
  duplicateListingScore: number;
  priceCompressionScore: number;
  sellConfidence: number;
  priceViability: number;
  differentiationScore: number;
  isGenericCommodity: boolean;
  sellerCount: number;
  exactOrSimilarMatchCount: number;
  duplicateRatio: number;
  stagnationRiskScore: number;
  competitionDensityScore: number;
  amazonPrice: number;
  policyRiskScore: number;
  notes: string[];
  reasonCodes: string[];
}

// V1.4 combined-evidence gate.  HIGH_SELLER_COMPETITION alone is no longer
// a hard rejection - the operator's prior manual QA was 85% PASS even on
// products with many sellers, so demand can offset crowded markets.  We
// only hard-fail when two or more saturation axes co-occur, or when one
// of three explicit "truly saturated" combos triggers.
function decideGate(g: GateInput): { result: CompetitionGateResult; code?: string } {
  // ---- 1. Truly-saturated combos (any one -> hard reject) -----------
  // a) Heavy duplication + many similar listings -> commodity race.
  const dupHotRaw = g.duplicateRatio >= 50;
  const exactHotRaw = g.exactOrSimilarMatchCount >= 20;
  if (dupHotRaw && exactHotRaw) {
    g.reasonCodes.push(RejectionReason.HIGH_DUPLICATE_MARKET, RejectionReason.EXACT_MATCH_SATURATION);
    g.notes.push(`truly saturated: dup=${g.duplicateRatio.toFixed(0)}% + exact=${g.exactOrSimilarMatchCount}`);
    return { result: 'saturated', code: RejectionReason.HIGH_DUPLICATE_MARKET };
  }
  // b) Price compression + lots of sellers -> race-to-the-bottom market.
  const compHot = g.priceCompressionScore > THRESHOLDS.MAX_PRICE_COMPRESSION_SCORE;
  const sellerLargeRaw = g.sellerCount >= 25;
  if (compHot && sellerLargeRaw) {
    g.reasonCodes.push(RejectionReason.PRICE_COMPRESSED_MARKET, RejectionReason.LOW_MARGIN_COMPETITIVE_MARKET);
    g.notes.push(`truly saturated: price_comp=${g.priceCompressionScore.toFixed(0)} + sellers=${g.sellerCount}`);
    return { result: 'saturated', code: RejectionReason.PRICE_COMPRESSED_MARKET };
  }
  // c) Generic commodity + dense competition + elevated stagnation.
  const commodityCrowded =
    g.isGenericCommodity && g.competitionDensityScore >= 70 && g.stagnationRiskScore >= 30;
  if (commodityCrowded) {
    g.reasonCodes.push(RejectionReason.SATURATED_GENERIC_PRODUCT, RejectionReason.GENERIC_COMMODITY_MARKET);
    g.notes.push(
      `truly saturated: generic commodity + comp_density=${g.competitionDensityScore.toFixed(0)} + stagnation=${g.stagnationRiskScore.toFixed(0)}`,
    );
    return { result: 'saturated', code: RejectionReason.SATURATED_GENERIC_PRODUCT };
  }

  // ---- 2. Count "hot" axes for combined-evidence judging ------------
  const sellerHot = g.sellerCompetitionScore > THRESHOLDS.MAX_SELLER_COMPETITION_SCORE;
  const exactHot = g.exactMatchSaturationScore > THRESHOLDS.MAX_EXACT_MATCH_SATURATION_SCORE;
  const dupHot = g.duplicateListingScore > THRESHOLDS.MAX_DUPLICATE_LISTING_SCORE;
  const stagHot = g.stagnationRiskScore >= 30;
  const lowDiff = g.differentiationScore < 50;
  const negSignals = [sellerHot, exactHot, dupHot, compHot, stagHot, lowDiff].filter(Boolean).length;

  if (negSignals >= 3) {
    // Three or more hot axes is genuinely saturated even if none of the
    // explicit combos above tripped.
    if (sellerHot) g.reasonCodes.push(RejectionReason.HIGH_SELLER_COMPETITION);
    if (exactHot) g.reasonCodes.push(RejectionReason.EXACT_MATCH_SATURATION);
    if (dupHot) g.reasonCodes.push(RejectionReason.HIGH_DUPLICATE_MARKET);
    if (compHot) g.reasonCodes.push(RejectionReason.PRICE_COMPRESSED_MARKET);
    if (g.isGenericCommodity) g.reasonCodes.push(RejectionReason.GENERIC_COMMODITY_MARKET);
    g.reasonCodes.push(RejectionReason.COMPETITION_GATE_FAILED);
    g.notes.push(`competition: ${negSignals} hot axes (saturated)`);
    return { result: 'saturated', code: RejectionReason.COMPETITION_GATE_FAILED };
  }

  // ---- 3. Healthy-competition rescue ---------------------------------
  // Strong demand + low compression + low stagnation + low duplicate
  // ratio + good price + low policy risk -> allow even when one axis is
  // hot or competitionQuality is mid-band.
  const healthyRescue =
    g.sellConfidence >= 85 &&
    g.priceCompressionScore < 40 &&
    g.stagnationRiskScore <= 25 &&
    g.duplicateRatio < 40 &&
    g.amazonPrice >= 12 &&
    g.policyRiskScore <= 25;
  if (healthyRescue && negSignals <= 1) {
    g.reasonCodes.push(RejectionReason.HEALTHY_COMPETITION_PASS);
    g.notes.push(
      `healthy competition rescue: sell=${g.sellConfidence.toFixed(0)} ` +
        `price_comp=${g.priceCompressionScore.toFixed(0)} stag=${g.stagnationRiskScore.toFixed(0)} ` +
        `dup=${g.duplicateRatio.toFixed(0)}% price=$${g.amazonPrice.toFixed(2)} ` +
        `policy=${g.policyRiskScore.toFixed(0)}`,
    );
    return { result: 'healthy' };
  }

  // ---- 4. Borderline ------------------------------------------------
  if (negSignals === 2) {
    if (sellerHot) g.reasonCodes.push(RejectionReason.HIGH_SELLER_COMPETITION);
    if (exactHot) g.reasonCodes.push(RejectionReason.EXACT_MATCH_SATURATION);
    if (dupHot) g.reasonCodes.push(RejectionReason.HIGH_DUPLICATE_MARKET);
    if (compHot) g.reasonCodes.push(RejectionReason.PRICE_COMPRESSED_MARKET);
    g.notes.push(`competition: 2 hot axes - borderline`);
    return { result: 'borderline' };
  }
  if (g.competitionQualityScore < THRESHOLDS.MIN_COMPETITION_QUALITY_SCORE) {
    // Quality drag below the floor with <2 hot axes - mark borderline, not
    // saturated. Avoids the previous behavior of failing on a single hot
    // signal.
    g.notes.push(`competition quality ${g.competitionQualityScore.toFixed(0)} - borderline`);
    return { result: 'borderline' };
  }
  if (g.competitionQualityScore < 75) {
    if (g.isGenericCommodity) g.reasonCodes.push(RejectionReason.GENERIC_COMMODITY_MARKET);
    return { result: 'borderline' };
  }
  return { result: 'healthy' };
}
