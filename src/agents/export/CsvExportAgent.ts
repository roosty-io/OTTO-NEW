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
  'total_cost_estimate',
  'predicted_monthly_profit_per_100_listings',
  'final_validation_score',
  'validation_status',
  'validated_at',
];

export interface CsvExportInput {
  products: ValidatedProduct[];
  discoveryRunId?: string;
}

export interface CsvExportData {
  filePath: string;
  rowCount: number;
  exportBatchId: string;
}

export class CsvExportAgent {
  readonly name = 'CsvExportAgent';
  private readonly log = logger.child(this.name);

  async run(input: CsvExportInput): Promise<AgentResult<CsvExportData>> {
    const supabase = getSupabase();
    const exportBatchId = uuidv4();
    const filename = `otto-validated-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;

    const rows = input.products.map((p) => ({
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
      total_cost_estimate: p.totalCostEstimate,
      predicted_monthly_profit_per_100_listings: p.predictedMonthlyProfitPer100Listings,
      final_validation_score: p.finalValidationScore,
      validation_status: p.validationStatus,
      validated_at: p.validatedAt,
    }));

    const { filePath, rowCount } = writeCsv(env.exportDir, filename, EXPORT_COLUMNS, rows);

    try {
      await supabase.from('export_batches').insert({
        id: exportBatchId,
        discovery_run_id: input.discoveryRunId ?? null,
        file_path: filePath,
        row_count: rowCount,
        status: 'completed',
      });
    } catch (err) {
      this.log.warn('export_batches insert failed', { err: (err as Error).message });
    }

    await persistAgentLog({
      agentName: this.name,
      runId: input.discoveryRunId,
      level: 'info',
      message: 'CSV export complete',
      data: { filePath, rowCount, exportBatchId },
    });

    const data: CsvExportData = { filePath, rowCount, exportBatchId };
    const result = makeResult(this.name, 'EXPORT', 'pass', rowCount, [`Wrote ${rowCount} rows`], data);
    await persistAgentResult(result, input.discoveryRunId);
    return result;
  }
}
