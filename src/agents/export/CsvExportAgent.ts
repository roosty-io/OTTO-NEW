import { v4 as uuidv4 } from 'uuid';
import { getSupabase } from '@/clients/supabaseClient';
import { logger } from '@/utils/logger';
import { env } from '@/config/env';
import { writeCsv } from '@/utils/csv';
import { makeResult, persistAgentLog, persistAgentResult } from '@/agents/baseAgent';
import type { AgentResult } from '@/types/agent';
import type { ValidatedProduct } from '@/types/product';

export const EXPORT_COLUMNS = [
  'otto_product_id',
  'export_batch_id',
  'asin',
  'parent_asin',
  'child_asin',
  'amazon_url',
  'product_title',
  'brand',
  'amazon_category',
  'variation_attributes',
  'amazon_price',
  'coupon_detected',
  'delivery_days',
  'stock_status',
  'rating',
  'review_count',
  'source_confidence_score',
  'product_match_type',
  'opportunity_type',
  'marketplace_signal_sources',
  'primary_discovery_source',
  'secondary_discovery_sources',
  'core_keyword',
  'related_keywords',
  'ebay_category_hint',
  'demand_type',
  'sell_within_30_days_confidence',
  'stagnation_risk_score',
  'demand_score',
  'category_velocity_score',
  'keyword_demand_score',
  'competitor_success_score',
  'saturation_score',
  'trend_momentum_score',
  'policy_risk_score',
  'vero_risk_score',
  'restricted_category_risk_score',
  'ip_risk_score',
  'edge_case_risk_score',
  'fragility_score',
  'variation_confusion_score',
  'business_fit_score',
  'competition_quality_score',
  'total_cost_estimate',
  'predicted_monthly_profit_per_100_listings',
  'final_validation_score',
  'validation_status',
  'validated_at',
  // Shipping gate / Prime signals
  'raw_delivery_text',
  'delivery_context',
  'prime_signal_detected',
  'prime_signal_source',
  'fba_signal_detected',
  'ships_from_amazon',
  'sold_by_amazon',
  'fulfilled_by_amazon',
  'shipping_gate_result',
  'shipping_review_required',
];

export const MANUAL_QA_COLUMNS = [
  'otto_product_id',
  'asin',
  'amazon_url',
  'product_title',
  'brand',
  'amazon_price',
  'delivery_days',
  'raw_delivery_text',
  'delivery_context',
  'prime_signal_detected',
  'prime_signal_source',
  'fba_signal_detected',
  'ships_from_amazon',
  'sold_by_amazon',
  'fulfilled_by_amazon',
  'shipping_gate_result',
  'shipping_review_required',
  'competition_quality_score',
  'exact_match_saturation_score',
  'duplicate_listing_score',
  'price_compression_score',
  'seller_count',
  'exact_or_similar_match_count',
  'duplicate_ratio',
  'competition_gate_result',
  'competition_rejection_reason',
  'sell_within_30_days_confidence',
  'stagnation_risk_score',
  'policy_risk_score',
  'final_validation_score',
  'would_list_yes_no',
  'asin_real_yes_no',
  'demand_makes_sense_yes_no',
  'low_risk_yes_no',
  'notes',
];

export interface CsvExportInput {
  products: ValidatedProduct[];
  discoveryRunId?: string;
  /**
   * When true, persisted rows are marked is_synthetic=true so the
   * dashboard can filter them out.  Defaults to false.
   */
  isSynthetic?: boolean;
}

export interface DedupeRemoval {
  asin: string;
  duplicateGroupId: string;
  keptOttoProductId: string;
  removedOttoProductId: string;
  keptFinalValidationScore: number;
  removedFinalValidationScore: number;
  keptSellWithin30DaysConfidence: number;
  removedSellWithin30DaysConfidence: number;
  keptPolicyRiskScore: number;
  removedPolicyRiskScore: number;
  keptStagnationRiskScore: number;
  removedStagnationRiskScore: number;
}

export interface CsvExportData {
  filePath: string;
  manualQaCsvPath: string;
  rowCount: number;
  exportBatchId: string;
  finalValidatedBeforeDedupe: number;
  duplicateAsinsRemoved: number;
  finalExportedAfterDedupe: number;
  persistedRowCount: number;
  failedPersistenceCount: number;
  removedDuplicates: DedupeRemoval[];
}

