import { v4 as uuidv4 } from 'uuid';
import { getEbayClient, type EbayBrowseItem, type EbaySearchResult } from '@/clients/ebayClient';
import { getSupabase } from '@/clients/supabaseClient';
import { logger } from '@/utils/logger';
import { clamp } from '@/utils/scoring';
import { persistAgentLog, recordRejection } from '@/agents/baseAgent';
import { RejectionReason } from '@/utils/rejectionReasons';
import type { ProductCandidate } from '@/types/product';

export interface DiscoveryInput {
  discoveryRunId: string;
  keywords: string[];
  limitPerKeyword?: number;
  categoryIds?: string[];
}

export interface KeywordDiscoveryStats {
  keyword: string;
  fetched: number;
  inserted: number;
  rejected: number;
  apiError?: { code: string; message: string };
}

export interface DiscoveryOutput {
  candidates: ProductCandidate[];
  perKeyword: KeywordDiscoveryStats[];
}

export class EbayKeywordDiscoveryAgent {
  readonly name = 'EbayKeywordDiscoveryAgent';
  private readonly log = logger.child(this.name);

  async run(input: DiscoveryInput): Promise<DiscoveryOutput> {
    const ebay = getEbayClient();
    const supabase = getSupabase();
    const out: ProductCandidate[] = [];
    const perKeyword: KeywordDiscoveryStats[] = [];
    const limit = input.limitPerKeyword ?? 50;

    for (const keyword of input.keywords) {
      this.log.info('Searching eBay', { keyword, limit });
      const result: EbaySearchResult = await ebay.search(keyword, { limit, categoryIds: input.categoryIds });
      const stats: KeywordDiscoveryStats = { keyword, fetched: 0, inserted: 0, rejected: 0 };

      if (result.error) {
        stats.apiError = { code: result.error.code, message: result.error.message };
        this.log.error('eBay search returned error', {
          keyword,
          code: result.error.code,
          message: result.error.message,
        });
        await persistAgentLog({
          agentName: this.name,
          runId: input.discoveryRunId,
          level: 'error',
          message: `eBay search error: ${result.error.code}`,
          data: { keyword, ...result.error },
        });
        await recordRejection(
          keywordSentinelId(keyword),
          'discovery',
          RejectionReason.EBAY_API_ERROR,
          { keyword, ...result.error },
        );
        perKeyword.push(stats);
        continue;
      }

      const items = result.items;
      stats.fetched = items.length;
      this.log.info('eBay search complete', { keyword, count: items.length });

      if (items.length === 0) {
        await persistAgentLog({
          agentName: this.name,
          runId: input.discoveryRunId,
          level: 'warn',
          message: 'eBay returned 0 candidates',
          data: { keyword },
        });
        await recordRejection(
          keywordSentinelId(keyword),
          'discovery',
          RejectionReason.NO_CANDIDATES_FOUND,
          { keyword },
        );
        perKeyword.push(stats);
        continue;
      }

      for (const item of items) {
        const validation = validateRawItem(item);
        if (validation.rejection) {
          stats.rejected++;
          await recordRejection(
            `EBAY::${item.itemId ?? 'unknown'}`,
            'discovery',
            validation.rejection,
            { keyword, itemId: item.itemId, title: item.title },
          );
          await persistAgentLog({
            agentName: this.name,
            runId: input.discoveryRunId,
            level: 'warn',
            message: `Raw candidate rejected: ${validation.rejection}`,
            data: { keyword, itemId: item.itemId },
          });
          continue;
        }

        const ottoProductId = `OTTO-${uuidv4()}`;
        const priceHint = item.price ? Number(item.price.value) : undefined;
        const candidate: ProductCandidate = {
          ottoProductId,
          source: 'ebay_browse_api',
          sourceUrl: item.itemWebUrl,
          marketplace: 'ebay',
          keyword,
          categoryHint: item.categories?.[0]?.categoryName,
          productTitleRaw: item.title,
          imageUrlHint: item.image?.imageUrl,
          priceHint,
          discoveryScore: discoveryScoreFor(item),
        };
        out.push(candidate);
        stats.inserted++;

        try {
          await supabase.from('raw_candidates').insert({
            discovery_run_id: input.discoveryRunId,
            source: candidate.source,
            source_url: candidate.sourceUrl,
            marketplace: candidate.marketplace,
            keyword: candidate.keyword,
            category_hint: candidate.categoryHint,
            product_title_raw: candidate.productTitleRaw,
            brand_hint: candidate.brandHint,
            image_url_hint: candidate.imageUrlHint,
            price_hint: candidate.priceHint,
            discovery_score: candidate.discoveryScore,
            raw_payload: item as unknown as Record<string, unknown>,
          });
        } catch (err) {
          this.log.warn('raw_candidates insert failed', { err: (err as Error).message });
        }

        await persistAgentLog({
          agentName: this.name,
          productId: ottoProductId,
          runId: input.discoveryRunId,
          level: 'info',
          message: 'Candidate discovered',
          data: { keyword, title: candidate.productTitleRaw },
        });
      }

      perKeyword.push(stats);
    }

    return { candidates: out, perKeyword };
  }
}

function keywordSentinelId(keyword: string): string {
  return `KEYWORD::${keyword.replace(/\s+/g, '_').toLowerCase()}`;
}

function validateRawItem(item: EbayBrowseItem): { rejection?: string } {
  if (!item || typeof item !== 'object') return { rejection: RejectionReason.BAD_SOURCE_DATA };
  if (!item.title || typeof item.title !== 'string' || item.title.trim().length === 0) {
    return { rejection: RejectionReason.MISSING_TITLE };
  }
  if (!item.itemWebUrl) return { rejection: RejectionReason.BAD_SOURCE_DATA };
  if (!item.categories || item.categories.length === 0 || !item.categories[0]?.categoryName) {
    return { rejection: RejectionReason.MISSING_CATEGORY };
  }
  return {};
}

function discoveryScoreFor(item: EbayBrowseItem): number {
  let score = 50;
  const fb = Number(item.seller?.feedbackPercentage ?? 0);
  if (Number.isFinite(fb)) score += (fb - 95) * 2;
  if ((item.seller?.feedbackScore ?? 0) > 1000) score += 5;
  if (item.topRatedBuyingExperience) score += 10;
  return clamp(score);
}
