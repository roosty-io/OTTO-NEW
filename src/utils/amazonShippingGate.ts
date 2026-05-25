// V1 shipping gate for Amazon source validation.
//
// The legacy gate hard-rejected products whose guest/public delivery was
// slow or unclear. In a logged-in Prime account the same products often
// ship same-day or next-day, so the legacy gate produced false rejects.
//
// The new gate trusts visible Prime / FBA / Amazon-fulfillment signals
// even when the guest delivery estimate is slow or missing. It NEVER logs
// into Amazon - all signals are extracted from the public PDP.

import type { DeliveryParseResult } from '@/utils/deliveryParser';
import { RejectionReason } from '@/utils/rejectionReasons';

export interface PrimeSignals {
  primeBadgeVisible: boolean;
  primeInDeliveryText: boolean;
  fastestDeliveryText?: string;
  shipsFromAmazon: boolean;
  soldByAmazon: boolean;
  fulfilledByAmazon: boolean;
}

export type DeliveryContext =
  | 'public_guest_no_zip'
  | 'public_guest_zip'
  | 'logged_in_non_prime'
  | 'logged_in_prime'
  | 'unknown';

export type ShippingGateResult = 'pass' | 'prime_likely_pass' | 'reject';
export type ShippingConfidence = 'high' | 'medium' | 'low_to_medium' | 'low';

export interface ShippingGateOutcome {
  shippingGateResult: ShippingGateResult;
  shippingConfidence: ShippingConfidence;
  shippingReviewRequired: boolean;
  rejectionCode?: string;
  primeSignalDetected: boolean;
  primeSignalSource?: string;
  fbaSignalDetected: boolean;
  notes: string;
}

export function summarizePrimeSignals(s: PrimeSignals): {
  primeSignalDetected: boolean;
  primeSignalSource?: string;
  fbaSignalDetected: boolean;
} {
  const sources: string[] = [];
  if (s.primeBadgeVisible) sources.push('prime_badge');
  if (s.primeInDeliveryText) sources.push('delivery_text_prime');
  if (s.fastestDeliveryText && /tomorrow|overnight|same\s*day|today/i.test(s.fastestDeliveryText)) {
    sources.push('fastest_delivery_overnight');
  }
  if (s.shipsFromAmazon) sources.push('ships_from_amazon');
  if (s.soldByAmazon) sources.push('sold_by_amazon');
  if (s.fulfilledByAmazon) sources.push('fulfilled_by_amazon');

  const primeSignalDetected =
    s.primeBadgeVisible || s.primeInDeliveryText ||
    (s.fastestDeliveryText !== undefined && /tomorrow|overnight|same\s*day|today/i.test(s.fastestDeliveryText));
  const fbaSignalDetected = s.shipsFromAmazon || s.soldByAmazon || s.fulfilledByAmazon;

  return {
    primeSignalDetected,
    fbaSignalDetected,
    primeSignalSource: sources.length > 0 ? sources.join(',') : undefined,
  };
}

export interface ShippingGateInput {
  delivery: DeliveryParseResult;
  primeSignals: PrimeSignals;
  maxDeliveryDays: number;
  outOfStock?: boolean;
}

export function evaluateShippingGate(input: ShippingGateInput): ShippingGateOutcome {
  const { delivery, primeSignals, maxDeliveryDays, outOfStock } = input;
  const summary = summarizePrimeSignals(primeSignals);

  // Hard out-of-stock blocks every other decision.
  if (outOfStock || delivery.signals.includes('out_of_stock_text')) {
    return {
      shippingGateResult: 'reject',
      shippingConfidence: 'high',
      shippingReviewRequired: false,
      rejectionCode: RejectionReason.AMAZON_OUT_OF_STOCK,
      primeSignalDetected: summary.primeSignalDetected,
      primeSignalSource: summary.primeSignalSource,
      fbaSignalDetected: summary.fbaSignalDetected,
      notes: 'Out of stock - shipping gate skipped.',
    };
  }

  const hasParsedDays = typeof delivery.estimatedDeliveryDays === 'number';
  const days = delivery.estimatedDeliveryDays;
  const withinWindow = hasParsedDays && (days as number) <= maxDeliveryDays;
  const confidenceIsKnown =
    delivery.deliveryParseConfidence === 'high' || delivery.deliveryParseConfidence === 'medium';

  // Case A: parsed delivery + within window  -> normal pass.
  if (hasParsedDays && withinWindow && confidenceIsKnown) {
    return {
      shippingGateResult: 'pass',
      shippingConfidence: 'high',
      shippingReviewRequired: false,
      primeSignalDetected: summary.primeSignalDetected,
      primeSignalSource: summary.primeSignalSource,
      fbaSignalDetected: summary.fbaSignalDetected,
      notes: `Guest delivery parsed at ${days}d <= ${maxDeliveryDays}d.`,
    };
  }

  const primeLikely = summary.primeSignalDetected || summary.fbaSignalDetected;

  // Case B: parsed delivery exceeds the window.
  if (hasParsedDays && !withinWindow) {
    if (primeLikely) {
      return {
        shippingGateResult: 'prime_likely_pass',
        shippingConfidence: 'medium',
        shippingReviewRequired: true,
        primeSignalDetected: summary.primeSignalDetected,
        primeSignalSource: summary.primeSignalSource,
        fbaSignalDetected: summary.fbaSignalDetected,
        notes: `Guest delivery ${days}d > ${maxDeliveryDays}d but Prime/FBA signal detected (${summary.primeSignalSource ?? 'fulfillment'}). Manual shipping check recommended.`,
      };
    }
    return {
      shippingGateResult: 'reject',
      shippingConfidence: 'high',
      shippingReviewRequired: false,
      rejectionCode: RejectionReason.DELIVERY_TOO_LONG,
      primeSignalDetected: summary.primeSignalDetected,
      primeSignalSource: summary.primeSignalSource,
      fbaSignalDetected: summary.fbaSignalDetected,
      notes: `Guest delivery ${days}d > ${maxDeliveryDays}d and no Prime/FBA signal.`,
    };
  }

  // Case C: delivery couldn't be parsed (unclear).
  if (primeLikely) {
    return {
      shippingGateResult: 'prime_likely_pass',
      shippingConfidence: 'low_to_medium',
      shippingReviewRequired: true,
      primeSignalDetected: summary.primeSignalDetected,
      primeSignalSource: summary.primeSignalSource,
      fbaSignalDetected: summary.fbaSignalDetected,
      notes: `Guest delivery text not parseable but Prime/FBA signal detected (${summary.primeSignalSource ?? 'fulfillment'}). Manual shipping check required.`,
    };
  }
  return {
    shippingGateResult: 'reject',
    shippingConfidence: 'low',
    shippingReviewRequired: false,
    rejectionCode: RejectionReason.DELIVERY_UNCLEAR,
    primeSignalDetected: false,
    primeSignalSource: undefined,
    fbaSignalDetected: false,
    notes: `Guest delivery unclear and no Prime/FBA signal.`,
  };
}
