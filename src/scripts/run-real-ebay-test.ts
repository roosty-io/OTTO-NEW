/* eslint-disable no-console */
/**
 * run-real-ebay-test.ts
 *
 * Runs the OTTO pipeline using the real eBay Browse API for discovery.
 * Downstream Amazon validation requires browser automation which is not
 * yet wired up - those stages return AMAZON_RESOLUTION_NOT_IMPLEMENTED
 * rejections.  Nothing in this script will pretend a product passed when
 * it has not.
 *
 * Usage:
 *   npm run test:real-ebay                            # default seed keywords
 *   npm run test:real-ebay -- "kw 1" "kw 2"           # custom keywords via CLI
 *   OTTO_REAL_EBAY_DISCOVERY=true npm run test:real-ebay
 *
 * Required env:
 *   EBAY_CLIENT_ID, EBAY_CLIENT_SECRET   (or EBAY_OAUTH_TOKEN)
 */

// Force real-mode for the eBay client before any module reads env.
process.env.OTTO_REAL_EBAY_DISCOVERY = process.env.OTTO_REAL_EBAY_DISCOVERY ?? 'true';
process.env.OTTO_MOCK_MODE = 'false';

import { v4 as uuidv4 } from 'uuid';
import { getSupabase } from '@/clients/supabaseClient';
import { getAmazonBrowserClient } from '@/clients/amazonBrowserClient';
import { logger } from '@/utils/logger';
import { env } from '@/config/env';
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

const DEFAULT_LIMIT = 50;

const log = logger.child('run-real-ebay-test');

interface Stats {
  rawCandidates: number;
  asinResolved: number;
  amazonValid: number;
  demandValid: number;
  complianceValid: number;
  costCalculated: number;
  finalValidated: number;
  rejected: number;
  csvPath: string;
  perKeyword: { keyword: string; fetched: number; inserted: number; rejected: number; apiError?: { code: string; message: string } }[];
  rejectionCounts: Record<string, number>;
}

async function main(): Promise<void> {
  const keywords = parseKeywords();
  const limit = parseLimit();

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
      seed_keywords: keywords,
      notes: `Real eBay discovery run (limit=${limit})`,
    });
  } catch (err) {
    log.warn('discovery_runs insert failed', { err: (err as Error).message });
  }
  log.info('Started real eBay discovery run', { runId, keywords, limit });

  const stats: Stats = {
    rawCandidates: 0,
    asinResolved: 0,
    amazonValid: 0,
    demandValid: 0,
    complianceValid: 0,
    costCalculated: 0,
    finalValidated: 0,
    rejected: 0,
    csvPath: '',
    perKeyword: [],
    rejectionCounts: {},
  };

  const bump = (code: string) => {
    stats.rejected++;
    stats.rejectionCounts[code] = (stats.rejectionCounts[code] ?? 0) + 1;
  };

  // 1. Discovery
  const discoveryAgent = new EbayKeywordDiscoveryAgent();
  const discovery = await discoveryAgent.run({
    discoveryRunId: runId,
    keywords,
    limitPerKeyword: limit,
  });
  stats.rawCandidates = discovery.candidates.length;
  stats.perKeyword = discovery.perKeyword;
  for (const k of discovery.perKeyword) {
    if (k.apiError) bump(RejectionReason.EBAY_API_ERROR);
    if (!k.apiError && k.fetched === 0) bump(RejectionReason.NO_CANDIDATES_FOUND);
    stats.rejected += k.rejected; // per-item raw rejections
  }
  log.info('Discovery complete', { rawCandidates: stats.rawCandidates });

  // 2. Downstream agents
  const asinAgent = new BasicAmazonAsinResolverAgent();
  const amazonAgent = new AmazonSourceValidationAgent();
  const demandAgent = new EbayDemandScoringAgent();
  const complianceAgent = new ComplianceRiskCouncil();
  const costAgent = new CostCalculationAgent();
  const finalAgent = new FinalValidationAgent();
  const amazonClient = getAmazonBrowserClient();
  const amazonImplemented = amazonClient.isImplemented;

  if (!amazonImplemented) {
    log.warn(
      'Amazon browser automation is a placeholder. ASIN resolution and Amazon validation will record ' +
        'AMAZON_RESOLUTION_NOT_IMPLEMENTED / AMAZON_VALIDATION_UNAVAILABLE rejections instead of fabricating data.',
    );
  } else {
    log.info(
      'Amazon ASIN resolver and source-page validation are both live (Playwright). ' +
        'Products only advance past the Amazon stage when amazon_source_checks.source_valid = true.',
    );
  }

  const validated: ValidatedProduct[] = [];

  for (const candidate of discovery.candidates) {
    const asinResult = await asinAgent.run({ candidate, runId });
    if (asinResult.status === 'fail' || !asinResult.data.asin) {
      bump(asinResult.reasons[0] ?? RejectionReason.ASIN_NOT_RESOLVED);
      continue;
    }
    stats.asinResolved++;

    const amazonResult = await amazonAgent.run({
      ottoProductId: candidate.ottoProductId,
      asin: asinResult.data.asin,
      amazonUrl: asinResult.data.amazonUrl,
      runId,
    });
    if (amazonResult.status !== 'pass') {
      bump(amazonResult.data.rejectionReason ?? amazonResult.data.reasons[0] ?? RejectionReason.AMAZON_VALIDATION_UNAVAILABLE);
      continue;
    }
    stats.amazonValid++;
    const amazonData = amazonResult.data;
    const amazonPrice = amazonData.price ?? asinResult.data.price ?? candidate.priceHint ?? 0;

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
    if (demand.demandPassed) {
      stats.demandValid++;
    } else {
      bump(demand.rejectionReason ?? RejectionReason.LOW_DEMAND_SCORE);
      continue;
    }

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
    const cdata = complianceResult.data;
    if (cdata.compliancePassed) {
      stats.complianceValid++;
    } else {
      bump(
        cdata.hardBlock
          ? RejectionReason.COMPLIANCE_HARD_BLOCK
          : cdata.manualReview
            ? RejectionReason.MANUAL_REVIEW_REQUIRED
            : RejectionReason.POLICY_RISK_TOO_HIGH,
      );
      continue;
    }

    const costResult = await costAgent.run({
      ottoProductId: candidate.ottoProductId,
      amazonPrice,
      runId,
    });
    stats.costCalculated++;

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
      bump(finalResult.data.rejectionReason ?? RejectionReason.FINAL_SCORE_TOO_LOW);
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
    });
  }

  // 3. CSV export
  const exporter = new CsvExportAgent();
  const exportResult = await exporter.run({ products: validated, discoveryRunId: runId });
  stats.csvPath = exportResult.data.filePath;

  try {
    await supabase.from('discovery_runs').update({
      status: 'completed',
      finished_at: new Date().toISOString(),
      stats: stats as unknown as Record<string, unknown>,
    }).eq('id', runId);
  } catch (err) {
    log.warn('discovery_runs update failed', { err: (err as Error).message });
  }

  printSummary(stats, amazonImplemented);
}

