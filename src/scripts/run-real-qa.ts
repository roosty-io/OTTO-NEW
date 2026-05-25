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

import * as fs from 'fs';
import * as path from 'path';
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
import { CsvExportAgent, dedupeByAsin } from '@/agents/export/CsvExportAgent';

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
  finalValidatedBeforeDedupe: number;
  duplicateAsinsRemoved: number;
  finalExportedAfterDedupe: number;
  exportedCount: number;
  rejectionCounts: Record<string, number>;
  // Shipping gate breakdown (over Amazon-source-checked products)
  shippingPass: number;
  shippingPrimeLikelyPass: number;
  shippingReviewRequired: number;
  shippingRejectTooLong: number;
  shippingRejectUnclear: number;
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
  const reportTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const commandRun = `npm run run:real-qa -- --limit=${args.limit} --keywords="${args.keywords.join(',')}"`;

  const envProblems = validateEnvForRealQa();
  if (envProblems.length > 0) {
    for (const p of envProblems) log.error(p);
    writeFailureReport({
      timestamp: reportTimestamp,
      commandRun,
      failedStage: 'env_check',
      errorMessage: envProblems.join(' | '),
      likelyCause: 'Missing required environment variables.',
      classification: classifyEnvProblems(envProblems),
      recommendedFix: 'Add the missing variables to .env and re-run `npm run check:env`.',
      nextCommand: 'npm run check:env',
    });
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
    finalValidatedBeforeDedupe: 0,
    duplicateAsinsRemoved: 0,
    finalExportedAfterDedupe: 0,
    exportedCount: 0,
    rejectionCounts: {},
    shippingPass: 0,
    shippingPrimeLikelyPass: 0,
    shippingReviewRequired: 0,
    shippingRejectTooLong: 0,
    shippingRejectUnclear: 0,
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
    const rej = amazonResult.data.rejectionReason;
    if (rej === RejectionReason.DELIVERY_TOO_LONG) stats.shippingRejectTooLong++;
    if (rej === RejectionReason.DELIVERY_UNCLEAR) stats.shippingRejectUnclear++;
    if (amazonResult.status !== 'pass') {
      stats.amazonSourceFailed++;
      bump(amazonResult.data.rejectionReason ?? amazonResult.data.reasons[0]);
      continue;
    }
    stats.amazonSourceValid++;
    const amazonData = amazonResult.data;
    if (amazonData.shippingGateResult === 'pass') stats.shippingPass++;
    if (amazonData.shippingGateResult === 'prime_likely_pass') stats.shippingPrimeLikelyPass++;
    if (amazonData.shippingReviewRequired) stats.shippingReviewRequired++;
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
      rawDeliveryText: amazonData.rawDeliveryText,
      deliveryContext: amazonData.deliveryContext,
      primeSignalDetected: amazonData.primeSignalDetected,
      primeSignalSource: amazonData.primeSignalSource,
      fbaSignalDetected: amazonData.fbaSignalDetected,
      shipsFromAmazon: amazonData.shipsFromAmazon,
      soldByAmazon: amazonData.soldByAmazon,
      fulfilledByAmazon: amazonData.fulfilledByAmazon,
      shippingGateResult: amazonData.shippingGateResult,
      shippingReviewRequired: amazonData.shippingReviewRequired,
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

  // 8. ASIN-level dedupe (single source of truth for both CSVs)
  stats.finalValidatedBeforeDedupe = validated.length;
  const { keptProducts: dedupedProducts, removals } = dedupeByAsin(validated);
  stats.duplicateAsinsRemoved = removals.length;
  stats.finalExportedAfterDedupe = dedupedProducts.length;
  if (removals.length > 0) {
    log.info('Removed duplicate ASIN rows', {
      duplicateAsinsRemoved: removals.length,
      asins: removals.map((r) => r.asin),
    });
  }

  // 9. Main CSV export (the agent re-dedupes defensively but will be a no-op).
  const exporter = new CsvExportAgent();
  const exportResult = await exporter.run({ products: dedupedProducts, discoveryRunId: runId });
  stats.exportedCount = exportResult.data.rowCount;

  // 10. Manual QA review CSV - also written from the deduped set.
  const qaPath = writeManualQaCsv(dedupedProducts);

  try {
    await supabase.from('discovery_runs').update({
      status: 'completed',
      finished_at: new Date().toISOString(),
      stats: stats as unknown as Record<string, unknown>,
    }).eq('id', runId);
  } catch (err) {
    log.warn('discovery_runs update failed', { err: (err as Error).message });
  }

  const summaryArgs = {
    runId,
    exportBatchId: exportResult.data.exportBatchId,
    csvPath: exportResult.data.filePath,
    qaPath,
    stats,
    // Use the deduped set so the "top passing products" panel and the
    // Markdown report match the rows actually written to the CSV.
    validated: dedupedProducts,
  };
  printSummary(summaryArgs);
  const nextAction = summarizeNextAction(stats);
  console.log(`  next action: ${nextAction}\n`);
  const reportPath = writeReport({
    timestamp: reportTimestamp,
    commandRun,
    nextAction,
    ...summaryArgs,
  });
  console.log(`  QA report written: ${reportPath}\n`);

  // Tear down Playwright so the Node process can exit cleanly.
  try {
    await amazonClient.close();
  } catch (err) {
    log.warn('amazon browser close failed', { err: (err as Error).message });
  }
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
  console.log(`  ----- export dedupe -----`);
  console.log(`  validated before dedupe : ${stats.finalValidatedBeforeDedupe}`);
  console.log(`  duplicate ASINs removed : ${stats.duplicateAsinsRemoved}`);
  console.log(`  exported after dedupe   : ${stats.finalExportedAfterDedupe}`);
  console.log(`  exported count       : ${stats.exportedCount}`);
  console.log(`  ----- shipping gate -----`);
  console.log(`  shipping pass        : ${stats.shippingPass}`);
  console.log(`  prime-likely pass    : ${stats.shippingPrimeLikelyPass}`);
  console.log(`  shipping review req  : ${stats.shippingReviewRequired}`);
  console.log(`  rejected too long    : ${stats.shippingRejectTooLong}`);
  console.log(`  rejected unclear     : ${stats.shippingRejectUnclear}`);
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
  const e = err as Error;
  logger.error('run-real-qa failed', { err: e.message, stack: e.stack });
  const reportPath = writeFailureReport({
    timestamp: new Date().toISOString().replace(/[:.]/g, '-'),
    commandRun: `npm run run:real-qa -- ${process.argv.slice(2).join(' ')}`,
    failedStage: detectFailedStage(e.message, e.stack),
    errorMessage: e.message,
    likelyCause: likelyCauseFor(e.message, e.stack),
    classification: classifyError(e.message),
    recommendedFix: recommendedFixFor(e.message),
    nextCommand: 'npm run check:env',
  });
  console.error(`\nFailure report written: ${reportPath}`);
  process.exit(1);
});

