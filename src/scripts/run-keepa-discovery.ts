/* eslint-disable no-console */
/**
 * run-keepa-discovery.ts
 *
 * ASIN-native discovery batch.  Pulls Amazon products with improving
 * sales rank from Keepa (KeepaRankMovementDiscoveryAgent), then routes
 * them through the SAME validation chain as run:real-qa
 * (Amazon source -> demand -> compliance -> business fit -> cost ->
 * final -> same-batch dedupe -> cross-batch filter -> CSV + manual QA +
 * persistence).  Keepa candidates already carry an ASIN, so the
 * BasicAmazonAsinResolverAgent is bypassed unless the ASIN is missing.
 *
 * Usage:
 *   npm run run:keepa-discovery -- --limit=25
 *   npm run run:keepa-discovery -- --limit=25 --category="Home & Kitchen"
 *   npm run run:keepa-discovery -- --limit=25 --min-price=12 --max-price=120
 *   npm run run:keepa-discovery -- --limit=25 --allow-repeats
 *   npm run run:keepa-discovery -- --repeat-policy=never_repeat
 *
 * Required env:
 *   KEEPA_API_KEY (real mode)
 *   EBAY_CLIENT_ID + EBAY_CLIENT_SECRET (demand scoring hits eBay)
 *   `npx playwright install chromium` once (Amazon source validation)
 */

process.env.OTTO_REAL_EBAY_DISCOVERY = process.env.OTTO_REAL_EBAY_DISCOVERY ?? 'true';

import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { getSupabase } from '@/clients/supabaseClient';
import { getAmazonBrowserClient } from '@/clients/amazonBrowserClient';
import { logger } from '@/utils/logger';
import { env } from '@/config/env';
import { RejectionReason } from '@/utils/rejectionReasons';

import { KeepaRankMovementDiscoveryAgent, type KeepaCategoryStat } from '@/agents/discovery/KeepaRankMovementDiscoveryAgent';
import { BasicAmazonAsinResolverAgent } from '@/agents/asin/BasicAmazonAsinResolverAgent';
import { AmazonSourceValidationAgent } from '@/agents/amazon/AmazonSourceValidationAgent';
import { EbayDemandScoringAgent } from '@/agents/ebay/EbayDemandScoringAgent';
import { ComplianceRiskCouncil } from '@/agents/compliance/ComplianceRiskCouncil';
import { BusinessFitAgent } from '@/agents/businessFit/BusinessFitAgent';
import { CostCalculationAgent } from '@/agents/cost/CostCalculationAgent';
import { FinalValidationAgent } from '@/agents/validation/FinalValidationAgent';
import { CsvExportAgent } from '@/agents/export/CsvExportAgent';
import { isRepeatPolicy, normalizeRepeatPolicy, type RepeatPolicy } from '@/agents/export/crossBatchFilter';
import { asinNativeResolution, type ResolvedAsin } from '@/pipeline/asinResolution';
import type { KeepaTokenInfo, KeepaError } from '@/clients/keepaClient';
import type { ProductCandidate, ValidatedProduct } from '@/types/product';

const DEFAULT_LIMIT = 25;
const SAFE_LIMIT_MAX = 200;
const log = logger.child('run-keepa-discovery');

interface KeepaArgs {
  limit: number;
  category?: string;
  minPrice?: number;
  maxPrice?: number;
  repeatPolicy: RepeatPolicy;
  repeatLookbackDays: number;
}

interface KeepaStats {
  rawKeepaCandidates: number;
  asinNativeCandidates: number;
  asinResolved: number;
  asinFailed: number;
  amazonSourceValid: number;
  amazonSourceFailed: number;
  demandPassed: number;
  demandFailed: number;
  compliancePassed: number;
  complianceFailed: number;
  businessFitPassed: number;
  businessFitFailed: number;
  costCalculated: number;
  finalValidated: number;
  finalRejected: number;
  finalValidatedBeforeDedupe: number;
  sameBatchDuplicatesRemoved: number;
  crossBatchRepeatsRemoved: number;
  exportedAfterAllFilters: number;
  exportedCount: number;
  repeatPolicy: string;
  repeatLookbackDays: number;
  rejectionCounts: Record<string, number>;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const reportTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const commandRun = `npm run run:keepa-discovery -- --limit=${args.limit}${args.category ? ` --category="${args.category}"` : ''}`;

