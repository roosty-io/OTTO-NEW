/* eslint-disable no-console */
/**
 * test-cross-batch-filter.ts
 *
 * Unit cases for the cross-batch ASIN export repeat filter.  Pure
 * function; no network or DB.
 *
 * Usage: npm run test:cross-batch-filter
 */

import {
  filterCrossBatch,
  type PriorExport,
  type RepeatPolicy,
} from '@/agents/export/crossBatchFilter';
import { dedupeByAsin } from '@/agents/export/CsvExportAgent';
import type { ValidatedProduct } from '@/types/product';

const NOW = new Date('2026-05-28T00:00:00.000Z');

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();
}

function product(asin: string, ottoProductId = `OTTO-${asin}`, finalValidationScore = 85): ValidatedProduct {
  return {
    ottoProductId,
    asin,
    amazonUrl: `https://www.amazon.com/dp/${asin}`,
    productTitle: `Product ${asin}`,
    amazonPrice: 24.99,
    couponDetected: false,
    stockStatus: 'in_stock',
    sourceConfidenceScore: 85,
    productMatchType: 'similar',
    opportunityType: 'direct_match',
    marketplaceSignalSources: ['ebay_browse_api'],
    primaryDiscoverySource: 'ebay_browse_api',
    secondaryDiscoverySources: [],
    coreKeyword: 'storage',
    relatedKeywords: [],
    demandType: 'steady',
    sellWithin30DaysConfidence: 80,
    stagnationRiskScore: 20,
    demandScore: 80,
    categoryVelocityScore: 70,
    keywordDemandScore: 70,
    competitorSuccessScore: 70,
    saturationScore: 30,
    trendMomentumScore: 60,
    policyRiskScore: 10,
    veroRiskScore: 0,
    restrictedCategoryRiskScore: 0,
    ipRiskScore: 0,
    edgeCaseRiskScore: 0,
    fragilityScore: 10,
    variationConfusionScore: 10,
    totalCostEstimate: 30,
    predictedMonthlyProfitPer100Listings: 0,
    finalValidationScore,
    validationStatus: 'validated',
    validatedAt: NOW.toISOString(),
  };
}

interface Case {
  label: string;
  run: () => boolean;
}

