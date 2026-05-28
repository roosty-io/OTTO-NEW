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
import {
  isCategoryAllowed,
  resolveCategoryTargets,
  type AllowedCategory,
} from '@/utils/keepaCategories';
import { env } from '@/config/env';
import type { ProductCandidate } from '@/types/product';

export interface KeepaDiscoveryInput {
  discoveryRunId: string;
  /** Total ASIN ceiling across all categories. Defaults to env. */
  maxAsins?: number;
  /** CLI category selector (name or root id); blank = all V1-safe categories. */
  categorySelector?: string;
  minAmazonPrice?: number;
  maxAmazonPrice?: number;
  minRankImprovementPercent?: number;
  maxSalesRank?: number;
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

export interface KeepaDiscoveryOutput {
  candidates: ProductCandidate[];
  perCategory: KeepaCategoryStat[];
  tokens: KeepaTokenInfo;
  error?: KeepaError;
  rawCandidateCount: number;
  asinNativeCount: number;
}

export class KeepaRankMovementDiscoveryAgent {
  readonly name = 'KeepaRankMovementDiscoveryAgent';
  private readonly log = logger.child(this.name);

  async run(input: KeepaDiscoveryInput): Promise<KeepaDiscoveryOutput> {
    const keepa = getKeepaClient();
    const supabase = getSupabase();

    const maxAsins = input.maxAsins ?? env.keepa.discoveryMaxAsins;
    const minPrice = input.minAmazonPrice ?? env.keepa.discoveryMinAmazonPrice;
    const maxPrice = input.maxAmazonPrice ?? env.keepa.discoveryMaxAmazonPrice;
    const minRankImprovement = input.minRankImprovementPercent ?? env.keepa.discoveryMinRankImprovementPercent;
    const maxSalesRank = input.maxSalesRank ?? env.keepa.discoveryMaxSalesRank;

    const targets: AllowedCategory[] = resolveCategoryTargets(
      input.categorySelector,
      env.keepa.discoveryAllowedCategories,
    );
    const perCategoryBudget = Math.max(1, Math.floor(maxAsins / targets.length));

    const candidates: ProductCandidate[] = [];
    const perCategory: KeepaCategoryStat[] = [];
    let tokens: KeepaTokenInfo = {};
    let firstError: KeepaError | undefined;
    let rawCandidateCount = 0;

    for (const target of targets) {
      if (candidates.length >= maxAsins) break;
      const stat: KeepaCategoryStat = {
        category: target.name,
        rootId: target.rootId,
        rawAsins: 0,
        accepted: 0,
        filteredCategory: 0,
        filteredPrice: 0,
        filteredRankImprovement: 0,
        filteredNoAsin: 0,
      };

      const movers = await keepa.findRankMovers({
        rootCategory: target.rootId,
        maxResults: perCategoryBudget,
        minRankImprovementPercent: minRankImprovement,
        maxSalesRank,
        minAvgRank30d: env.keepa.discoveryMinAvgRank30d,
        minAmazonPriceCents: Math.round(minPrice * 100),
        maxAmazonPriceCents: Math.round(maxPrice * 100),
      });
      tokens = mergeTokens(tokens, movers.tokens);

      if (movers.error) {
        firstError = firstError ?? movers.error;
        this.log.error('Keepa rank-mover query failed', { category: target.name, ...movers.error });
        await persistAgentLog({
          agentName: this.name,
          runId: input.discoveryRunId,
          level: 'error',
          message: `Keepa discovery error: ${movers.error.code}`,
          data: { category: target.name, ...movers.error },
        });
        perCategory.push(stat);
        continue;
      }

      if (movers.asins.length === 0) {
        perCategory.push(stat);
        continue;
      }

      const fetchRes = await keepa.fetchProductsByAsin(movers.asins);
      tokens = mergeTokens(tokens, fetchRes.tokens);
      if (fetchRes.error) {
        firstError = firstError ?? fetchRes.error;
        this.log.error('Keepa product fetch failed', { category: target.name, ...fetchRes.error });
        perCategory.push(stat);
        continue;
      }

      for (const product of fetchRes.products) {
        rawCandidateCount++;
        stat.rawAsins++;
        const norm = normalizeKeepaProduct(product.raw);
        if (!norm || !norm.asin) {
          stat.filteredNoAsin++;
          continue;
        }
        if (!isCategoryAllowed(norm.amazonCategory, norm.title, env.keepa.discoveryExcludedCategories)) {
          stat.filteredCategory++;
          continue;
        }
        if (
          minRankImprovement > 0 &&
          typeof norm.rankImprovement30d === 'number' &&
          norm.rankImprovement30d < minRankImprovement
        ) {
          stat.filteredRankImprovement++;
          continue;
        }
        if (typeof norm.amazonPrice === 'number') {
          if (norm.amazonPrice < minPrice || norm.amazonPrice > maxPrice) {
            stat.filteredPrice++;
            continue;
          }
        }

        const candidate = this.toCandidate(norm, target);
        candidates.push(candidate);
        stat.accepted++;
        await this.persist(candidate, norm, input.discoveryRunId, product.raw);
        if (candidates.length >= maxAsins) break;
      }

      perCategory.push(stat);
    }

    return {
      candidates,
      perCategory,
      tokens,
      error: candidates.length === 0 ? firstError : undefined,
      rawCandidateCount,
      asinNativeCount: candidates.length,
    };
  }

  private toCandidate(norm: NormalizedKeepaProduct, target: AllowedCategory): ProductCandidate {
    const ottoProductId = `OTTO-${uuidv4()}`;
    const amazonUrl = `https://www.amazon.com/dp/${norm.asin}`;
    return {
      ottoProductId,
      source: 'keepa_rank_movement',
      sourceUrl: amazonUrl,
      marketplace: 'amazon',
      keyword: norm.title?.split(/\s+/).slice(0, 4).join(' ') ?? target.name,
      categoryHint: norm.amazonCategory ?? target.name,
      productTitleRaw: norm.title ?? `ASIN ${norm.asin}`,
      brandHint: norm.brand,
      imageUrlHint: norm.imageUrl,
      priceHint: norm.amazonPrice,
      discoveryScore: keepaDiscoveryScore(norm),
      asin: norm.asin,
      amazonUrl,
      // ASIN comes straight from Keepa => high source confidence.
      sourceConfidenceScore: 92,
    };
  }

  private async persist(
    candidate: ProductCandidate,
    norm: NormalizedKeepaProduct,
    runId: string,
    raw: Record<string, unknown>,
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
