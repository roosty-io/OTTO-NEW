import { v4 as uuidv4 } from 'uuid';
import {
  getKeepaClient,
  keepaDiscoveryScore,
  normalizeKeepaProduct,
  type KeepaError,
  type KeepaTokenInfo,
  type NormalizedKeepaProduct,
} from '@/clients/keepaClient';
import { getSupabase } from '@/clients/supabaseClient';
import { logger } from '@/utils/logger';
import { persistAgentLog } from '@/agents/baseAgent';
import { resolveCategoryTargets, type AllowedCategory } from '@/utils/keepaCategories';
import { classifyKeepaCandidate, KeepaFilterReason } from '@/agents/discovery/keepaFilters';
import {
  KEEPA_STRATEGY_NAMES,
  buildStrategyQuerySpecs,
  shouldRunNextStrategy,
  type AsinStrategyMeta,
  type KeepaStrategyName,
  type StrategyBuildContext,
  type StrategyMode,
} from '@/config/keepaStrategies';
import { env } from '@/config/env';
import type { ProductCandidate } from '@/types/product';

export interface KeepaDiscoveryInput {
  discoveryRunId: string;
  /** Total ASIN ceiling across all categories/strategies. Defaults to env. */
  maxAsins?: number;
  /** CLI category selector (name or root id); blank = all V1-safe categories. */
  categorySelector?: string;
  minAmazonPrice?: number;
  maxAmazonPrice?: number;
  minRankImprovementPercent?: number;
  maxSalesRank?: number;
  /** Ordered Product Finder strategies to consider; empty/undefined = default. */
  strategies?: KeepaStrategyName[];
  /** all = run every strategy; auto/fixed = stop once enough candidates found. */
  strategyMode?: StrategyMode;
  /** Token budget for the run (0 = no guard). Enforced against actual usage. */
  maxKeepaTokens?: number;
  /** Bypass the token guard. */
  force?: boolean;
}

export interface KeepaCategoryStat {
  category: string;
  rootId: number;
  rawAsins: number;
  accepted: number;
  filteredCategory: number;
  filteredPrice: number;
  filteredRankImprovement: number;
  filteredNoAsin: number;
}

export interface KeepaStrategyStat {
  strategy: string;
  /** Keepa tokens consumed by this strategy's queries + product fetches. */
  tokensConsumed: number;
  /** ASINs returned across this strategy's queries (pre-dedupe). */
  rawProductsReturned: number;
  /** ASINs this strategy was the first to surface (unique contribution). */
  uniqueAsinsContributed: number;
  /** Candidates accepted whose primary (first-seen) strategy is this one. */
  accepted: number;
  rejected: number;
  /** Keepa filter reason counts for this strategy's rejected candidates. */
  filterReasons: Record<string, number>;
}

export interface AsinStrategyProvenance {
  primaryStrategy: string;
  strategiesFound: string[];
  strategyCount: number;
}

export interface SkippedStrategy {
  strategy: string;
  /** 'enough_candidates' | 'token_budget' */
  reason: string;
}

export interface KeepaDiscoveryOutput {
  candidates: ProductCandidate[];
  perCategory: KeepaCategoryStat[];
  perStrategy: KeepaStrategyStat[];
  strategiesRun: string[];
  strategiesSkipped: SkippedStrategy[];
  strategyMode: StrategyMode;
  duplicateAsinsAcrossStrategies: number;
  /** ASIN -> provenance, for "which strategy produced each exported product". */
  strategyByAsin: Record<string, AsinStrategyProvenance>;
  tokenBudgetStopped: boolean;
  tokens: KeepaTokenInfo;
  error?: KeepaError;
  rawCandidateCount: number;
  asinNativeCount: number;
  /** Diagnostic counts keyed by KeepaFilterReason code (across all strategies). */
  filterReasons: Record<string, number>;
}

const PRODUCT_FETCH_BATCH = 100; // Keepa /product accepts up to 100 ASINs per call

interface MetaEntry {
  found: Set<string>;
  primary: string;
  firstCat: string;
  firstRoot: number;
}

export class KeepaRankMovementDiscoveryAgent {
  readonly name = 'KeepaRankMovementDiscoveryAgent';
  private readonly log = logger.child(this.name);

