/**
 * Shared Keepa discovery + validation execution, used by both
 * run:keepa-discovery (single run) and calibrate:keepa-discovery
 * (multi-profile).  It runs the SAME downstream validation chain as
 * run:real-qa — no gate is loosened here.
 *
 * Caller is responsible for the discovery_runs row lifecycle; this
 * function only runs discovery + pipeline + export for a given runId.
 */

import { getAmazonBrowserClient } from '@/clients/amazonBrowserClient';
import { logger } from '@/utils/logger';
import { RejectionReason } from '@/utils/rejectionReasons';

import {
  KeepaRankMovementDiscoveryAgent,
  type KeepaCategoryStat,
  type KeepaStrategyStat,
  type AsinStrategyProvenance,
  type SkippedStrategy,
} from '@/agents/discovery/KeepaRankMovementDiscoveryAgent';
import {
  buildStrategyEfficiency,
  recommendStrategyConfig,
  type KeepaStrategyName,
  type StrategyMode,
  type StrategyEfficiency,
  type StrategyRecommendation,
} from '@/config/keepaStrategies';
import { BasicAmazonAsinResolverAgent } from '@/agents/asin/BasicAmazonAsinResolverAgent';
import { AmazonSourceValidationAgent } from '@/agents/amazon/AmazonSourceValidationAgent';
import { EbayDemandScoringAgent } from '@/agents/ebay/EbayDemandScoringAgent';
import { ComplianceRiskCouncil } from '@/agents/compliance/ComplianceRiskCouncil';
import { BusinessFitAgent } from '@/agents/businessFit/BusinessFitAgent';
import { CostCalculationAgent } from '@/agents/cost/CostCalculationAgent';
import { FinalValidationAgent } from '@/agents/validation/FinalValidationAgent';
import { CsvExportAgent } from '@/agents/export/CsvExportAgent';
import { asinNativeResolution } from '@/pipeline/asinResolution';
import type { RepeatPolicy } from '@/agents/export/crossBatchFilter';
import type { KeepaTokenInfo, KeepaError } from '@/clients/keepaClient';
import type { ProductCandidate, ValidatedProduct } from '@/types/product';

const log = logger.child('keepa-discovery-run');

export interface KeepaRunOptions {
  runId: string;
  maxAsins: number;
  categorySelector?: string;
  minAmazonPrice: number;
  maxAmazonPrice: number;
  minRankImprovementPercent: number;
  repeatPolicy: RepeatPolicy;
  repeatLookbackDays: number;
  isSynthetic: boolean;
  /** Ordered Product Finder strategies to consider; empty/undefined = default. */
  strategies?: KeepaStrategyName[];
  /** all = run every strategy; auto/fixed = stop once enough candidates found. */
  strategyMode?: StrategyMode;
  /** Profile label, for the strategy recommendation. */
  profileName?: string;
  /** Token budget for the run (0 = no guard). */
  maxKeepaTokens?: number;
  /** Bypass the token guard. */
  force?: boolean;
  /** Close the shared Amazon browser when done (single-run). Calibrator keeps it open across profiles. */
  closeBrowser?: boolean;
}

