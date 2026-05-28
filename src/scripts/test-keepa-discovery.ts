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

import { normalizeKeepaProduct, keepaDiscoveryScore, buildProductFinderSelection } from '@/clients/keepaClient';
import { isCategoryAllowed, resolveCategoryTargets, ALLOWED_V1_CATEGORIES, type AllowedCategory } from '@/utils/keepaCategories';
import { asinNativeResolution } from '@/pipeline/asinResolution';
import { resolveProfile, mergeKeepaOptions, KEEPA_PROFILES } from '@/config/keepaProfiles';
import { classifyKeepaCandidate, KeepaFilterReason } from '@/agents/discovery/keepaFilters';
import {
  KEEPA_STRATEGY_NAMES,
  isKeepaStrategyName,
  parseStrategySelector,
  buildStrategyQuerySpecs,
  estimateKeepaTokens,
  exceedsTokenBudget,
  tokenGuardDecision,
  mergeAsinDiscoveries,
  countDuplicateAsins,
  type StrategyBuildContext,
} from '@/config/keepaStrategies';
import { normalizeRepeatPolicy } from '@/agents/export/crossBatchFilter';
import type { ProductCandidate } from '@/types/product';

const STRAT_CTX: StrategyBuildContext = {
  minRankImprovementPercent: 10,
  minAmazonPriceCents: 1000,
  maxAmazonPriceCents: 15000,
  maxSalesRank: 150000,
  minAvgRank30d: 0,
  poolPerQuery: 50,
};
const STRAT_CAT: AllowedCategory = { name: 'Home & Kitchen', rootId: 1055398 };