  const envProblems = validateEnv();
  if (envProblems.length > 0) {
    for (const p of envProblems) log.error(p);
    console.log('\nKeepa discovery aborted: missing required env.');
    console.log('  ' + envProblems.join('\n  '));
    process.exit(2);
  }

  const supabase = getSupabase();
  const runId = uuidv4();
  try {
    await supabase.from('discovery_runs').insert({
      id: runId,
      status: 'running',
      seed_keywords: [],
      notes: `Keepa rank-movement discovery (limit=${args.limit}${args.category ? `, category=${args.category}` : ''})`,
    });
  } catch (err) {
    log.warn('discovery_runs insert failed', { err: (err as Error).message });
  }

  const stats: KeepaStats = makeStats(args);

  const bump = (code: string | undefined) => {
    const c = code ?? 'UNSPECIFIED';
    stats.rejectionCounts[c] = (stats.rejectionCounts[c] ?? 0) + 1;
  };

  const discoveryAgent = new KeepaRankMovementDiscoveryAgent();
  const asinAgent = new BasicAmazonAsinResolverAgent();
  const amazonAgent = new AmazonSourceValidationAgent();
  const demandAgent = new EbayDemandScoringAgent();
  const complianceAgent = new ComplianceRiskCouncil();
  const businessFitAgent = new BusinessFitAgent();
  const costAgent = new CostCalculationAgent();
  const finalAgent = new FinalValidationAgent();

  // 1. Keepa discovery (ASIN-native)
  const discovery = await discoveryAgent.run({
    discoveryRunId: runId,
    maxAsins: args.limit,
    categorySelector: args.category,
    minAmazonPrice: args.minPrice,
    maxAmazonPrice: args.maxPrice,
  });
  stats.rawKeepaCandidates = discovery.rawCandidateCount;
  stats.asinNativeCandidates = discovery.asinNativeCount;
  log.info('Keepa discovery complete', {
    raw: discovery.rawCandidateCount,
    asinNative: discovery.asinNativeCount,
    error: discovery.error?.code,
  });

  if (discovery.candidates.length === 0) {
    await finishRun(supabase, runId, stats, 'completed');
    printSummary({ runId, exportBatchId: '', csvPath: '', qaPath: '', stats, perCategory: discovery.perCategory, tokens: discovery.tokens, keepaError: discovery.error, validated: [] });
    if (discovery.error) {
      console.log(`\nNo Keepa candidates produced. Keepa reported: ${discovery.error.code} - ${discovery.error.message}`);
      console.log('No fake candidates were generated.');
    } else {
      console.log('\nNo Keepa candidates matched the current filters.');
    }
    const reportPath = writeReport({ timestamp: reportTimestamp, commandRun, runId, exportBatchId: '', csvPath: '', qaPath: '', stats, perCategory: discovery.perCategory, tokens: discovery.tokens, keepaError: discovery.error, validated: [] });
    console.log(`  Keepa discovery report written: ${reportPath}\n`);
    process.exit(discovery.error ? 1 : 0);
  }

  const amazonClient = getAmazonBrowserClient();
  if (!amazonClient.isImplemented) {
    log.warn('Amazon browser client is a placeholder; source validation will degrade to placeholder rejections.');
  }

  const validated: ValidatedProduct[] = [];

