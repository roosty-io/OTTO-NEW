import { getSupabase } from '@/clients/supabaseClient';
import { logger } from '@/utils/logger';
import { makeResult, persistAgentResult, recordRejection } from '@/agents/baseAgent';
import { scoreBusinessFit, type BusinessFitInput, type BusinessFitOutput } from '@/utils/businessFitScoring';
import { RejectionReason } from '@/utils/rejectionReasons';
import type { AgentResult } from '@/types/agent';

export interface BusinessFitAgentInput extends BusinessFitInput {
  ottoProductId: string;
  asin?: string;
  amazonUrl?: string;
  runId?: string;
}

export interface BusinessFitData extends BusinessFitOutput {
  asin?: string;
  amazonUrl?: string;
}

export class BusinessFitAgent {
  readonly name = 'BusinessFitAgent';
  private readonly log = logger.child(this.name);

  async run(input: BusinessFitAgentInput): Promise<AgentResult<BusinessFitData>> {
    const out = scoreBusinessFit(input);
    const data: BusinessFitData = { ...out, asin: input.asin, amazonUrl: input.amazonUrl };

    await this.persist(input, data);

    if (!data.businessFitPassed) {
      await recordRejection(
        input.ottoProductId,
        'business_fit',
        data.businessFitRejectionReason ?? RejectionReason.BUSINESS_FIT_FAILED,
        {
          businessFitScore: data.businessFitScore,
          priceQualityScore: data.priceQualityScore,
          saturationQualityScore: data.saturationQualityScore,
          bulkinessRiskScore: data.bulkinessRiskScore,
          brandCautionScore: data.brandCautionScore,
          manualQaPatternPenalty: data.manualQaPatternPenalty,
          reasonCodes: data.reasonCodes,
        },
      );
    }

    const reasons = [
      `business_fit_score=${data.businessFitScore.toFixed(0)}`,
      `price_q=${data.priceQualityScore.toFixed(0)}`,
      `sat_q=${data.saturationQualityScore.toFixed(0)}`,
      `bulky=${data.bulkinessRiskScore.toFixed(0)}`,
      `brand=${data.brandCautionScore.toFixed(0)}`,
      ...data.reasonCodes,
    ];
    const result = makeResult<BusinessFitData>(
      this.name,
      input.ottoProductId,
      data.businessFitPassed ? 'pass' : 'fail',
      data.businessFitScore,
      reasons,
      data,
    );
    await persistAgentResult(result, input.runId);
    return result;
  }

  private async persist(input: BusinessFitAgentInput, data: BusinessFitData): Promise<void> {
    try {
      await getSupabase().from('business_fit_checks').insert({
        otto_product_id: input.ottoProductId,
        asin: input.asin ?? null,
        amazon_url: input.amazonUrl ?? null,
        amazon_price: input.amazonPrice ?? null,
        product_title: input.productTitle ?? null,
        brand: input.brand ?? null,
        business_fit_score: data.businessFitScore,
        price_quality_score: data.priceQualityScore,
        saturation_quality_score: data.saturationQualityScore,
        differentiation_score: data.differentiationScore,
        bulkiness_risk_score: data.bulkinessRiskScore,
        brand_caution_score: data.brandCautionScore,
        manual_qa_pattern_penalty: data.manualQaPatternPenalty,
        similar_listing_penalty: data.similarListingPenalty,
        duplicate_market_penalty: data.duplicateMarketPenalty,
        business_fit_passed: data.businessFitPassed,
        business_fit_rejection_reason: data.businessFitRejectionReason ?? null,
        reason_codes: data.reasonCodes,
        notes: data.notes,
      });
    } catch (err) {
      this.log.warn('business_fit_checks insert failed', { err: (err as Error).message });
    }
  }
}
