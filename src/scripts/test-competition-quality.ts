/* eslint-disable no-console */
/**
 * test-competition-quality.ts
 *
 * Unit cases for the V1.2 competition / saturation gate.  No network
 * calls; no Amazon login.
 *
 * Usage: npm run test:competition-quality
 */

import {
  scoreCompetitionQuality,
  type CompetitionInput,
  type CompetitionGateResult,
} from '@/utils/competitionQualityScoring';

interface Case {
  label: string;
  input: CompetitionInput;
  expectGate: CompetitionGateResult;
  expectGenericCommodity?: boolean;
}

const BASE: CompetitionInput = {
  amazonPrice: 20,
  productTitle: 'OTTO Generic Storage',
  relevantComparableCount: 10,
  exactOrSimilarMatchCount: 5,
  sellerCount: 6,
  sellerConcentrationScore: 20,
  duplicateRatio: 5,
  competitionDensityScore: 50,
  medianComparablePrice: 35,
  priceBandMin: 25,
  priceBandMax: 60,
  priceViabilityScore: 80,
  sellWithin30DaysConfidence: 80,
  stagnationRiskScore: 15,
};

const CASES: Case[] = [
  {
    label: 'many sellers + high duplicate ratio + compressed price -> reject',
    input: { ...BASE, sellerCount: 28, duplicateRatio: 55, medianComparablePrice: 22, priceViabilityScore: 25 },
    expectGate: 'saturated',
  },
  {
    label: 'many sellers + varied listings + strong price viability -> pass',
    input: { ...BASE, sellerCount: 22, duplicateRatio: 5, medianComparablePrice: 45, priceViabilityScore: 90, exactOrSimilarMatchCount: 6, sellWithin30DaysConfidence: 90 },
    expectGate: 'healthy',
  },
  {
    label: 'few sellers + strong demand + good price gap -> pass',
    input: { ...BASE, sellerCount: 4, exactOrSimilarMatchCount: 3, duplicateRatio: 0, medianComparablePrice: 50, priceViabilityScore: 95 },
    expectGate: 'healthy',
  },
  {
    label: 'many sellers + high sell confidence but low differentiation -> borderline',
    input: {
      ...BASE,
      relevantComparableCount: 25,
      exactOrSimilarMatchCount: 16,
      sellerCount: 28,
      sellerConcentrationScore: 12,
      duplicateRatio: 35,
      sellWithin30DaysConfidence: 90,
      priceViabilityScore: 75,
    },
    expectGate: 'borderline',
  },
  {
    label: 'generic commodity product + high exact-match saturation -> reject',
    input: { ...BASE, productTitle: 'BTSKY 3-Layer Craft Storage Box Organizer', exactOrSimilarMatchCount: 22, duplicateRatio: 35, sellerCount: 14, medianComparablePrice: 28, priceViabilityScore: 45 },
    expectGate: 'saturated',
    expectGenericCommodity: true,
  },
  {
    label: 'generic commodity product + low competition -> pass',
    input: { ...BASE, productTitle: 'Under Sink Organizer', sellerCount: 5, exactOrSimilarMatchCount: 4, duplicateRatio: 0, medianComparablePrice: 32, priceViabilityScore: 85 },
    expectGate: 'healthy',
    expectGenericCommodity: true,
  },
];

function main(): void {
  let ok = 0;
  let fail = 0;
  console.log('OTTO competition-quality cases');
  console.log('------------------------------');
  for (const c of CASES) {
    const r = scoreCompetitionQuality(c.input);
    const gateOk = r.competitionGateResult === c.expectGate;
    const commodityOk =
      c.expectGenericCommodity === undefined || r.isGenericCommodity === c.expectGenericCommodity;
    const pass = gateOk && commodityOk;
    if (pass) ok++;
    else fail++;
    console.log(
      `  ${pass ? 'PASS' : 'FAIL'}  ${c.label.padEnd(70)} gate=${r.competitionGateResult} ` +
        `cq=${r.competitionQualityScore.toFixed(0)} ` +
        `sc=${r.sellerCompetitionScore.toFixed(0)} ` +
        `em=${r.exactMatchSaturationScore.toFixed(0)} ` +
        `dup=${r.duplicateListingScore.toFixed(0)} ` +
        `pc=${r.priceCompressionScore.toFixed(0)} ` +
        `commodity=${r.isGenericCommodity}`,
    );
  }
  console.log('');
  console.log(`${ok}/${ok + fail} cases passed`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
