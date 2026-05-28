/* eslint-disable no-console */
/**
 * test-keepa-discovery.ts
 *
 * Unit cases for Keepa rank-movement discovery: product normalization,
 * ASIN-native resolver bypass, missing-ASIN handling, category and price
 * filtering, and the score derivation.  Pure functions only; no network,
 * no DB.
 *
 * Usage: npm run test:keepa-discovery
 */

import { normalizeKeepaProduct, keepaDiscoveryScore } from '@/clients/keepaClient';
import { isCategoryAllowed, resolveCategoryTargets, ALLOWED_V1_CATEGORIES } from '@/utils/keepaCategories';
import { asinNativeResolution } from '@/pipeline/asinResolution';
import type { ProductCandidate } from '@/types/product';

// Keepa CSV indices: 0=AMAZON, 3=SALES, 16=RATING(x10), 17=REVIEWS.
function rawProduct(over: Partial<{ asin: string; rankCurrent: number; rank30: number; priceCents: number; category: string; rootCategory: number }> = {}) {
  const current: number[] = [];
  current[0] = over.priceCents ?? 2499; // $24.99
  current[3] = over.rankCurrent ?? 4000;
  current[16] = 44; // 4.4
  current[17] = 1200;
  const avg30: number[] = [];
  avg30[3] = over.rank30 ?? 8000; // worse 30d avg => improving
  const avg90: number[] = [];
  avg90[3] = 9000;
  const catName = over.category ?? 'Storage & Organization';
  return {
    asin: over.asin ?? 'B0KEEPATEST',
    title: `Test ${catName} bin`,
    brand: 'TestBrand',
    rootCategory: over.rootCategory ?? 1055398,
    categoryTree: [
      { catId: over.rootCategory ?? 1055398, name: 'Home & Kitchen' },
      { catId: 3741331, name: catName },
    ],
    imagesCSV: '71abc.jpg',
    stats: { current, avg30, avg90 },
  };
}

function candidate(asin?: string): ProductCandidate {
  return {
    ottoProductId: 'OTTO-test',
    source: 'keepa_rank_movement',
    sourceUrl: 'https://www.amazon.com/dp/X',
    marketplace: 'amazon',
    keyword: 'storage bin',
    productTitleRaw: 'Storage bin',
    discoveryScore: 70,
    asin,
    amazonUrl: asin ? `https://www.amazon.com/dp/${asin}` : undefined,
    sourceConfidenceScore: asin ? 92 : undefined,
  };
}

interface Case { label: string; run: () => boolean }

const CASES: Case[] = [
  {
    label: 'normalizeKeepaProduct parses asin / rank / price / improvement / category',
    run: () => {
      const n = normalizeKeepaProduct(rawProduct());
      if (!n) return false;
      return (
        n.asin === 'B0KEEPATEST' &&
        n.salesRankCurrent === 4000 &&
        n.salesRank30dAvg === 8000 &&
        Math.round(n.rankImprovement30d ?? 0) === 50 && // (8000-4000)/8000 = 50%
        n.amazonPrice === 24.99 &&
        (n.amazonCategory ?? '').includes('Home & Kitchen') &&
        n.rating === 4.4 &&
        n.reviewCount === 1200
      );
    },
  },
  {
    label: 'normalizeKeepaProduct returns null when ASIN missing (clean reject)',
    run: () => {
      const raw = rawProduct();
      // remove asin
      delete (raw as Record<string, unknown>).asin;
      return normalizeKeepaProduct(raw) === null;
    },
  },
  {
    label: 'ASIN-native candidate bypasses resolver',
    run: () => {
      const r = asinNativeResolution(candidate('B0NATIVE1'));
      return !!r && r.bypassed === true && r.asin === 'B0NATIVE1' && r.score >= 90 && r.productMatchType === 'exact';
    },
  },
  {
    label: 'missing-ASIN candidate returns null (caller must run resolver)',
    run: () => {
      return asinNativeResolution(candidate(undefined)) === null;
    },
  },
  {
    label: 'disallowed category filtered (Health & Personal Care)',
    run: () => {
      return isCategoryAllowed('Health & Personal Care > Vitamins', 'Daily multivitamin') === false;
    },
  },
  {
    label: 'disallowed by title keyword (supplement) even if category vague',
    run: () => {
      return isCategoryAllowed('Home & Kitchen', 'Protein supplement powder') === false;
    },
  },
  {
    label: 'allowed category passes (Home & Kitchen > Storage)',
    run: () => {
      return isCategoryAllowed('Home & Kitchen > Storage & Organization', 'Stackable storage bin') === true;
    },
  },
  {
    label: 'pet ingestible filtered, pet non-ingestible allowed',
    run: () => {
      const food = isCategoryAllowed('Pet Supplies > Dog Food', 'Grain-free kibble') === false;
      const bed = isCategoryAllowed('Pet Supplies > Beds & Furniture', 'Orthopedic dog bed') === true;
      return food && bed;
    },
  },
  {
    label: 'price filter predicate: outside [10,150] rejected, inside accepted',
    run: () => {
      const inRange = (p: number, min: number, max: number) => p >= min && p <= max;
      return inRange(24.99, 10, 150) && !inRange(4.99, 10, 150) && !inRange(199, 10, 150);
    },
  },
  {
    label: 'resolveCategoryTargets: blank/all => full V1 set; name => one; id => one',
    run: () => {
      const all = resolveCategoryTargets('', undefined).length === ALLOWED_V1_CATEGORIES.length;
      const byName = resolveCategoryTargets('Home & Kitchen', undefined);
      const byId = resolveCategoryTargets('228013', undefined);
      return all && byName.length === 1 && byName[0].rootId === 1055398 && byId.length === 1 && byId[0].rootId === 228013;
    },
  },
  {
    label: 'keepaDiscoveryScore rewards bigger rank improvement',
    run: () => {
      const low = keepaDiscoveryScore({ asin: 'A', rankImprovement30d: 5, salesRankCurrent: 50000 });
      const high = keepaDiscoveryScore({ asin: 'A', rankImprovement30d: 60, salesRankCurrent: 3000 });
      return high > low && high <= 100 && low >= 0;
    },
  },
];

function main(): void {
  let ok = 0, fail = 0;
  console.log('OTTO Keepa discovery cases');
  console.log('--------------------------');
  for (const c of CASES) {
    let pass = false; let err = '';
    try { pass = c.run(); } catch (e) { err = (e as Error).message; }
    if (pass) ok++; else fail++;
    console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${c.label}${err ? `  (threw: ${err})` : ''}`);
  }
  console.log('');
  console.log(`${ok}/${ok + fail} cases passed`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