// ---------------------------------------------------------------------------
// Env validation + friendly error messages
// ---------------------------------------------------------------------------

function validateEnvForRealQa(): string[] {
  const problems: string[] = [];
  if (!env.ebay.clientId && !env.ebay.oauthToken) {
    problems.push('Missing eBay credentials. Add EBAY_CLIENT_ID and EBAY_CLIENT_SECRET to .env.');
  } else if (!env.ebay.oauthToken && env.ebay.clientId && !env.ebay.clientSecret) {
    problems.push('Missing eBay credentials. Add EBAY_CLIENT_ID and EBAY_CLIENT_SECRET to .env.');
  }
  if (!env.supabase.url || !env.supabase.serviceRoleKey) {
    problems.push('Missing Supabase configuration. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to .env.');
  }
  if (env.runtime.mockMode) {
    problems.push('OTTO_MOCK_MODE must be false for real QA.');
  }
  if (!env.runtime.realEbayDiscovery) {
    // Not fatal - the script sets process.env.OTTO_REAL_EBAY_DISCOVERY = 'true'
    // at the top so this gets flipped on at runtime. Still warn if it was
    // misconfigured on disk so the user knows.
  }
  return problems;
}

function classifyEnvProblems(problems: string[]): FailureClassification {
  if (problems.some((p) => p.includes('eBay'))) return 'ebay_credentials';
  if (problems.some((p) => p.includes('Supabase'))) return 'supabase';
  return 'env';
}

