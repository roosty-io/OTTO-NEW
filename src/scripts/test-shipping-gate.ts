/* eslint-disable no-console */
/**
 * test-shipping-gate.ts
 *
 * Drives the V1 shipping gate against synthetic delivery + Prime/FBA
 * inputs to verify Prime/FBA/Amazon-fulfillment signals can override
 * slow or unclear guest delivery.  No network calls; no Amazon login.
 *
 * Usage:  npm run test:shipping-gate
 */

import { parseDelivery } from '@/utils/deliveryParser';
import { evaluateShippingGate, type PrimeSignals } from '@/utils/amazonShippingGate';
import { THRESHOLDS } from '@/config/thresholds';

interface Case {
  label: string;
  deliveryText: string;
  primeSignals: Partial<PrimeSignals>;
  expectGate: 'pass' | 'prime_likely_pass' | 'reject';
  expectReviewRequired?: boolean;
  expectRejectionCode?: string;
}

const NO_PRIME: PrimeSignals = {
  primeBadgeVisible: false,
  primeInDeliveryText: false,
  shipsFromAmazon: false,
  soldByAmazon: false,
  fulfilledByAmazon: false,
};

const PRIME_BADGE: PrimeSignals = { ...NO_PRIME, primeBadgeVisible: true, primeInDeliveryText: true };
const SHIPS_FROM_AMAZON: PrimeSignals = { ...NO_PRIME, shipsFromAmazon: true };

const CASES: Case[] = [
  // Within the window, no Prime: clean pass.
  { label: 'delivery 5 days, no Prime', deliveryText: 'FREE delivery in 5 days', primeSignals: NO_PRIME, expectGate: 'pass' },
  // Beyond window, no Prime: reject DELIVERY_TOO_LONG.
  {
    label: 'delivery 12 days, no Prime',
    deliveryText: 'FREE delivery in 12 days',
    primeSignals: NO_PRIME,
    expectGate: 'reject',
    expectRejectionCode: 'DELIVERY_TOO_LONG',
  },
  // Beyond window but Prime badge visible: prime_likely_pass + review.
  {
    label: 'delivery 12 days, Prime badge visible',
    deliveryText: 'FREE delivery in 12 days',
    primeSignals: PRIME_BADGE,
    expectGate: 'prime_likely_pass',
    expectReviewRequired: true,
  },
  // Unclear delivery + Prime: prime_likely_pass + review.
  {
    label: 'unclear delivery, Prime visible',
    deliveryText: 'In Stock',
    primeSignals: PRIME_BADGE,
    expectGate: 'prime_likely_pass',
    expectReviewRequired: true,
  },
  // Unclear delivery + Ships from Amazon: prime_likely_pass + review.
  {
    label: 'unclear delivery, Ships from Amazon',
    deliveryText: '',
    primeSignals: SHIPS_FROM_AMAZON,
    expectGate: 'prime_likely_pass',
    expectReviewRequired: true,
  },
  // Unclear delivery, no Prime/FBA: reject DELIVERY_UNCLEAR.
  {
    label: 'unclear delivery, no Prime/FBA',
    deliveryText: '',
    primeSignals: NO_PRIME,
    expectGate: 'reject',
    expectRejectionCode: 'DELIVERY_UNCLEAR',
  },
  // Tomorrow text -> pass.
  { label: 'Tomorrow text', deliveryText: 'FREE delivery Tomorrow', primeSignals: NO_PRIME, expectGate: 'pass' },
  // Overnight text -> pass (parsed as Today/Tomorrow or covered by Prime).
  {
    label: 'Overnight text + Prime',
    deliveryText: 'FREE overnight delivery',
    primeSignals: PRIME_BADGE,
    expectGate: 'prime_likely_pass',
    expectReviewRequired: true,
  },
];

function describe(c: Case): { ok: boolean; got: string; gotReview: boolean; gotCode?: string } {
  const delivery = parseDelivery(c.deliveryText, THRESHOLDS.DEFAULT_MAX_DELIVERY_DAYS);
  const outcome = evaluateShippingGate({
    delivery,
    primeSignals: { ...NO_PRIME, ...c.primeSignals },
    maxDeliveryDays: THRESHOLDS.DEFAULT_MAX_DELIVERY_DAYS,
  });
  const gateOk = outcome.shippingGateResult === c.expectGate;
  const reviewOk = c.expectReviewRequired === undefined || outcome.shippingReviewRequired === c.expectReviewRequired;
  const codeOk = c.expectRejectionCode === undefined || outcome.rejectionCode === c.expectRejectionCode;
  return {
    ok: gateOk && reviewOk && codeOk,
    got: outcome.shippingGateResult,
    gotReview: outcome.shippingReviewRequired,
    gotCode: outcome.rejectionCode,
  };
}

function main(): void {
  let ok = 0;
  let fail = 0;
  console.log('OTTO shipping-gate cases');
  console.log('------------------------');
  for (const c of CASES) {
    const r = describe(c);
    if (r.ok) ok++;
    else fail++;
    const status = r.ok ? 'PASS' : 'FAIL';
    const detail = `gate=${r.got} review=${r.gotReview}${r.gotCode ? ' code=' + r.gotCode : ''}`;
    console.log(`  ${status}  ${c.label.padEnd(45)} ${detail}`);
  }
  console.log('');
  console.log(`${ok}/${ok + fail} cases passed`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
