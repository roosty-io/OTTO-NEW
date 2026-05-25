import { clamp, weightedAverage } from '@/utils/scoring';
import type { DeliveryParseResult } from '@/utils/deliveryParser';
import type { ShippingGateResult } from '@/utils/amazonShippingGate';

export interface SourceScoringInput {
  pageLoaded: boolean;
  blockedOrCaptcha: boolean;
  hasAsin: boolean;
  hasAmazonUrl: boolean;
  inStock: boolean;
  buyable: boolean;
  priceKnown: boolean;
  isAmazonBasics: boolean;
  isUsedRenewedRefurbished: boolean;
  isBundleOrMultipack: boolean;
  restrictedSignalCount: number;
  hasHardRestriction: boolean;
  delivery: DeliveryParseResult;
  maxDeliveryDays: number;
  /** New: shipping gate decides whether Prime/FBA signals override slow guest delivery. */
  shippingGateResult?: ShippingGateResult;
}

export interface SourceScoringResult {
  stockScore: number;
  deliveryScore: number;
  priceScore: number;
  conditionScore: number;
  restrictionScore: number;
  sourceValidityScore: number;
  passed: boolean;
}

export function scoreAmazonSource(input: SourceScoringInput): SourceScoringResult {
  if (!input.pageLoaded || input.blockedOrCaptcha || !input.hasAsin || !input.hasAmazonUrl) {
    return zeroResult();
  }

  const stockScore = input.inStock && input.buyable ? 100 : 0;
  const priceScore = input.priceKnown ? 100 : 0;
  const conditionScore =
    input.isAmazonBasics || input.isUsedRenewedRefurbished || input.isBundleOrMultipack ? 0 : 100;

  const restrictionScore = input.hasHardRestriction
    ? 0
    : clamp(100 - input.restrictedSignalCount * 20);

  const deliveryScore = computeDeliveryScore(input.delivery, input.maxDeliveryDays, input.shippingGateResult);

  const sourceValidityScore = clamp(
    weightedAverage([
      { value: stockScore, weight: 2.5 },
      { value: priceScore, weight: 2 },
      { value: deliveryScore, weight: 2 },
      { value: conditionScore, weight: 1.5 },
      { value: restrictionScore, weight: 2 },
    ]),
  );

  // A product is only "source valid" when every gate is open. Score is for
  // ranking / analytics; the boolean is the gatekeeper.
  const passed =
    stockScore === 100 &&
    priceScore === 100 &&
    conditionScore === 100 &&
    restrictionScore === 100 &&
    deliveryScore >= 50; // medium-confidence delivery within window is OK

  return {
    stockScore,
    deliveryScore,
    priceScore,
    conditionScore,
    restrictionScore,
    sourceValidityScore,
    passed,
  };
}

function computeDeliveryScore(
  d: DeliveryParseResult,
  maxDays: number,
  gate?: ShippingGateResult,
): number {
  // Explicit out-of-stock text -> hard zero.
  if (d.signals.includes('out_of_stock_text')) return 0;

  // The shipping gate is the source of truth when it has been evaluated.
  // Prime/FBA-likely passes get medium scores even when guest delivery is
  // slow or unclear; rejects always get zero.
  if (gate === 'reject') return 0;
  if (gate === 'prime_likely_pass') {
    // Medium when we DO have parsed (but slow) days, lower when delivery
    // text was unparseable.
    if (d.estimatedDeliveryDays !== undefined) return 65;
    return 50;
  }
  if (gate === 'pass') return 100;

  // No gate was supplied (legacy call sites) - fall back to the old behavior.
  if (d.deliveryPassesMaxWindow === false) return 0;
  if (d.estimatedDeliveryDays !== undefined && d.estimatedDeliveryDays > maxDays) return 0;
  if (d.deliveryParseConfidence === 'high') return 100;
  if (d.deliveryParseConfidence === 'medium') return 75;
  if (d.deliveryParseConfidence === 'low') return 40;
  return 0;
}

function zeroResult(): SourceScoringResult {
  return {
    stockScore: 0,
    deliveryScore: 0,
    priceScore: 0,
    conditionScore: 0,
    restrictionScore: 0,
    sourceValidityScore: 0,
    passed: false,
  };
}
