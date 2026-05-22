/* eslint-disable no-console */
/**
 * run-real-qa.ts
 *
 * First-real-output QA batch.  Runs the full real eBay -> Amazon -> demand
 * -> compliance -> cost -> final -> CSV chain end-to-end with a safe
 * default ceiling and emits both the canonical export CSV and a manual
 * QA review CSV with reviewer columns.
 *
 * Usage:
 *   npm run run:real-qa
 *   npm run run:real-qa -- --limit=10
 *   npm run run:real-qa -- --keywords="under sink organizer,garage storage rack"
 *
 * Required env:
 *   EBAY_CLIENT_ID + EBAY_CLIENT_SECRET (or EBAY_OAUTH_TOKEN)
 *   `npx playwright install chromium` once
 */

process.env.OTTO_REAL_EBAY_DISCOVERY = process.env.OTTO_REAL_EBAY_DISCOVERY ?? 'true';
process.env.OTTO_MOCK_MODE = 'false';

import { v4 as uuidv4 } from 'uuid';
import { getSupabase } from '@/clients/supabaseClient';
import { getAmazonBrowserClient } from '@/clients/amazonBrowserClient';
import { logger } from '@/utils/logger';
import { env } from '@/config/env';
import { writeCsv } from '@/utils/csv';
import { RejectionReason } from '@/utils/rejectionReasons';

import { EbayKeywordDiscoveryAgent } from '@/agents/discovery/EbayKeywordDiscoveryAgent';
import { BasicAmazonAsinResolverAgent } from '@/agents/asin/BasicAmazonAsinResolverAgent';
import { AmazonSourceValidationAgent } from '@/agents/amazon/AmazonSourceValidationAgent';
import { EbayDemandScoringAgent } from '@/agents/ebay/EbayDemandScoringAgent';
import { ComplianceRiskCouncil } from '@/agents/compliance/ComplianceRiskCouncil';
import { CostCalculationAgent } from '@/agents/cost/CostCalculationAgent';
import { FinalValidationAgent } from '@/agents/validation/FinalValidationAgent';
import { CsvExportAgent } from '@/agents/export/CsvExportAgent';

import type { ValidatedProduct } from '@/types/product';

const DEFAULT_KEYWORDS = [
  'under sink organizer',
  'garage storage rack',
  'desk cable organizer',
  'garden kneeling pad',
  'craft storage box',
];

const DEFAULT_LIMIT = 25;
const SAFE_LIMIT_MAX = 100;

const log = logger.child('run-real-qa');

interface PipelineStats {
  rawCandidates: number;
  asinResolved: number;
  asinFailed: number;
  amazonSourceValid: number;
  amazonSourceFailed: number;
  demandPassed: number;
  demandFailed: number;
  compliancePassed: number;
  complianceFailed: number;
  costCalculated: number;
  finalValidated: number;
  finalRejected: number;
  exportedCount: number;
  rejectionCounts: Record<string, number>;
}

interface TopProductRow {
  asin: string;
  amazonUrl: string;
  productTitle: string;
  brand?: string;
  amazonPrice: number;
  deliveryDays?: number;
  sellWithin30DaysConfidence: number;
  stagnationRiskScore: number;
  policyRiskScore: number;
  finalValidationScore: number;
}

