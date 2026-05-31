// Keepa Product Finder query strategies. Pure config + helpers (no I/O) so
// they're unit-testable. Each strategy compiles a category into one or more
// Keepa Product Finder selection specs. Running multiple strategies and then
// deduping their ASINs increases candidate VOLUME without touching any
// downstream validation gate — strategies only shape Keepa INPUT.

import type { KeepaQuerySpec } from '@/clients/keepaClient';
import type { AllowedCategory } from '@/utils/keepaCategories';

export type KeepaStrategyName =
  | 'rank_drops_30d'
  | 'rank_drops_90d'
  | 'current_rank_only'
  | 'category_movers'
  | 'price_band_movers'
  | 'review_quality_movers';

export const KEEPA_STRATEGY_NAMES: KeepaStrategyName[] = [
  'rank_drops_30d',
  'rank_drops_90d',
  'current_rank_only',
  'category_movers',
  'price_band_movers',
  'review_quality_movers',
];

export function isKeepaStrategyName(v: string): v is KeepaStrategyName {
  return (KEEPA_STRATEGY_NAMES as string[]).includes(v);
}

/**
 * Parse a --strategy=... selector. Accepts 'all', a single strategy name, or
 * a comma-separated list. Unknown names are dropped; a blank/empty/'all'
 * selector (or one that resolves to nothing) means every strategy.
 */
export function parseStrategySelector(raw?: string): KeepaStrategyName[] {
  if (!raw) return [...KEEPA_STRATEGY_NAMES];
  const parts = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (parts.length === 0 || parts.includes('all')) return [...KEEPA_STRATEGY_NAMES];
  const out: KeepaStrategyName[] = [];
  for (const p of parts) if (isKeepaStrategyName(p) && !out.includes(p)) out.push(p);
  return out.length > 0 ? out : [...KEEPA_STRATEGY_NAMES];
}

/** Amazon price bands (USD) for price_band_movers, expressed in cents. */
export const KEEPA_PRICE_BANDS_CENTS: ReadonlyArray<readonly [number, number]> = [
  [1000, 2500], // $10-25
  [2500, 5000], // $25-50
  [5000, 10000], // $50-100
  [10000, 20000], // $100-200
];

const REVIEW_MIN_RATING_X10 = 40; // 4.0 stars (Keepa rating is stars x10)
const REVIEW_MIN_COUNT = 50;

export interface StrategyBuildContext {
  /** Profile rank-improvement %; >0 means movement-seeking strategies require a drop. */
  minRankImprovementPercent: number;
  minAmazonPriceCents: number;
  maxAmazonPriceCents: number;
  maxSalesRank: number;
  minAvgRank30d: number;
  /** Per-query candidate pool size (before cross-strategy dedupe + maxAsins cap). */
  poolPerQuery: number;
}

/**
 * Compile a (strategy, category) pair into Keepa Product Finder specs. Most
 * strategies emit one spec per category; price_band_movers emits one per
 * price band that overlaps the profile's price range.
 */
