export type StockStatus = 'in_stock' | 'out_of_stock' | 'unknown';
export type ProductMatchType = 'exact' | 'variation' | 'similar' | 'unknown';
export type DemandType = 'high_velocity' | 'steady' | 'seasonal' | 'niche' | 'unknown';
export type OpportunityType =
  | 'direct_match'
  | 'adjacent_product'
  | 'complementary_product'
  | 'different_brand'
  | 'private_label_alternative'
  | 'unknown';

export interface ProductCandidate {
  ottoProductId: string;
  source: string;
  sourceUrl: string;
  marketplace: 'ebay' | 'amazon' | 'walmart' | 'aliexpress' | 'other';
  keyword: string;
  categoryHint?: string;
  productTitleRaw: string;
  brandHint?: string;
  imageUrlHint?: string;
  priceHint?: number;
  discoveryScore: number;
  // ASIN-native discovery (e.g. Keepa): when present, the ASIN resolver
  // can be bypassed and source confidence treated as high.
  asin?: string;
  amazonUrl?: string;
  sourceConfidenceScore?: number;
  // Keepa multi-strategy discovery provenance (set by the discovery agent
  // after deduping an ASIN across Product Finder strategies). discoveryScore
  // above already carries the best score across the strategies that found it.
  keepaStrategiesFound?: string[];
  primaryKeepaStrategy?: string;
  keepaStrategyCount?: number;
}

export interface ValidatedProduct {
  ottoProductId: string;

  // ASIN / Amazon
  asin: string;
  parentAsin?: string;
  childAsin?: string;
  amazonUrl: string;
  productTitle: string;
  brand?: string;
  amazonCategory?: string;
  variationAttributes?: Record<string, string>;
  amazonPrice: number;
  couponDetected: boolean;
  deliveryDays?: number;
  stockStatus: StockStatus;
  rating?: number;
  reviewCount?: number;

  // Source confidence
  sourceConfidenceScore: number;
  productMatchType: ProductMatchType;
  opportunityType: OpportunityType;
  marketplaceSignalSources: string[];
  primaryDiscoverySource: string;
  secondaryDiscoverySources: string[];

  // Demand
  coreKeyword: string;
  relatedKeywords: string[];
  ebayCategoryHint?: string;
  demandType: DemandType;
  sellWithin30DaysConfidence: number;
  stagnationRiskScore: number;
  demandScore: number;
  categoryVelocityScore: number;
  keywordDemandScore: number;
  competitorSuccessScore: number;
  saturationScore: number;
  trendMomentumScore: number;

  // Compliance
  policyRiskScore: number;
  veroRiskScore: number;
  restrictedCategoryRiskScore: number;
  ipRiskScore: number;
  edgeCaseRiskScore: number;
  fragilityScore: number;
  variationConfusionScore: number;

  // Shipping gate / Prime signals
  rawDeliveryText?: string;
  deliveryContext?: string;
  primeSignalDetected?: boolean;
  primeSignalSource?: string;
  fbaSignalDetected?: boolean;
  shipsFromAmazon?: boolean;
  soldByAmazon?: boolean;
  fulfilledByAmazon?: boolean;
  shippingGateResult?: 'pass' | 'prime_likely_pass' | 'reject';
  shippingReviewRequired?: boolean;

  // Business fit (V1.4)
  businessFitScore?: number;

  // Competition gate (V1.2)
  competitionQualityScore?: number;
  sellerCompetitionScore?: number;
  exactMatchSaturationScore?: number;
  duplicateListingScore?: number;
  priceCompressionScore?: number;
  sameSourceLikelihoodScore?: number;
  isGenericCommodity?: boolean;
  competitionGateResult?: 'healthy' | 'borderline' | 'saturated';
  competitionRejectionReason?: string;
  sellerCount?: number;
  exactOrSimilarMatchCount?: number;
  duplicateRatio?: number;

  // Cost
  totalCostEstimate: number;
  predictedMonthlyProfitPer100Listings: number;

  // Final
  finalValidationScore: number;
  validationStatus: 'validated' | 'rejected' | 'manual_review';
  validatedAt: string;
}