  async run(input: KeepaDiscoveryInput): Promise<KeepaDiscoveryOutput> {
    const keepa = getKeepaClient();

    const maxAsins = input.maxAsins ?? env.keepa.discoveryMaxAsins;
    const minPrice = input.minAmazonPrice ?? env.keepa.discoveryMinAmazonPrice;
    const maxPrice = input.maxAmazonPrice ?? env.keepa.discoveryMaxAmazonPrice;
    const minRankImprovement = input.minRankImprovementPercent ?? env.keepa.discoveryMinRankImprovementPercent;
    const maxSalesRank = input.maxSalesRank ?? env.keepa.discoveryMaxSalesRank;
    const strategies = input.strategies && input.strategies.length > 0 ? input.strategies : [...KEEPA_STRATEGY_NAMES];
    const strategyMode: StrategyMode = input.strategyMode ?? 'fixed';
    const maxKeepaTokens = input.maxKeepaTokens ?? 0;
    const force = input.force ?? false;

    const targets: AllowedCategory[] = resolveCategoryTargets(
      input.categorySelector,
      env.keepa.discoveryAllowedCategories,
    );

    // Gather a broad candidate pool per query, then dedupe + cap to maxAsins
    // before paying for /product detail. /query cost is per-call, not
    // per-result, so a larger pool is cheap; product fetches are the cost.
    const poolPerQuery = Math.min(100, Math.max(maxAsins, 20));
    const ctx: StrategyBuildContext = {
      minRankImprovementPercent: minRankImprovement,
      minAmazonPriceCents: Math.round(minPrice * 100),
      maxAmazonPriceCents: Math.round(maxPrice * 100),
      maxSalesRank,
      minAvgRank30d: env.keepa.discoveryMinAvgRank30d,
      poolPerQuery,
    };

    let tokens: KeepaTokenInfo = {};
    let firstError: KeepaError | undefined;
    let tokenBudgetStopped = false;
    const overBudget = (): boolean => !force && maxKeepaTokens > 0 && (tokens.tokensConsumed ?? 0) >= maxKeepaTokens;

    const perStrategyMap = new Map<string, KeepaStrategyStat>();
    const ensureStrat = (s: string): KeepaStrategyStat => {
      let st = perStrategyMap.get(s);
      if (!st) {
        st = { strategy: s, tokensConsumed: 0, rawProductsReturned: 0, uniqueAsinsContributed: 0, accepted: 0, rejected: 0, filterReasons: {} };
        perStrategyMap.set(s, st);
      }
      return st;
    };

    const perCategoryMap = new Map<string, KeepaCategoryStat>();
    const ensureCat = (name: string, rootId: number): KeepaCategoryStat => {
      let cs = perCategoryMap.get(name);
      if (!cs) {
        cs = { category: name, rootId, rawAsins: 0, accepted: 0, filteredCategory: 0, filteredPrice: 0, filteredRankImprovement: 0, filteredNoAsin: 0 };
        perCategoryMap.set(name, cs);
      }
      return cs;
    };

    const candidates: ProductCandidate[] = [];
    const filterReasons: Record<string, number> = {};
    const bumpReason = (code: string) => {
      filterReasons[code] = (filterReasons[code] ?? 0) + 1;
    };
    const asinMeta = new Map<string, MetaEntry>();
    const fetchedAsins = new Set<string>();
    const strategiesRun: string[] = [];
    const strategiesSkipped: SkippedStrategy[] = [];
    let rawCandidateCount = 0;

    const toMeta = (asin: string): AsinStrategyMeta | undefined => {
      const m = asinMeta.get(asin);
      if (!m) return undefined;
      return {
        asin,
        strategiesFound: [...m.found],
        primaryStrategy: m.primary,
        strategyCount: m.found.size,
        firstCategoryName: m.firstCat,
        firstRootId: m.firstRoot,
      };
    };

    // Process strategies one at a time so auto/fixed can short-circuit once the
    // candidate limit is met, and so token attribution is per-strategy.
    for (let i = 0; i < strategies.length; i++) {
      const strategy = strategies[i];

      if (!shouldRunNextStrategy(strategyMode, candidates.length, maxAsins)) {
        for (let j = i; j < strategies.length; j++) strategiesSkipped.push({ strategy: strategies[j], reason: 'enough_candidates' });
        break;
      }
      if (overBudget()) {
        tokenBudgetStopped = true;
        for (let j = i; j < strategies.length; j++) strategiesSkipped.push({ strategy: strategies[j], reason: 'token_budget' });
        break;
      }

      const st = ensureStrat(strategy);
      strategiesRun.push(strategy);
      const newUnique: string[] = [];

      // ---- discover ASINs for this strategy (Product Finder /query) ----
      let stopDiscovery = false;
      for (const target of targets) {
        if (overBudget()) {
          tokenBudgetStopped = true;
          stopDiscovery = true;
          break;
        }
        for (const spec of buildStrategyQuerySpecs(strategy, target, ctx)) {
          if (overBudget()) {
            tokenBudgetStopped = true;
            stopDiscovery = true;
            break;
          }
          const res = await keepa.findProducts(spec);
          tokens = mergeTokens(tokens, res.tokens);
          st.tokensConsumed += res.tokens.tokensConsumed ?? 0;
          if (res.error) {
            firstError = firstError ?? res.error;
            this.log.error('Keepa Product Finder query failed', { strategy, category: target.name, label: spec.label, ...res.error });
            await persistAgentLog({
              agentName: this.name,
              runId: input.discoveryRunId,
              level: 'error',
              message: `Keepa discovery error: ${res.error.code}`,
              data: { strategy, category: target.name, label: spec.label, ...res.error },
            });
            continue;
          }
          for (const asin of res.asins) {
            st.rawProductsReturned++;
            const m = asinMeta.get(asin);
            if (!m) {
              asinMeta.set(asin, { found: new Set([strategy]), primary: strategy, firstCat: target.name, firstRoot: target.rootId });
              st.uniqueAsinsContributed++;
              newUnique.push(asin);
            } else {
              m.found.add(strategy);
            }
          }
        }
        if (stopDiscovery) break;
      }

      // ---- fetch + classify this strategy's NEW unique ASINs, up to cap ----
      const remaining = maxAsins - candidates.length;
      const fetchList = remaining > 0 ? newUnique.slice(0, remaining) : [];
      for (const batch of chunk(fetchList, PRODUCT_FETCH_BATCH)) {
        if (overBudget()) {
          tokenBudgetStopped = true;
          break;
        }
        const fetchRes = await keepa.fetchProductsByAsin(batch);
        tokens = mergeTokens(tokens, fetchRes.tokens);
        st.tokensConsumed += fetchRes.tokens.tokensConsumed ?? 0;
        if (fetchRes.error) {
          firstError = firstError ?? fetchRes.error;
          this.log.error('Keepa product fetch failed', { strategy, ...fetchRes.error });
          continue;
        }
        for (const product of fetchRes.products) {
          rawCandidateCount++;
          const m = asinMeta.get(product.asin);
          const norm = normalizeKeepaProduct(product.raw);
          const catName = m?.firstCat ?? norm?.amazonCategory ?? 'unknown';
          const catRoot = m?.firstRoot ?? norm?.rootCategory ?? 0;
          const cstat = ensureCat(catName, catRoot);
          cstat.rawAsins++;

          const decision = classifyKeepaCandidate(norm, {
            minRankImprovementPercent: minRankImprovement,
            minAmazonPrice: minPrice,
            maxAmazonPrice: maxPrice,
            excludedCategoriesCsv: env.keepa.discoveryExcludedCategories,
          });
          if (!decision.accepted) {
            const reason = decision.reason ?? 'KEEPA_UNKNOWN';
            bumpReason(reason);
            st.rejected++;
            st.filterReasons[reason] = (st.filterReasons[reason] ?? 0) + 1;
            switch (decision.reason) {
              case KeepaFilterReason.KEEPA_MISSING_ASIN:
              case KeepaFilterReason.KEEPA_MISSING_TITLE:
                cstat.filteredNoAsin++;
                break;
              case KeepaFilterReason.KEEPA_CATEGORY_EXCLUDED:
              case KeepaFilterReason.KEEPA_UNSUPPORTED_CATEGORY:
                cstat.filteredCategory++;
                break;
              case KeepaFilterReason.KEEPA_RANK_IMPROVEMENT_TOO_LOW:
                cstat.filteredRankImprovement++;
                break;
              case KeepaFilterReason.KEEPA_PRICE_TOO_LOW:
              case KeepaFilterReason.KEEPA_PRICE_TOO_HIGH:
              case KeepaFilterReason.KEEPA_MISSING_PRICE:
                cstat.filteredPrice++;
                break;
            }
            continue;
          }

          const meta = toMeta(product.asin);
          const candidate = this.toCandidate(norm!, meta, catName);
          candidates.push(candidate);
          fetchedAsins.add(product.asin);
          st.accepted++;
          cstat.accepted++;
          await this.persist(candidate, norm!, input.discoveryRunId, product.raw, meta);
        }
      }
    }

    // Provenance for exported products is taken from the final meta map (so an
    // ASIN re-seen by a later strategy still records strategy_count > 1).
    const strategyByAsin: Record<string, AsinStrategyProvenance> = {};
    for (const asin of fetchedAsins) {
      const m = asinMeta.get(asin);
      if (m) strategyByAsin[asin] = { primaryStrategy: m.primary, strategiesFound: [...m.found], strategyCount: m.found.size };
    }
    let duplicateAsinsAcrossStrategies = 0;
    for (const m of asinMeta.values()) if (m.found.size > 1) duplicateAsinsAcrossStrategies++;

    return {
      candidates,
      perCategory: [...perCategoryMap.values()],
      perStrategy: [...perStrategyMap.values()],
      strategiesRun,
      strategiesSkipped,
      strategyMode,
      duplicateAsinsAcrossStrategies,
      strategyByAsin,
      tokenBudgetStopped,
      tokens,
      filterReasons,
      error: candidates.length === 0 ? firstError : undefined,
      rawCandidateCount,
      asinNativeCount: candidates.length,
    };
  }