export function buildStrategyQuerySpecs(
  strategy: KeepaStrategyName,
  category: AllowedCategory,
  ctx: StrategyBuildContext,
): KeepaQuerySpec[] {
  const base = {
    strategy,
    rootCategory: category.rootId,
    maxResults: ctx.poolPerQuery,
    currentRankMax: ctx.maxSalesRank,
    minAvgRank30d: ctx.minAvgRank30d,
    minAmazonPriceCents: ctx.minAmazonPriceCents,
    maxAmazonPriceCents: ctx.maxAmazonPriceCents,
  };
  const wantsMovement = ctx.minRankImprovementPercent > 0;

  switch (strategy) {
    case 'rank_drops_30d':
      return [{ ...base, label: 'rank_drops_30d', salesRankDrops30Min: 1, sort: [['salesRankDrops30', 'desc']] }];

    case 'rank_drops_90d':
      return [{ ...base, label: 'rank_drops_90d', salesRankDrops90Min: 1, sort: [['salesRankDrops90', 'desc']] }];

    case 'current_rank_only':
      // No rank-movement requirement at query level; the profile's rank
      // filter still scores/rejects downstream in classifyKeepaCandidate.
      return [{ ...base, label: 'current_rank_only', sort: [['current_SALES', 'asc']] }];

    case 'category_movers':
      // Best-ranked recent movers within each safe category (different slice
      // than rank_drops_30d, which surfaces the biggest movers regardless of
      // current rank).
      return [
        { ...base, label: `category_movers:${category.name}`, salesRankDrops30Min: 1, sort: [['current_SALES', 'asc']] },
      ];

    case 'price_band_movers': {
      const specs: KeepaQuerySpec[] = [];
      for (const [lo, hi] of KEEPA_PRICE_BANDS_CENTS) {
        const minC = Math.max(lo, ctx.minAmazonPriceCents);
        const maxC = Math.min(hi, ctx.maxAmazonPriceCents);
        if (minC >= maxC) continue; // band lies outside the profile price range
        specs.push({
          ...base,
          label: `price_band_movers:$${Math.round(minC / 100)}-${Math.round(maxC / 100)}`,
          minAmazonPriceCents: minC,
          maxAmazonPriceCents: maxC,
          salesRankDrops30Min: wantsMovement ? 1 : undefined,
          sort: [['salesRankDrops30', 'desc']],
        });
      }
      return specs;
    }

    case 'review_quality_movers':
      return [
        {
          ...base,
          label: 'review_quality_movers',
          minRatingX10: REVIEW_MIN_RATING_X10,
          minReviewCount: REVIEW_MIN_COUNT,
          sort: [['current_COUNT_REVIEWS', 'desc']],
        },
      ];
  }
}

// ---------------------------------------------------------------------------
// Token estimation + guard (pure)
// ---------------------------------------------------------------------------

/** Rough token cost of a single Product Finder /query call. */
export const KEEPA_QUERY_TOKEN_COST = 1;
/** Rough token cost of fetching one product's detail (/product, stats=90). */
export const KEEPA_PRODUCT_TOKEN_COST = 1;

/** Number of /query calls a strategy makes for a given category count. */
export function countStrategyQueries(strategy: KeepaStrategyName, categoryCount: number): number {
  if (strategy === 'price_band_movers') return categoryCount * KEEPA_PRICE_BANDS_CENTS.length;
  return categoryCount;
}

export interface TokenEstimateInput {
  strategies: KeepaStrategyName[];
  categoryCount: number;
  maxAsins: number;
}

/**
 * Estimate Keepa token use for a run: one cost per Product Finder query plus
 * product-detail fetches, which are deduped and capped at maxAsins. This is a
 * conservative pre-run guard, not an exact figure — the run also enforces the
 * budget against the API's actual reported tokensConsumed.
 */
export function estimateKeepaTokens(input: TokenEstimateInput): number {
  let queries = 0;
  for (const s of input.strategies) queries += countStrategyQueries(s, input.categoryCount);
  const queryTokens = queries * KEEPA_QUERY_TOKEN_COST;
  const productTokens = Math.max(0, input.maxAsins) * KEEPA_PRODUCT_TOKEN_COST;
  return queryTokens + productTokens;
}

export function exceedsTokenBudget(estimatedTokens: number, maxTokens: number): boolean {
  return maxTokens > 0 && estimatedTokens > maxTokens;
}

export type TokenGuardDecision = 'proceed' | 'block';

/** Decide whether a run may proceed. --force always proceeds. */
export function tokenGuardDecision(estimatedTokens: number, maxTokens: number, force: boolean): TokenGuardDecision {
  if (force) return 'proceed';
  return exceedsTokenBudget(estimatedTokens, maxTokens) ? 'block' : 'proceed';
}

// ---------------------------------------------------------------------------
// Cross-strategy ASIN dedupe (pure)
// ---------------------------------------------------------------------------

export interface AsinDiscovery {
  asin: string;
  strategy: string;
  categoryName?: string;
  rootId?: number;
}

export interface AsinStrategyMeta {
  asin: string;
  strategiesFound: string[];
  primaryStrategy: string;
  strategyCount: number;
  firstCategoryName?: string;
  firstRootId?: number;
}

/**
 * Dedupe ASINs discovered across strategies, preserving first-sighting order.
 * primaryStrategy is the strategy that first surfaced the ASIN; strategiesFound
 * accumulates every strategy that returned it. This is a within-run dedupe and
 * is independent of the cross-batch export filter.
 */
