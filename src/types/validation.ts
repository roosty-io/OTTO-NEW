export interface AmazonSourceCheck {
  inStock: boolean;
  hasSourcePrice: boolean;
  isRenewedOrRefurbished: boolean;
  isAmazonBasics: boolean;
  isBundleOrMultipack: boolean;
  deliveryDays?: number;
  withinDeliveryWindow: boolean;
  reasons: string[];
  passed: boolean;
}

export interface DemandScoreBundle {
  demandScore: number;
  sellWithin30DaysConfidence: number;
  stagnationRiskScore: number;
  categoryVelocityScore: number;
  keywordDemandScore: number;
  competitorSuccessScore: number;
  saturationScore: number;
  trendMomentumScore: number;
  demandType: 'high_velocity' | 'steady' | 'seasonal' | 'niche' | 'unknown';
  signals: Record<string, unknown>;
}

export interface ComplianceScoreBundle {
  policyRiskScore: number;
  veroRiskScore: number;
  restrictedCategoryRiskScore: number;
  ipRiskScore: number;
  edgeCaseRiskScore: number;
  fragilityScore: number;
  variationConfusionScore: number;
  hardReject: boolean;
  reasons: string[];
}

export interface CostBundle {
  amazonPrice: number;
  salesTaxAssumption: number;
  autodsWalletFee: number;
  autodsOrderFee: number;
  returnReserve: number;
  totalCostEstimate: number;
}

export interface FinalValidationDecision {
  ottoProductId: string;
  passed: boolean;
  finalValidationScore: number;
  reasons: string[];
  rejectionReason?: string;
}
