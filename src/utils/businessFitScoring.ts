// Business-fit scoring (V1).  Combines price quality, market saturation,
// bulkiness risk, brand caution, and learned manual-QA patterns into a
// single business_fit_score and pass/reject decision.  Used by
// BusinessFitAgent after compliance and before final validation.
//
// Tuned from the limit=25 post-shipping-gate QA review: 19/29 = 65.5%
// would-list approval.  The 10 rejections clustered around:
//   - too cheap
//   - too many similar listings
//   - bulky/high-ticket garage rack concern
//   - VeRO/brand-caution (Fiskars)
// Brand-caution is now blocked by compliance; the other three are the
// price / saturation / bulkiness scorers below.

import { clamp, weightedAverage } from '@/utils/scoring';
import { containsAny } from '@/utils/normalize';
import { BRAND_ENTRIES } from '@/config/categories';
import { THRESHOLDS } from '@/config/thresholds';
import { RejectionReason } from '@/utils/rejectionReasons';

export interface BusinessFitInput {
  amazonPrice?: number;
  productTitle?: string;
  brand?: string;
  amazonCategoryBreadcrumbs?: string[];
  estimatedDeliveryDays?: number;

  // Demand-side inputs (already produced by EbayDemandScoringAgent).
  relevantComparableCount?: number;
  exactOrSimilarMatchCount?: number;
  duplicateRatio?: number;
  sellerConcentrationScore?: number;
  competitionDensityScore?: number;
  stagnationRiskScore?: number;
  sellWithin30DaysConfidence?: number;
  saturationScore?: number;

  // Compliance-side inputs.
  policyRiskScore?: number;
}

export interface BusinessFitOutput {
  businessFitScore: number;
  priceQualityScore: number;
  saturationQualityScore: number;
  bulkinessRiskScore: number;
  brandCautionScore: number;
  manualQaPatternPenalty: number;
  businessFitPassed: boolean;
  businessFitRejectionReason?: string;
  reasonCodes: string[];
  notes: string[];
}

// Bulky / heavy product cues (drawn from the manual QA notes).
const BULKY_CUES = [
  'rack', 'overhead', 'garage rack', 'tire storage', 'tire rack',
  'large', 'heavy duty', 'steel', 'shelving', 'storage rack',
  '96in', '48in', '72in', '60in', 'shelf unit', 'pegboard',
];