export function mergeAsinDiscoveries(discoveries: AsinDiscovery[]): AsinStrategyMeta[] {
  const map = new Map<string, AsinStrategyMeta>();
  for (const d of discoveries) {
    const asin = d.asin.trim();
    if (!asin) continue;
    const existing = map.get(asin);
    if (!existing) {
      map.set(asin, {
        asin,
        strategiesFound: [d.strategy],
        primaryStrategy: d.strategy,
        strategyCount: 1,
        firstCategoryName: d.categoryName,
        firstRootId: d.rootId,
      });
    } else if (!existing.strategiesFound.includes(d.strategy)) {
      existing.strategiesFound.push(d.strategy);
      existing.strategyCount = existing.strategiesFound.length;
    }
  }
  return [...map.values()];
}

/** How many ASINs were surfaced by more than one strategy. */
export function countDuplicateAsins(metas: AsinStrategyMeta[]): number {
  return metas.filter((m) => m.strategyCount > 1).length;
}

// ---------------------------------------------------------------------------
// Strategy plan / modes (default, all, auto) + short-circuit decision
// ---------------------------------------------------------------------------

export type StrategyMode = 'all' | 'auto' | 'fixed';

/**
 * The single most token-efficient default. Calibration on GCE showed
 * rank_drops_30d produced all accepted candidates while the other strategies
 * spent tokens for zero accepted output, so it is the default for a normal run.
 */
export const DEFAULT_KEEPA_STRATEGY: KeepaStrategyName = 'rank_drops_30d';

/**
 * Fallback order for --strategy=auto: start with the proven producer, then add
 * breadth only if the candidate limit hasn't been met.
 */
export const KEEPA_AUTO_ORDER: KeepaStrategyName[] = [
  'rank_drops_30d',
  'rank_drops_90d',
  'current_rank_only',
  'category_movers',
  'price_band_movers',
  'review_quality_movers',
];

export interface StrategyPlan {
  mode: StrategyMode;
  /** Ordered strategies to consider (auto/fixed may stop early; all never does). */
  strategies: KeepaStrategyName[];
  label: string;
}

/**
 * Parse --strategy=... into a plan.
 *   (blank)  => fixed [rank_drops_30d]   (efficient default)
 *   all      => all strategies, never short-circuited (calibration)
 *   auto     => fallback order, short-circuits once the limit is met
 *   a,b,c    => fixed ordered list (short-circuits once the limit is met)
 * 'all'/'auto' anywhere in a list win. Unknown names are dropped; an empty
 * result falls back to the default strategy.
 */
export function parseStrategyPlan(raw?: string): StrategyPlan {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === '') return { mode: 'fixed', strategies: [DEFAULT_KEEPA_STRATEGY], label: DEFAULT_KEEPA_STRATEGY };
  if (v === 'all') return { mode: 'all', strategies: [...KEEPA_STRATEGY_NAMES], label: 'all' };
  if (v === 'auto') return { mode: 'auto', strategies: [...KEEPA_AUTO_ORDER], label: 'auto' };
  const parts = v.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.includes('all')) return { mode: 'all', strategies: [...KEEPA_STRATEGY_NAMES], label: 'all' };
  if (parts.includes('auto')) return { mode: 'auto', strategies: [...KEEPA_AUTO_ORDER], label: 'auto' };
  const out: KeepaStrategyName[] = [];
  for (const p of parts) if (isKeepaStrategyName(p) && !out.includes(p)) out.push(p);
  if (out.length === 0) return { mode: 'fixed', strategies: [DEFAULT_KEEPA_STRATEGY], label: DEFAULT_KEEPA_STRATEGY };
  return { mode: 'fixed', strategies: out, label: out.join(',') };
}

/**
 * Short-circuit decision: should the next strategy run? 'all' always runs every
 * strategy (full diagnostics for calibration); 'auto'/'fixed' stop once enough
 * accepted candidates have been gathered.
 */
export function shouldRunNextStrategy(mode: StrategyMode, acceptedSoFar: number, maxAsins: number): boolean {
  if (mode === 'all') return true;
  return acceptedSoFar < maxAsins;
}