async function main(): Promise<void> {
  const args = parseArgs();
  if (!env.ebay.clientId && !env.ebay.oauthToken) {
    log.error('Missing eBay credentials. Set EBAY_CLIENT_ID + EBAY_CLIENT_SECRET (or EBAY_OAUTH_TOKEN) in .env.');
    process.exit(2);
  }

  const supabase = getSupabase();
  const runId = uuidv4();
  try {
    await supabase.from('discovery_runs').insert({
      id: runId,
      status: 'running',
      seed_keywords: args.keywords,
      notes: `Real QA batch (limit=${args.limit})`,
    });
  } catch (err) {
    log.warn('discovery_runs insert failed', { err: (err as Error).message });
  }
  log.info('Starting real QA batch', { runId, keywords: args.keywords, limit: args.limit });

  const stats: PipelineStats = {
    rawCandidates: 0,
    asinResolved: 0,
    asinFailed: 0,
    amazonSourceValid: 0,
    amazonSourceFailed: 0,
    demandPassed: 0,
    demandFailed: 0,
    compliancePassed: 0,
    complianceFailed: 0,
    costCalculated: 0,
    finalValidated: 0,
    finalRejected: 0,
    exportedCount: 0,
    rejectionCounts: {},
  };

  const bump = (code: string | undefined) => {
    const c = code ?? 'UNSPECIFIED';
    stats.rejectionCounts[c] = (stats.rejectionCounts[c] ?? 0) + 1;
  };

  const discoveryAgent = new EbayKeywordDiscoveryAgent();
  const asinAgent = new BasicAmazonAsinResolverAgent();
  const amazonAgent = new AmazonSourceValidationAgent();
  const demandAgent = new EbayDemandScoringAgent();
  const complianceAgent = new ComplianceRiskCouncil();
  const costAgent = new CostCalculationAgent();
  const finalAgent = new FinalValidationAgent();

  // 1. Discovery
  const discovery = await discoveryAgent.run({
    discoveryRunId: runId,
    keywords: args.keywords,
    limitPerKeyword: args.limit,
  });
  stats.rawCandidates = discovery.candidates.length;
  for (const k of discovery.perKeyword) {
    if (k.apiError) bump(RejectionReason.EBAY_API_ERROR);
    if (!k.apiError && k.fetched === 0) bump(RejectionReason.NO_CANDIDATES_FOUND);
  }
  log.info('Discovery complete', { rawCandidates: stats.rawCandidates });

  const amazonClient = getAmazonBrowserClient();
  if (!amazonClient.isImplemented) {
    log.warn('Amazon browser client is a placeholder; ASIN / source validation will degrade to placeholder rejections.');
  }

  const validated: ValidatedProduct[] = [];

  for (const candidate of discovery.candidates) {
    // 2. ASIN
    const asinResult = await asinAgent.run({ candidate, runId });
    if (asinResult.status !== 'pass' || !asinResult.data.asin) {
      stats.asinFailed++;
      bump(asinResult.data.rejectionReason ?? asinResult.reasons[0]);
      continue;
    }
    stats.asinResolved++;

    // 3. Amazon source
    const amazonResult = await amazonAgent.run({
      ottoProductId: candidate.ottoProductId,
      asin: asinResult.data.asin,
      amazonUrl: asinResult.data.amazonUrl,
      runId,
    });
    if (amazonResult.status !== 'pass') {
      stats.amazonSourceFailed++;
      bump(amazonResult.data.rejectionReason ?? amazonResult.data.reasons[0]);
      continue;
    }
    stats.amazonSourceValid++;
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
    if (!demandResult.data.demandPassed) {
      stats.demandFailed++;
      bump(demandResult.data.rejectionReason);
      continue;
    }
    stats.demandPassed++;

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
    if (!complianceResult.data.compliancePassed) {
      stats.complianceFailed++;
      bump(
        complianceResult.data.hardBlock
          ? RejectionReason.COMPLIANCE_HARD_BLOCK
          : complianceResult.data.manualReview
            ? RejectionReason.MANUAL_REVIEW_REQUIRED
            : RejectionReason.POLICY_RISK_TOO_HIGH,
      );
      continue;
    }
    stats.compliancePassed++;

    // 6. Cost
    const costResult = await costAgent.run({
      ottoProductId: candidate.ottoProductId,
      amazonPrice,
      runId,
    });
    stats.costCalculated++;

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
    if (!finalResult.data.passed) {
      stats.finalRejected++;
      bump(finalResult.data.rejectionReason);
      continue;
    }
    stats.finalValidated++;

    validated.push({
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
      demandType: demandResult.data.demandType,
      sellWithin30DaysConfidence: demandResult.data.sellWithin30DaysConfidence,
      stagnationRiskScore: demandResult.data.stagnationRiskScore,
      demandScore: demandResult.data.demandScore,
      categoryVelocityScore: demandResult.data.categoryVelocityScore,
      keywordDemandScore: demandResult.data.keywordDemandScore,
      competitorSuccessScore: demandResult.data.competitorSuccessScore,
      saturationScore: demandResult.data.saturationScore,
      trendMomentumScore: demandResult.data.trendMomentumScore,
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
    });
  }

  // 8. Main CSV export
  const exporter = new CsvExportAgent();
  const exportResult = await exporter.run({ products: validated, discoveryRunId: runId });
  stats.exportedCount = exportResult.data.rowCount;

  // 9. Manual QA review CSV
  const qaPath = writeManualQaCsv(validated);

  try {
    await supabase.from('discovery_runs').update({
      status: 'completed',
      finished_at: new Date().toISOString(),
      stats: stats as unknown as Record<string, unknown>,
    }).eq('id', runId);
  } catch (err) {
    log.warn('discovery_runs update failed', { err: (err as Error).message });
  }

  printSummary({
    runId,
    exportBatchId: exportResult.data.exportBatchId,
    csvPath: exportResult.data.filePath,
    qaPath,
    stats,
    validated,
  });
}

function parseArgs(): { keywords: string[]; limit: number } {
  const args = process.argv.slice(2);
  let keywords = DEFAULT_KEYWORDS;
  let limit = DEFAULT_LIMIT;
  for (const a of args) {
    if (a.startsWith('--limit=')) {
      const n = Number(a.split('=')[1]);
      if (Number.isFinite(n) && n > 0) limit = Math.min(n, SAFE_LIMIT_MAX);
    } else if (a.startsWith('--keywords=')) {
      const raw = a.substring('--keywords='.length).trim().replace(/^"|"$/g, '');
      const parts = raw.split(',').map((k) => k.trim()).filter(Boolean);
      if (parts.length > 0) keywords = parts;
    }
  }
  return { keywords, limit };
}