type FailureClassification =
  | 'ebay_credentials'
  | 'supabase'
  | 'amazon_blocking'
  | 'playwright'
  | 'schema'
  | 'env'
  | 'code';

function detectFailedStage(message: string, stack: string | undefined): string {
  const m = (message ?? '').toLowerCase();
  const s = (stack ?? '').toLowerCase();
  if (m.includes('ebay') || s.includes('ebayclient')) return 'discovery (eBay Browse API)';
  if (m.includes('playwright') || m.includes('chromium') || s.includes('amazonbrowserclient')) return 'amazon resolver / source validation (Playwright)';
  if (m.includes('supabase') || m.includes('postgres') || m.includes('relation') || m.includes('column')) return 'persistence (Supabase / Postgres)';
  return 'unknown';
}

function likelyCauseFor(message: string, _stack: string | undefined): string {
  const m = (message ?? '').toLowerCase();
  if (m.includes('missing credentials') || m.includes('eauth')) return 'Missing or invalid eBay credentials.';
  if (m.includes('401') || m.includes('unauthorized')) return 'eBay or Supabase API returned 401 - credentials may be wrong or expired.';
  if (m.includes('429') || m.includes('rate limit')) return 'eBay API rate limit hit.';
  if (m.includes('captcha') || m.includes('robot')) return 'Amazon served a robot-check / captcha page.';
  if (m.includes('chromium') || m.includes('executable doesn')) return 'Playwright Chromium not installed.';
  if (m.includes('cert_authority') || m.includes('ssl') || m.includes('tls')) return 'TLS handshake failed (sandbox proxy / corporate MITM).';
  if (m.includes('column') || m.includes('relation') || m.includes('does not exist')) return 'Supabase schema not applied or out of date.';
  if (m.includes('econnrefused') || m.includes('econnreset') || m.includes('etimedout')) return 'Network error reaching upstream API.';
  return 'See errorMessage above; check the failing stage logs.';
}

function classifyError(message: string): FailureClassification {
  const m = (message ?? '').toLowerCase();
  if (m.includes('credentials') || m.includes('401') || m.includes('unauthorized')) return 'ebay_credentials';
  if (m.includes('captcha') || m.includes('robot') || m.includes('blocked')) return 'amazon_blocking';
  if (m.includes('chromium') || m.includes('playwright') || m.includes('browser')) return 'playwright';
  if (m.includes('supabase') || m.includes('postgres')) return 'supabase';
  if (m.includes('column') || m.includes('relation') || m.includes('does not exist')) return 'schema';
  return 'code';
}

function recommendedFixFor(message: string): string {
  const c = classifyError(message);
  switch (c) {
    case 'ebay_credentials':
      return 'Add or refresh EBAY_CLIENT_ID + EBAY_CLIENT_SECRET in .env, then re-run `npm run check:env`.';
    case 'amazon_blocking':
      return 'Amazon blocking - try a residential proxy via AMAZON_PROXY_SERVER, retry later, or set AMAZON_DEBUG=true for a non-headless inspection.';
    case 'playwright':
      return 'Install browsers with `npx playwright install chromium`, then re-run.';
    case 'supabase':
      return 'Verify SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env; ensure the project is reachable.';
    case 'schema':
      return 'Database schema appears missing. Run: psql "$DATABASE_URL" -f src/db/schema.sql and `npm run seed:rules`.';
    case 'env':
      return 'Add missing env vars to .env and re-run `npm run check:env`.';
    case 'code':
    default:
      return 'Capture the error stack from the log line above and bisect the most recently changed file.';
  }
}

// ---------------------------------------------------------------------------
// Next-best-action diagnostics
// ---------------------------------------------------------------------------