// ---------------------------------------------------------------------------
// Strategy efficiency report + recommendation (pure)
// ---------------------------------------------------------------------------

export interface StrategyEfficiencyInput {
  strategy: string;
  tokensConsumed?: number;
  rawReturned: number;
  uniqueAsins: number;
  accepted: number;
  sourceValid: number;
  demandPassed: number;
  finalValidated: number;
  exportedAfterFilters: number;
}

export interface StrategyEfficiency extends StrategyEfficiencyInput {
  /** null when there is nothing to divide by (avoids NaN/Infinity). */
  tokensPerAccepted: number | null;
  tokensPerExported: number | null;
  /** % of total exported (falls back to % of total accepted when nothing exported). */
  contributionPercent: number;
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/** Build the per-strategy efficiency table. Safe for zero-export strategies. */
export function buildStrategyEfficiency(rows: StrategyEfficiencyInput[]): StrategyEfficiency[] {
  const totalExported = rows.reduce((s, r) => s + r.exportedAfterFilters, 0);
  const totalAccepted = rows.reduce((s, r) => s + r.accepted, 0);
  const denom = totalExported > 0 ? totalExported : totalAccepted;
  return rows.map((r) => {
    const t = r.tokensConsumed;
    const tokensPerAccepted = t !== undefined && r.accepted > 0 ? round(t / r.accepted, 2) : null;
    const tokensPerExported = t !== undefined && r.exportedAfterFilters > 0 ? round(t / r.exportedAfterFilters, 2) : null;
    const basis = totalExported > 0 ? r.exportedAfterFilters : r.accepted;
    const contributionPercent = denom > 0 ? round((basis / denom) * 100, 1) : 0;
    return { ...r, tokensPerAccepted, tokensPerExported, contributionPercent };
  });
}

export interface StrategyRecommendation {
  /** Highest-contributing strategy, or null when nothing produced output. */
  bestStrategy: string | null;
  recommendedProfile: string;
  /** Strategies that consumed tokens but produced no accepted candidates. */
  disableByDefault: string[];
  /** True only when >1 strategy actually contributed output. */
  strategyAllWorthwhile: boolean;
  rationale: string[];
}

/**
 * Recommend a default strategy/profile from one run's efficiency table. Best =
 * most exported, then most accepted, then fewest tokens/accepted.
 */
export function recommendStrategyConfig(
  efficiencies: StrategyEfficiency[],
  profileName: string,
): StrategyRecommendation {
  const ranked = [...efficiencies].sort((a, b) => {
    if (b.exportedAfterFilters !== a.exportedAfterFilters) return b.exportedAfterFilters - a.exportedAfterFilters;
    if (b.accepted !== a.accepted) return b.accepted - a.accepted;
    return (a.tokensPerAccepted ?? Infinity) - (b.tokensPerAccepted ?? Infinity);
  });
  const top = ranked[0];
  const bestStrategy = top && (top.exportedAfterFilters > 0 || top.accepted > 0) ? top.strategy : null;
  const contributors = efficiencies.filter((e) => e.exportedAfterFilters > 0 || e.accepted > 0);
  const disableByDefault = efficiencies
    .filter((e) => (e.tokensConsumed ?? 0) > 0 && e.accepted === 0 && e.exportedAfterFilters === 0)
    .map((e) => e.strategy);
  const strategyAllWorthwhile = contributors.length > 1;

  const rationale: string[] = [];
  if (bestStrategy) rationale.push(`Best single strategy: ${bestStrategy} (most exported/accepted this run).`);
  else rationale.push('No strategy produced accepted candidates this run.');
  if (disableByDefault.length > 0) rationale.push(`Disable by default (spent tokens, zero accepted): ${disableByDefault.join(', ')}.`);
  rationale.push(
    strategyAllWorthwhile
      ? 'Multiple strategies contributed — --strategy=all or --strategy=auto adds real breadth.'
      : 'Only one strategy contributed — prefer that single strategy or --strategy=auto over --strategy=all to save tokens.',
  );
  rationale.push(`Profile compared: ${profileName} (use calibrate:keepa-discovery to compare profiles head-to-head).`);

  return { bestStrategy, recommendedProfile: profileName, disableByDefault, strategyAllWorthwhile, rationale };
}
