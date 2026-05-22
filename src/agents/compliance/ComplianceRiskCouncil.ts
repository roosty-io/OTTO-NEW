import { getSupabase } from '@/clients/supabaseClient';
import { logger } from '@/utils/logger';
import { clamp } from '@/utils/scoring';
import { makeResult, persistAgentResult, persistAgentVote, recordRejection } from '@/agents/baseAgent';
import {
  runComplianceAgents,
  type ComplianceContext,
} from '@/agents/compliance/subAgents';
import {
  combineCompliance,
  POLICY_RISK_MANUAL_MAX,
  POLICY_RISK_PASS_MAX,
  type ComplianceModelOutput,
} from '@/utils/complianceRiskModel';
import { normalizeForCompliance } from '@/utils/complianceTextNormalizer';
import { RejectionReason } from '@/utils/rejectionReasons';
import type { AgentResult } from '@/types/agent';
import type { ComplianceScoreBundle } from '@/types/validation';

export type { ComplianceContext } from '@/utils/complianceTextNormalizer';

export interface ComplianceInput {
  ctx: ComplianceContext;
  amazonUrl?: string;
  asin?: string;
  runId?: string;
}

export interface ComplianceData extends ComplianceScoreBundle {
  hardBlock: boolean;
  manualReview: boolean;
  compliancePassed: boolean;
  reasonCodes: string[];
  matchedBrands: string[];
  matchedKeywords: string[];
  matchedCategories: string[];
  triggeredAgents: string[];
  notes: string[];
  subResults: { agentName: string; status: string; score: number; reasonCodes: string[]; matchedTerms: string[]; notes: string }[];
}

export class ComplianceRiskCouncil {
  readonly name = 'ComplianceRiskCouncil';
  private readonly log = logger.child(this.name);

  async run(input: ComplianceInput): Promise<AgentResult<ComplianceData>> {
    const ctx = input.ctx;
    const normalized = normalizeForCompliance(ctx);
    const subResults = runComplianceAgents(ctx);

    const fragilityScore = fragilityHeuristic(normalized.normalizedTitle);
    const variationConfusionScore = variationHeuristic(ctx);

    const model: ComplianceModelOutput = combineCompliance({
      subResults,
      fragilityScore,
      variationConfusionScore,
    });

    // Cast votes for analytics.
    for (const r of subResults) {
      try {
        await persistAgentVote({
          agentName: r.agentName,
          productId: ctx.ottoProductId,
          vote: r.status === 'fail' ? 'reject' : r.status === 'pass' ? 'approve' : 'review',
          weight: 1,
          reason: r.reasonCodes.join(',') || r.notes,
        });
      } catch (err) {
        this.log.warn('persistAgentVote failed', { err: (err as Error).message });
      }
    }

    const reasons: string[] = [
      ...model.reasonCodes,
      ...model.notes,
      `policyRisk=${model.policyRiskScore.toFixed(0)}`,
      `bucketsVero=${model.veroRiskScore} restricted=${model.restrictedCategoryRiskScore} ip=${model.ipRiskScore} edge=${model.edgeCaseRiskScore}`,
    ];

    let primaryRejectionCode: string | undefined;
    if (model.hardBlock) {
      primaryRejectionCode = pickPrimaryHardBlockCode(model);
    } else if (!model.compliancePassed) {
      primaryRejectionCode = model.manualReview
        ? RejectionReason.MANUAL_REVIEW_REQUIRED
        : RejectionReason.POLICY_RISK_TOO_HIGH;
    }

    const data: ComplianceData = {
      policyRiskScore: model.policyRiskScore,
      veroRiskScore: model.veroRiskScore,
      restrictedCategoryRiskScore: model.restrictedCategoryRiskScore,
      ipRiskScore: model.ipRiskScore,
      edgeCaseRiskScore: model.edgeCaseRiskScore,
      fragilityScore: model.fragilityScore,
      variationConfusionScore: model.variationConfusionScore,
      hardReject: model.hardBlock,
      hardBlock: model.hardBlock,
      manualReview: model.manualReview,
      compliancePassed: model.compliancePassed,
      reasons,
      reasonCodes: model.reasonCodes,
      matchedBrands: model.matchedBrands,
      matchedKeywords: model.matchedKeywords,
      matchedCategories: model.matchedCategories,
      triggeredAgents: model.triggeredAgents,
      notes: model.notes,
      subResults: subResults.map((r) => ({
        agentName: r.agentName,
        status: r.status,
        score: r.scoreContribution,
        reasonCodes: r.reasonCodes,
        matchedTerms: r.matchedTerms,
        notes: r.notes,
      })),
    };

    await this.persist(ctx, input.asin, input.amazonUrl, data);

    if (!model.compliancePassed) {
      await recordRejection(ctx.ottoProductId, 'compliance', primaryRejectionCode ?? RejectionReason.POLICY_RISK_TOO_HIGH, {
        policyRiskScore: model.policyRiskScore,
        hardBlock: model.hardBlock,
        manualReview: model.manualReview,
        reasonCodes: model.reasonCodes,
        matchedBrands: model.matchedBrands,
        matchedKeywords: model.matchedKeywords,
      });
    }

    const status = model.compliancePassed ? 'pass' : model.manualReview ? 'manual_review' : 'fail';
    const result = makeResult<ComplianceData>(
      this.name,
      ctx.ottoProductId,
      status,
      model.policyRiskScore,
      reasons,
      data,
    );
    await persistAgentResult(result, input.runId);
    return result;
  }