export class CsvExportAgent {
  readonly name = 'CsvExportAgent';
  private readonly log = logger.child(this.name);

  async run(input: CsvExportInput): Promise<AgentResult<CsvExportData>> {
    const supabase = getSupabase();
    const exportBatchId = uuidv4();
    const exportedAt = new Date().toISOString();
    const stamp = exportedAt.replace(/[:.]/g, '-');
    const filename = `otto-validated-${stamp}.csv`;
    const manualQaFilename = `otto_manual_qa_review_${exportedAt.slice(0, 10)}.csv`;

    const finalValidatedBeforeDedupe = input.products.length;
    const { keptProducts, removals } = dedupeByAsin(input.products);
    const duplicateAsinsRemoved = removals.length;
    const finalExportedAfterDedupe = keptProducts.length;

    if (duplicateAsinsRemoved > 0) {
      await this.persistRemovals(removals, exportBatchId, input.discoveryRunId);
    }

    // ---------- Canonical CSV ----------
    const csvRows = keptProducts.map((p) => mapToExportRow(p, exportBatchId));
    const { filePath, rowCount } = writeCsv(env.exportDir, filename, EXPORT_COLUMNS, csvRows);

    // ---------- Manual QA CSV ----------
    const qaRows = keptProducts.map(mapToManualQaRow);
    const { filePath: manualQaCsvPath } = writeCsv(
      env.exportDir,
      manualQaFilename,
      MANUAL_QA_COLUMNS,
      qaRows,
    );

    // ---------- export_batches row ----------
    try {
      await supabase.from('export_batches').insert({
        id: exportBatchId,
        discovery_run_id: input.discoveryRunId ?? null,
        file_path: filePath,
        row_count: rowCount,
        final_validated_before_dedupe: finalValidatedBeforeDedupe,
        duplicate_asins_removed: duplicateAsinsRemoved,
        final_exported_after_dedupe: finalExportedAfterDedupe,
        status: 'completed',
        is_synthetic: Boolean(input.isSynthetic),
      });
    } catch (err) {
      this.log.warn('export_batches insert failed', { err: (err as Error).message });
    }

    // ---------- validated_products upsert ----------
    const persistResult = await this.persistExportedProducts(
      keptProducts,
      exportBatchId,
      input.discoveryRunId,
      filePath,
      exportedAt,
      Boolean(input.isSynthetic),
    );

    await persistAgentLog({
      agentName: this.name,
      runId: input.discoveryRunId,
      level: 'info',
      message: 'CSV export complete',
      data: {
        filePath,
        manualQaCsvPath,
        rowCount,
        exportBatchId,
        finalValidatedBeforeDedupe,
        duplicateAsinsRemoved,
        finalExportedAfterDedupe,
        persistedRowCount: persistResult.persisted,
        failedPersistenceCount: persistResult.failed,
      },
    });

    const data: CsvExportData = {
      filePath,
      manualQaCsvPath,
      rowCount,
      exportBatchId,
      finalValidatedBeforeDedupe,
      duplicateAsinsRemoved,
      finalExportedAfterDedupe,
      persistedRowCount: persistResult.persisted,
      failedPersistenceCount: persistResult.failed,
      removedDuplicates: removals,
    };
    const result = makeResult(
      this.name,
      'EXPORT',
      'pass',
      rowCount,
      [
        `Wrote ${rowCount} rows to CSV`,
        `${duplicateAsinsRemoved} duplicate ASIN(s) removed (kept ${finalExportedAfterDedupe} of ${finalValidatedBeforeDedupe})`,
        `Persisted ${persistResult.persisted}/${rowCount} to validated_products (${persistResult.failed} failed)`,
      ],
      data,
    );
    await persistAgentResult(result, input.discoveryRunId);
    return result;
  }