function writeManualQaCsv(products: ValidatedProduct[]): string {
  const columns = [
    'otto_product_id',
    'asin',
    'amazon_url',
    'product_title',
    'brand',
    'amazon_price',
    'delivery_days',
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
  const rows = products.map((p) => ({
    otto_product_id: p.ottoProductId,
    asin: p.asin,
    amazon_url: p.amazonUrl,
    product_title: p.productTitle,
    brand: p.brand,
    amazon_price: p.amazonPrice,
    delivery_days: p.deliveryDays,
    sell_within_30_days_confidence: p.sellWithin30DaysConfidence,
    stagnation_risk_score: p.stagnationRiskScore,
    policy_risk_score: p.policyRiskScore,
    final_validation_score: p.finalValidationScore,
    would_list_yes_no: '',
    asin_real_yes_no: '',
    demand_makes_sense_yes_no: '',
    low_risk_yes_no: '',
    notes: '',
  }));
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `otto_manual_qa_review_${stamp}.csv`;
  const out = writeCsv(env.exportDir, filename, columns, rows);
  return out.filePath;
}

function printSummary(args: {
  runId: string;
  exportBatchId: string;
  csvPath: string;
  qaPath: string;
  stats: PipelineStats;
  validated: ValidatedProduct[];
}): void {
  const { stats, validated } = args;
  const passRate = stats.rawCandidates > 0
    ? ((stats.finalValidated / stats.rawCandidates) * 100).toFixed(1)
    : '0';

  console.log('\n========== OTTO REAL QA BATCH SUMMARY ==========');
  console.log(`  discovery_run_id     : ${args.runId}`);
  console.log(`  export_batch_id      : ${args.exportBatchId}`);
  console.log('  ----- stage counts -----');
  console.log(`  raw candidates       : ${stats.rawCandidates}`);
  console.log(`  asin resolved        : ${stats.asinResolved}`);
  console.log(`  asin failed          : ${stats.asinFailed}`);
  console.log(`  amazon source valid  : ${stats.amazonSourceValid}`);
  console.log(`  amazon source failed : ${stats.amazonSourceFailed}`);
  console.log(`  demand passed        : ${stats.demandPassed}`);
  console.log(`  demand failed        : ${stats.demandFailed}`);
  console.log(`  compliance passed    : ${stats.compliancePassed}`);
  console.log(`  compliance failed    : ${stats.complianceFailed}`);
  console.log(`  cost calculated      : ${stats.costCalculated}`);
  console.log(`  final validated      : ${stats.finalValidated}`);
  console.log(`  final rejected       : ${stats.finalRejected}`);
  console.log(`  exported count       : ${stats.exportedCount}`);
  console.log(`  end-to-end pass rate : ${passRate}%`);
  console.log(`  CSV path             : ${args.csvPath}`);
  console.log(`  manual QA CSV path   : ${args.qaPath}`);

  const codes = Object.entries(stats.rejectionCounts).sort((a, b) => b[1] - a[1]);
  if (codes.length > 0) {
    console.log('  ----- rejection breakdown -----');
    for (const [code, n] of codes) {
      console.log(`    ${code.padEnd(42)} ${n}`);
    }
  }

  if (validated.length > 0) {
    const top: TopProductRow[] = validated
      .slice()
      .sort((a, b) => b.finalValidationScore - a.finalValidationScore)
      .slice(0, 10)
      .map((p) => ({
        asin: p.asin,
        amazonUrl: p.amazonUrl,
        productTitle: p.productTitle,
        brand: p.brand,
        amazonPrice: p.amazonPrice,
        deliveryDays: p.deliveryDays,
        sellWithin30DaysConfidence: p.sellWithin30DaysConfidence,
        stagnationRiskScore: p.stagnationRiskScore,
        policyRiskScore: p.policyRiskScore,
        finalValidationScore: p.finalValidationScore,
      }));
    console.log('  ----- top passing products (sorted by final_validation_score) -----');
    for (const p of top) {
      console.log(`    [${p.asin}] ${p.productTitle.slice(0, 70)}`);
      console.log(`      url=${p.amazonUrl}`);
      console.log(
        `      brand=${p.brand ?? '(none)'}  price=$${p.amazonPrice.toFixed(2)}  delivery=${p.deliveryDays ?? '?'}d  ` +
          `30d_conf=${p.sellWithin30DaysConfidence.toFixed(0)}  stag=${p.stagnationRiskScore.toFixed(0)}  ` +
          `policy_risk=${p.policyRiskScore.toFixed(0)}  final=${p.finalValidationScore.toFixed(0)}`,
      );
    }
  }
  console.log('================================================\n');
}

main().catch((err) => {
  logger.error('run-real-qa failed', { err: (err as Error).message, stack: (err as Error).stack });
  process.exit(1);
});