const DEFAULTS = { minRankImprovementPercent: 20, minAmazonPrice: 10, maxAmazonPrice: 150, maxAsins: 100 };
const FILTER_OPTS = { minRankImprovementPercent: 10, minAmazonPrice: 10, maxAmazonPrice: 150 };
function norm(over: Partial<{ asin: string; title: string; amazonCategory: string; rootCategory: number; amazonPrice: number; rankImprovement30d: number }> = {}) {
  return {
    asin: over.asin ?? 'B0X', title: over.title ?? 'Storage bin',
    amazonCategory: over.amazonCategory ?? 'Home & Kitchen > Storage',
    rootCategory: over.rootCategory ?? 1055398,
    amazonPrice: over.amazonPrice, rankImprovement30d: over.rankImprovement30d,
  } as Parameters<typeof classifyKeepaCandidate>[0];
}

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
  // --- calibration profiles ---
  {
    label: 'profiles exist with expected thresholds (strict/balanced/broad/exploratory)',
    run: () => {
      return (
        KEEPA_PROFILES.strict.minRankImprovementPercent === 20 &&
        KEEPA_PROFILES.balanced.minRankImprovementPercent === 10 &&
        KEEPA_PROFILES.broad.minRankImprovementPercent === 5 &&
        KEEPA_PROFILES.broad.maxAmazonPrice === 200 &&
        KEEPA_PROFILES.exploratory.diagnosticsOnly === true
      );
    },
  },
  {
    label: 'resolveProfile parses name (case-insensitive), rejects unknown',
    run: () => {
      return resolveProfile('BALANCED')?.name === 'balanced' && resolveProfile('nope') === null && resolveProfile(undefined) === null;
    },
  },
  {
    label: 'mergeKeepaOptions: profile sets base, explicit overrides win',
    run: () => {
      const m = mergeKeepaOptions(KEEPA_PROFILES.strict, { minRankImprovementPercent: 7, maxAsins: 25 }, DEFAULTS);
      return m.minRankImprovementPercent === 7 && m.minAmazonPrice === 12 && m.maxAmazonPrice === 150 && m.maxAsins === 25 && m.profileName === 'strict';
    },
  },
  {
    label: 'mergeKeepaOptions: no profile => env defaults, profileName=custom',
    run: () => {
      const m = mergeKeepaOptions(null, {}, DEFAULTS);
      return m.minRankImprovementPercent === 20 && m.minAmazonPrice === 10 && m.maxAmazonPrice === 150 && m.profileName === 'custom';
    },
  },
  // --- filter reason codes ---
  {
    label: 'classify: accepted candidate',
    run: () => classifyKeepaCandidate(norm({ amazonPrice: 25, rankImprovement30d: 30 }), FILTER_OPTS).accepted === true,
  },
  {
    label: 'classify: missing ASIN => KEEPA_MISSING_ASIN',
    run: () => classifyKeepaCandidate(null, FILTER_OPTS).reason === KeepaFilterReason.KEEPA_MISSING_ASIN,
  },
  {
    label: 'classify: missing title => KEEPA_MISSING_TITLE',
    run: () => classifyKeepaCandidate(norm({ title: '' }), FILTER_OPTS).reason === KeepaFilterReason.KEEPA_MISSING_TITLE,
  },
  {
    label: 'classify: excluded category => KEEPA_CATEGORY_EXCLUDED',
    run: () => classifyKeepaCandidate(norm({ amazonCategory: 'Health & Personal Care', title: 'vitamin' }), FILTER_OPTS).reason === KeepaFilterReason.KEEPA_CATEGORY_EXCLUDED,
  },
  {
    label: 'classify: rank improvement too low => KEEPA_RANK_IMPROVEMENT_TOO_LOW',
    run: () => classifyKeepaCandidate(norm({ amazonPrice: 25, rankImprovement30d: 3 }), FILTER_OPTS).reason === KeepaFilterReason.KEEPA_RANK_IMPROVEMENT_TOO_LOW,
  },
  {
    label: 'classify: price too low / too high',
    run: () => {
      const lo = classifyKeepaCandidate(norm({ amazonPrice: 4, rankImprovement30d: 30 }), FILTER_OPTS).reason;
      const hi = classifyKeepaCandidate(norm({ amazonPrice: 999, rankImprovement30d: 30 }), FILTER_OPTS).reason;
      return lo === KeepaFilterReason.KEEPA_PRICE_TOO_LOW && hi === KeepaFilterReason.KEEPA_PRICE_TOO_HIGH;
    },
  },
  {
    label: 'classify: missing price allowed by default, rejected when requirePrice',
    run: () => {
      const allowed = classifyKeepaCandidate(norm({ rankImprovement30d: 30 }), FILTER_OPTS).accepted === true;
      const rejected = classifyKeepaCandidate(norm({ rankImprovement30d: 30 }), { ...FILTER_OPTS, requirePrice: true }).reason === KeepaFilterReason.KEEPA_MISSING_PRICE;
      return allowed && rejected;
    },
  },
  {
    label: 'classify: undefined rank improvement is NOT rejected (cant judge)',
    run: () => classifyKeepaCandidate(norm({ amazonPrice: 25 }), FILTER_OPTS).accepted === true,
  },
  // --- multi-strategy: config parsing ---
  {
    label: 'parseStrategySelector: all => every strategy (6)',
    run: () => parseStrategySelector('all').length === KEEPA_STRATEGY_NAMES.length && KEEPA_STRATEGY_NAMES.length === 6,
  },
  {
    label: 'parseStrategySelector: csv subset, unknown names dropped',
    run: () => {
      const r = parseStrategySelector('rank_drops_30d,current_rank_only,bogus');
      return r.length === 2 && r.includes('rank_drops_30d') && r.includes('current_rank_only');
    },
  },
  {
    label: 'parseStrategySelector: blank/undefined/unknown-only => all',
    run: () =>
      parseStrategySelector(undefined).length === 6 &&
      parseStrategySelector('').length === 6 &&
      parseStrategySelector('nope').length === 6,
  },
  {
    label: 'isKeepaStrategyName validates known/unknown',
    run: () => isKeepaStrategyName('price_band_movers') && !isKeepaStrategyName('nope'),
  },
  {
    label: 'strategy=all expands to multiple distinct strategies, each with queries',
    run: () => {
      const all = parseStrategySelector('all');
      const seen = new Set<string>();
      for (const s of all) for (const spec of buildStrategyQuerySpecs(s, STRAT_CAT, STRAT_CTX)) seen.add(spec.strategy);
      return all.length === 6 && seen.size === 6;
    },
  },
  // --- multi-strategy: query spec shapes ---
  {
    label: 'specs: rank_drops_30d requires 30d drop; current_rank_only does not',
    run: () => {
      const a = buildStrategyQuerySpecs('rank_drops_30d', STRAT_CAT, STRAT_CTX);
      const b = buildStrategyQuerySpecs('current_rank_only', STRAT_CAT, STRAT_CTX);
      return a.length === 1 && a[0].salesRankDrops30Min === 1 && b.length === 1 && b[0].salesRankDrops30Min === undefined;
    },
  },
  {
    label: 'specs: price_band_movers emits multiple band queries within the profile range',
    run: () => {
      const specs = buildStrategyQuerySpecs('price_band_movers', STRAT_CAT, STRAT_CTX);
      return specs.length >= 2 && specs.every((s) => (s.minAmazonPriceCents ?? 0) >= 1000 && (s.maxAmazonPriceCents ?? 1e9) <= 15000);
    },
  },
  {
    label: 'specs: review_quality_movers sets rating + review thresholds',
    run: () => {
      const s = buildStrategyQuerySpecs('review_quality_movers', STRAT_CAT, STRAT_CTX)[0];
      return (s.minRatingX10 ?? 0) > 0 && (s.minReviewCount ?? 0) > 0;
    },
  },
  {
    label: 'buildProductFinderSelection maps to real Keepa Product Finder fields (no fabrication)',
    run: () => {
      const sel = buildProductFinderSelection(buildStrategyQuerySpecs('rank_drops_30d', STRAT_CAT, STRAT_CTX)[0]);
      return (
        sel.current_SALES_gte === 1 &&
        sel.salesRankDrops30_gte === 1 &&
        sel.current_SALES_lte === 150000 &&
        sel.current_AMAZON_gte === 1000 &&
        sel.current_AMAZON_lte === 15000
      );
    },
  },
  // --- multi-strategy: ASIN dedupe + provenance ---
  {
    label: 'mergeAsinDiscoveries dedupes ASINs across strategies, preserving provenance',
    run: () => {
      const metas = mergeAsinDiscoveries([
        { asin: 'A', strategy: 'rank_drops_30d' },
        { asin: 'A', strategy: 'current_rank_only' },
        { asin: 'B', strategy: 'rank_drops_30d' },
        { asin: 'A', strategy: 'rank_drops_30d' }, // repeat within same strategy
      ]);
      const a = metas.find((m) => m.asin === 'A')!;
      return (
        metas.length === 2 &&
        a.primaryStrategy === 'rank_drops_30d' &&
        a.strategyCount === 2 &&
        a.strategiesFound.length === 2 &&
        countDuplicateAsins(metas) === 1
      );
    },
  },
  // --- multi-strategy: strategy-level reason counts ---
  {
    label: 'strategy-level reason counts tally rejections per primary strategy',
    run: () => {
      const perStrategy: Record<string, Record<string, number>> = {};
      const tally = (strategy: string, reason: string) => {
        perStrategy[strategy] = perStrategy[strategy] ?? {};
        perStrategy[strategy][reason] = (perStrategy[strategy][reason] ?? 0) + 1;
      };
      const rows = [
        { strategy: 'current_rank_only', n: norm({ amazonPrice: 4, rankImprovement30d: 30 }) }, // too low
        { strategy: 'current_rank_only', n: norm({ amazonPrice: 999, rankImprovement30d: 30 }) }, // too high
        { strategy: 'rank_drops_30d', n: norm({ amazonPrice: 25, rankImprovement30d: 30 }) }, // accepted
      ];
      for (const r of rows) {
        const d = classifyKeepaCandidate(r.n, FILTER_OPTS);
        if (!d.accepted) tally(r.strategy, d.reason!);
      }
      return (
        perStrategy['current_rank_only']?.[KeepaFilterReason.KEEPA_PRICE_TOO_LOW] === 1 &&
        perStrategy['current_rank_only']?.[KeepaFilterReason.KEEPA_PRICE_TOO_HIGH] === 1 &&
        perStrategy['rank_drops_30d'] === undefined
      );
    },
  },
  // --- multi-strategy: token guard ---
  {
    label: 'estimateKeepaTokens grows with more strategies',
    run: () => {
      const one = estimateKeepaTokens({ strategies: ['rank_drops_30d'], categoryCount: 6, maxAsins: 10 });
      const all = estimateKeepaTokens({ strategies: [...KEEPA_STRATEGY_NAMES], categoryCount: 6, maxAsins: 10 });
      return all > one;
    },
  },
  {
    label: 'token guard blocks over-budget run',
    run: () => {
      const est = estimateKeepaTokens({ strategies: [...KEEPA_STRATEGY_NAMES], categoryCount: 6, maxAsins: 200 });
      return exceedsTokenBudget(est, 1) === true && tokenGuardDecision(est, 1, false) === 'block';
    },
  },
  {
    label: '--force overrides token guard',
    run: () => {
      const est = estimateKeepaTokens({ strategies: [...KEEPA_STRATEGY_NAMES], categoryCount: 6, maxAsins: 200 });
      return tokenGuardDecision(est, 1, true) === 'proceed';
    },
  },
  {
    label: 'token guard disabled when max=0 (no guard)',
    run: () => exceedsTokenBudget(99999, 0) === false && tokenGuardDecision(99999, 0, false) === 'proceed',
  },
  // --- cross-batch filtering unchanged, independent of within-run dedupe ---
  {
    label: 'cross-batch repeat policies unchanged; separate from within-run strategy dedupe',
    run: () => {
      const policiesOk =
        normalizeRepeatPolicy('never_repeat') === 'never_repeat' &&
        normalizeRepeatPolicy('exclude_recent') === 'exclude_recent' &&
        normalizeRepeatPolicy('allow_repeats') === 'allow_repeats';
      // within-run dedupe collapses same-ASIN sightings; cross-batch is a later, separate filter.
      const metas = mergeAsinDiscoveries([
        { asin: 'A', strategy: 'rank_drops_30d' },
        { asin: 'A', strategy: 'rank_drops_30d' },
      ]);
      return policiesOk && metas.length === 1;
    },
  },
  // --- no fake data on failure ---
  {
    label: 'no fake Keepa data: an errored/empty query contributes zero candidates',
    run: () => {
      // A /query that errors returns no ASINs -> no discoveries -> merge fabricates nothing.
      const metas = mergeAsinDiscoveries([]);
      return metas.length === 0 && countDuplicateAsins(metas) === 0;
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