  /**
   * Idempotent upsert keyed on (export_batch_id, asin).  Re-running the
   * same batch produces the same rows; new batches always insert.
   */
  private async persistExportedProducts(
    products: ValidatedProduct[],
    exportBatchId: string,
    discoveryRunId: string | undefined,
    csvExportPath: string,
    exportedAt: string,
    isSynthetic: boolean,
  ): Promise<{ persisted: number; failed: number }> {
    if (products.length === 0) return { persisted: 0, failed: 0 };
    const supabase = getSupabase();
    const rows = products.map((p) => ({
      otto_product_id: p.ottoProductId,
      export_batch_id: exportBatchId,
      discovery_run_id: discoveryRunId ?? null,
      asin: p.asin,
      parent_asin: p.parentAsin ?? null,
      child_asin: p.childAsin ?? null,
      amazon_url: p.amazonUrl,
      product_title: p.productTitle,
      brand: p.brand ?? null,
      amazon_category: p.amazonCategory ?? null,
      variation_attributes: p.variationAttributes ?? {},
      amazon_price: p.amazonPrice,
      coupon_detected: p.couponDetected,
      delivery_days: p.deliveryDays ?? null,
      raw_delivery_text: p.rawDeliveryText ?? null,
      delivery_context: p.deliveryContext ?? null,
      prime_signal_detected: p.primeSignalDetected ?? null,
      prime_signal_source: p.primeSignalSource ?? null,
      fba_signal_detected: p.fbaSignalDetected ?? null,
      ships_from_amazon: p.shipsFromAmazon ?? null,
      sold_by_amazon: p.soldByAmazon ?? null,
      fulfilled_by_amazon: p.fulfilledByAmazon ?? null,
      shipping_gate_result: p.shippingGateResult ?? null,
      shipping_review_required: p.shippingReviewRequired ?? null,
      stock_status: p.stockStatus,
      rating: p.rating ?? null,
      review_count: p.reviewCount ?? null,
      source_confidence_score: p.sourceConfidenceScore,
      product_match_type: p.productMatchType,
      opportunity_type: p.opportunityType,
      marketplace_signal_sources: p.marketplaceSignalSources,
      primary_discovery_source: p.primaryDiscoverySource,
      secondary_discovery_sources: p.secondaryDiscoverySources,
      core_keyword: p.coreKeyword,
      related_keywords: p.relatedKeywords,
      ebay_category_hint: p.ebayCategoryHint ?? null,
      demand_type: p.demandType,
      sell_within_30_days_confidence: p.sellWithin30DaysConfidence,
      stagnation_risk_score: p.stagnationRiskScore,
      demand_score: p.demandScore,
      category_velocity_score: p.categoryVelocityScore,
      keyword_demand_score: p.keywordDemandScore,
      competitor_success_score: p.competitorSuccessScore,
      saturation_score: p.saturationScore,
      trend_momentum_score: p.trendMomentumScore,
      policy_risk_score: p.policyRiskScore,
      vero_risk_score: p.veroRiskScore,
      restricted_category_risk_score: p.restrictedCategoryRiskScore,
      ip_risk_score: p.ipRiskScore,
      edge_case_risk_score: p.edgeCaseRiskScore,
      fragility_score: p.fragilityScore,
      variation_confusion_score: p.variationConfusionScore,
      business_fit_score: p.businessFitScore ?? null,
      competition_quality_score: p.competitionQualityScore ?? null,
      total_cost_estimate: p.totalCostEstimate,
      predicted_monthly_profit_per_100_listings: p.predictedMonthlyProfitPer100Listings,
      final_validation_score: p.finalValidationScore,
      validation_status: p.validationStatus,
      validated_at: p.validatedAt,
      exported_at: exportedAt,
      csv_export_path: csvExportPath,
      is_synthetic: isSynthetic,
    }));
    try {
      const { error } = await supabase
        .from('validated_products')
        .upsert(rows, { onConflict: 'export_batch_id,asin' } as never);
      if (error) {
        this.log.warn('validated_products upsert failed', { err: error.message, attempted: rows.length });
        return { persisted: 0, failed: rows.length };
      }
      return { persisted: rows.length, failed: 0 };
    } catch (err) {
      this.log.warn('validated_products upsert threw', { err: (err as Error).message, attempted: rows.length });
      return { persisted: 0, failed: rows.length };
    }
  }

