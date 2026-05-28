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
  mergeAsinDiscoveries,
  countDuplicateAsins,
  type AsinDiscovery,
  type AsinStrategyMeta,
  type KeepaStrategyName,
  type StrategyBuildContext,
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
  /** Product Finder strategies to run; empty/undefined = all strategies. */
  strategies?: KeepaStrategyName[];
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

export interface KeepaDiscoveryOutput {
  candidates: ProductCandidate[];
  perCategory: KeepaCategoryStat[];
  perStrategy: KeepaStrategyStat[];
  strategiesRun: string[];
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
    const maxKeepaTokens = input.maxKeepaTokens ?? 0;
    const force = input.force ?? false;

    const targets: AllowedCategory[] = resolveCategoryTargets(
      input.categorySelector,
      env.keepa.discoveryAllowedCategories,
    );

    // Gather a broad candidate pool across strategies, then dedupe + cap to
    // maxAsins before paying for /product detail. /query cost is per-call, not
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

    const perStrategyMap = new Map<string, KeepaStrategyStat>();
    const ensureStrat = (s: string): KeepaStrategyStat => {
      let st = perStrategyMap.get(s);
      if (!st) {
        st = { strategy: s, rawProductsReturned: 0, uniqueAsinsContributed: 0, accepted: 0, rejected: 0, filterReasons: {} };
        perStrategyMap.set(s, st);
      }
      return st;
    };
    for (const s of strategies) ensureStrat(s); // stable ordering in reports

    const overBudget = (): boolean =>
      !force && maxKeepaTokens > 0 && (tokens.tokensConsumed ?? 0) >= maxKeepaTokens;

    // ---- Phase 1: discover ASINs across strategies (Product Finder /query) ----
    const discoveries: AsinDiscovery[] = [];
    const seen = new Set<string>();

    phase1: for (const strategy of strategies) {
      const st = ensureStrat(strategy);
      for (const target of targets) {
        const specs = buildStrategyQuerySpecs(strategy, target, ctx);
        for (const spec of specs) {
          if (overBudget()) {
            tokenBudgetStopped = true;
            break phase1;
          }
          const res = await keepa.findProducts(spec);
          tokens = mergeTokens(tokens, res.tokens);
          if (res.error) {
            firstError = firstError ?? res.error;
            this.log.error('Keepa Product Finder query failed', {
              strategy,
              category: target.name,
              label: spec.label,
              ...res.error,
            });
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
            discoveries.push({ asin, strategy, categoryName: target.name, rootId: target.rootId });
            if (!seen.has(asin)) {
              seen.add(asin);
              st.uniqueAsinsContributed++;
            }
          }
        }
      }
    }

    const metas = mergeAsinDiscoveries(discoveries);
    const duplicateAsinsAcrossStrategies = countDuplicateAsins(metas);

    // Cap unique ASINs to maxAsins BEFORE paying for /product detail.
    const cappedMetas = metas.slice(0, maxAsins);
    const metaByAsin = new Map(cappedMetas.map((m) => [m.asin, m]));
    const strategyByAsin: Record<string, AsinStrategyProvenance> = {};
    for (const m of cappedMetas) {
      strategyByAsin[m.asin] = {
        primaryStrategy: m.primaryStrategy,
        strategiesFound: m.strategiesFound,
        strategyCount: m.strategyCount,
      };
    }

    // ---- Phase 2: fetch product detail for unique ASINs, classify, build ----
    const candidates: ProductCandidate[] = [];
    const filterReasons: Record<string, number> = {};
    const bumpReason = (code: string) => {
      filterReasons[code] = (filterReasons[code] ?? 0) + 1;
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
    let rawCandidateCount = 0;

    const asinList = cappedMetas.map((m) => m.asin);
    for (const batch of chunk(asinList, PRODUCT_FETCH_BATCH)) {
      if (overBudget()) {
        tokenBudgetStopped = true;
        break;
      }
      const fetchRes = await keepa.fetchProductsByAsin(batch);
      tokens = mergeTokens(tokens, fetchRes.tokens);
      if (fetchRes.error) {
        firstError = firstError ?? fetchRes.error;
        this.log.error('Keepa product fetch failed', { ...fetchRes.error });
        continue;
      }

      for (const product of fetchRes.products) {
        rawCandidateCount++;
        const meta = metaByAsin.get(product.asin);
        const primary = meta?.primaryStrategy ?? strategies[0];
        const st = ensureStrat(primary);
        const norm = normalizeKeepaProduct(product.raw);
        const catName = meta?.firstCategoryName ?? norm?.amazonCategory ?? 'unknown';
        const catRoot = meta?.firstRootId ?? norm?.rootCategory ?? 0;
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

        const candidate = this.toCandidate(norm!, meta, catName);
        candidates.push(candidate);
        st.accepted++;
        cstat.accepted++;
        await this.persist(candidate, norm!, input.discoveryRunId, product.raw, meta);
      }
    }

    return {
      candidates,
      perCategory: [...perCategoryMap.values()],
      perStrategy: [...perStrategyMap.values()],
      strategiesRun: strategies,
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