function summarizeNextAction(stats: PipelineStats): string {
  if (stats.rawCandidates === 0) {
    return 'eBay returned 0 candidates. Check EBAY_CLIENT_ID/SECRET, then run `npm run test:ebay-demand` to confirm the Browse API is reachable.';
  }
  if (stats.asinResolved === 0) {
    return 'No ASINs resolved. Run `npm run test:asin-resolver` to validate the Amazon resolver and check Playwright launch.';
  }
  if (stats.amazonSourceValid === 0) {
    return 'No products passed Amazon source validation. Run `npm run test:amazon-source` to inspect a known ASIN and check for delivery / stock / restriction signal noise.';
  }
  if (stats.demandPassed === 0) {
    return 'No products passed eBay demand. Run `npm run test:ebay-demand --from-db` to inspect comparable counts and price viability for source-valid candidates.';
  }
  if (stats.compliancePassed === 0) {
    return 'Every demand-valid product was rejected by compliance. Inspect the rejection-code breakdown above and run `npm run test:compliance` to verify the council against the canonical safe samples.';
  }
  if (stats.finalValidated === 0) {
    return 'Compliance passed but the final validation gate rejected everything. Inspect the rejection breakdown and check final-validation thresholds in src/config/thresholds.ts.';
  }
  return `${stats.finalValidated} product(s) validated. Open the manual QA CSV and target a >= 70% would_list_yes_no approval before scaling.`;
}

// ---------------------------------------------------------------------------
// Markdown reports
// ---------------------------------------------------------------------------

