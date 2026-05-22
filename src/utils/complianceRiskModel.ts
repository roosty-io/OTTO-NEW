import { clamp } from '@/utils/scoring';

export type ComplianceBucket = 'vero' | 'restricted' | 'ip' | 'edge_case';
export type ComplianceStatus = 'pass' | 'warning' | 'manual_review' | 'fail';

export interface ComplianceSubResult {
  agentName: string;
  status: ComplianceStatus;
  scoreContribution: number; // 0-100, raw risk this agent contributes
  bucket: ComplianceBucket;
  matchedTerms: string[];
  reasonCodes: string[];
  notes: string;
  hardBlock: boolean;
}

export interface ComplianceModelOutput {
  policyRiskScore: number;
  veroRiskScore: number;
  restrictedCategoryRiskScore: number;
  ipRiskScore: number;
  edgeCaseRiskScore: number;
  fragilityScore: number;
  variationConfusionScore: number;
  hardBlock: boolean;
  manualReview: boolean;
  compliancePassed: boolean;
  reasonCodes: string[];
  matchedBrands: string[];
  matchedKeywords: string[];
  matchedCategories: string[];
  triggeredAgents: string[];
  notes: string[];
}

export interface ComplianceModelInput {
  subResults: ComplianceSubResult[];
  fragilityScore?: number;
  variationConfusionScore?: number;
}

/**
 * V1 rules (per spec):
 *   - any sub-agent with status='fail' AND hardBlock=true  => hardBlock=true
 *   - final_policy_risk_score > 50                         => reject
 *   - final_policy_risk_score 36-50                        => manual_review
 *   - final_policy_risk_score <= 35 and no hardBlock       => pass
 */
export const POLICY_RISK_PASS_MAX = 35;
export const POLICY_RISK_MANUAL_MAX = 50;

export function combineCompliance(input: ComplianceModelInput): ComplianceModelOutput {
  const buckets: Record<ComplianceBucket, number> = {
    vero: 0,
    restricted: 0,
    ip: 0,
    edge_case: 0,
  };
  const triggered = new Set<string>();
  const reasonCodes = new Set<string>();
  const matchedBrands = new Set<string>();
  const matchedKeywords = new Set<string>();
  const matchedCategories = new Set<string>();
  const notes: string[] = [];

  let hardBlock = false;
  let anyManual = false;

  for (const r of input.subResults) {
    if (r.scoreContribution > buckets[r.bucket]) buckets[r.bucket] = r.scoreContribution;
    if (r.status === 'fail' || r.status === 'warning' || r.status === 'manual_review') {
      triggered.add(r.agentName);
    }
    for (const c of r.reasonCodes) reasonCodes.add(c);
    if (r.notes) notes.push(`${r.agentName}: ${r.notes}`);

    // Sort matched terms into buckets for the council output.
    for (const term of r.matchedTerms) {
      if (r.bucket === 'vero' || r.bucket === 'ip') matchedBrands.add(term);
      if (r.bucket === 'restricted') matchedCategories.add(term);
      if (r.bucket === 'edge_case') matchedKeywords.add(term);
    }

    if (r.status === 'fail' && r.hardBlock) hardBlock = true;
    if (r.status === 'manual_review') anyManual = true;
  }

  const fragilityScore = input.fragilityScore ?? 0;
  const variationConfusionScore = input.variationConfusionScore ?? 0;

  const veroRiskScore = clamp(buckets.vero);
  const restrictedCategoryRiskScore = clamp(buckets.restricted);
  const ipRiskScore = clamp(buckets.ip);
  const edgeCaseRiskScore = clamp(buckets.edge_case);

  // Weighted combination, with the strongest bucket dominating.
  const max = Math.max(veroRiskScore, restrictedCategoryRiskScore, ipRiskScore, edgeCaseRiskScore);
  const avg =
    0.30 * veroRiskScore +
    0.30 * restrictedCategoryRiskScore +
    0.25 * ipRiskScore +
    0.15 * edgeCaseRiskScore;
  let policyRiskScore = clamp(Math.max(max * 0.7 + avg * 0.3, max - 5));
  if (hardBlock) policyRiskScore = Math.max(policyRiskScore, 90);

  const manualReview =
    !hardBlock &&
    (anyManual || (policyRiskScore > POLICY_RISK_PASS_MAX && policyRiskScore <= POLICY_RISK_MANUAL_MAX));

  const compliancePassed = !hardBlock && policyRiskScore <= POLICY_RISK_PASS_MAX && !manualReview;

  return {
    policyRiskScore,
    veroRiskScore,
    restrictedCategoryRiskScore,
    ipRiskScore,
    edgeCaseRiskScore,
    fragilityScore,
    variationConfusionScore,
    hardBlock,
    manualReview,
    compliancePassed,
    reasonCodes: Array.from(reasonCodes),
    matchedBrands: Array.from(matchedBrands),
    matchedKeywords: Array.from(matchedKeywords),
    matchedCategories: Array.from(matchedCategories),
    triggeredAgents: Array.from(triggered),
    notes,
  };
}
