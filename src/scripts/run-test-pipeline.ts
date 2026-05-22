/* eslint-disable no-console */
import { v4 as uuidv4 } from 'uuid';
import { getSupabase } from '@/clients/supabaseClient';
import { logger } from '@/utils/logger';
import { env } from '@/config/env';

import { EbayKeywordDiscoveryAgent } from '@/agents/discovery/EbayKeywordDiscoveryAgent';
import { BasicAmazonAsinResolverAgent } from '@/agents/asin/BasicAmazonAsinResolverAgent';
import { AmazonSourceValidationAgent } from '@/agents/amazon/AmazonSourceValidationAgent';
import { EbayDemandScoringAgent } from '@/agents/ebay/EbayDemandScoringAgent';
import { ComplianceRiskCouncil } from '@/agents/compliance/ComplianceRiskCouncil';
import { CostCalculationAgent } from '@/agents/cost/CostCalculationAgent';
import { FinalValidationAgent } from '@/agents/validation/FinalValidationAgent';
import { CsvExportAgent } from '@/agents/export/CsvExportAgent';

import type { ValidatedProduct } from '@/types/product';

const SEED_KEYWORDS = [
  'under sink organizer',
  'garage storage rack',
  'desk cable organizer',
  'garden kneeling pad',
  'craft storage box',
];

const log = logger.child('run-test-pipeline');

