import { getEbayClient, type EbayBrowseItem, type EbaySearchResult } from '@/clients/ebayClient';
import { getSupabase } from '@/clients/supabaseClient';
import { logger } from '@/utils/logger';
import { THRESHOLDS } from '@/config/thresholds';
import {
  buildEbayDemandQueries,
  type EbayQueryStrategy,
} from '@/utils/ebayQueryBuilder';
import {
  scoreComparable,
  type ComparableContext,
  type ScoredComparable,
} from '@/utils/ebayComparableScoring';
import { buildDemandModel, type DemandModelOutput } from '@/utils/ebayDemandModel';
import { makeResult, persistAgentResult, recordRejection } from '@/agents/baseAgent';
import { RejectionReason } from '@/utils/rejectionReasons';
import type { AgentResult } from '@/types/agent';
import type { DemandScoreBundle } from '@/types/validation';

const MIN_RELEVANT_COMPARABLES_DEFAULT = 5;
const MIN_DEMAND_SCORE = 65;
const MIN_SELL_CONFIDENCE = THRESHOLDS.MIN_SELL_WITHIN_30_DAYS_CONFIDENCE;
const MAX_STAGNATION = THRESHOLDS.MAX_STAGNATION_RISK_SCORE;

const SEARCH_LIMIT_PER_QUERY = 30;
const COMPARABLE_SAMPLE_SIZE = 10;

export interface DemandInput {
  ottoProductId: string;
  asin?: string;
  amazonUrl?: string;
  keyword: string;
  productTitle: string;
  amazonBrand?: string;
  amazonCategoryBreadcrumbs?: string[];
  amazonPrice?: number;
  sourceConfidenceScore?: number;
  sourceValidityScore?: number;
  policyRiskScore?: number;
  minRelevantComparables?: number;
  runId?: string;
}

export interface DemandData extends DemandScoreBundle {
  // Aggregates returned alongside the bundle so downstream agents / the
  // CSV exporter can attach them directly.
  generatedQueries: string[];
  activeListingCount: number;
  relevantComparableCount: number;
  exactOrSimilarMatchCount: number;
  sellerCount: number;
  sellerConcentrationScore: number;
  medianComparablePrice?: number;
  avgComparablePrice?: number;
  priceBandMin?: number;
  priceBandMax?: number;
  lowPrice?: number;
  highPrice?: number;
  listingQualityGapScore: number;
  competitionDensityScore: number;
  priceViabilityScore: number;
  duplicateRatio: number;
  demandPassed: boolean;
  rejectionReason?: string;
  comparableSamples: ScoredComparable[];
}

export class EbayDemandScoringAgent {
  readonly name = 'EbayDemandScoringAgent';
  private readonly log = logger.child(this.name);

