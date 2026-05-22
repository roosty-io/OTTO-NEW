import { clamp, weightedAverage } from '@/utils/scoring';
import type { DeliveryParseResult } from '@/utils/deliveryParser';

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

  const deliveryScore = computeDeliveryScore(input.delivery, input.maxDeliveryDays);

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

function computeDeliveryScore(d: DeliveryParseResult, maxDays: number): number {
  // Explicit out-of-stock text -> hard zero.
  if (d.signals.includes('out_of_stock_text')) return 0;
  if (d.deliveryPassesMaxWindow === false) return 0;
  if (d.estimatedDeliveryDays !== undefined && d.estimatedDeliveryDays > maxDays) return 0;
  if (d.deliveryParseConfidence === 'high') return 100;
  if (d.deliveryParseConfidence === 'medium') return 75;
  if (d.deliveryParseConfidence === 'low') return 40; // not auto-pass; caller decides
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
