import { getAmazonBrowserClient, type AmazonSearchHit } from '@/clients/amazonBrowserClient';
import { getSupabase } from '@/clients/supabaseClient';
import { env } from '@/config/env';
import { logger } from '@/utils/logger';
import { makeResult, persistAgentResult, recordRejection } from '@/agents/baseAgent';
import { buildAmazonQueries } from '@/utils/amazonQueryBuilder';
import { scoreAmazonHit, type ProductMatchType, type ScoredHit } from '@/utils/amazonScoring';
import { amazonUrlFromAsin } from '@/utils/normalize';
import { RejectionReason } from '@/utils/rejectionReasons';
import type { AgentResult } from '@/types/agent';
import type { ProductCandidate } from '@/types/product';

const MIN_ACCEPT_CONFIDENCE = 75;
const RESOLVER_METHOD = 'playwright_amazon_search_v1';

export interface AsinResolverInput {
  candidate: ProductCandidate;
  runId?: string;
  rawCandidateId?: string;
}

export interface AsinResolverAttempt {
  query: string;
  queryStrategy: string;
  asin: string;
  amazonUrl: string;
  title: string;
  brand?: string;
  price?: number;
  rating?: number;
  reviewCount?: number;
  imageUrl?: string;
  scored: ScoredHit;
  accepted: boolean;
  rejectionReason?: string;
}

export interface AsinResolverData {
  asin?: string;
  amazonUrl?: string;
  title?: string;
  brand?: string;
  price?: number;
  rating?: number;
  reviewCount?: number;
  imageUrl?: string;
  productMatchType?: ProductMatchType;
  finalProductMatchConfidence: number;
  titleSimilarityScore?: number;
  keywordOverlapScore?: number;
  resolverMethod: string;
  attempts: number;
  rejectionReason?: string;
  /** Legacy: kept so older callers reading `.confidence` still get a number. */
  confidence: number;
}

export class BasicAmazonAsinResolverAgent {
  readonly name = 'BasicAmazonAsinResolverAgent';
  private readonly log = logger.child(this.name);

  async run({ candidate, runId, rawCandidateId }: AsinResolverInput): Promise<AgentResult<AsinResolverData>> {
    const amazon = getAmazonBrowserClient();

    if (!amazon.isImplemented) {
      return this.failNotImplemented(candidate, runId);
    }

    const queries = buildAmazonQueries(candidate, env.amazon.maxQueriesPerCandidate);
    if (queries.length === 0) {
      return this.failWith(candidate, runId, RejectionReason.ASIN_NOT_RESOLVED, 'No queries could be generated', 0);
    }

    const attempts: AsinResolverAttempt[] = [];
    let searchHadError = false;
    let lastSearchError: string | null = null;

    for (const strategy of queries) {
      const result = await amazon.search(strategy.query, env.amazon.maxResultsPerQuery);
      if (result.error) {
        searchHadError = true;
        lastSearchError = `${result.error.code}: ${result.error.message}`;
        this.log.warn('Amazon search error', {
          ottoProductId: candidate.ottoProductId,
          query: strategy.query,
          code: result.error.code,
        });
        // Browser-launch failures will repeat - bail out early.
        if (result.error.code === 'BROWSER_LAUNCH_FAILED') break;
        continue;
      }
      for (const hit of result.hits) {
        const scored = scoreAmazonHit(hit, {
          productTitleRaw: candidate.productTitleRaw,
          brandHint: candidate.brandHint,
          keyword: candidate.keyword,
          categoryHint: candidate.categoryHint,
        });
        const rejectionReason = hardExclusionReason(hit, scored);
        const accepted = !rejectionReason && scored.finalProductMatchConfidence >= MIN_ACCEPT_CONFIDENCE;
        attempts.push({
          query: strategy.query,
          queryStrategy: strategy.label,
          asin: hit.asin,
          amazonUrl: hit.amazonUrl || amazonUrlFromAsin(hit.asin),
          title: hit.title,
          brand: hit.brand,
          price: hit.price,
          rating: hit.rating,
          reviewCount: hit.reviewCount,
          imageUrl: hit.imageUrl,
          scored,
          accepted,
          rejectionReason: accepted ? undefined : (rejectionReason ?? RejectionReason.LOW_CONFIDENCE_ASIN_MATCH),
        });
      }
    }

    await this.persistAttempts(candidate.ottoProductId, rawCandidateId, attempts);

    const accepted = attempts.filter((a) => a.accepted)
      .sort((a, b) => b.scored.finalProductMatchConfidence - a.scored.finalProductMatchConfidence);

    if (accepted.length > 0) {
      const best = accepted[0];
      await this.markAccepted(candidate.ottoProductId, best.asin);
      const data: AsinResolverData = {
        asin: best.asin,
        amazonUrl: best.amazonUrl,
        title: best.title,
        brand: best.brand,
        price: best.price,
        rating: best.rating,
        reviewCount: best.reviewCount,
        imageUrl: best.imageUrl,
        productMatchType: best.scored.productMatchType,
        finalProductMatchConfidence: best.scored.finalProductMatchConfidence,
        titleSimilarityScore: best.scored.titleSimilarityScore,
        keywordOverlapScore: best.scored.keywordOverlapScore,
        resolverMethod: RESOLVER_METHOD,
        attempts: attempts.length,
        confidence: best.scored.finalProductMatchConfidence,
      };
      const result = makeResult<AsinResolverData>(
        this.name,
        candidate.ottoProductId,
        'pass',
        best.scored.finalProductMatchConfidence,
        [
          `Resolved ASIN ${best.asin} (${best.scored.productMatchType}, conf=${best.scored.finalProductMatchConfidence.toFixed(0)}, attempts=${attempts.length})`,
        ],
        data,
      );
      await persistAgentResult(result, runId);
      return result;
    }

    // No accepted candidate.  Pick the most informative rejection reason.
    let rejectionReason: string;
    if (attempts.length === 0) {
      rejectionReason = searchHadError
        ? RejectionReason.AMAZON_SEARCH_UNAVAILABLE
        : RejectionReason.ASIN_NOT_RESOLVED;
    } else if (attempts.every((a) => a.rejectionReason === RejectionReason.LOW_CONFIDENCE_ASIN_MATCH)) {
      rejectionReason = RejectionReason.LOW_CONFIDENCE_ASIN_MATCH;
    } else {
      rejectionReason = RejectionReason.ASIN_NOT_RESOLVED;
    }

    return this.failWith(
      candidate,
      runId,
      rejectionReason,
      lastSearchError ?? `${attempts.length} hits, none above ${MIN_ACCEPT_CONFIDENCE}% confidence`,
      attempts.length,
    );
  }

