import { getAmazonBrowserClient } from '@/clients/amazonBrowserClient';
import { getSupabase } from '@/clients/supabaseClient';
import { logger } from '@/utils/logger';
import { makeResult, persistAgentResult, recordRejection } from '@/agents/baseAgent';
import { amazonUrlFromAsin } from '@/utils/normalize';
import { clamp } from '@/utils/scoring';
import { RejectionReason } from '@/utils/rejectionReasons';
import type { AgentResult } from '@/types/agent';
import type { ProductCandidate } from '@/types/product';

export interface AsinResolverInput {
  candidate: ProductCandidate;
  runId?: string;
}

export interface AsinResolverData {
  asin?: string;
  amazonUrl?: string;
  title?: string;
  brand?: string;
  price?: number;
  confidence: number;
}

export class BasicAmazonAsinResolverAgent {
  readonly name = 'BasicAmazonAsinResolverAgent';
  private readonly log = logger.child(this.name);

  async run({ candidate, runId }: AsinResolverInput): Promise<AgentResult<AsinResolverData>> {
    const amazon = getAmazonBrowserClient();
    const supabase = getSupabase();

    if (!amazon.isImplemented) {
      const reasonCode = RejectionReason.AMAZON_RESOLUTION_NOT_IMPLEMENTED;
      await recordRejection(candidate.ottoProductId, 'asin_resolution', reasonCode, {
        note: 'Real Amazon browser automation not yet wired up. Enable OTTO_MOCK_MODE=true to exercise downstream stages locally.',
      });
      const result = makeResult<AsinResolverData>(
        this.name,
        candidate.ottoProductId,
        'fail',
        0,
        [reasonCode],
        { confidence: 0 },
      );
      await persistAgentResult(result, runId);
      return result;
    }

    const hit = await amazon.resolveByTitle(candidate.productTitleRaw);
    if (!hit) {
      const reasonCode = RejectionReason.ASIN_NOT_RESOLVED;
      await recordRejection(candidate.ottoProductId, 'asin_resolution', reasonCode, {
        productTitleRaw: candidate.productTitleRaw,
      });
      const result = makeResult<AsinResolverData>(
        this.name,
        candidate.ottoProductId,
        'fail',
        0,
        [reasonCode],
        { confidence: 0 },
      );
      await persistAgentResult(result, runId);
      return result;
    }

    const confidence = scoreMatch(candidate.productTitleRaw, hit.title);
    const data: AsinResolverData = {
      asin: hit.asin,
      amazonUrl: hit.amazonUrl ?? amazonUrlFromAsin(hit.asin),
      title: hit.title,
      brand: hit.brand,
      price: hit.price,
      confidence,
    };

    try {
      await supabase.from('asin_candidates').insert({
        otto_product_id: candidate.ottoProductId,
        asin: hit.asin,
        amazon_url: data.amazonUrl,
        resolver: this.name,
        confidence,
        resolved_title: hit.title,
        resolved_brand: hit.brand,
        resolved_price: hit.price,
        raw_payload: hit as unknown as Record<string, unknown>,
      });
    } catch (err) {
      this.log.warn('asin_candidates insert failed', { err: (err as Error).message });
    }

    const status = confidence >= 60 ? 'pass' : confidence >= 30 ? 'warning' : 'fail';
    const result = makeResult<AsinResolverData>(
      this.name,
      candidate.ottoProductId,
      status,
      confidence,
      [`Resolved ASIN ${hit.asin} with confidence ${confidence}`],
      data,
    );
    await persistAgentResult(result, runId);
    return result;
  }
}

function scoreMatch(a: string, b: string): number {
  if (!a || !b) return 0;
  const aTokens = new Set(tokenize(a));
  const bTokens = new Set(tokenize(b));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;
  let overlap = 0;
  for (const t of aTokens) if (bTokens.has(t)) overlap++;
  return clamp((overlap / Math.min(aTokens.size, bTokens.size)) * 100);
}

function tokenize(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
}