  private async persistRemovals(
    removals: DedupeRemoval[],
    exportBatchId: string,
    runId?: string,
  ): Promise<void> {
    const supabase = getSupabase();
    const rows = removals.map((r) => ({
      duplicate_group_id: r.duplicateGroupId,
      asin: r.asin,
      kept_otto_product_id: r.keptOttoProductId,
      removed_otto_product_id: r.removedOttoProductId,
      removed_reason: 'duplicate_asin',
      kept_final_validation_score: r.keptFinalValidationScore,
      removed_final_validation_score: r.removedFinalValidationScore,
      kept_sell_within_30_days_confidence: r.keptSellWithin30DaysConfidence,
      removed_sell_within_30_days_confidence: r.removedSellWithin30DaysConfidence,
      kept_policy_risk_score: r.keptPolicyRiskScore,
      removed_policy_risk_score: r.removedPolicyRiskScore,
      kept_stagnation_risk_score: r.keptStagnationRiskScore,
      removed_stagnation_risk_score: r.removedStagnationRiskScore,
      export_batch_id: exportBatchId,
    }));
    try {
      await supabase.from('deduped_products').insert(rows);
    } catch (err) {
      this.log.warn('deduped_products insert failed', { err: (err as Error).message });
    }
    for (const r of removals) {
      await persistAgentLog({
        agentName: this.name,
        productId: r.removedOttoProductId,
        runId,
        level: 'info',
        message: 'EXPORT_DEDUPED_ASIN',
        data: {
          asin: r.asin,
          keptOttoProductId: r.keptOttoProductId,
          keptFinalValidationScore: r.keptFinalValidationScore,
          removedFinalValidationScore: r.removedFinalValidationScore,
        },
      });
    }
  }
}

/** Map a ValidatedProduct -> canonical CSV row. */
export function mapToExportRow(p: ValidatedProduct, exportBatchId: string): Record<string, unknown> {
  return {
    otto_product_id: p.ottoProductId,
    export_batch_id: exportBatchId,
    asin: p.asin,
    parent_asin: p.parentAsin,
    child_asin: p.childAsin,
    amazon_url: p.amazonUrl,
    product_title: p.productTitle,
    brand: p.brand,
    amazon_category: p.amazonCategory,
    variation_attributes: p.variationAttributes,
    amazon_price: p.amazonPrice,
    coupon_detected: p.couponDetected,
    delivery_days: p.deliveryDays,
    stock_status: p.stockStatus,
    rating: p.rating,
    review_count: p.reviewCount,
    source_confidence_score: p.sourceConfidenceScore,
    product_match_type: p.productMatchType,
    opportunity_type: p.opportunityType,
    marketplace_signal_sources: p.marketplaceSignalSources,
    primary_discovery_source: p.primaryDiscoverySource,
    secondary_discovery_sources: p.secondaryDiscoverySources,
    core_keyword: p.coreKeyword,
    related_keywords: p.relatedKeywords,
    ebay_category_hint: p.ebayCategoryHint,
    demand_type: p.demandType,
    sell_within_30_days_confidence: p.sellWithin30DaysConfidence,
    stagnation_risk_score: p.stagnationRiskScore,
    demand_score: p.demandScore,
    category_velocity_score: p.categoryVelocityScore,
    keyword_demand_score: p.keywordDemandScore,
    competitor_success_score: p.competitorSuccessScore,
    saturation_score: p.saturationScore,
    trend_momentum_score: p.trendMomentumScore,
    policy_risk_score: p.policyRiskScore,
    vero_risk_score: p.veroRiskScore,
    restricted_category_risk_score: p.restrictedCategoryRiskScore,
    ip_risk_score: p.ipRiskScore,
    edge_case_risk_score: p.edgeCaseRiskScore,
    fragility_score: p.fragilityScore,
    variation_confusion_score: p.variationConfusionScore,
    business_fit_score: p.businessFitScore,
    competition_quality_score: p.competitionQualityScore,
    total_cost_estimate: p.totalCostEstimate,
    predicted_monthly_profit_per_100_listings: p.predictedMonthlyProfitPer100Listings,
    final_validation_score: p.finalValidationScore,
    validation_status: p.validationStatus,
    validated_at: p.validatedAt,
    raw_delivery_text: p.rawDeliveryText,
    delivery_context: p.deliveryContext,
    prime_signal_detected: p.primeSignalDetected,
    prime_signal_source: p.primeSignalSource,
    fba_signal_detected: p.fbaSignalDetected,
    ships_from_amazon: p.shipsFromAmazon,
    sold_by_amazon: p.soldByAmazon,
    fulfilled_by_amazon: p.fulfilledByAmazon,
    shipping_gate_result: p.shippingGateResult,
    shipping_review_required: p.shippingReviewRequired,
  };
}