  private toCandidate(
    norm: NormalizedKeepaProduct,
    meta: AsinStrategyMeta | undefined,
    fallbackCategory: string,
  ): ProductCandidate {
    const ottoProductId = `OTTO-${uuidv4()}`;
    const amazonUrl = `https://www.amazon.com/dp/${norm.asin}`;
    return {
      ottoProductId,
      source: 'keepa_rank_movement',
      sourceUrl: amazonUrl,
      marketplace: 'amazon',
      keyword: norm.title?.split(/\s+/).slice(0, 4).join(' ') ?? fallbackCategory,
      categoryHint: norm.amazonCategory ?? fallbackCategory,
      productTitleRaw: norm.title ?? `ASIN ${norm.asin}`,
      brandHint: norm.brand,
      imageUrlHint: norm.imageUrl,
      priceHint: norm.amazonPrice,
      // best_discovery_score across the strategies that found this ASIN.
      discoveryScore: keepaDiscoveryScore(norm),
      asin: norm.asin,
      amazonUrl,
      // ASIN comes straight from Keepa => high source confidence.
      sourceConfidenceScore: 92,
      keepaStrategiesFound: meta?.strategiesFound,
      primaryKeepaStrategy: meta?.primaryStrategy,
      keepaStrategyCount: meta?.strategyCount,
    };
  }