  private async persist(
    ctx: ComplianceContext,
    asin: string | undefined,
    amazonUrl: string | undefined,
    data: ComplianceData,
  ): Promise<void> {
    try {
      await getSupabase().from('compliance_checks').insert({
        otto_product_id: ctx.ottoProductId,
        asin: asin ?? null,
        amazon_url: amazonUrl ?? null,
        product_title: ctx.title,
        brand: ctx.brand ?? null,
        category_text: [ctx.amazonCategory, ...(ctx.amazonCategoryBreadcrumbs ?? []), ctx.ebayCategoryHint]
          .filter(Boolean)
          .join(' > '),
        policy_risk_score: data.policyRiskScore,
        vero_risk_score: data.veroRiskScore,
        restricted_category_risk_score: data.restrictedCategoryRiskScore,
        ip_risk_score: data.ipRiskScore,
        edge_case_risk_score: data.edgeCaseRiskScore,
        fragility_score: data.fragilityScore,
        variation_confusion_score: data.variationConfusionScore,
        hard_reject: data.hardBlock,
        hard_block: data.hardBlock,
        manual_review: data.manualReview,
        compliance_passed: data.compliancePassed,
        matched_brands: data.matchedBrands,
        matched_keywords: data.matchedKeywords,
        matched_categories: data.matchedCategories,
        triggered_agents: data.triggeredAgents,
        reason_codes: data.reasonCodes,
        notes: data.notes,
        reasons: data.reasons,
        sub_agent_results: data.subResults,
      });
    } catch (err) {
      this.log.warn('compliance_checks insert failed', { err: (err as Error).message });
    }
  }
}

function pickPrimaryHardBlockCode(model: ComplianceModelOutput): string {
  const codes = model.reasonCodes;
  // Prefer the most specific code if multiple are set.
  const priority = [
    RejectionReason.RESTRICTED_CATEGORY_MATCH,
    RejectionReason.HAZMAT_RISK,
    RejectionReason.MEDICAL_DEVICE_RISK,
    RejectionReason.SUPPLEMENT_FOOD_RISK,
    RejectionReason.WEAPON_SELF_DEFENSE_RISK,
    RejectionReason.BABY_SAFETY_RISK,
    RejectionReason.COPYRIGHT_CHARACTER_MATCH,
    RejectionReason.BRANDED_ELECTRONICS_RISK,
    RejectionReason.LUXURY_FASHION_RISK,
    RejectionReason.COUNTERFEIT_REPLICA_LANGUAGE,
    RejectionReason.COMPATIBILITY_FITMENT_RISK,
    RejectionReason.VERO_BRAND_MATCH,
  ];
  for (const p of priority) if (codes.includes(p)) return p;
  return RejectionReason.COMPLIANCE_HARD_BLOCK;
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
