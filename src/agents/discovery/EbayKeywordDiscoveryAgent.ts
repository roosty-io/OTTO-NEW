import { v4 as uuidv4 } from 'uuid';
import { getEbayClient } from '@/clients/ebayClient';
import { getSupabase } from '@/clients/supabaseClient';
import { logger } from '@/utils/logger';
import { clamp } from '@/utils/scoring';
import { persistAgentLog } from '@/agents/baseAgent';
import type { ProductCandidate } from '@/types/product';

export interface DiscoveryInput {
  discoveryRunId: string;
  keywords: string[];
  limitPerKeyword?: number;
  categoryIds?: string[];
}

export interface DiscoveryOutput {
  candidates: ProductCandidate[];
}

export class EbayKeywordDiscoveryAgent {
  readonly name = 'EbayKeywordDiscoveryAgent';
  private readonly log = logger.child(this.name);

  async run(input: DiscoveryInput): Promise<DiscoveryOutput> {
    const ebay = getEbayClient();
    const supabase = getSupabase();
    const out: ProductCandidate[] = [];
    const limit = input.limitPerKeyword ?? 10;

    for (const keyword of input.keywords) {
      this.log.info('Searching eBay', { keyword, limit });
      const items = await ebay.search(keyword, { limit, categoryIds: input.categoryIds });
      this.log.info('eBay search complete', { keyword, count: items.length });

      for (const item of items) {
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
    }

    return { candidates: out };
  }
}

function discoveryScoreFor(item: {
  seller?: { feedbackPercentage?: string; feedbackScore?: number };
  topRatedBuyingExperience?: boolean;
}): number {
  let score = 50;
  const fb = Number(item.seller?.feedbackPercentage ?? 0);
  if (Number.isFinite(fb)) score += (fb - 95) * 2;
  if ((item.seller?.feedbackScore ?? 0) > 1000) score += 5;
  if (item.topRatedBuyingExperience) score += 10;
  return clamp(score);
}