  private async persist(
    candidate: ProductCandidate,
    norm: NormalizedKeepaProduct,
    runId: string,
    raw: Record<string, unknown>,
    meta: AsinStrategyMeta | undefined,
  ): Promise<void> {
    const supabase = getSupabase();
    const payloadSummary = {
      asin: norm.asin,
      salesRankCurrent: norm.salesRankCurrent,
      salesRank30dAvg: norm.salesRank30dAvg,
      salesRank90dAvg: norm.salesRank90dAvg,
      rankImprovement30d: norm.rankImprovement30d,
      rankImprovement90d: norm.rankImprovement90d,
      keepaTrackingScore: norm.keepaTrackingScore,
      rootCategory: norm.rootCategory,
      categoryId: norm.categoryId,
      amazonCategory: norm.amazonCategory,
      amazonPrice: norm.amazonPrice,
      reviewCount: norm.reviewCount,
      rating: norm.rating,
      // Multi-strategy provenance (deduped across strategies).
      primaryKeepaStrategy: meta?.primaryStrategy,
      strategiesFound: meta?.strategiesFound,
      strategyCount: meta?.strategyCount,
    };

    try {
      await supabase.from('raw_candidates').insert({
        discovery_run_id: runId,
        source: candidate.source,
        source_url: candidate.sourceUrl,
        marketplace: candidate.marketplace,
        keyword: candidate.keyword,
        category_hint: candidate.categoryHint,
        product_title_raw: candidate.productTitleRaw,
        brand_hint: candidate.brandHint,
        image_url_hint: candidate.imageUrlHint,
        price_hint: candidate.priceHint,
        discovery_score: candidate.discoveryScore,
        raw_payload: { asin: candidate.asin, keepa: payloadSummary },
      });
    } catch (err) {
      this.log.warn('raw_candidates insert failed', { err: (err as Error).message });
    }

    try {
      await supabase.from('product_opportunities').upsert(
        {
          otto_product_id: candidate.ottoProductId,
          discovery_run_id: runId,
          primary_discovery_source: 'keepa_rank_movement',
          marketplace_signal_sources: ['keepa'],
          opportunity_type: 'direct_match',
          source_confidence_score: candidate.sourceConfidenceScore,
          core_keyword: candidate.keyword,
          amazon_category: norm.amazonCategory,
        },
        { onConflict: 'otto_product_id' } as never,
      );
    } catch (err) {
      this.log.warn('product_opportunities upsert failed', { err: (err as Error).message });
    }

    void raw; // full payload intentionally not stored; summary only

    await persistAgentLog({
      agentName: this.name,
      productId: candidate.ottoProductId,
      runId,
      level: 'info',
      message: 'Keepa ASIN-native candidate discovered',
      data: { ...payloadSummary },
    });
  }
}

function mergeTokens(a: KeepaTokenInfo, b: KeepaTokenInfo): KeepaTokenInfo {
  return {
    tokensConsumed: (a.tokensConsumed ?? 0) + (b.tokensConsumed ?? 0),
    tokensLeft: b.tokensLeft ?? a.tokensLeft,
    refillIn: b.refillIn ?? a.refillIn,
    refillRate: b.refillRate ?? a.refillRate,
  };
}

function chunk<T>(arr: T[], size: number): T[][] {
  if (size <= 0) return [arr];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