  private async failNotImplemented(
    candidate: ProductCandidate,
    runId?: string,
  ): Promise<AgentResult<AsinResolverData>> {
    const reasonCode = RejectionReason.AMAZON_RESOLUTION_NOT_IMPLEMENTED;
    await recordRejection(candidate.ottoProductId, 'asin_resolution', reasonCode, {
      note: 'AmazonBrowserClient.isImplemented = false',
    });
    const data: AsinResolverData = {
      finalProductMatchConfidence: 0,
      resolverMethod: 'not_implemented',
      attempts: 0,
      rejectionReason: reasonCode,
      confidence: 0,
    };
    const result = makeResult<AsinResolverData>(this.name, candidate.ottoProductId, 'fail', 0, [reasonCode], data);
    await persistAgentResult(result, runId);
    return result;
  }

  private async failWith(
    candidate: ProductCandidate,
    runId: string | undefined,
    reasonCode: string,
    detail: string,
    attempts: number,
  ): Promise<AgentResult<AsinResolverData>> {
    await recordRejection(candidate.ottoProductId, 'asin_resolution', reasonCode, {
      detail,
      productTitleRaw: candidate.productTitleRaw,
      attempts,
    });
    const data: AsinResolverData = {
      finalProductMatchConfidence: 0,
      resolverMethod: RESOLVER_METHOD,
      attempts,
      rejectionReason: reasonCode,
      confidence: 0,
    };
    const result = makeResult<AsinResolverData>(
      this.name,
      candidate.ottoProductId,
      'fail',
      0,
      [reasonCode, detail],
      data,
    );
    await persistAgentResult(result, runId);
    return result;
  }

  private async persistAttempts(
    ottoProductId: string,
    rawCandidateId: string | undefined,
    attempts: AsinResolverAttempt[],
  ): Promise<void> {
    if (attempts.length === 0) return;
    const supabase = getSupabase();
    const rows = attempts.map((a) => ({
      otto_product_id: ottoProductId,
      raw_candidate_id: rawCandidateId ?? null,
      asin: a.asin,
      amazon_url: a.amazonUrl,
      resolver: this.name,
      resolver_method: RESOLVER_METHOD,
      confidence: a.scored.finalProductMatchConfidence,
      resolved_title: a.title,
      resolved_brand: a.brand ?? null,
      resolved_price: a.price ?? null,
      rating: a.rating ?? null,
      review_count: a.reviewCount ?? null,
      image_url: a.imageUrl ?? null,
      product_match_type: a.scored.productMatchType,
      title_similarity_score: a.scored.titleSimilarityScore,
      keyword_overlap_score: a.scored.keywordOverlapScore,
      source_confidence_score: a.scored.finalProductMatchConfidence,
      final_product_match_confidence: a.scored.finalProductMatchConfidence,
      rejection_reason: a.accepted ? null : a.rejectionReason,
      accepted: a.accepted,
      raw_payload: {
        queryStrategy: a.queryStrategy,
        query: a.query,
        scored: a.scored as unknown as Record<string, unknown>,
      },
    }));
    try {
      await supabase.from('asin_candidates').insert(rows);
    } catch (err) {
      this.log.warn('asin_candidates insert failed', { err: (err as Error).message });
    }
  }

  private async markAccepted(_ottoProductId: string, _asin: string): Promise<void> {
    // The accepted row is already inserted with accepted=true above; this hook
    // exists so the agent can later promote a single winner across multiple
    // resolver passes (e.g. when the Zik resolver lands).
    return;
  }
}

function hardExclusionReason(hit: AmazonSearchHit, scored: ScoredHit): string | null {
  if (!hit.asin) return RejectionReason.ASIN_NOT_RESOLVED;
  if (!hit.amazonUrl) return RejectionReason.ASIN_NOT_RESOLVED;
  if (hit.isAmazonBasics) return RejectionReason.AMAZON_BASICS;
  if (hit.isRenewedOrRefurbished) return RejectionReason.AMAZON_RENEWED_OR_REFURBISHED;
  if (hit.isBundleOrMultipack) return RejectionReason.AMAZON_BUNDLE_OR_MULTIPACK;
  if (hit.sponsored && scored.titleSimilarityScore < 40) return RejectionReason.LOW_CONFIDENCE_ASIN_MATCH;
  return null;
}
