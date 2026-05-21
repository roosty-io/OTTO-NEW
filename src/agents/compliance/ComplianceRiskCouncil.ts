import { getSupabase } from '@/clients/supabaseClient';
import { logger } from '@/utils/logger';
import { clamp } from '@/utils/scoring';
import { THRESHOLDS } from '@/config/thresholds';
import { makeResult, persistAgentResult, persistAgentVote, recordRejection } from '@/agents/baseAgent';
import { ALL_COMPLIANCE_AGENTS, type ComplianceContext } from '@/agents/compliance/subAgents';
import { RestrictedCategoryAgent } from '@/agents/compliance/subAgents';
import type { AgentResult } from '@/types/agent';
import type { ComplianceScoreBundle } from '@/types/validation';

export interface ComplianceInput {
  ctx: ComplianceContext;
  runId?: string;
}

export class ComplianceRiskCouncil {
  readonly name = 'ComplianceRiskCouncil';
  private readonly log = logger.child(this.name);

  async run(input: ComplianceInput): Promise<AgentResult<ComplianceScoreBundle>> {
    const { ctx, runId } = input;
    const subResults: { agent: string; status: string; score: number; reasons: string[]; hardReject: boolean }[] = [];
    const reasons: string[] = [];
    let hardReject = false;
    let veroRiskScore = 0;
    let restrictedCategoryRiskScore = 0;
    let ipRiskScore = 0;
    let edgeCaseRiskScore = 0;
    let fragilityScore = 0;
    let variationConfusionScore = 0;

    for (const agent of ALL_COMPLIANCE_AGENTS) {
      const result = agent.fn(ctx);
      subResults.push({
        agent: agent.name,
        status: result.status,
        score: result.score,
        reasons: result.reasons,
        hardReject: result.data.hardReject,
      });
      reasons.push(...result.reasons);
      if (result.data.hardReject) hardReject = true;

      // Bucket sub-scores.
      switch (agent.name) {
        case 'VeroBrandAgent':
        case 'BrandStrengthAgent':
        case 'LuxuryFashionAgent':
          veroRiskScore = Math.max(veroRiskScore, result.score);
          break;
        case 'RestrictedCategoryAgent':
          restrictedCategoryRiskScore = Math.max(restrictedCategoryRiskScore, result.score);
          break;
        case 'TrademarkKeywordAgent':
        case 'CopyrightCharacterAgent':
        case 'CounterfeitReplicaAgent':
        case 'ElectronicsBrandAgent':
          ipRiskScore = Math.max(ipRiskScore, result.score);
          break;
        case 'CompatibilityFitmentAgent':
        case 'BabySafetyAgent':
        case 'MedicalDeviceAgent':
        case 'SupplementFoodAgent':
        case 'HazardousMaterialAgent':
        case 'WeaponSelfDefenseAgent':
          edgeCaseRiskScore = Math.max(edgeCaseRiskScore, result.score);
          break;
      }

      await persistAgentVote({
        agentName: agent.name,
        productId: ctx.ottoProductId,
        vote: result.status === 'fail' ? 'reject' : result.status === 'warning' ? 'review' : 'approve',
        weight: 1,
        reason: result.reasons.join('; '),
      });
    }

    // Heuristics for fragility/variation not captured by sub-agents above.
    fragilityScore = fragilityHeuristic(ctx.title);
    variationConfusionScore = variationHeuristic(ctx);

    const policyRiskScore = clamp(
      0.35 * veroRiskScore +
        0.25 * restrictedCategoryRiskScore +
        0.20 * ipRiskScore +
        0.15 * edgeCaseRiskScore +
        0.05 * fragilityScore,
    );

    // Hard reject if restricted category triggers.
    const restrictedHardReject = RestrictedCategoryAgent(ctx).data.hardReject;
    if (restrictedHardReject) {
      hardReject = true;
      if (!reasons.some((r) => r.startsWith('Restricted category'))) {
        reasons.push('Restricted category hard block');
      }
    }

    const bundle: ComplianceScoreBundle = {
      policyRiskScore,
      veroRiskScore,
      restrictedCategoryRiskScore,
      ipRiskScore,
      edgeCaseRiskScore,
      fragilityScore,
      variationConfusionScore,
      hardReject,
      reasons,
    };

    try {
      await getSupabase().from('compliance_checks').insert({
        otto_product_id: ctx.ottoProductId,
        policy_risk_score: policyRiskScore,
        vero_risk_score: veroRiskScore,
        restricted_category_risk_score: restrictedCategoryRiskScore,
        ip_risk_score: ipRiskScore,
        edge_case_risk_score: edgeCaseRiskScore,
        fragility_score: fragilityScore,
        variation_confusion_score: variationConfusionScore,
        hard_reject: hardReject,
        reasons,
        sub_agent_results: subResults,
      });
    } catch (err) {
      this.log.warn('compliance_checks insert failed', { err: (err as Error).message });
    }

    const passed = !hardReject && policyRiskScore <= THRESHOLDS.MAX_POLICY_RISK_SCORE;
    if (!passed) {
      await recordRejection(ctx.ottoProductId, 'compliance', reasons[0] ?? 'policy_risk_exceeded', {
        policyRiskScore,
        hardReject,
      });
    }

    const result = makeResult(
      this.name,
      ctx.ottoProductId,
      passed ? 'pass' : 'fail',
      policyRiskScore,
      reasons,
      bundle,
    );
    await persistAgentResult(result, runId);
    return result;
  }
}

function fragilityHeuristic(title: string): number {
  const lc = title.toLowerCase();
  let s = 0;
  if (lc.includes('glass')) s += 30;
  if (lc.includes('ceramic')) s += 20;
  if (lc.includes('porcelain')) s += 20;
  if (lc.includes('mirror')) s += 25;
  if (lc.includes('crystal')) s += 25;
  if (lc.includes('vase')) s += 15;
  if (lc.includes('lcd') || lc.includes('display screen')) s += 15;
  return clamp(s);
}

function variationHeuristic(ctx: ComplianceContext): number {
  const lc = ctx.title.toLowerCase();
  let s = 0;
  if (lc.includes('color') || lc.includes('size') || lc.includes('variant')) s += 15;
  if (ctx.variationAttributes && Object.keys(ctx.variationAttributes).length > 2) s += 30;
  return clamp(s);
}