  async run(input: DemandInput): Promise<AgentResult<DemandData>> {
    const ebay = getEbayClient();
    const strategies = buildEbayDemandQueries(
      {
        amazonTitle: input.productTitle,
        amazonBrand: input.amazonBrand,
        amazonCategoryBreadcrumbs: input.amazonCategoryBreadcrumbs,
        coreKeyword: input.keyword,
      },
      6,
    );
    if (strategies.length === 0) {
      return this.failWithCode(
        input,
        RejectionReason.EBAY_DEMAND_UNAVAILABLE,
        'No demand queries could be generated for this product',
        strategies,
        [],
      );
    }

    const allHits: EbayBrowseItem[] = [];
    const seenItems = new Set<string>();
    let apiError: { code: string; message: string } | undefined;

    for (const strategy of strategies) {
      const result: EbaySearchResult = await ebay.search(strategy.query, { limit: SEARCH_LIMIT_PER_QUERY });
      if (result.error) {
        apiError = { code: result.error.code, message: result.error.message };
        this.log.warn('eBay demand query error', {
          query: strategy.query,
          code: result.error.code,
          message: result.error.message,
        });
        continue;
      }
      for (const item of result.items) {
        if (!item.itemId || seenItems.has(item.itemId)) continue;
        seenItems.add(item.itemId);
        allHits.push(item);
      }
    }

    if (allHits.length === 0) {
      if (apiError) {
        return this.failWithCode(
          input,
          RejectionReason.EBAY_DEMAND_API_ERROR,
          `eBay returned no usable results: ${apiError.code}: ${apiError.message}`,
          strategies,
          [],
        );
      }
      return this.failWithCode(
        input,
        RejectionReason.IRRELEVANT_EBAY_COMPARABLES,
        'eBay returned zero comparable listings across all queries',
        strategies,
        [],
      );
    }

    const ctx: ComparableContext = {
      amazonTitle: input.productTitle,
      amazonBrand: input.amazonBrand,
      amazonCategoryBreadcrumbs: input.amazonCategoryBreadcrumbs,
      amazonPrice: input.amazonPrice,
      coreKeyword: input.keyword,
    };
    const scored = allHits.map((h) => scoreComparable(h, ctx));

    const model: DemandModelOutput = buildDemandModel({
      scored,
      amazonPrice: input.amazonPrice,
      sourceConfidenceScore: input.sourceConfidenceScore,
      sourceValidityScore: input.sourceValidityScore,
      policyRiskScore: input.policyRiskScore,
    });

    const minRelevant = input.minRelevantComparables ?? MIN_RELEVANT_COMPARABLES_DEFAULT;
    const { passed, rejectionReason, reasons } = this.applyGates(model, minRelevant);

    const data = this.assemble(input, strategies, scored, model, passed, rejectionReason);

    await this.persist(input, data);

    if (!passed) {
      await recordRejection(input.ottoProductId, 'demand', rejectionReason ?? RejectionReason.LOW_DEMAND_SCORE, {
        sellWithin30DaysConfidence: model.sellWithin30DaysConfidence,
        stagnationRiskScore: model.stagnationRiskScore,
        demandScore: model.demandScore,
        relevantComparableCount: model.relevantComparableCount,
      });
    }

    const result = makeResult<DemandData>(
      this.name,
      input.ottoProductId,
      passed ? 'pass' : 'fail',
      model.demandScore,
      reasons,
      data,
    );
    await persistAgentResult(result, input.runId);
    return result;
  }

  private applyGates(model: DemandModelOutput, minRelevant: number): {
    passed: boolean;
    rejectionReason?: string;
    reasons: string[];
  } {
    const reasons: string[] = [
      `demand=${model.demandScore.toFixed(0)}`,
      `30d=${model.sellWithin30DaysConfidence.toFixed(0)}`,
      `stag=${model.stagnationRiskScore.toFixed(0)}`,
      `relevant=${model.relevantComparableCount}`,
      `exact_or_similar=${model.exactOrSimilarMatchCount}`,
    ];
    let rejectionReason: string | undefined;
    const fail = (code: string, reason: string) => {
      if (!rejectionReason) rejectionReason = code;
      reasons.push(reason);
    };

    if (model.relevantComparableCount < minRelevant) {
      fail(
        RejectionReason.NOT_ENOUGH_RELEVANT_COMPARABLES,
        `${model.relevantComparableCount} relevant comparables < ${minRelevant} required`,
      );
    }
    if (model.demandScore < MIN_DEMAND_SCORE) {
      fail(RejectionReason.LOW_DEMAND_SCORE, `demandScore ${model.demandScore.toFixed(0)} < ${MIN_DEMAND_SCORE}`);
    }
    if (model.sellWithin30DaysConfidence < MIN_SELL_CONFIDENCE) {
      fail(
        RejectionReason.LOW_SELL_WITHIN_30_DAYS_CONFIDENCE,
        `sellWithin30DaysConfidence ${model.sellWithin30DaysConfidence.toFixed(0)} < ${MIN_SELL_CONFIDENCE}`,
      );
    }
    if (model.stagnationRiskScore > MAX_STAGNATION) {
      fail(
        RejectionReason.HIGH_STAGNATION_RISK,
        `stagnationRiskScore ${model.stagnationRiskScore.toFixed(0)} > ${MAX_STAGNATION}`,
      );
    }

    return { passed: !rejectionReason, rejectionReason, reasons };
  }