function parseKeywords(): string[] {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (args.length > 0) return args;
  return DEFAULT_KEYWORDS;
}

function parseLimit(): number {
  const limitArg = process.argv.find((a) => a.startsWith('--limit='));
  if (limitArg) {
    const n = Number(limitArg.split('=')[1]);
    if (Number.isFinite(n) && n > 0) return Math.min(n, 200);
  }
  return DEFAULT_LIMIT;
}

function printSummary(stats: Stats, amazonImplemented: boolean): void {
  console.log('\n========== OTTO REAL EBAY PIPELINE SUMMARY ==========');
  console.log(`  raw candidates    : ${stats.rawCandidates}`);
  console.log(`  ASIN resolved     : ${stats.asinResolved}`);
  console.log(`  Amazon valid      : ${stats.amazonValid}`);
  console.log(`  demand valid      : ${stats.demandValid}`);
  console.log(`  compliance valid  : ${stats.complianceValid}`);
  console.log(`  cost calculated   : ${stats.costCalculated}`);
  console.log(`  final validated   : ${stats.finalValidated}`);
  console.log(`  rejected          : ${stats.rejected}`);
  console.log(`  CSV path          : ${stats.csvPath}`);
  console.log('  per-keyword       :');
  for (const k of stats.perKeyword) {
    const errSuffix = k.apiError ? `  [ERROR ${k.apiError.code}]` : '';
    console.log(
      `    - ${k.keyword.padEnd(28)} fetched=${String(k.fetched).padStart(3)} inserted=${String(k.inserted).padStart(3)} rejected=${String(k.rejected).padStart(3)}${errSuffix}`,
    );
  }
  if (Object.keys(stats.rejectionCounts).length > 0) {
    console.log('  rejection reasons :');
    for (const [code, n] of Object.entries(stats.rejectionCounts).sort((a, b) => b[1] - a[1])) {
      console.log(`    - ${code.padEnd(40)} ${n}`);
    }
  }
  if (!amazonImplemented) {
    console.log('\n  NOTE: Amazon browser automation is a placeholder.  No product can pass');
    console.log('        ASIN resolution / Amazon source validation in real mode until');
    console.log('        a real Playwright client is wired up.  All such products were');
    console.log('        recorded with AMAZON_RESOLUTION_NOT_IMPLEMENTED.');
  } else {
    console.log('\n  NOTE: Amazon ASIN resolver and source-page validation are both live.');
    console.log('        Products only continue past Amazon when source_valid = true.');
  }
  console.log('=====================================================\n');
}

main().catch((err) => {
  logger.error('Real eBay pipeline failed', { err: (err as Error).message, stack: (err as Error).stack });
  process.exit(1);
});
