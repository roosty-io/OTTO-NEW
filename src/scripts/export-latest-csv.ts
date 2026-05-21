/* eslint-disable no-console */
import { getSupabase } from '@/clients/supabaseClient';
import { logger } from '@/utils/logger';
import { CsvExportAgent } from '@/agents/export/CsvExportAgent';
import type { ValidatedProduct } from '@/types/product';

const log = logger.child('export-latest-csv');

async function main(): Promise<void> {
  const supabase = getSupabase();
  const query = supabase.from('validated_products').select('*') as unknown as {
    order: (col: string, opts: { ascending: boolean }) => {
      limit: (n: number) => Promise<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>;
    };
  };
  const { data, error } = await query.order('validated_at', { ascending: false }).limit(5000);
  if (error) {
    log.error('Failed to fetch validated_products', { err: error.message });
    process.exit(1);
  }
  const rows = (data ?? []) as Record<string, unknown>[];
  const products: ValidatedProduct[] = rows.map(rowToProduct);
  const exporter = new CsvExportAgent();
  const out = await exporter.run({ products });
  console.log(`Exported ${out.data.rowCount} rows -> ${out.data.filePath}`);
}

function rowToProduct(r: Record<string, unknown>): ValidatedProduct {
  return {
    ottoProductId: String(r.otto_product_id ?? ''),
    asin: String(r.asin ?? ''),
    parentAsin: (r.parent_asin as string) ?? undefined,
    childAsin: (r.child_asin as string) ?? undefined,
    amazonUrl: String(r.amazon_url ?? ''),
    productTitle: String(r.product_title ?? ''),
    brand: (r.brand as string) ?? undefined,
    amazonCategory: (r.amazon_category as string) ?? undefined,
    variationAttributes: (r.variation_attributes as Record<string, string>) ?? undefined,
    amazonPrice: Number(r.amazon_price ?? 0),
    couponDetected: Boolean(r.coupon_detected ?? false),
    deliveryDays: (r.delivery_days as number) ?? undefined,
    stockStatus: (r.stock_status as ValidatedProduct['stockStatus']) ?? 'unknown',
    rating: (r.rating as number) ?? undefined,
    reviewCount: (r.review_count as number) ?? undefined,
    sourceConfidenceScore: Number(r.source_confidence_score ?? 0),
    productMatchType: (r.product_match_type as ValidatedProduct['productMatchType']) ?? 'unknown',
    opportunityType: (r.opportunity_type as ValidatedProduct['opportunityType']) ?? 'unknown',
    marketplaceSignalSources: (r.marketplace_signal_sources as string[]) ?? [],
    primaryDiscoverySource: (r.primary_discovery_source as string) ?? '',
    secondaryDiscoverySources: (r.secondary_discovery_sources as string[]) ?? [],
    coreKeyword: (r.core_keyword as string) ?? '',
    relatedKeywords: (r.related_keywords as string[]) ?? [],
    ebayCategoryHint: (r.ebay_category_hint as string) ?? undefined,
    demandType: (r.demand_type as ValidatedProduct['demandType']) ?? 'unknown',
    sellWithin30DaysConfidence: Number(r.sell_within_30_days_confidence ?? 0),
    stagnationRiskScore: Number(r.stagnation_risk_score ?? 0),
    demandScore: Number(r.demand_score ?? 0),
    categoryVelocityScore: Number(r.category_velocity_score ?? 0),
    keywordDemandScore: Number(r.keyword_demand_score ?? 0),
    competitorSuccessScore: Number(r.competitor_success_score ?? 0),
    saturationScore: Number(r.saturation_score ?? 0),
    trendMomentumScore: Number(r.trend_momentum_score ?? 0),
    policyRiskScore: Number(r.policy_risk_score ?? 0),
    veroRiskScore: Number(r.vero_risk_score ?? 0),
    restrictedCategoryRiskScore: Number(r.restricted_category_risk_score ?? 0),
    ipRiskScore: Number(r.ip_risk_score ?? 0),
    edgeCaseRiskScore: Number(r.edge_case_risk_score ?? 0),
    fragilityScore: Number(r.fragility_score ?? 0),
    variationConfusionScore: Number(r.variation_confusion_score ?? 0),
    totalCostEstimate: Number(r.total_cost_estimate ?? 0),
    predictedMonthlyProfitPer100Listings: Number(r.predicted_monthly_profit_per_100_listings ?? 0),
    finalValidationScore: Number(r.final_validation_score ?? 0),
    validationStatus: (r.validation_status as ValidatedProduct['validationStatus']) ?? 'validated',
    validatedAt: String(r.validated_at ?? new Date().toISOString()),
  };
}

main().catch((err) => {
  logger.error('Export failed', { err: (err as Error).message });
  process.exit(1);
});
