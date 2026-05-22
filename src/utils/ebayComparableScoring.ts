import { BLACKLIST_BRANDS } from '@/config/categories';
import { clamp, weightedAverage } from '@/utils/scoring';
import { containsAny } from '@/utils/normalize';
import { tokenize } from '@/utils/ebayQueryBuilder';
import { detectBundleOrMultipack } from '@/utils/productRiskText';
import type { EbayBrowseItem } from '@/clients/ebayClient';

export type ComparableMatchType =
  | 'EXACT_MATCH'
  | 'SIMILAR_MATCH'
  | 'SAME_PRODUCT_DIFFERENT_BRAND'
  | 'ADJACENT_ALTERNATIVE'
  | 'COMPLEMENTARY_PRODUCT'
  | 'CATEGORY_GAP'
  | 'TREND_GAP'
  | 'LOW_CONFIDENCE';

export interface ComparableContext {
  amazonTitle?: string;
  amazonBrand?: string;
  amazonCategoryBreadcrumbs?: string[];
  amazonPrice?: number;
  coreKeyword?: string;
}

export interface ScoredComparable {
  itemId: string;
  title: string;
  price?: number;
  currency?: string;
  categoryId?: string;
  categoryName?: string;
  sellerUsername?: string;
  sellerFeedbackPercent?: number;
  sellerFeedbackScore?: number;
  condition?: string;
  buyingOptions: string[];
  itemLocation?: string;
  url: string;
  imageUrl?: string;

  titleSimilarityScore: number;
  keywordOverlapScore: number;
  categoryMatchScore: number;
  priceBandSimilarityScore: number;
  brandConflictScore: number;
  productTypeMatchScore: number;
  listingQualityScore: number;
  comparableConfidenceScore: number;
  comparableMatchType: ComparableMatchType;

  relevant: boolean;
  isBundleOrMultipack: boolean;
}

const RELEVANCE_THRESHOLD = 60;

export function scoreComparable(item: EbayBrowseItem, ctx: ComparableContext): ScoredComparable {
  const title = item.title ?? '';
  const lcTitle = title.toLowerCase();
  const itemId = item.itemId;
  const price = item.price ? Number(item.price.value) : undefined;
  const categoryName = item.categories?.[0]?.categoryName;
  const categoryId = item.categories?.[0]?.categoryId;
  const sellerFb = Number(item.seller?.feedbackPercentage ?? NaN);
  const sellerScore = Number(item.seller?.feedbackScore ?? NaN);

  const titleSimilarityScore = ctx.amazonTitle ? tokenSimilarity(title, ctx.amazonTitle) : 0;
  const keywordOverlapScore = ctx.coreKeyword ? tokenOverlap(title, ctx.coreKeyword) : 0;
  const categoryMatchScore = categoryMatch(categoryName, ctx.amazonCategoryBreadcrumbs);
  const priceBandSimilarityScore = priceBandSimilarity(price, ctx.amazonPrice);
  const brandConflictScore = brandConflict(title, ctx.amazonBrand);
  const productTypeMatchScore = productTypeMatch(title, ctx.amazonTitle, ctx.coreKeyword);
  const listingQualityScore = listingQuality(sellerFb, sellerScore, item.condition, item.topRatedBuyingExperience);

  const bundleHit = detectBundleOrMultipack(title);

  // Combined comparable confidence.  Title and keyword carry the most
  // weight; brand conflict and bundles drag the score down.
  const raw = weightedAverage([
    { value: titleSimilarityScore, weight: 3 },
    { value: keywordOverlapScore, weight: 2 },
    { value: productTypeMatchScore, weight: 2 },
    { value: categoryMatchScore, weight: 1 },
    { value: priceBandSimilarityScore, weight: 1.5 },
    { value: listingQualityScore, weight: 1 },
  ]);
  let comparableConfidenceScore = clamp(raw + (brandConflictScore - 50) * 0.2);
  if (bundleHit.matched) comparableConfidenceScore = clamp(comparableConfidenceScore - 15);

  const comparableMatchType = classify({
    titleSimilarityScore,
    keywordOverlapScore,
    categoryMatchScore,
    productTypeMatchScore,
    comparableConfidenceScore,
    brandHit: brandConflictScore < 50,
  });

  const relevant = comparableConfidenceScore >= RELEVANCE_THRESHOLD;

  return {
    itemId,
    title,
    price,
    currency: item.price?.currency,
    categoryId,
    categoryName,
    sellerUsername: item.seller?.username,
    sellerFeedbackPercent: Number.isFinite(sellerFb) ? sellerFb : undefined,
    sellerFeedbackScore: Number.isFinite(sellerScore) ? sellerScore : undefined,
    condition: item.condition,
    buyingOptions: item.buyingOptions ?? [],
    url: item.itemWebUrl,
    imageUrl: item.image?.imageUrl,
    titleSimilarityScore,
    keywordOverlapScore,
    categoryMatchScore,
    priceBandSimilarityScore,
    brandConflictScore,
    productTypeMatchScore,
    listingQualityScore,
    comparableConfidenceScore,
    comparableMatchType,
    relevant,
    isBundleOrMultipack: bundleHit.matched,
  };
  void lcTitle;
}