  private assemble(
    input: DemandInput,
    strategies: EbayQueryStrategy[],
    scored: ScoredComparable[],
    model: DemandModelOutput,
    passed: boolean,
    rejectionReason: string | undefined,
  ): DemandData {
    const samples = scored
      .slice()
      .sort((a, b) => b.comparableConfidenceScore - a.comparableConfidenceScore)
      .slice(0, COMPARABLE_SAMPLE_SIZE);
    return {
      demandScore: model.demandScore,
      sellWithin30DaysConfidence: model.sellWithin30DaysConfidence,
      stagnationRiskScore: model.stagnationRiskScore,
      categoryVelocityScore: model.categoryVelocityScore,
      keywordDemandScore: model.keywordDemandScore,
      competitorSuccessScore: model.competitorSuccessScore,
      saturationScore: model.saturationScore,
      trendMomentumScore: model.trendMomentumScore,
      demandType: model.demandType,
      signals: {
        keyword: input.keyword,
        amazonPrice: input.amazonPrice,
      },
      generatedQueries: strategies.map((s) => s.query),
      activeListingCount: model.activeListingCount,
      relevantComparableCount: model.relevantComparableCount,
      exactOrSimilarMatchCount: model.exactOrSimilarMatchCount,
      sellerCount: model.sellerCount,
      sellerConcentrationScore: model.sellerConcentrationScore,
      medianComparablePrice: model.medianComparablePrice,
      avgComparablePrice: model.avgComparablePrice,
      priceBandMin: model.priceBandMin,
      priceBandMax: model.priceBandMax,
      lowPrice: model.lowPrice,
      highPrice: model.highPrice,
      listingQualityGapScore: model.listingQualityGapScore,
      competitionDensityScore: model.competitionDensityScore,
      priceViabilityScore: model.priceViabilityScore,
      duplicateRatio: model.duplicateRatio,
      demandPassed: passed,
      rejectionReason,
      comparableSamples: samples,
    };
  }

  private async failWithCode(
    input: DemandInput,
    code: string,
    detail: string,
    strategies: EbayQueryStrategy[],
    scored: ScoredComparable[],
  ): Promise<AgentResult<DemandData>> {
    const model = buildDemandModel({ scored, amazonPrice: input.amazonPrice });
    const data: DemandData = this.assemble(input, strategies, scored, model, false, code);
    await this.persist(input, data);
    await recordRejection(input.ottoProductId, 'demand', code, { detail });
    const result = makeResult<DemandData>(this.name, input.ottoProductId, 'fail', 0, [code, detail], data);
    await persistAgentResult(result, input.runId);
    return result;
  }

  private async persist(input: DemandInput, data: DemandData): Promise<void> {
    const supabase = getSupabase();
    try {
      await supabase.from('ebay_demand_checks').insert({
        otto_product_id: input.ottoProductId,
        asin: input.asin ?? null,
        amazon_url: input.amazonUrl ?? null,
        product_title: input.productTitle ?? null,
        core_keyword: input.keyword ?? null,
        generated_queries: data.generatedQueries,
        active_listing_count: data.activeListingCount,
        relevant_comparable_count: data.relevantComparableCount,
        exact_or_similar_match_count: data.exactOrSimilarMatchCount,
        seller_count: data.sellerCount,
        seller_concentration_score: data.sellerConcentrationScore,
        median_comparable_price: data.medianComparablePrice ?? null,
        avg_comparable_price: data.avgComparablePrice ?? null,
        price_band_min: data.priceBandMin ?? null,
        price_band_max: data.priceBandMax ?? null,
        low_price: data.lowPrice ?? null,
        high_price: data.highPrice ?? null,
        listing_quality_gap_score: data.listingQualityGapScore,
        competition_density_score: data.competitionDensityScore,
        price_viability_score: data.priceViabilityScore,
        duplicate_ratio: data.duplicateRatio,
        demand_score: data.demandScore,
        sell_within_30_days_confidence: data.sellWithin30DaysConfidence,
        stagnation_risk_score: data.stagnationRiskScore,
        category_velocity_score: data.categoryVelocityScore,
        keyword_demand_score: data.keywordDemandScore,
        competitor_success_score: data.competitorSuccessScore,
        saturation_score: data.saturationScore,
        trend_momentum_score: data.trendMomentumScore,
        demand_type: data.demandType,
        demand_passed: data.demandPassed,
        rejection_reason: data.rejectionReason ?? null,
        comparable_samples: data.comparableSamples as unknown as Record<string, unknown>[],
        signals: data.signals as Record<string, unknown>,
      });
    } catch (err) {
      this.log.warn('ebay_demand_checks insert failed', { err: (err as Error).message });
    }
  }
}