async function main(): Promise<void> {
  if (!env.ebay.clientId && !env.runtime.mockMode) {
    log.warn('No eBay credentials and OTTO_MOCK_MODE=false. Enabling mock mode for this run.');
    process.env.OTTO_MOCK_MODE = 'true';
  }

  const supabase = getSupabase();
  const runId = uuidv4();
  try {
    await supabase.from('discovery_runs').insert({
      id: runId,
      status: 'running',
      seed_keywords: SEED_KEYWORDS,
      notes: 'Test pipeline run from run-test-pipeline.ts',
    });
  } catch (err) {
    log.warn('discovery_runs insert failed', { err: (err as Error).message });
  }
  log.info('Started discovery run', { runId });

  const stats = {
    rawCandidates: 0,
    asinResolved: 0,
    amazonValid: 0,
    demandValid: 0,
    complianceValid: 0,
    finalValidated: 0,
    csvPath: '' as string,
  };

  // 1. Discovery
  const discoveryAgent = new EbayKeywordDiscoveryAgent();
  const { candidates } = await discoveryAgent.run({
    discoveryRunId: runId,
    keywords: SEED_KEYWORDS,
    limitPerKeyword: 5,
  });
  stats.rawCandidates = candidates.length;
  log.info('Discovery complete', { count: candidates.length });

  // Agents
  const asinAgent = new BasicAmazonAsinResolverAgent();
  const amazonAgent = new AmazonSourceValidationAgent();
  const demandAgent = new EbayDemandScoringAgent();
  const complianceAgent = new ComplianceRiskCouncil();
  const costAgent = new CostCalculationAgent();
  const finalAgent = new FinalValidationAgent();

  const validated: ValidatedProduct[] = [];

  for (const candidate of candidates) {
    // 2. ASIN
    const asinResult = await asinAgent.run({ candidate, runId });
    if (asinResult.status === 'fail' || !asinResult.data.asin) continue;
    stats.asinResolved++;

    // 3. Amazon source validation
    const amazonResult = await amazonAgent.run({
      ottoProductId: candidate.ottoProductId,
      asin: asinResult.data.asin,
      amazonUrl: asinResult.data.amazonUrl,
      runId,
    });
    if (amazonResult.status !== 'pass') continue;
    stats.amazonValid++;
    const amazonData = amazonResult.data;
    const amazonPrice = amazonData.price ?? asinResult.data.price ?? candidate.priceHint ?? 0;

    // 4. Demand
    const demandResult = await demandAgent.run({
      ottoProductId: candidate.ottoProductId,
      asin: asinResult.data.asin,
      amazonUrl: asinResult.data.amazonUrl,
      keyword: candidate.keyword,
      productTitle: amazonData.productTitle ?? candidate.productTitleRaw,
      amazonBrand: amazonData.brand ?? candidate.brandHint,
      amazonCategoryBreadcrumbs: amazonData.categoryBreadcrumbs,
      amazonPrice,
      sourceConfidenceScore: asinResult.score,
      sourceValidityScore: amazonData.sourceValidityScore,
      runId,
    });
    const demand = demandResult.data;
    if (demand.sellWithin30DaysConfidence >= 70 && demand.stagnationRiskScore <= 40) {
      stats.demandValid++;
    }

    // 5. Compliance
    const complianceResult = await complianceAgent.run({
      ctx: {
        ottoProductId: candidate.ottoProductId,
        title: amazonData.productTitle ?? candidate.productTitleRaw,
        brand: amazonData.brand ?? candidate.brandHint,
        amazonCategory: amazonData.categoryBreadcrumbs.join(' > ') || undefined,
        amazonCategoryBreadcrumbs: amazonData.categoryBreadcrumbs,
        bullets: amazonData.productBullets,
        descriptionSnippet: amazonData.snapshot?.productDescriptionSnippet,
        ebayCategoryHint: candidate.categoryHint,
        comparableTitles: demandResult.data.comparableSamples.map((c) => c.title),
        coreKeyword: candidate.keyword,
      },
      amazonUrl: asinResult.data.amazonUrl,
      asin: asinResult.data.asin,
      runId,
    });
    if (!complianceResult.data.compliancePassed) continue;
    stats.complianceValid++;

    // 6. Cost
    const costResult = await costAgent.run({
      ottoProductId: candidate.ottoProductId,
      amazonPrice,
      runId,
    });

    // 7. Final
    const finalResult = await finalAgent.run({
      ottoProductId: candidate.ottoProductId,
      asin: asinResult.data.asin,
      amazonUrl: asinResult.data.amazonUrl,
      amazon: amazonResult.data,
      demand: demandResult.data,
      compliance: complianceResult.data,
      runId,
    });
    if (!finalResult.data.passed) continue;
    stats.finalValidated++;

    const product: ValidatedProduct = {
      ottoProductId: candidate.ottoProductId,
      asin: asinResult.data.asin,
      amazonUrl: asinResult.data.amazonUrl ?? `https://www.amazon.com/dp/${asinResult.data.asin}`,
      productTitle: amazonData.productTitle ?? candidate.productTitleRaw,
      brand: amazonData.brand,
      amazonCategory: amazonData.categoryBreadcrumbs.join(' > ') || undefined,
      amazonPrice,
      couponDetected: amazonData.couponDetected,
      deliveryDays: amazonData.estimatedDeliveryDays,
      stockStatus: amazonData.stockStatus,
      rating: amazonData.rating,
      reviewCount: amazonData.reviewCount,
      sourceConfidenceScore: asinResult.score,
      productMatchType: asinResult.score >= 80 ? 'exact' : 'similar',
      opportunityType: 'direct_match',
      marketplaceSignalSources: ['ebay_browse_api'],
      primaryDiscoverySource: candidate.source,
      secondaryDiscoverySources: [],
      coreKeyword: candidate.keyword,
      relatedKeywords: [],
      ebayCategoryHint: candidate.categoryHint,
      demandType: demand.demandType,
      sellWithin30DaysConfidence: demand.sellWithin30DaysConfidence,
      stagnationRiskScore: demand.stagnationRiskScore,
      demandScore: demand.demandScore,
      categoryVelocityScore: demand.categoryVelocityScore,
      keywordDemandScore: demand.keywordDemandScore,
      competitorSuccessScore: demand.competitorSuccessScore,
      saturationScore: demand.saturationScore,
      trendMomentumScore: demand.trendMomentumScore,
      policyRiskScore: complianceResult.data.policyRiskScore,
      veroRiskScore: complianceResult.data.veroRiskScore,
      restrictedCategoryRiskScore: complianceResult.data.restrictedCategoryRiskScore,
      ipRiskScore: complianceResult.data.ipRiskScore,
      edgeCaseRiskScore: complianceResult.data.edgeCaseRiskScore,
      fragilityScore: complianceResult.data.fragilityScore,
      variationConfusionScore: complianceResult.data.variationConfusionScore,
      totalCostEstimate: costResult.data.totalCostEstimate,
      predictedMonthlyProfitPer100Listings: 0,
      finalValidationScore: finalResult.data.finalValidationScore,
      validationStatus: 'validated',
      validatedAt: new Date().toISOString(),
    };

    validated.push(product);

    try {
      await supabase.from('validated_products').upsert(
        {
          otto_product_id: product.ottoProductId,
          asin: product.asin,
          amazon_url: product.amazonUrl,
          product_title: product.productTitle,
          brand: product.brand,
          amazon_category: product.amazonCategory,
          variation_attributes: product.variationAttributes ?? {},
          amazon_price: product.amazonPrice,
          coupon_detected: product.couponDetected,
          delivery_days: product.deliveryDays,
          stock_status: product.stockStatus,
          rating: product.rating,
          review_count: product.reviewCount,
          source_confidence_score: product.sourceConfidenceScore,
          product_match_type: product.productMatchType,
          opportunity_type: product.opportunityType,
          marketplace_signal_sources: product.marketplaceSignalSources,
          primary_discovery_source: product.primaryDiscoverySource,
          secondary_discovery_sources: product.secondaryDiscoverySources,
          core_keyword: product.coreKeyword,
          related_keywords: product.relatedKeywords,
          ebay_category_hint: product.ebayCategoryHint,
          demand_type: product.demandType,
          sell_within_30_days_confidence: product.sellWithin30DaysConfidence,
          stagnation_risk_score: product.stagnationRiskScore,
          demand_score: product.demandScore,
          category_velocity_score: product.categoryVelocityScore,
          keyword_demand_score: product.keywordDemandScore,
          competitor_success_score: product.competitorSuccessScore,
          saturation_score: product.saturationScore,
          trend_momentum_score: product.trendMomentumScore,
          policy_risk_score: product.policyRiskScore,
          vero_risk_score: product.veroRiskScore,
          restricted_category_risk_score: product.restrictedCategoryRiskScore,
          ip_risk_score: product.ipRiskScore,
          edge_case_risk_score: product.edgeCaseRiskScore,
          fragility_score: product.fragilityScore,
          variation_confusion_score: product.variationConfusionScore,
          total_cost_estimate: product.totalCostEstimate,
          predicted_monthly_profit_per_100_listings: product.predictedMonthlyProfitPer100Listings,
          final_validation_score: product.finalValidationScore,
          validation_status: product.validationStatus,
          validated_at: product.validatedAt,
        },
        { onConflict: 'otto_product_id' } as never,
      );
    } catch (err) {
      log.warn('validated_products upsert failed', { err: (err as Error).message });
    }
  }

  // 8. Export
  const exporter = new CsvExportAgent();
  const exportResult = await exporter.run({ products: validated, discoveryRunId: runId });
  stats.csvPath = exportResult.data.filePath;

  try {
    await supabase.from('discovery_runs').update({
      status: 'completed',
      finished_at: new Date().toISOString(),
      stats,
    }).eq('id', runId);
  } catch (err) {
    log.warn('discovery_runs update failed', { err: (err as Error).message });
  }

  console.log('\n========== OTTO TEST PIPELINE SUMMARY ==========');
  console.log(`  raw candidates    : ${stats.rawCandidates}`);
  console.log(`  ASIN resolved     : ${stats.asinResolved}`);
  console.log(`  Amazon valid      : ${stats.amazonValid}`);
  console.log(`  demand valid      : ${stats.demandValid}`);
  console.log(`  compliance valid  : ${stats.complianceValid}`);
  console.log(`  final validated   : ${stats.finalValidated}`);
  console.log(`  CSV path          : ${stats.csvPath}`);
  console.log('================================================\n');
}

main().catch((err) => {
  logger.error('Pipeline failed', { err: (err as Error).message, stack: (err as Error).stack });
  process.exit(1);
});
