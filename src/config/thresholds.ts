// Editable validation and scoring thresholds for OTTO V1.
// These mirror the rows seeded into `validation_thresholds` so they can be
// overridden later from the database without code changes.

export const THRESHOLDS = {
  DEFAULT_ZIP_CODE: '84107',
  DEFAULT_MAX_DELIVERY_DAYS: 10,

  MAX_POLICY_RISK_SCORE: 35,
  MIN_SELL_WITHIN_30_DAYS_CONFIDENCE: 70,
  MAX_STAGNATION_RISK_SCORE: 40,
  MIN_FINAL_VALIDATION_SCORE: 75,

  // Business-fit thresholds (V1).  Learned from manual QA feedback.
  MIN_AMAZON_PRICE_DEFAULT: 10,
  MIN_AMAZON_PRICE_STRICT: 12,
  MAX_BULKY_PRICE_WITHOUT_HIGH_CONFIDENCE: 100,
  MIN_BUSINESS_FIT_SCORE: 70,
  MAX_BULKINESS_RISK_SCORE: 60,
  MAX_SATURATION_QUALITY_RISK: 60,

  // Competition gate (V1.2).  Stricter checks for over-crowded markets.
  MIN_COMPETITION_QUALITY_SCORE: 60,
  MAX_EXACT_MATCH_SATURATION_SCORE: 75,
  MAX_PRICE_COMPRESSION_SCORE: 70,
  MAX_DUPLICATE_LISTING_SCORE: 70,
  MAX_SELLER_COMPETITION_SCORE: 80,

  // Cost assumptions (editable).
  SALES_TAX_ASSUMPTION_PCT: 7.25,
  AUTODS_WALLET_FEE_PCT: 2.0,
  AUTODS_ORDER_FEE_FLAT: 0.15,
  RETURN_RESERVE_PCT: 4.0,
} as const;

export type ThresholdKey = keyof typeof THRESHOLDS;
