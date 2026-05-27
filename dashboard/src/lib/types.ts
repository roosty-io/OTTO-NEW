export interface DiscoveryRun {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  seed_keywords: string[] | null;
  notes: string | null;
  stats: Record<string, unknown> | null;
}

export interface ExportBatch {
  id: string;
  discovery_run_id: string | null;
  file_path: string;
  row_count: number;
  final_validated_before_dedupe: number | null;
  duplicate_asins_removed: number | null;
  final_exported_after_dedupe: number | null;
  status: string;
  created_at: string;
  is_synthetic: boolean;
}

export interface ValidatedProduct {
  otto_product_id: string;
  export_batch_id: string | null;
  discovery_run_id: string | null;
  asin: string;
  amazon_url: string;
  product_title: string;
  brand: string | null;
  amazon_category: string | null;
  amazon_price: number;
  delivery_days: number | null;
  stock_status: string | null;
  rating: number | null;
  review_count: number | null;
  source_confidence_score: number | null;
  product_match_type: string | null;
  opportunity_type: string | null;
  marketplace_signal_sources: string[] | null;
  primary_discovery_source: string | null;
  core_keyword: string | null;
  ebay_category_hint: string | null;
  demand_type: string | null;
  sell_within_30_days_confidence: number | null;
  stagnation_risk_score: number | null;
  demand_score: number | null;
  policy_risk_score: number | null;
  final_validation_score: number | null;
  validation_status: string | null;
  validated_at: string;
  // Persistence metadata added in V1.5
  raw_delivery_text: string | null;
  delivery_context: string | null;
  prime_signal_detected: boolean | null;
  prime_signal_source: string | null;
  fba_signal_detected: boolean | null;
  ships_from_amazon: boolean | null;
  sold_by_amazon: boolean | null;
  fulfilled_by_amazon: boolean | null;
  shipping_gate_result: string | null;
  shipping_review_required: boolean | null;
  business_fit_score: number | null;
  competition_quality_score: number | null;
  exported_at: string | null;
  csv_export_path: string | null;
  is_synthetic: boolean;
}

export interface BusinessFitCheck {
  id: string;
  otto_product_id: string;
  asin: string | null;
  amazon_url: string | null;
  amazon_price: number | null;
  product_title: string | null;
  brand: string | null;
  business_fit_score: number | null;
  price_quality_score: number | null;
  saturation_quality_score: number | null;
  differentiation_score: number | null;
  bulkiness_risk_score: number | null;
  brand_caution_score: number | null;
  competition_quality_score: number | null;
  seller_competition_score: number | null;
  exact_match_saturation_score: number | null;
  duplicate_listing_score: number | null;
  price_compression_score: number | null;
  is_generic_commodity: boolean | null;
  competition_gate_result: string | null;
  competition_rejection_reason: string | null;
  seller_count: number | null;
  exact_or_similar_match_count: number | null;
  duplicate_ratio: number | null;
  business_fit_passed: boolean | null;
  business_fit_rejection_reason: string | null;
  reason_codes: string[] | null;
  notes: string[] | null;
  created_at: string;
}

export interface AmazonSourceCheck {
  id: string;
  otto_product_id: string;
  asin: string | null;
  amazon_url: string | null;
  product_title: string | null;
  brand: string | null;
  source_price: number | null;
  delivery_days: number | null;
  estimated_delivery_days: number | null;
  delivery_text: string | null;
  raw_delivery_text: string | null;
  delivery_context: string | null;
  prime_signal_detected: boolean | null;
  prime_signal_source: string | null;
  fba_signal_detected: boolean | null;
  ships_from_amazon: boolean | null;
  sold_by_amazon: boolean | null;
  fulfilled_by_amazon: boolean | null;
  shipping_gate_result: string | null;
  shipping_review_required: boolean | null;
  source_valid: boolean | null;
  rejection_reason: string | null;
  reasons: string[] | null;
  created_at: string;
}

export interface RejectedProduct {
  id: string;
  otto_product_id: string;
  stage: string;
  reason: string;
  details: Record<string, unknown> | null;
  created_at: string;
}

export interface ManualQaReview {
  id: string;
  otto_product_id: string | null;
  asin: string | null;
  amazon_url: string | null;
  product_title: string | null;
  brand: string | null;
  amazon_price: number | null;
  delivery_days: number | null;
  sell_within_30_days_confidence: number | null;
  stagnation_risk_score: number | null;
  policy_risk_score: number | null;
  final_validation_score: number | null;
  would_list_yes_no: string | null;
  asin_real_yes_no: string | null;
  demand_makes_sense_yes_no: string | null;
  low_risk_yes_no: string | null;
  notes: string | null;
  reviewed_at: string | null;
  source_file: string | null;
  batch_label: string | null;
  created_at: string;
}

export interface AgentLog {
  id: string;
  agent_name: string;
  otto_product_id: string | null;
  discovery_run_id: string | null;
  level: string;
  message: string;
  data: Record<string, unknown> | null;
  created_at: string;
}

export interface AgentVote {
  id: string;
  agent_name: string;
  otto_product_id: string;
  vote: string;
  weight: number;
  reason: string | null;
  created_at: string;
}

export interface FunnelMetrics {
  rawCandidates: number;
  asinResolved: number;
  amazonSourceValid: number;
  demandPassed: number;
  compliancePassed: number;
  businessFitPassed: number;
  finalValidated: number;
  exportedAfterDedupe: number;
}

export interface LatestRun {
  runId: string;
  exportBatchId: string | null;
  csvPath: string | null;
  manualQaCsvPath: string | null;
  metrics: FunnelMetrics & {
    asinFailed: number;
    amazonSourceFailed: number;
    demandFailed: number;
    complianceFailed: number;
    businessFitFailed: number;
    finalValidatedBeforeDedupe: number;
    duplicateAsinsRemoved: number;
    endToEndPassRate: number;
    shippingReviewRequired: number;
    topRejectionReason: string | null;
    latestManualQaApprovalRate: number | null;
  };
}
