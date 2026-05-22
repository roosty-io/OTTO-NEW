import { getEbayClient, type EbayBrowseItem } from '@/clients/ebayClient';
import { getSupabase } from '@/clients/supabaseClient';
import { logger } from '@/utils/logger';
import { clamp, inverse100, weightedAverage } from '@/utils/scoring';
import { makeResult, persistAgentResult } from '@/agents/baseAgent';
import type { AgentResult } from '@/types/agent';
import type { DemandScoreBundle } from '@/types/validation';

export interface DemandInput {
  ottoProductId: string;
  keyword: string;
  productTitle: string;
  amazonPrice?: number;
  runId?: string;
}

export class EbayDemandScoringAgent {
  readonly name = 'EbayDemandScoringAgent';
  private readonly log = logger.child(this.name);

  async run(input: DemandInput): Promise<AgentResult<DemandScoreBundle>> {
    const ebay = getEbayClient();
    const searchResult = await ebay.search(input.keyword, { limit: 30 });
    if (searchResult.error) {
      this.log.warn('Demand scoring degraded - eBay error', {
        keyword: input.keyword,
        code: searchResult.error.code,
      });
    }
    const items = searchResult.items;
    const bundle = this.score(items, input.amazonPrice);

    const supabase = getSupabase();
    try {
      await supabase.from('ebay_demand_checks').insert({
        otto_product_id: input.ottoProductId,
        demand_score: bundle.demandScore,
        sell_within_30_days_confidence: bundle.sellWithin30DaysConfidence,
        stagnation_risk_score: bundle.stagnationRiskScore,
        category_velocity_score: bundle.categoryVelocityScore,
        keyword_demand_score: bundle.keywordDemandScore,
        competitor_success_score: bundle.competitorSuccessScore,
        saturation_score: bundle.saturationScore,
        trend_momentum_score: bundle.trendMomentumScore,
        demand_type: bundle.demandType,
        signals: bundle.signals,
      });
    } catch (err) {
      this.log.warn('ebay_demand_checks insert failed', { err: (err as Error).message });
    }

    const status =
      bundle.sellWithin30DaysConfidence >= 70 && bundle.stagnationRiskScore <= 40 ? 'pass' : 'warning';
    const result = makeResult(
      this.name,
      input.ottoProductId,
      status,
      bundle.demandScore,
      [
        `demand=${bundle.demandScore.toFixed(0)}`,
        `30d=${bundle.sellWithin30DaysConfidence.toFixed(0)}`,
        `stag=${bundle.stagnationRiskScore.toFixed(0)}`,
      ],
      bundle,
    );
    await persistAgentResult(result, input.runId);
    return result;
  }

  private score(items: EbayBrowseItem[], amazonPrice?: number): DemandScoreBundle {
    const totalListings = items.length;
    if (totalListings === 0) {
      return {
        demandScore: 0,
        sellWithin30DaysConfidence: 0,
        stagnationRiskScore: 100,
        categoryVelocityScore: 0,
        keywordDemandScore: 0,
        competitorSuccessScore: 0,
        saturationScore: 100,
        trendMomentumScore: 0,
        demandType: 'unknown',
        signals: { totalListings: 0 },
      };
    }

    const sellerScores = items.map((i) => Number(i.seller?.feedbackPercentage ?? 0)).filter(Number.isFinite);
    const avgSellerFb = avg(sellerScores);
    const topRatedCount = items.filter((i) => i.topRatedBuyingExperience).length;
    const competitorSuccessScore = clamp(((avgSellerFb - 90) * 5) + (topRatedCount / totalListings) * 30);

    const prices = items
      .map((i) => Number(i.price?.value))
      .filter((n) => Number.isFinite(n) && n > 0);
    const avgPrice = avg(prices);
    const priceSpread = prices.length > 1 ? stdev(prices) / Math.max(avgPrice, 1) : 0;
    const keywordDemandScore = clamp(40 + Math.min(totalListings, 60));
    const categoryVelocityScore = clamp(50 + (avgSellerFb - 95) * 2);
    const saturationScore = clamp(Math.min(totalListings, 80) - 10 - priceSpread * 20);
    const trendMomentumScore = clamp(50 + (competitorSuccessScore - 50) / 2);

    const margin = amazonPrice && avgPrice > 0 ? (avgPrice - amazonPrice) / avgPrice : 0;
    const marginBoost = margin > 0.2 ? 10 : margin > 0.1 ? 5 : 0;

    const demandScore = clamp(
      weightedAverage([
        { value: keywordDemandScore, weight: 2 },
        { value: categoryVelocityScore, weight: 1 },
        { value: competitorSuccessScore, weight: 2 },
        { value: inverse100(saturationScore), weight: 1.5 },
        { value: trendMomentumScore, weight: 1 },
      ]) + marginBoost,
    );

    const sellWithin30DaysConfidence = clamp(demandScore * 0.9 + (competitorSuccessScore - 50) * 0.2);
    const stagnationRiskScore = clamp(100 - demandScore + saturationScore * 0.2);

    const demandType =
      demandScore >= 80 ? 'high_velocity' :
      demandScore >= 60 ? 'steady' :
      saturationScore > 70 ? 'saturated' === 'saturated' ? 'niche' : 'niche' :
      demandScore >= 40 ? 'niche' : 'unknown';

    return {
      demandScore,
      sellWithin30DaysConfidence,
      stagnationRiskScore,
      categoryVelocityScore,
      keywordDemandScore,
      competitorSuccessScore,
      saturationScore,
      trendMomentumScore,
      demandType,
      signals: { totalListings, avgPrice, avgSellerFb, topRatedCount, priceSpread, marginBoost },
    };
  }
}

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stdev(arr: number[]): number {
  if (arr.length === 0) return 0;
  const m = avg(arr);
  return Math.sqrt(avg(arr.map((x) => (x - m) ** 2)));
}
