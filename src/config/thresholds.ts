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

  // Cost assumptions (editable).
  SALES_TAX_ASSUMPTION_PCT: 7.25,
  AUTODS_WALLET_FEE_PCT: 2.0,
  AUTODS_ORDER_FEE_FLAT: 0.15,
  RETURN_RESERVE_PCT: 4.0,
} as const;

export type ThresholdKey = keyof typeof THRESHOLDS;
