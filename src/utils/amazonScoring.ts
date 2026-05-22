import { BLACKLIST_BRANDS } from '@/config/categories';
import { clamp } from '@/utils/scoring';
import { containsAny, detectAmazonBasics, detectMultipack, detectRenewed } from '@/utils/normalize';
import { tokenize } from '@/utils/amazonQueryBuilder';

export type ProductMatchType =
  | 'EXACT_MATCH'
  | 'SAME_PRODUCT_DIFFERENT_BRAND'
  | 'SIMILAR_PRODUCT'
  | 'ADJACENT_PRODUCT'
  | 'COMPLEMENTARY_PRODUCT'
  | 'PRIVATE_LABEL_ALTERNATIVE'
  | 'LOW_CONFIDENCE';

export interface AmazonHitInput {
  title: string;
  brand?: string;
  isAmazonBasics?: boolean;
  isRenewedOrRefurbished?: boolean;
  isBundleOrMultipack?: boolean;
  sponsored?: boolean;
}

export interface CandidateContext {
  productTitleRaw: string;
  brandHint?: string;
  keyword?: string;
  categoryHint?: string;
}

export interface ScoredHit {
  titleSimilarityScore: number;
  keywordOverlapScore: number;
  categoryHintScore: number;
  brandRiskAdjustment: number;
  privateLabelScore: number;
  sponsoredPenalty: number;
  bundlePenalty: number;
  multipackPenalty: number;
  renewedRefurbishedPenalty: number;
  amazonBasicsPenalty: number;
  finalProductMatchConfidence: number;
  productMatchType: ProductMatchType;
}

export function scoreAmazonHit(hit: AmazonHitInput, ctx: CandidateContext): ScoredHit {
  const titleSimilarityScore = tokenSimilarity(hit.title, ctx.productTitleRaw);
  const keywordOverlapScore = ctx.keyword ? tokenOverlap(hit.title, ctx.keyword) : titleSimilarityScore * 0.7;
  const categoryHintScore = ctx.categoryHint
    ? Math.min(100, tokenOverlap(hit.title, ctx.categoryHint) + 20)
    : 50;

  const isAB = hit.isAmazonBasics ?? detectAmazonBasics(hit.title, hit.brand);
  const isRR = hit.isRenewedOrRefurbished ?? detectRenewed(hit.title);
  const isBM = hit.isBundleOrMultipack ?? detectMultipack(hit.title);

  const brandVeroHit = (hit.brand && containsAny(hit.brand, BLACKLIST_BRANDS)) ||
    containsAny(hit.title, BLACKLIST_BRANDS);
  const brandRiskAdjustment = brandVeroHit ? -25 : 0;

  // Private-label heuristic: short brand string + low review-velocity-style title.
  const privateLabelScore = privateLabelHeuristic(hit);

  const sponsoredPenalty = hit.sponsored ? 8 : 0;
  const bundlePenalty = isBM ? 100 : 0;
  const multipackPenalty = isBM ? 100 : 0;
  const renewedRefurbishedPenalty = isRR ? 100 : 0;
  const amazonBasicsPenalty = isAB ? 100 : 0;

  const baseScore = clamp(
    titleSimilarityScore * 0.55 +
      keywordOverlapScore * 0.30 +
      categoryHintScore * 0.15 +
      brandRiskAdjustment -
      sponsoredPenalty,
  );

  // Hard exclusions zero the final confidence so the agent will filter them.
  const blocked = isAB || isRR || isBM;
  const finalProductMatchConfidence = blocked ? 0 : baseScore;

  const productMatchType = classifyMatch({
    titleSimilarityScore,
    keywordOverlapScore,
    hitBrand: hit.brand,
    candidateBrand: ctx.brandHint,
    finalScore: finalProductMatchConfidence,
    privateLabelScore,
  });

  return {
    titleSimilarityScore,
    keywordOverlapScore,
    categoryHintScore,
    brandRiskAdjustment,
    privateLabelScore,
    sponsoredPenalty,
    bundlePenalty,
    multipackPenalty,
    renewedRefurbishedPenalty,
    amazonBasicsPenalty,
    finalProductMatchConfidence,
    productMatchType,
  };
}

function tokenSimilarity(a: string, b: string): number {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let overlap = 0;
  for (const t of ta) if (tb.has(t)) overlap++;
  const jaccard = overlap / new Set([...ta, ...tb]).size;
  const containment = overlap / Math.min(ta.size, tb.size);
  // Heavily favor containment: candidate titles (eBay) are short and Amazon
  // titles are long & keyword-stuffed. A pure jaccard would penalize the
  // correct answer for being verbose, which is the opposite of what we want.
  return clamp((jaccard * 0.2 + containment * 0.8) * 100);
}

function tokenOverlap(haystack: string, needle: string): number {
  const tn = new Set(tokenize(needle));
  const th = new Set(tokenize(haystack));
  if (tn.size === 0) return 0;
  let hit = 0;
  for (const t of tn) if (th.has(t)) hit++;
  return clamp((hit / tn.size) * 100);
}

function privateLabelHeuristic(hit: AmazonHitInput): number {
  const brand = (hit.brand ?? '').trim();
  if (!brand) return 0;
  // Short alphanumeric brand names that are not on common-brand lists are
  // characteristic of private-label sellers on Amazon.
  const looksMadeUp = /^[A-Z][a-z]{2,9}$/.test(brand) || /^[A-Z]{3,6}$/.test(brand);
  if (!looksMadeUp) return 0;
  if (containsAny(brand, BLACKLIST_BRANDS)) return 0;
  return 60;
}

interface ClassifyArgs {
  titleSimilarityScore: number;
  keywordOverlapScore: number;
  hitBrand?: string;
  candidateBrand?: string;
  finalScore: number;
  privateLabelScore: number;
}

export function classifyMatch(args: ClassifyArgs): ProductMatchType {
  const { titleSimilarityScore, keywordOverlapScore, hitBrand, candidateBrand, finalScore, privateLabelScore } = args;

  if (finalScore < 30) return 'LOW_CONFIDENCE';

  const brandsKnown = Boolean(hitBrand && candidateBrand);
  const sameBrand = brandsKnown && hitBrand!.toLowerCase() === candidateBrand!.toLowerCase();
  const differentBrand = brandsKnown && !sameBrand;

  if (titleSimilarityScore >= 85 && (sameBrand || !brandsKnown)) return 'EXACT_MATCH';
  if (titleSimilarityScore >= 75 && differentBrand) return 'SAME_PRODUCT_DIFFERENT_BRAND';
  if (privateLabelScore >= 60 && titleSimilarityScore >= 55) return 'PRIVATE_LABEL_ALTERNATIVE';
  if (titleSimilarityScore >= 60) return 'SIMILAR_PRODUCT';
  if (keywordOverlapScore >= 60) return 'ADJACENT_PRODUCT';
  if (keywordOverlapScore >= 40) return 'COMPLEMENTARY_PRODUCT';
  return 'LOW_CONFIDENCE';
}