  for (const candidate of discovery.candidates) {
    // 2. ASIN: bypass resolver when Keepa already gave us an ASIN.
    const resolved = await resolveAsin(candidate, asinAgent, runId);
    if (!resolved) {
      stats.asinFailed++;
      bump(RejectionReason.ASIN_NOT_RESOLVED);
      continue;
    }
    stats.asinResolved++;

    // 3. Amazon source validation
    const amazonResult = await amazonAgent.run({
      ottoProductId: candidate.ottoProductId,
      asin: resolved.asin,
      amazonUrl: resolved.amazonUrl,
      runId,
    });
    if (amazonResult.status !== 'pass') {
      stats.amazonSourceFailed++;
      bump(amazonResult.data.rejectionReason ?? amazonResult.data.reasons[0]);
      continue;
    }
    stats.amazonSourceValid++;
    const amazonData = amazonResult.data;
    const amazonPrice = amazonData.price ?? resolved.price ?? candidate.priceHint ?? 0;

    // 4. eBay demand scoring
    const demandResult = await demandAgent.run({
      ottoProductId: candidate.ottoProductId,
      asin: resolved.asin,
      amazonUrl: resolved.amazonUrl,
      keyword: candidate.keyword,
      productTitle: amazonData.productTitle ?? candidate.productTitleRaw,
      amazonBrand: amazonData.brand ?? candidate.brandHint,
      amazonCategoryBreadcrumbs: amazonData.categoryBreadcrumbs,
      amazonPrice,
      sourceConfidenceScore: resolved.score,
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
        amazonCategory: amazonData.categoryBreadcrumbs.join(' > ') || candidate.categoryHint,
        amazonCategoryBreadcrumbs: amazonData.categoryBreadcrumbs,
        bullets: amazonData.productBullets,
        descriptionSnippet: amazonData.snapshot?.productDescriptionSnippet,
        ebayCategoryHint: candidate.categoryHint,
        comparableTitles: demandResult.data.comparableSamples.map((c) => c.title),
        coreKeyword: candidate.keyword,
      },
      amazonUrl: resolved.amazonUrl,
      asin: resolved.asin,
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

    // 6. Business fit
    const businessFitResult = await businessFitAgent.run({
      ottoProductId: candidate.ottoProductId,
      asin: resolved.asin,
      amazonUrl: resolved.amazonUrl,
      amazonPrice,
      productTitle: amazonData.productTitle ?? candidate.productTitleRaw,
      brand: amazonData.brand ?? candidate.brandHint,
      amazonCategoryBreadcrumbs: amazonData.categoryBreadcrumbs,
      estimatedDeliveryDays: amazonData.estimatedDeliveryDays,
      relevantComparableCount: demandResult.data.relevantComparableCount,
      exactOrSimilarMatchCount: demandResult.data.exactOrSimilarMatchCount,
      sellerCount: demandResult.data.sellerCount,
      sellerConcentrationScore: demandResult.data.sellerConcentrationScore,
      duplicateRatio: demandResult.data.duplicateRatio,
      competitionDensityScore: demandResult.data.competitionDensityScore,
      medianComparablePrice: demandResult.data.medianComparablePrice,
      avgComparablePrice: demandResult.data.avgComparablePrice,
      priceBandMin: demandResult.data.priceBandMin,
      priceBandMax: demandResult.data.priceBandMax,
      priceViabilityScore: demandResult.data.priceViabilityScore,
      stagnationRiskScore: demandResult.data.stagnationRiskScore,
      sellWithin30DaysConfidence: demandResult.data.sellWithin30DaysConfidence,
      saturationScore: demandResult.data.saturationScore,
      policyRiskScore: complianceResult.data.policyRiskScore,
      runId,
    });
    if (!businessFitResult.data.businessFitPassed) {
      stats.businessFitFailed++;
      bump(businessFitResult.data.businessFitRejectionReason ?? RejectionReason.BUSINESS_FIT_FAILED);
      continue;
    }
    stats.businessFitPassed++;

    // 7. Cost
    const costResult = await costAgent.run({ ottoProductId: candidate.ottoProductId, amazonPrice, runId });
    stats.costCalculated++;

    // 8. Final
    const finalResult = await finalAgent.run({
      ottoProductId: candidate.ottoProductId,
      asin: resolved.asin,
      amazonUrl: resolved.amazonUrl,
      amazon: amazonResult.data,
      demand: demandResult.data,
      compliance: complianceResult.data,
      businessFit: businessFitResult.data,
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
      asin: resolved.asin,
      amazonUrl: resolved.amazonUrl,
      productTitle: amazonData.productTitle ?? candidate.productTitleRaw,
      brand: amazonData.brand ?? candidate.brandHint,
      amazonCategory: amazonData.categoryBreadcrumbs.join(' > ') || candidate.categoryHint,
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
      businessFitScore: businessFitResult.data.businessFitScore,
      competitionQualityScore: businessFitResult.data.competitionQualityScore,
      sellerCompetitionScore: businessFitResult.data.sellerCompetitionScore,
      exactMatchSaturationScore: businessFitResult.data.exactMatchSaturationScore,
      duplicateListingScore: businessFitResult.data.duplicateListingScore,
      priceCompressionScore: businessFitResult.data.priceCompressionScore,
      sameSourceLikelihoodScore: businessFitResult.data.sameSourceLikelihoodScore,
      isGenericCommodity: businessFitResult.data.isGenericCommodity,
      competitionGateResult: businessFitResult.data.competitionGateResult,
      competitionRejectionReason: businessFitResult.data.competitionRejectionReason,
      sellerCount: demandResult.data.sellerCount,
      exactOrSimilarMatchCount: demandResult.data.exactOrSimilarMatchCount,
      duplicateRatio: demandResult.data.duplicateRatio,
      sourceConfidenceScore: resolved.score,
      productMatchType: resolved.productMatchType,
      opportunityType: 'direct_match',
      marketplaceSignalSources: ['keepa'],
      primaryDiscoverySource: candidate.source, // keepa_rank_movement
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

  // 9. Export: same-batch dedupe + cross-batch filter + CSV + manual QA + persist.
  const exporter = new CsvExportAgent();
  const exportResult = await exporter.run({
    products: validated,
    discoveryRunId: runId,
    repeatPolicy: args.repeatPolicy,
    repeatLookbackDays: args.repeatLookbackDays,
    // Mock-mode runs must not hijack the Command Center "latest real run".
    isSynthetic: env.runtime.mockMode,
  });
  stats.finalValidatedBeforeDedupe = exportResult.data.finalValidatedBeforeDedupe;
  stats.sameBatchDuplicatesRemoved = exportResult.data.sameBatchDuplicatesRemoved;
  stats.crossBatchRepeatsRemoved = exportResult.data.crossBatchRepeatsRemoved;
  stats.exportedAfterAllFilters = exportResult.data.exportedAfterAllFilters;
  stats.exportedCount = exportResult.data.rowCount;
  stats.repeatPolicy = exportResult.data.repeatPolicy;
  stats.repeatLookbackDays = exportResult.data.repeatLookbackDays;

  await finishRun(supabase, runId, stats, 'completed');

  const summaryArgs = {
    runId,
    exportBatchId: exportResult.data.exportBatchId,
    csvPath: exportResult.data.filePath,
    qaPath: exportResult.data.manualQaCsvPath,
    stats,
    perCategory: discovery.perCategory,
    tokens: discovery.tokens,
    keepaError: discovery.error,
    validated,
  };
  printSummary(summaryArgs);
  const reportPath = writeReport({ timestamp: reportTimestamp, commandRun, ...summaryArgs });
  console.log(`  Keepa discovery report written: ${reportPath}\n`);

  try {
    await amazonClient.close();
  } catch (err) {
    log.warn('amazon browser close failed', { err: (err as Error).message });
  }
}

async function resolveAsin(
  candidate: ProductCandidate,
  asinAgent: BasicAmazonAsinResolverAgent,
  runId: string,
): Promise<ResolvedAsin | null> {
  // ASIN-native: Keepa already gave us a confirmed ASIN -> bypass resolver.
  const native = asinNativeResolution(candidate);
  if (native) return native;
  // Fallback: no ASIN -> run the resolver as usual.
  const asinResult = await asinAgent.run({ candidate, runId });
  if (asinResult.status !== 'pass' || !asinResult.data.asin) return null;
  return {
    asin: asinResult.data.asin,
    amazonUrl: asinResult.data.amazonUrl ?? `https://www.amazon.com/dp/${asinResult.data.asin}`,
    score: asinResult.score,
    price: asinResult.data.price,
    productMatchType: asinResult.score >= 80 ? 'exact' : 'similar',
    bypassed: false,
  };
}

function parseArgs(): KeepaArgs {
  const argv = process.argv.slice(2);
  let limit = DEFAULT_LIMIT;
  let category: string | undefined;
  let minPrice: number | undefined;
  let maxPrice: number | undefined;
  let repeatPolicy = normalizeRepeatPolicy(env.export.repeatPolicy);
  let repeatLookbackDays = env.export.repeatLookbackDays;
  for (const a of argv) {
    if (a.startsWith('--limit=')) {
      const n = Number(a.split('=')[1]);
      if (Number.isFinite(n) && n > 0) limit = Math.min(n, SAFE_LIMIT_MAX);
    } else if (a.startsWith('--category=')) {
      category = a.substring('--category='.length).trim().replace(/^"|"$/g, '');
    } else if (a.startsWith('--min-price=')) {
      const n = Number(a.split('=')[1]);
      if (Number.isFinite(n) && n >= 0) minPrice = n;
    } else if (a.startsWith('--max-price=')) {
      const n = Number(a.split('=')[1]);
      if (Number.isFinite(n) && n > 0) maxPrice = n;
    } else if (a === '--allow-repeats') {
      repeatPolicy = 'allow_repeats';
    } else if (a.startsWith('--repeat-policy=')) {
      const raw = a.substring('--repeat-policy='.length).trim();
      if (isRepeatPolicy(raw)) repeatPolicy = raw;
      else log.warn(`Ignoring unknown --repeat-policy=${raw}; using ${repeatPolicy}`);
    } else if (a.startsWith('--repeat-lookback-days=')) {
      const n = Number(a.split('=')[1]);
      if (Number.isFinite(n) && n >= 0) repeatLookbackDays = Math.trunc(n);
    }
  }
  return { limit, category, minPrice, maxPrice, repeatPolicy, repeatLookbackDays };
}

function validateEnv(): string[] {
  const problems: string[] = [];
  if (!env.runtime.mockMode) {
    if (!env.keepa.apiKey) problems.push('KEEPA_API_KEY is required for Keepa discovery (real mode).');
    if (!env.ebay.clientId || !env.ebay.clientSecret) {
      if (!env.ebay.oauthToken) {
        problems.push('EBAY_CLIENT_ID + EBAY_CLIENT_SECRET (or EBAY_OAUTH_TOKEN) are required for demand scoring.');
      }
    }
  }
  return problems;
}

function makeStats(args: KeepaArgs): KeepaStats {
  return {
    rawKeepaCandidates: 0,
    asinNativeCandidates: 0,
    asinResolved: 0,
    asinFailed: 0,
    amazonSourceValid: 0,
    amazonSourceFailed: 0,
    demandPassed: 0,
    demandFailed: 0,
    compliancePassed: 0,
    complianceFailed: 0,
    businessFitPassed: 0,
    businessFitFailed: 0,
    costCalculated: 0,
    finalValidated: 0,
    finalRejected: 0,
    finalValidatedBeforeDedupe: 0,
    sameBatchDuplicatesRemoved: 0,
    crossBatchRepeatsRemoved: 0,
    exportedAfterAllFilters: 0,
    exportedCount: 0,
    repeatPolicy: args.repeatPolicy,
    repeatLookbackDays: args.repeatLookbackDays,
    rejectionCounts: {},
  };
}

async function finishRun(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  runId: string,
  stats: KeepaStats,
  status: string,
): Promise<void> {
  try {
    await supabase.from('discovery_runs').update({
      status,
      finished_at: new Date().toISOString(),
      stats: stats as unknown as Record<string, unknown>,
    }).eq('id', runId);
  } catch (err) {
    log.warn('discovery_runs update failed', { err: (err as Error).message });
  }
}

interface ReportArgs {
  runId: string;
  exportBatchId: string;
  csvPath: string;
  qaPath: string;
  stats: KeepaStats;
  perCategory: KeepaCategoryStat[];
  tokens: KeepaTokenInfo;
  keepaError?: KeepaError;
  validated: ValidatedProduct[];
}

function printSummary(args: ReportArgs): void {
  const { stats } = args;
  console.log('\n========== OTTO KEEPA DISCOVERY SUMMARY ==========');
  console.log(`  discovery_run_id      : ${args.runId}`);
  console.log(`  export_batch_id       : ${args.exportBatchId || '(none)'}`);
  console.log('  ----- discovery -----');
  console.log(`  raw Keepa candidates  : ${stats.rawKeepaCandidates}`);
  console.log(`  ASIN-native candidates: ${stats.asinNativeCandidates}`);
  console.log('  ----- validation -----');
  console.log(`  asin resolved/bypassed: ${stats.asinResolved}`);
  console.log(`  asin failed           : ${stats.asinFailed}`);
  console.log(`  amazon source valid   : ${stats.amazonSourceValid}`);
  console.log(`  amazon source failed  : ${stats.amazonSourceFailed}`);
  console.log(`  demand passed         : ${stats.demandPassed}`);
  console.log(`  demand failed         : ${stats.demandFailed}`);
  console.log(`  compliance passed     : ${stats.compliancePassed}`);
  console.log(`  compliance failed     : ${stats.complianceFailed}`);
  console.log(`  business fit passed   : ${stats.businessFitPassed}`);
  console.log(`  business fit failed   : ${stats.businessFitFailed}`);
  console.log(`  final validated       : ${stats.finalValidated}`);
  console.log(`  final rejected        : ${stats.finalRejected}`);
  console.log('  ----- export dedupe + cross-batch -----');
  console.log(`  validated before dedupe   : ${stats.finalValidatedBeforeDedupe}`);
  console.log(`  same-batch dupes removed  : ${stats.sameBatchDuplicatesRemoved}`);
  console.log(`  cross-batch repeats removed: ${stats.crossBatchRepeatsRemoved}`);
  console.log(`  exported after all filters: ${stats.exportedAfterAllFilters}`);
  console.log(`  repeat policy             : ${stats.repeatPolicy} (lookback ${stats.repeatLookbackDays}d)`);
  console.log('  ----- keepa api -----');
  console.log(`  tokens consumed       : ${args.tokens.tokensConsumed ?? 'n/a'}`);
  console.log(`  tokens left           : ${args.tokens.tokensLeft ?? 'n/a'}`);
  if (args.keepaError) {
    console.log(`  keepa error           : ${args.keepaError.code} - ${args.keepaError.message}`);
  }
  console.log('  ----- top categories discovered -----');
  for (const c of [...args.perCategory].sort((a, b) => b.accepted - a.accepted).slice(0, 8)) {
    console.log(`    ${c.category.padEnd(28)} raw=${c.rawAsins} accepted=${c.accepted} (cat-filtered=${c.filteredCategory}, price=${c.filteredPrice}, rank=${c.filteredRankImprovement})`);
  }
  if (args.validated.length > 0) {
    console.log('  ----- top exported products -----');
    for (const p of [...args.validated].sort((a, b) => b.finalValidationScore - a.finalValidationScore).slice(0, 10)) {
      console.log(`    ${p.asin}  $${p.amazonPrice.toFixed(2)}  final=${p.finalValidationScore.toFixed(0)}  ${(p.productTitle ?? '').slice(0, 50)}`);
    }
  }
  console.log('  ----- output -----');
  console.log(`  CSV path              : ${args.csvPath || '(none)'}`);
  console.log(`  manual QA CSV path    : ${args.qaPath || '(none)'}`);
  console.log('==================================================\n');
}

function reportsDir(): string {
  const dir = path.resolve(process.cwd(), 'reports');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeReport(args: ReportArgs & { timestamp: string; commandRun: string }): string {
  const file = path.join(reportsDir(), `otto-keepa-discovery-report-${args.timestamp}.md`);
  const s = args.stats;
  const codes = Object.entries(s.rejectionCounts).sort((a, b) => b[1] - a[1]);
  const lines: string[] = [];
  lines.push('# OTTO Keepa Rank-Movement Discovery Report');
  lines.push('');
  lines.push(`- **Generated**: ${new Date().toISOString()}`);
  lines.push(`- **Command**: \`${args.commandRun}\``);
  lines.push(`- **discovery_run_id**: \`${args.runId}\``);
  lines.push(`- **export_batch_id**: \`${args.exportBatchId || '(none)'}\``);
  lines.push('');
  lines.push('## Funnel');
  lines.push('');
  lines.push('| Stage | Count |');
  lines.push('| --- | --- |');
  lines.push(`| raw Keepa candidates | ${s.rawKeepaCandidates} |`);
  lines.push(`| ASIN-native candidates | ${s.asinNativeCandidates} |`);
  lines.push(`| ASIN resolved/bypassed | ${s.asinResolved} |`);
  lines.push(`| Amazon source valid | ${s.amazonSourceValid} |`);
  lines.push(`| demand passed | ${s.demandPassed} |`);
  lines.push(`| compliance passed | ${s.compliancePassed} |`);
  lines.push(`| business fit passed | ${s.businessFitPassed} |`);
  lines.push(`| final validated before dedupe | ${s.finalValidatedBeforeDedupe} |`);
  lines.push(`| same-batch duplicates removed | ${s.sameBatchDuplicatesRemoved} |`);
  lines.push(`| cross-batch repeats removed | ${s.crossBatchRepeatsRemoved} |`);
  lines.push(`| exported after all filters | ${s.exportedAfterAllFilters} |`);
  lines.push('');
  lines.push('## Cross-batch repeat filtering');
  lines.push('');
  lines.push(`- repeat policy: \`${s.repeatPolicy}\``);
  lines.push(`- repeat lookback days: ${s.repeatLookbackDays}`);
  lines.push(`- cross-batch repeats removed: ${s.crossBatchRepeatsRemoved}`);
  lines.push('');
  lines.push('## Keepa API usage');
  lines.push('');
  lines.push(`- tokens consumed: ${args.tokens.tokensConsumed ?? 'n/a'}`);
  lines.push(`- tokens left: ${args.tokens.tokensLeft ?? 'n/a'}`);
  if (args.keepaError) {
    lines.push(`- **Keepa error**: \`${args.keepaError.code}\` — ${args.keepaError.message}`);
  }
  lines.push('');
  lines.push('## Top Keepa categories discovered');
  lines.push('');
  lines.push('| Category | rootId | raw | accepted | cat-filtered | price-filtered | rank-filtered |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const c of [...args.perCategory].sort((a, b) => b.accepted - a.accepted)) {
    lines.push(`| ${c.category} | ${c.rootId} | ${c.rawAsins} | ${c.accepted} | ${c.filteredCategory} | ${c.filteredPrice} | ${c.filteredRankImprovement} |`);
  }
  lines.push('');
  lines.push('## Top exported products');
  lines.push('');
  if (args.validated.length === 0) {
    lines.push('_(none)_');
  } else {
    lines.push('| ASIN | price | final | title |');
    lines.push('| --- | --- | --- | --- |');
    for (const p of [...args.validated].sort((a, b) => b.finalValidationScore - a.finalValidationScore).slice(0, 15)) {
      lines.push(`| \`${p.asin}\` | $${p.amazonPrice.toFixed(2)} | ${p.finalValidationScore.toFixed(0)} | ${(p.productTitle ?? '').slice(0, 60)} |`);
    }
  }
  lines.push('');
  lines.push('## Rejection breakdown');
  lines.push('');
  if (codes.length === 0) {
    lines.push('_(none)_');
  } else {
    lines.push('| Code | Count |');
    lines.push('| --- | --- |');
    for (const [code, n] of codes) lines.push(`| \`${code}\` | ${n} |`);
  }
  lines.push('');
  lines.push(`- **CSV export path**: \`${args.csvPath || '(none)'}\``);
  lines.push(`- **manual QA CSV path**: \`${args.qaPath || '(none)'}\``);
  lines.push('');
  fs.writeFileSync(file, lines.join('\n'), 'utf8');
  return file;
}

main().catch((err) => {
  logger.error('run-keepa-discovery failed', { err: (err as Error).message, stack: (err as Error).stack });
  process.exit(1);
});