function reportsDir(): string {
  const dir = path.resolve(process.cwd(), 'reports');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

interface SuccessReportArgs {
  timestamp: string;
  commandRun: string;
  nextAction: string;
  runId: string;
  exportBatchId: string;
  csvPath: string;
  qaPath: string;
  stats: PipelineStats;
  validated: { asin: string; amazonUrl: string; productTitle: string; brand?: string; amazonPrice: number; deliveryDays?: number; sellWithin30DaysConfidence: number; stagnationRiskScore: number; policyRiskScore: number; finalValidationScore: number }[];
}

function writeReport(args: SuccessReportArgs): string {
  const filename = `otto-real-qa-report-${args.timestamp}.md`;
  const file = path.join(reportsDir(), filename);
  const passRate = args.stats.rawCandidates > 0
    ? ((args.stats.finalValidated / args.stats.rawCandidates) * 100).toFixed(1)
    : '0';
  const codes = Object.entries(args.stats.rejectionCounts).sort((a, b) => b[1] - a[1]);
  const top = args.validated
    .slice()
    .sort((a, b) => b.finalValidationScore - a.finalValidationScore)
    .slice(0, 10);

  const lines: string[] = [];
  lines.push(`# OTTO Real QA Batch Report`);
  lines.push('');
  lines.push(`- **Generated**: ${new Date().toISOString()}`);
  lines.push(`- **Status**: completed`);
  lines.push(`- **Command**: \`${args.commandRun}\``);
  lines.push(`- **discovery_run_id**: \`${args.runId}\``);
  lines.push(`- **export_batch_id**: \`${args.exportBatchId}\``);
  lines.push('');
  lines.push(`## Stage counts`);
  lines.push('');
  lines.push(`| Stage | Count |`);
  lines.push(`| --- | --- |`);
  lines.push(`| raw candidates | ${args.stats.rawCandidates} |`);
  lines.push(`| ASIN resolved | ${args.stats.asinResolved} |`);
  lines.push(`| ASIN failed | ${args.stats.asinFailed} |`);
  lines.push(`| Amazon source valid | ${args.stats.amazonSourceValid} |`);
  lines.push(`| Amazon source failed | ${args.stats.amazonSourceFailed} |`);
  lines.push(`| demand passed | ${args.stats.demandPassed} |`);
  lines.push(`| demand failed | ${args.stats.demandFailed} |`);
  lines.push(`| compliance passed | ${args.stats.compliancePassed} |`);
  lines.push(`| compliance failed | ${args.stats.complianceFailed} |`);
  lines.push(`| cost calculated | ${args.stats.costCalculated} |`);
  lines.push(`| final validated | ${args.stats.finalValidated} |`);
  lines.push(`| final rejected | ${args.stats.finalRejected} |`);
  lines.push(`| final validated before dedupe | ${args.stats.finalValidatedBeforeDedupe} |`);
  lines.push(`| duplicate ASINs removed | ${args.stats.duplicateAsinsRemoved} |`);
  lines.push(`| exported after dedupe | ${args.stats.finalExportedAfterDedupe} |`);
  lines.push(`| exported count | ${args.stats.exportedCount} |`);
  lines.push(`| end-to-end pass rate | ${passRate}% |`);
  lines.push('');
  lines.push(`## Shipping gate`);
  lines.push('');
  lines.push(`| Outcome | Count |`);
  lines.push(`| --- | --- |`);
  lines.push(`| shipping pass (clear & within window) | ${args.stats.shippingPass} |`);
  lines.push(`| prime-likely pass (Prime/FBA signal trusted) | ${args.stats.shippingPrimeLikelyPass} |`);
  lines.push(`| requires manual shipping review | ${args.stats.shippingReviewRequired} |`);
  lines.push(`| rejected: DELIVERY_TOO_LONG | ${args.stats.shippingRejectTooLong} |`);
  lines.push(`| rejected: DELIVERY_UNCLEAR | ${args.stats.shippingRejectUnclear} |`);
  lines.push('');
  lines.push(`- **CSV export path**: \`${args.csvPath}\``);
  lines.push(`- **manual QA CSV path**: \`${args.qaPath}\``);
  lines.push('');
  lines.push(`## Rejection breakdown`);
  lines.push('');
  if (codes.length === 0) {
    lines.push('_(none)_');
  } else {
    lines.push(`| Code | Count |`);
    lines.push(`| --- | --- |`);
    for (const [code, n] of codes) lines.push(`| \`${code}\` | ${n} |`);
  }
  lines.push('');
  lines.push(`## Top passing products`);
  lines.push('');
  if (top.length === 0) {
    lines.push('_(no products passed all gates this run)_');
  } else {
    for (const p of top) {
      lines.push(`### [${p.asin}] ${p.productTitle}`);
      lines.push(`- URL: ${p.amazonUrl}`);
      lines.push(`- brand: ${p.brand ?? '(none)'}`);
      lines.push(`- amazon price: $${p.amazonPrice.toFixed(2)}`);
      lines.push(`- delivery days: ${p.deliveryDays ?? 'unknown'}`);
      lines.push(`- sell within 30 days confidence: ${p.sellWithin30DaysConfidence.toFixed(0)}`);
      lines.push(`- stagnation risk: ${p.stagnationRiskScore.toFixed(0)}`);
      lines.push(`- policy risk: ${p.policyRiskScore.toFixed(0)}`);
      lines.push(`- final validation score: ${p.finalValidationScore.toFixed(0)}`);
      lines.push('');
    }
  }
  lines.push(`## Next action`);
  lines.push('');
  lines.push(args.nextAction);
  lines.push('');
  fs.writeFileSync(file, lines.join('\n'), 'utf8');
  return file;
}

interface FailureReportArgs {
  timestamp: string;
  commandRun: string;
  failedStage: string;
  errorMessage: string;
  likelyCause: string;
  classification: FailureClassification;
  recommendedFix: string;
  nextCommand: string;
}

function writeFailureReport(args: FailureReportArgs): string {
  const filename = `otto-real-qa-failure-${args.timestamp}.md`;
  const file = path.join(reportsDir(), filename);
  const lines: string[] = [];
  lines.push(`# OTTO Real QA Batch — FAILURE`);
  lines.push('');
  lines.push(`- **Generated**: ${new Date().toISOString()}`);
  lines.push(`- **Status**: failed`);
  lines.push(`- **Command**: \`${args.commandRun}\``);
  lines.push(`- **Failed stage**: ${args.failedStage}`);
  lines.push(`- **Classification**: ${args.classification}`);
  lines.push('');
  lines.push(`## Error message`);
  lines.push('');
  lines.push('```');
  lines.push(args.errorMessage);
  lines.push('```');
  lines.push('');
  lines.push(`## Likely cause`);
  lines.push('');
  lines.push(args.likelyCause);
  lines.push('');
  lines.push(`## Recommended fix`);
  lines.push('');
  lines.push(args.recommendedFix);
  lines.push('');
  lines.push(`## Next command`);
  lines.push('');
  lines.push('```');
  lines.push(args.nextCommand);
  lines.push('```');
  lines.push('');
  fs.writeFileSync(file, lines.join('\n'), 'utf8');
  return file;
}