function tokenSimilarity(a: string, b: string): number {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let overlap = 0;
  for (const t of ta) if (tb.has(t)) overlap++;
  const jaccard = overlap / new Set([...ta, ...tb]).size;
  const containment = overlap / Math.min(ta.size, tb.size);
  // Same containment-weighted approach as the Amazon resolver: eBay
  // titles are also keyword-stuffed and longer than what we'd compare.
  return clamp((jaccard * 0.3 + containment * 0.7) * 100);
}

function tokenOverlap(haystack: string, needle: string): number {
  const tn = new Set(tokenize(needle));
  const th = new Set(tokenize(haystack));
  if (tn.size === 0) return 0;
  let hit = 0;
  for (const t of tn) if (th.has(t)) hit++;
  return clamp((hit / tn.size) * 100);
}

function categoryMatch(eBayCategoryName: string | undefined, amazonBreadcrumbs: string[] | undefined): number {
  if (!eBayCategoryName) return 50;
  if (!amazonBreadcrumbs || amazonBreadcrumbs.length === 0) return 60;
  const eBayTokens = new Set(tokenize(eBayCategoryName));
  const amazonTokens = new Set(tokenize(amazonBreadcrumbs.join(' ')));
  let overlap = 0;
  for (const t of eBayTokens) if (amazonTokens.has(t)) overlap++;
  if (eBayTokens.size === 0) return 50;
  return clamp((overlap / eBayTokens.size) * 100);
}

function priceBandSimilarity(ePrice: number | undefined, aPrice: number | undefined): number {
  if (!ePrice || !aPrice) return 50;
  const ratio = ePrice / aPrice;
  // Sweet spot: eBay listings priced 1.3x - 3.0x of Amazon cost = best for resale.
  if (ratio >= 1.3 && ratio <= 3.0) return 100;
  if (ratio >= 1.1 && ratio < 1.3) return 70; // thin margin
  if (ratio > 3.0 && ratio <= 5.0) return 70; // unusual but possible
  if (ratio >= 0.9 && ratio < 1.1) return 30; // about cost - no margin
  return 10; // way under cost or > 5x
}

function brandConflict(title: string, amazonBrand: string | undefined): number {
  const veroHit = containsAny(title, BLACKLIST_BRANDS);
  if (veroHit) return 0; // strong conflict
  if (!amazonBrand) return 70;
  const lc = title.toLowerCase();
  if (lc.includes(amazonBrand.toLowerCase())) return 100;
  return 60; // no info either way
}

function productTypeMatch(title: string, amazonTitle: string | undefined, keyword: string | undefined): number {
  // Take the last two significant tokens of the keyword/title as the product type
  // and check whether they appear in the eBay title.
  const candidate = (keyword ?? amazonTitle ?? '').trim();
  if (!candidate) return 0;
  const tokens = tokenize(candidate).filter((t) => t.length > 2);
  if (tokens.length === 0) return 0;
  const tail = tokens.slice(-2);
  const tt = new Set(tokenize(title));
  let hit = 0;
  for (const t of tail) if (tt.has(t)) hit++;
  return clamp((hit / tail.length) * 100);
}

function listingQuality(
  feedbackPercent: number,
  feedbackScore: number,
  condition: string | undefined,
  topRated: boolean | undefined,
): number {
  let score = 50;
  if (Number.isFinite(feedbackPercent)) score += (feedbackPercent - 95) * 2;
  if (Number.isFinite(feedbackScore) && feedbackScore > 1000) score += 5;
  if (Number.isFinite(feedbackScore) && feedbackScore > 10000) score += 5;
  if (topRated) score += 10;
  const cond = (condition ?? '').toLowerCase();
  if (cond.includes('new')) score += 5;
  if (cond.includes('used') || cond.includes('pre-owned') || cond.includes('refurb')) score -= 30;
  return clamp(score);
}

interface ClassifyArgs {
  titleSimilarityScore: number;
  keywordOverlapScore: number;
  categoryMatchScore: number;
  productTypeMatchScore: number;
  comparableConfidenceScore: number;
  brandHit: boolean;
}

function classify(a: ClassifyArgs): ComparableMatchType {
  if (a.comparableConfidenceScore < 30) return 'LOW_CONFIDENCE';
  if (a.titleSimilarityScore >= 85 && !a.brandHit) return 'EXACT_MATCH';
  if (a.titleSimilarityScore >= 70) return 'SIMILAR_MATCH';
  if (a.titleSimilarityScore >= 55 && a.brandHit) return 'SAME_PRODUCT_DIFFERENT_BRAND';
  if (a.productTypeMatchScore >= 60) return 'ADJACENT_ALTERNATIVE';
  if (a.keywordOverlapScore >= 60) return 'COMPLEMENTARY_PRODUCT';
  if (a.categoryMatchScore >= 60) return 'CATEGORY_GAP';
  return 'TREND_GAP';
}

export const COMPARABLE_RELEVANCE_THRESHOLD = RELEVANCE_THRESHOLD;