const SIZE_INCH_RE = /\b\d{2,3}\s*(?:in|inch|inches|"|′|ft|foot|feet)\b/i;
const WEIGHT_LBS_RE = /\b\d{2,4}\s*(?:lb|lbs|pound|pounds)\b/i;

export function scoreBusinessFit(input: BusinessFitInput): BusinessFitOutput {
  const reasonCodes: string[] = [];
  const notes: string[] = [];
  let hardReject: string | undefined;

  const priceQualityScore = scorePriceQuality(input.amazonPrice, reasonCodes, notes);
  if (priceQualityScore === 0 && (input.amazonPrice ?? 0) < 8) {
    hardReject = RejectionReason.TOO_CHEAP;
  }

  const saturationQualityScore = scoreSaturationQuality(input, reasonCodes, notes);

  const bulkinessRiskScore = scoreBulkinessRisk(input, reasonCodes, notes);

  const brandCautionScore = scoreBrandCaution(input.brand, reasonCodes, notes);

  const manualQaPatternPenalty = scoreManualQaPatterns(input, reasonCodes, notes);

  // Final blend: weighted, then drag down for high penalties.
  const blended = weightedAverage([
    { value: priceQualityScore, weight: 4 },
    { value: saturationQualityScore, weight: 3 },
    { value: 100 - bulkinessRiskScore, weight: 1.5 },
    { value: 100 - brandCautionScore, weight: 1 },
    { value: 100 - manualQaPatternPenalty, weight: 0.5 },
  ]);
  const businessFitScore = hardReject !== undefined ? 0 : clamp(blended);

  // Pass rules.
  let businessFitRejectionReason: string | undefined;
  if (hardReject) businessFitRejectionReason = hardReject;
  else if (bulkinessRiskScore > THRESHOLDS.MAX_BULKINESS_RISK_SCORE) {
    businessFitRejectionReason = RejectionReason.BULKY_HIGH_TICKET_CAUTION;
  } else if ((100 - saturationQualityScore) > THRESHOLDS.MAX_SATURATION_QUALITY_RISK) {
    businessFitRejectionReason = RejectionReason.TOO_MANY_SIMILAR_LISTINGS;
  } else if (businessFitScore < THRESHOLDS.MIN_BUSINESS_FIT_SCORE) {
    businessFitRejectionReason = RejectionReason.BUSINESS_FIT_FAILED;
  }

  const businessFitPassed = !businessFitRejectionReason;

  return {
    businessFitScore,
    priceQualityScore,
    saturationQualityScore,
    bulkinessRiskScore,
    brandCautionScore,
    manualQaPatternPenalty,
    businessFitPassed,
    businessFitRejectionReason,
    reasonCodes,
    notes,
  };
}

// ---------------------------------------------------------------------------
// Sub-scores
// ---------------------------------------------------------------------------

function scorePriceQuality(amazonPrice: number | undefined, codes: string[], notes: string[]): number {
  const price = amazonPrice ?? 0;
  if (price <= 0) {
    codes.push(RejectionReason.PRICE_BELOW_BUSINESS_FIT_THRESHOLD);
    notes.push('Amazon price missing or zero.');
    return 0;
  }
  if (price < 8) {
    codes.push(RejectionReason.TOO_CHEAP);
    notes.push(`Amazon price $${price.toFixed(2)} is below the hard $8 floor.`);
    return 0;
  }
  if (price < THRESHOLDS.MIN_AMAZON_PRICE_DEFAULT) {
    codes.push(RejectionReason.LOW_PRICE_QUALITY);
    notes.push(`Amazon price $${price.toFixed(2)} is below the $${THRESHOLDS.MIN_AMAZON_PRICE_DEFAULT} default floor.`);
    return 30;
  }
  if (price < THRESHOLDS.MIN_AMAZON_PRICE_STRICT) {
    codes.push(RejectionReason.LOW_PRICE_QUALITY);
    notes.push(`Amazon price $${price.toFixed(2)} is below the strict $${THRESHOLDS.MIN_AMAZON_PRICE_STRICT} floor; allowed if sell confidence is high.`);
    return 55;
  }
  if (price < 25) return 90;
  if (price < 50) return 95;
  if (price <= 100) return 90;
  return 75; // higher-ticket items are valid but lose some quality points
}

function scoreSaturationQuality(input: BusinessFitInput, codes: string[], notes: string[]): number {
  let score = 100;

  const exact = input.exactOrSimilarMatchCount ?? 0;
  if (exact > 25) {
    score -= 25;
    codes.push(RejectionReason.TOO_MANY_SIMILAR_LISTINGS);
    notes.push(`exact_or_similar_match_count=${exact} (very high)`);
  } else if (exact > 15) {
    score -= 12;
  }

  const dup = input.duplicateRatio ?? 0;
  if (dup > 40) {
    score -= 20;
    codes.push(RejectionReason.HIGH_DUPLICATE_MARKET);
    notes.push(`duplicate_ratio=${dup.toFixed(0)} (many near-duplicate listings)`);
  } else if (dup > 25) {
    score -= 10;
  }

  const stag = input.stagnationRiskScore ?? 0;
  if (stag > 35) {
    score -= 20;
    codes.push(RejectionReason.SATURATED_GENERIC_PRODUCT);
    notes.push(`stagnation_risk_score=${stag.toFixed(0)}`);
  } else if (stag > 25) {
    score -= 10;
  }

  const sellerConc = input.sellerConcentrationScore ?? 0;
  if (sellerConc > 75) {
    score -= 15;
    codes.push(RejectionReason.LOW_DIFFERENTIATION);
    notes.push(`seller_concentration_score=${sellerConc.toFixed(0)} (one seller dominates)`);
  }

  const competition = input.competitionDensityScore;
  if (typeof competition === 'number' && competition < 40) {
    score -= 10;
  }

  // Generic-product heuristic: short or no brand + many similar listings.
  const brand = (input.brand ?? '').trim();
  const looksGeneric = brand.length === 0 || /^generic$/i.test(brand);
  if (looksGeneric && exact > 10) {
    score -= 10;
    codes.push(RejectionReason.SATURATED_GENERIC_PRODUCT);
    notes.push('Generic/missing brand with many similar listings.');
  }

  // High sell confidence + high saturation: still allowed but capped.
  const sell = input.sellWithin30DaysConfidence ?? 0;
  if (sell >= 85 && score < 60) {
    notes.push('High sell confidence offsets some saturation - allowed but capped.');
    score = Math.max(score, 55);
  }

  return clamp(score);
}

function scoreBulkinessRisk(input: BusinessFitInput, codes: string[], notes: string[]): number {
  const title = input.productTitle ?? '';
  const bulkyHit = containsAny(title, BULKY_CUES);
  const hasInchSize = SIZE_INCH_RE.test(title);
  const hasLbWeight = WEIGHT_LBS_RE.test(title);
  const bulky = Boolean(bulkyHit) || hasInchSize || hasLbWeight;

  if (!bulky) return 0;

  const price = input.amazonPrice ?? 0;
  const delivery = input.estimatedDeliveryDays ?? 0;
  let score = 15;

  if (price > THRESHOLDS.MAX_BULKY_PRICE_WITHOUT_HIGH_CONFIDENCE) {
    score += 50;
    codes.push(RejectionReason.BULKY_HIGH_TICKET_CAUTION);
    notes.push(`Bulky product priced $${price.toFixed(2)} > $${THRESHOLDS.MAX_BULKY_PRICE_WITHOUT_HIGH_CONFIDENCE} (return-shipping risk).`);
  } else if (price > 60) {
    score += 25;
    codes.push(RejectionReason.OVERSIZED_STORAGE_RISK);
    notes.push(`Bulky product priced $${price.toFixed(2)}.`);
  }

  if (delivery >= 8 && bulky) {
    score += 15;
    codes.push(RejectionReason.RETURN_SHIPPING_RISK);
    notes.push(`Delivery ${delivery}d on a bulky item raises return-shipping risk.`);
  }

  if (hasLbWeight && price > 40) score += 10;

  return clamp(score);
}

function scoreBrandCaution(brand: string | undefined, codes: string[], notes: string[]): number {
  if (!brand) return 0;
  const lc = brand.trim();
  if (!lc) return 0;
  const matchedHardBlock = BRAND_ENTRIES.find((b) =>
    b.brand.toLowerCase() === lc.toLowerCase() ||
    (b.aliases ?? []).some((a) => a.toLowerCase() === lc.toLowerCase()),
  );
  if (matchedHardBlock?.hardBlock) {
    codes.push(RejectionReason.BRAND_CAUTION_MATCH);
    notes.push(`Brand "${brand}" is on the hard-block list (${matchedHardBlock.category ?? 'general'}).`);
    return 100;
  }
  // Soft-cautions can be added here later from manual QA pattern analysis.
  return 0;
}

function scoreManualQaPatterns(input: BusinessFitInput, codes: string[], notes: string[]): number {
  let penalty = 0;
  const price = input.amazonPrice ?? 0;
  const exact = input.exactOrSimilarMatchCount ?? 0;
  const brand = (input.brand ?? '').trim();

  // Pattern A (learned 5-25 review): cheap + many similar + generic brand.
  if (price < 12 && exact > 15 && (brand.length === 0 || /^generic$/i.test(brand))) {
    penalty += 30;
    codes.push(RejectionReason.SATURATED_GENERIC_PRODUCT);
    notes.push('Manual-QA pattern: cheap + many similar listings + generic brand.');
  }

  // Pattern B: bulky/high-ticket with slow delivery.
  const delivery = input.estimatedDeliveryDays ?? 0;
  const title = input.productTitle ?? '';
  const bulky = Boolean(containsAny(title, BULKY_CUES));
  if (bulky && price > 80 && delivery >= 7) {
    penalty += 20;
    codes.push(RejectionReason.RETURN_SHIPPING_RISK);
    notes.push('Manual-QA pattern: bulky + high ticket + slow delivery.');
  }

  return clamp(penalty);
}