/** Map a ValidatedProduct -> manual QA review CSV row. */
export function mapToManualQaRow(p: ValidatedProduct): Record<string, unknown> {
  return {
    otto_product_id: p.ottoProductId,
    asin: p.asin,
    amazon_url: p.amazonUrl,
    product_title: p.productTitle,
    brand: p.brand,
    amazon_price: p.amazonPrice,
    delivery_days: p.deliveryDays,
    raw_delivery_text: p.rawDeliveryText,
    delivery_context: p.deliveryContext,
    prime_signal_detected: p.primeSignalDetected,
    prime_signal_source: p.primeSignalSource,
    fba_signal_detected: p.fbaSignalDetected,
    ships_from_amazon: p.shipsFromAmazon,
    sold_by_amazon: p.soldByAmazon,
    fulfilled_by_amazon: p.fulfilledByAmazon,
    shipping_gate_result: p.shippingGateResult,
    shipping_review_required: p.shippingReviewRequired,
    competition_quality_score: p.competitionQualityScore,
    exact_match_saturation_score: p.exactMatchSaturationScore,
    duplicate_listing_score: p.duplicateListingScore,
    price_compression_score: p.priceCompressionScore,
    seller_count: p.sellerCount,
    exact_or_similar_match_count: p.exactOrSimilarMatchCount,
    duplicate_ratio: p.duplicateRatio,
    competition_gate_result: p.competitionGateResult,
    competition_rejection_reason: p.competitionRejectionReason,
    sell_within_30_days_confidence: p.sellWithin30DaysConfidence,
    stagnation_risk_score: p.stagnationRiskScore,
    policy_risk_score: p.policyRiskScore,
    final_validation_score: p.finalValidationScore,
    would_list_yes_no: '',
    asin_real_yes_no: '',
    demand_makes_sense_yes_no: '',
    low_risk_yes_no: '',
    notes: '',
  };
}

/**
 * Group validated products by ASIN and keep one row per ASIN.  Priority:
 *   1. highest final_validation_score
 *   2. highest sell_within_30_days_confidence
 *   3. lowest policy_risk_score
 *   4. lowest stagnation_risk_score
 *   5. most recent validated_at
 */
export function dedupeByAsin(
  products: ValidatedProduct[],
): { keptProducts: ValidatedProduct[]; removals: DedupeRemoval[] } {
  const groups = new Map<string, ValidatedProduct[]>();
  for (const p of products) {
    const key = (p.asin ?? '').trim();
    if (!key) continue;
    const arr = groups.get(key) ?? [];
    arr.push(p);
    groups.set(key, arr);
  }

  const kept: ValidatedProduct[] = [];
  const removals: DedupeRemoval[] = [];
  for (const [asin, group] of groups) {
    const sorted = group.slice().sort(compareByPriority);
    const keepWinner = sorted[0];
    kept.push(keepWinner);
    if (sorted.length > 1) {
      const duplicateGroupId = uuidv4();
      for (const loser of sorted.slice(1)) {
        removals.push({
          asin,
          duplicateGroupId,
          keptOttoProductId: keepWinner.ottoProductId,
          removedOttoProductId: loser.ottoProductId,
          keptFinalValidationScore: keepWinner.finalValidationScore,
          removedFinalValidationScore: loser.finalValidationScore,
          keptSellWithin30DaysConfidence: keepWinner.sellWithin30DaysConfidence,
          removedSellWithin30DaysConfidence: loser.sellWithin30DaysConfidence,
          keptPolicyRiskScore: keepWinner.policyRiskScore,
          removedPolicyRiskScore: loser.policyRiskScore,
          keptStagnationRiskScore: keepWinner.stagnationRiskScore,
          removedStagnationRiskScore: loser.stagnationRiskScore,
        });
      }
    }
  }
  return { keptProducts: kept, removals };
}

function compareByPriority(a: ValidatedProduct, b: ValidatedProduct): number {
  if (b.finalValidationScore !== a.finalValidationScore) return b.finalValidationScore - a.finalValidationScore;
  if (b.sellWithin30DaysConfidence !== a.sellWithin30DaysConfidence) {
    return b.sellWithin30DaysConfidence - a.sellWithin30DaysConfidence;
  }
  if (a.policyRiskScore !== b.policyRiskScore) return a.policyRiskScore - b.policyRiskScore;
  if (a.stagnationRiskScore !== b.stagnationRiskScore) return a.stagnationRiskScore - b.stagnationRiskScore;
  const aT = new Date(a.validatedAt).getTime();
  const bT = new Date(b.validatedAt).getTime();
  return bT - aT;
}
