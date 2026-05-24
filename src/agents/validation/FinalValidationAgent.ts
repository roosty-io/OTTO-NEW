import { getSupabase } from '@/clients/supabaseClient';
import { logger } from '@/utils/logger';
import { THRESHOLDS } from '@/config/thresholds';
import { clamp, weightedAverage } from '@/utils/scoring';
import { makeResult, persistAgentResult, recordRejection } from '@/agents/baseAgent';
import { RejectionReason } from '@/utils/rejectionReasons';
import type { AgentResult } from '@/types/agent';
import type { ComplianceScoreBundle, DemandScoreBundle } from '@/types/validation';
import type { AmazonValidationData } from '@/agents/amazon/AmazonSourceValidationAgent';

export interface FinalValidationInput {
  ottoProductId: string;
  asin?: string;
  amazonUrl?: string;
  amazon?: AmazonValidationData;
  demand?: DemandScoreBundle;
  compliance?: ComplianceScoreBundle;
  runId?: string;
}

export interface FinalValidationData {
  finalValidationScore: number;
  passed: boolean;
  reasons: string[];
  rejectionReason?: string;
}

export class FinalValidationAgent {
  readonly name = 'FinalValidationAgent';
  private readonly log = logger.child(this.name);

  async run(input: FinalValidationInput): Promise<AgentResult<FinalValidationData>> {
    const reasons: string[] = [];
    let passed = true;
    let rejectionReason: string | undefined;

    // `reason` is the stable rejection code stored in rejection_reason;
    // `detail` is a free-form sentence kept in the agent reason list.
    const fail = (code: string, detail: string) => {
      if (passed) {
        passed = false;
        rejectionReason = code;
      }
      reasons.push(code, detail);
    };

    if (!input.asin) fail(RejectionReason.ASIN_NOT_RESOLVED, 'Missing confirmed ASIN');
    if (!input.amazonUrl) fail(RejectionReason.ASIN_NOT_RESOLVED, 'Missing Amazon URL');

    const a = input.amazon;
    if (!a || !a.inStock) fail(RejectionReason.AMAZON_OUT_OF_STOCK, 'Amazon source not in stock');
    if (a && a.deliveryDays !== undefined && a.deliveryDays > THRESHOLDS.DEFAULT_MAX_DELIVERY_DAYS) {
      fail(RejectionReason.DELIVERY_TOO_LONG, `Delivery ${a.deliveryDays}d exceeds ${THRESHOLDS.DEFAULT_MAX_DELIVERY_DAYS}d`);
    }
    if (a?.isBundleOrMultipack) fail(RejectionReason.BUNDLE_OR_MULTIPACK_EXCLUDED, 'Bundle or multipack');
    if (a?.isRenewedOrRefurbished) fail(RejectionReason.USED_RENEWED_REFURBISHED, 'Renewed or refurbished');
    if (a?.isAmazonBasics) fail(RejectionReason.AMAZON_BASICS_EXCLUDED, 'Amazon Basics');

    const c = input.compliance;
    if (!c) fail(RejectionReason.UNSPECIFIED, 'Missing compliance result');
    if (c?.hardReject) fail(RejectionReason.COMPLIANCE_HARD_BLOCK, 'Compliance hard reject');
    if (c && c.restrictedCategoryRiskScore >= 100) fail(RejectionReason.RESTRICTED_CATEGORY, 'Restricted category hard block');
    if (c && c.policyRiskScore > THRESHOLDS.MAX_POLICY_RISK_SCORE) {
      fail(RejectionReason.POLICY_RISK_TOO_HIGH, `policy_risk_score ${c.policyRiskScore} > ${THRESHOLDS.MAX_POLICY_RISK_SCORE}`);
    }

    const d = input.demand;
    if (!d) fail(RejectionReason.EBAY_DEMAND_UNAVAILABLE, 'Missing demand result');
    if (d && d.sellWithin30DaysConfidence < THRESHOLDS.MIN_SELL_WITHIN_30_DAYS_CONFIDENCE) {
      fail(
        RejectionReason.LOW_SELL_WITHIN_30_DAYS_CONFIDENCE,
        `sell_within_30_days_confidence ${d.sellWithin30DaysConfidence} < ${THRESHOLDS.MIN_SELL_WITHIN_30_DAYS_CONFIDENCE}`,
      );
    }
    if (d && d.stagnationRiskScore > THRESHOLDS.MAX_STAGNATION_RISK_SCORE) {
      fail(
        RejectionReason.HIGH_STAGNATION_RISK,
        `stagnation_risk_score ${d.stagnationRiskScore} > ${THRESHOLDS.MAX_STAGNATION_RISK_SCORE}`,
      );
    }

    const finalValidationScore = computeFinalScore(input);
    if (finalValidationScore < THRESHOLDS.MIN_FINAL_VALIDATION_SCORE) {
      fail(
        RejectionReason.FINAL_SCORE_TOO_LOW,
        `final_validation_score ${finalValidationScore.toFixed(0)} < ${THRESHOLDS.MIN_FINAL_VALIDATION_SCORE}`,
      );
    }

    const finalPassed = passed;
    try {
      await getSupabase().from('final_validation_results').insert({
        otto_product_id: input.ottoProductId,
        final_validation_score: finalValidationScore,
        passed: finalPassed,
        reasons,
        rejection_reason: rejectionReason ?? null,
      });
    } catch (err) {
      this.log.warn('final_validation_results insert failed', { err: (err as Error).message });
    }

    if (!finalPassed) {
      await recordRejection(input.ottoProductId, 'final_validation', rejectionReason ?? 'unspecified', { reasons });
    }

    const data: FinalValidationData = {
      finalValidationScore,
      passed: finalPassed,
      reasons,
      rejectionReason,
    };
    const result = makeResult(
      this.name,
      input.ottoProductId,
      finalPassed ? 'pass' : 'fail',
      finalValidationScore,
      reasons,
      data,
    );
    await persistAgentResult(result, input.runId);
    return result;
  }
}

function computeFinalScore(input: FinalValidationInput): number {
  const d = input.demand;
  const c = input.compliance;
  const parts: { value: number; weight: number }[] = [];
  if (d) parts.push({ value: d.demandScore, weight: 0.4 });
  if (d) parts.push({ value: d.sellWithin30DaysConfidence, weight: 0.3 });
  if (c) parts.push({ value: 100 - c.policyRiskScore, weight: 0.2 });
  if (d) parts.push({ value: 100 - d.stagnationRiskScore, weight: 0.1 });
  if (parts.length === 0) return 0;
  return clamp(weightedAverage(parts));
}