const CASES: Case[] = [
  {
    label: 'ASIN in current batch twice => one export (same-batch dedupe)',
    run: () => {
      const products = [product('B0AAA', 'OTTO-1', 90), product('B0AAA', 'OTTO-2', 70)];
      const { keptProducts } = dedupeByAsin(products);
      // After same-batch dedupe there is exactly one B0AAA (the higher score).
      return keptProducts.length === 1 && keptProducts[0].ottoProductId === 'OTTO-1';
    },
  },
  {
    label: 'exported yesterday, exclude_recent 30d => excluded (PREVIOUSLY_EXPORTED_RECENTLY)',
    run: () => {
      const products = [product('B0AAA')];
      const prior: PriorExport[] = [{ asin: 'B0AAA', exportBatchId: 'batch-1', exportedAt: daysAgo(1) }];
      const { keptProducts, exclusions } = filterCrossBatch({ products, priorExports: prior, policy: 'exclude_recent', lookbackDays: 30, now: NOW });
      return keptProducts.length === 0 && exclusions.length === 1 && exclusions[0].exclusionReason === 'PREVIOUSLY_EXPORTED_RECENTLY';
    },
  },
  {
    label: 'exported 60 days ago, exclude_recent 30d => allowed',
    run: () => {
      const products = [product('B0AAA')];
      const prior: PriorExport[] = [{ asin: 'B0AAA', exportBatchId: 'batch-1', exportedAt: daysAgo(60) }];
      const { keptProducts, exclusions } = filterCrossBatch({ products, priorExports: prior, policy: 'exclude_recent', lookbackDays: 30, now: NOW });
      return keptProducts.length === 1 && exclusions.length === 0;
    },
  },
  {
    label: 'exported 60 days ago, never_repeat => excluded (PREVIOUSLY_EXPORTED_ASIN)',
    run: () => {
      const products = [product('B0AAA')];
      const prior: PriorExport[] = [{ asin: 'B0AAA', exportBatchId: 'batch-1', exportedAt: daysAgo(60) }];
      const { keptProducts, exclusions } = filterCrossBatch({ products, priorExports: prior, policy: 'never_repeat', lookbackDays: 30, now: NOW });
      return keptProducts.length === 0 && exclusions.length === 1 && exclusions[0].exclusionReason === 'PREVIOUSLY_EXPORTED_ASIN';
    },
  },
  {
    label: 'exported yesterday, allow_repeats => allowed (no exclusions)',
    run: () => {
      const products = [product('B0AAA')];
      const prior: PriorExport[] = [{ asin: 'B0AAA', exportBatchId: 'batch-1', exportedAt: daysAgo(1) }];
      const { keptProducts, exclusions } = filterCrossBatch({ products, priorExports: prior, policy: 'allow_repeats', lookbackDays: 30, now: NOW });
      return keptProducts.length === 1 && exclusions.length === 0;
    },
  },
  {
    label: 'no prior export, exclude_recent => allowed',
    run: () => {
      const products = [product('B0NEW')];
      const prior: PriorExport[] = [{ asin: 'B0AAA', exportBatchId: 'batch-1', exportedAt: daysAgo(1) }];
      const { keptProducts, exclusions } = filterCrossBatch({ products, priorExports: prior, policy: 'exclude_recent', lookbackDays: 30, now: NOW });
      return keptProducts.length === 1 && exclusions.length === 0;
    },
  },
  {
    label: 'multiple priors, most recent decides (recent within window => excluded)',
    run: () => {
      const products = [product('B0AAA')];
      const prior: PriorExport[] = [
        { asin: 'B0AAA', exportBatchId: 'old', exportedAt: daysAgo(90) },
        { asin: 'B0AAA', exportBatchId: 'recent', exportedAt: daysAgo(5) },
      ];
      const { keptProducts, exclusions } = filterCrossBatch({ products, priorExports: prior, policy: 'exclude_recent', lookbackDays: 30, now: NOW });
      return keptProducts.length === 0 && exclusions.length === 1 && exclusions[0].priorExportBatchId === 'recent';
    },
  },
  {
    label: 'synthetic prior rows are caller-filtered: empty priors => real export allowed',
    run: () => {
      // CsvExportAgent.fetchPriorExports only returns is_synthetic=false rows,
      // so a real product whose ASIN only appears in synthetic exports sees
      // an empty priorExports list and is allowed.
      const products = [product('B0AAA')];
      const prior: PriorExport[] = []; // synthetic rows excluded upstream
      const { keptProducts, exclusions } = filterCrossBatch({ products, priorExports: prior, policy: 'never_repeat', lookbackDays: 30, now: NOW });
      return keptProducts.length === 1 && exclusions.length === 0;
    },
  },
  {
    label: 'mixed batch: one repeat excluded, one new kept',
    run: () => {
      const products = [product('B0AAA', 'OTTO-A'), product('B0NEW', 'OTTO-N')];
      const prior: PriorExport[] = [{ asin: 'B0AAA', exportBatchId: 'batch-1', exportedAt: daysAgo(2) }];
      const { keptProducts, exclusions } = filterCrossBatch({ products, priorExports: prior, policy: 'exclude_recent', lookbackDays: 30, now: NOW });
      return keptProducts.length === 1 && keptProducts[0].asin === 'B0NEW' && exclusions.length === 1 && exclusions[0].asin === 'B0AAA';
    },
  },
];

function main(): void {
  let ok = 0;
  let fail = 0;
  console.log('OTTO cross-batch filter cases');
  console.log('-----------------------------');
  for (const c of CASES) {
    let pass = false;
    let err = '';
    try {
      pass = c.run();
    } catch (e) {
      err = (e as Error).message;
    }
    if (pass) ok++;
    else fail++;
    console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${c.label}${err ? `  (threw: ${err})` : ''}`);
  }
  console.log('');
  console.log(`${ok}/${ok + fail} cases passed`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