export interface KeepaRunStats {
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

export interface SourceFailureSample {
  asin: string;
  rejectionReason?: string;
  pageLoaded: boolean;
  hasSourcePrice: boolean;
  buyable: boolean;
  stockStatus: string;
  shippingGateResult: string;
  restrictedSignals: string[];
}

export interface KeepaRunResult {
  stats: KeepaRunStats;
  perCategory: KeepaCategoryStat[];
  perStrategy: KeepaStrategyStat[];
  strategiesRun: string[];
  strategiesSkipped: SkippedStrategy[];
  strategyMode: StrategyMode;
  strategyEfficiency: StrategyEfficiency[];
  strategyRecommendation: StrategyRecommendation;
  duplicateAsinsAcrossStrategies: number;
  uniqueAsinCandidates: number;
  strategyByAsin: Record<string, AsinStrategyProvenance>;
  tokenBudgetStopped: boolean;
  filterReasons: Record<string, number>;
  tokens: KeepaTokenInfo;
  keepaError?: KeepaError;
  sourceFailureSamples: SourceFailureSample[];
  validated: ValidatedProduct[];
  exportBatchId: string;
  csvPath: string;
  qaPath: string;
}

const SOURCE_FAILURE_SAMPLE_CAP = 15;

export async function executeKeepaDiscovery(opts: KeepaRunOptions): Promise<KeepaRunResult> {
  const stats = makeStats(opts);
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

  const discovery = await discoveryAgent.run({
    discoveryRunId: opts.runId,
    maxAsins: opts.maxAsins,
    categorySelector: opts.categorySelector,
    minAmazonPrice: opts.minAmazonPrice,
    maxAmazonPrice: opts.maxAmazonPrice,
    minRankImprovementPercent: opts.minRankImprovementPercent,
    strategies: opts.strategies,
    strategyMode: opts.strategyMode,
    maxKeepaTokens: opts.maxKeepaTokens,
    force: opts.force,
  });
  stats.rawKeepaCandidates = discovery.rawCandidateCount;
  stats.asinNativeCandidates = discovery.asinNativeCount;

  const sourceFailureSamples: SourceFailureSample[] = [];
  const validated: ValidatedProduct[] = [];

  // Per-strategy validation tallies, keyed by the candidate's primary strategy.
  const perStrategySourceValid: Record<string, number> = {};
  const perStrategyDemand: Record<string, number> = {};
  const perStrategyFinal: Record<string, number> = {};
  const tallyStrat = (m: Record<string, number>, c: ProductCandidate) => {
    const k = c.primaryKeepaStrategy ?? 'unknown';
    m[k] = (m[k] ?? 0) + 1;
  };

  if (discovery.candidates.length > 0) {
    const amazonClient = getAmazonBrowserClient();
    if (!amazonClient.isImplemented) {
      log.warn('Amazon browser client is a placeholder; source validation will degrade to placeholder rejections.');
    }

    for (const candidate of discovery.candidates) {
      const resolved = await resolveAsin(candidate, asinAgent, opts.runId);
      if (!resolved) {
        stats.asinFailed++;
        bump(RejectionReason.ASIN_NOT_RESOLVED);
        continue;
      }
      stats.asinResolved++;

      const amazonResult = await amazonAgent.run({
        ottoProductId: candidate.ottoProductId,
        asin: resolved.asin,
        amazonUrl: resolved.amazonUrl,
        runId: opts.runId,
      });
      if (amazonResult.status !== 'pass') {
        stats.amazonSourceFailed++;
        bump(amazonResult.data.rejectionReason ?? amazonResult.data.reasons[0]);
        if (sourceFailureSamples.length < SOURCE_FAILURE_SAMPLE_CAP) {
          const d = amazonResult.data;
          sourceFailureSamples.push({
            asin: resolved.asin,
            rejectionReason: d.rejectionReason,
            pageLoaded: Boolean(d.pageLoaded),
            hasSourcePrice: Boolean(d.hasSourcePrice),
            buyable: Boolean(d.buyable),
            stockStatus: d.stockStatus ?? 'unknown',
            shippingGateResult: d.shippingGateResult ?? 'unknown',
            restrictedSignals: d.restrictedSignals ?? [],
          });
        }
        continue;
      }
      stats.amazonSourceValid++;
      tallyStrat(perStrategySourceValid, candidate);
      const amazonData = amazonResult.data;
      const amazonPrice = amazonData.price ?? resolved.price ?? candidate.priceHint ?? 0;

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
        runId: opts.runId,
      });
      if (!demandResult.data.demandPassed) {
        stats.demandFailed++;
        bump(demandResult.data.rejectionReason);
        continue;
      }
      stats.demandPassed++;
      tallyStrat(perStrategyDemand, candidate);

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
        runId: opts.runId,
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
        runId: opts.runId,
      });
      if (!businessFitResult.data.businessFitPassed) {
        stats.businessFitFailed++;
        bump(businessFitResult.data.businessFitRejectionReason ?? RejectionReason.BUSINESS_FIT_FAILED);
        continue;
      }
      stats.businessFitPassed++;

      const costResult = await costAgent.run({ ottoProductId: candidate.ottoProductId, amazonPrice, runId: opts.runId });
      stats.costCalculated++;

      const finalResult = await finalAgent.run({
        ottoProductId: candidate.ottoProductId,
        asin: resolved.asin,
        amazonUrl: resolved.amazonUrl,
        amazon: amazonResult.data,
        demand: demandResult.data,
        compliance: complianceResult.data,
        businessFit: businessFitResult.data,
        runId: opts.runId,
      });
      if (!finalResult.data.passed) {
        stats.finalRejected++;
        bump(finalResult.data.rejectionReason);
        continue;
      }
      stats.finalValidated++;
      tallyStrat(perStrategyFinal, candidate);

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

    if (opts.closeBrowser) {
      try {
        await amazonClient.close();
      } catch (err) {
        log.warn('amazon browser close failed', { err: (err as Error).message });
      }
    }
  }

  // Export: same-batch dedupe + cross-batch filter + CSV + manual QA + persist.
  const exporter = new CsvExportAgent();
  const exportResult = await exporter.run({
    products: validated,
    discoveryRunId: opts.runId,
    repeatPolicy: opts.repeatPolicy,
    repeatLookbackDays: opts.repeatLookbackDays,
    isSynthetic: opts.isSynthetic,
  });
  stats.finalValidatedBeforeDedupe = exportResult.data.finalValidatedBeforeDedupe;
  stats.sameBatchDuplicatesRemoved = exportResult.data.sameBatchDuplicatesRemoved;
  stats.crossBatchRepeatsRemoved = exportResult.data.crossBatchRepeatsRemoved;
  stats.exportedAfterAllFilters = exportResult.data.exportedAfterAllFilters;
  stats.exportedCount = exportResult.data.rowCount;
  stats.repeatPolicy = exportResult.data.repeatPolicy;
  stats.repeatLookbackDays = exportResult.data.repeatLookbackDays;

  // Exported ASINs = validated ASINs that survived the cross-batch filter
  // (same-batch dedupe keeps one row per ASIN, so the ASIN still exports).
  const excludedAsins = new Set(exportResult.data.crossBatchExclusions.map((e) => e.asin));
  const perStrategyExported: Record<string, number> = {};
  const seenExportAsin = new Set<string>();
  for (const v of validated) {
    if (excludedAsins.has(v.asin) || seenExportAsin.has(v.asin)) continue;
    seenExportAsin.add(v.asin);
    const strat = discovery.strategyByAsin[v.asin]?.primaryStrategy ?? 'unknown';
    perStrategyExported[strat] = (perStrategyExported[strat] ?? 0) + 1;
  }

  // Per-strategy efficiency table + a recommendation from this run's data.
  const strategyEfficiency = buildStrategyEfficiency(
    discovery.perStrategy.map((st) => ({
      strategy: st.strategy,
      tokensConsumed: st.tokensConsumed,
      rawReturned: st.rawProductsReturned,
      uniqueAsins: st.uniqueAsinsContributed,
      accepted: st.accepted,
      sourceValid: perStrategySourceValid[st.strategy] ?? 0,
      demandPassed: perStrategyDemand[st.strategy] ?? 0,
      finalValidated: perStrategyFinal[st.strategy] ?? 0,
      exportedAfterFilters: perStrategyExported[st.strategy] ?? 0,
    })),
  );
  const strategyRecommendation = recommendStrategyConfig(strategyEfficiency, opts.profileName ?? 'custom');

  return {
    stats,
    perCategory: discovery.perCategory,
    perStrategy: discovery.perStrategy,
    strategiesRun: discovery.strategiesRun,
    strategiesSkipped: discovery.strategiesSkipped,
    strategyMode: discovery.strategyMode,
    strategyEfficiency,
    strategyRecommendation,
    duplicateAsinsAcrossStrategies: discovery.duplicateAsinsAcrossStrategies,
    uniqueAsinCandidates: discovery.asinNativeCount,
    strategyByAsin: discovery.strategyByAsin,
    tokenBudgetStopped: discovery.tokenBudgetStopped,
    filterReasons: discovery.filterReasons,
    tokens: discovery.tokens,
    keepaError: discovery.error,
    sourceFailureSamples,
    validated,
    exportBatchId: exportResult.data.exportBatchId,
    csvPath: exportResult.data.filePath,
    qaPath: exportResult.data.manualQaCsvPath,
  };
}

interface ResolvedAsinInfo {
  asin: string;
  amazonUrl: string;
  score: number;
  price?: number;
  productMatchType: 'exact' | 'similar';
}

async function resolveAsin(
  candidate: ProductCandidate,
  asinAgent: BasicAmazonAsinResolverAgent,
  runId: string,
): Promise<ResolvedAsinInfo | null> {
  const native = asinNativeResolution(candidate);
  if (native) return native;
  const asinResult = await asinAgent.run({ candidate, runId });
  if (asinResult.status !== 'pass' || !asinResult.data.asin) return null;
  return {
    asin: asinResult.data.asin,
    amazonUrl: asinResult.data.amazonUrl ?? `https://www.amazon.com/dp/${asinResult.data.asin}`,
    score: asinResult.score,
    price: asinResult.data.price,
    productMatchType: asinResult.score >= 80 ? 'exact' : 'similar',
  };
}

function makeStats(opts: KeepaRunOptions): KeepaRunStats {
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
    repeatPolicy: opts.repeatPolicy,
    repeatLookbackDays: opts.repeatLookbackDays,
    rejectionCounts: {},
  };
}
