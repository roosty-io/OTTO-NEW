import { getSupabase } from '@/clients/supabaseClient';
import { logger } from '@/utils/logger';
import { THRESHOLDS } from '@/config/thresholds';
import { clamp, weightedAverage } from '@/utils/scoring';
import { makeResult, persistAgentResult, recordRejection } from '@/agents/baseAgent';
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

    const fail = (reason: string) => {
      if (passed) {
        passed = false;
        rejectionReason = reason;
      }
      reasons.push(reason);
    };

    if (!input.asin) fail('Missing confirmed ASIN');
    if (!input.amazonUrl) fail('Missing Amazon URL');

    const a = input.amazon;
    if (!a || !a.inStock) fail('Amazon source not in stock');
    if (a && a.deliveryDays !== undefined && a.deliveryDays > THRESHOLDS.DEFAULT_MAX_DELIVERY_DAYS) {
      fail(`Delivery ${a.deliveryDays}d exceeds ${THRESHOLDS.DEFAULT_MAX_DELIVERY_DAYS}d`);
    }
    if (a?.isBundleOrMultipack) fail('Bundle or multipack');
    if (a?.isRenewedOrRefurbished) fail('Renewed or refurbished');
    if (a?.isAmazonBasics) fail('Amazon Basics');

    const c = input.compliance;
    if (!c) fail('Missing compliance result');
    if (c?.hardReject) fail('Compliance hard reject');
    if (c && c.restrictedCategoryRiskScore >= 100) fail('Restricted category hard block');
    if (c && c.policyRiskScore > THRESHOLDS.MAX_POLICY_RISK_SCORE) {
      fail(`policy_risk_score ${c.policyRiskScore} > ${THRESHOLDS.MAX_POLICY_RISK_SCORE}`);
    }

    const d = input.demand;
    if (!d) fail('Missing demand result');
    if (d && d.sellWithin30DaysConfidence < THRESHOLDS.MIN_SELL_WITHIN_30_DAYS_CONFIDENCE) {
      fail(`sell_within_30_days_confidence ${d.sellWithin30DaysConfidence} < ${THRESHOLDS.MIN_SELL_WITHIN_30_DAYS_CONFIDENCE}`);
    }
    if (d && d.stagnationRiskScore > THRESHOLDS.MAX_STAGNATION_RISK_SCORE) {
      fail(`stagnation_risk_score ${d.stagnationRiskScore} > ${THRESHOLDS.MAX_STAGNATION_RISK_SCORE}`);
    }

    const finalValidationScore = computeFinalScore(input);
    if (finalValidationScore < THRESHOLDS.MIN_FINAL_VALIDATION_SCORE) {
      fail(`final_validation_score ${finalValidationScore.toFixed(0)} < ${THRESHOLDS.MIN_FINAL_VALIDATION_SCORE}`);
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
