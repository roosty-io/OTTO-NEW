import { getAmazonBrowserClient, type AmazonProductSnapshot } from '@/clients/amazonBrowserClient';
import { getSupabase } from '@/clients/supabaseClient';
import { env } from '@/config/env';
import { THRESHOLDS } from '@/config/thresholds';
import { logger } from '@/utils/logger';
import { detectAmazonBasics, detectMultipack, detectRenewed } from '@/utils/normalize';
import { clamp } from '@/utils/scoring';
import { makeResult, persistAgentResult, recordRejection } from '@/agents/baseAgent';
import type { AgentResult } from '@/types/agent';

export interface AmazonValidationInput {
  ottoProductId: string;
  asin: string;
  runId?: string;
}

export interface AmazonValidationData {
  snapshot?: AmazonProductSnapshot;
  inStock: boolean;
  hasSourcePrice: boolean;
  isRenewedOrRefurbished: boolean;
  isAmazonBasics: boolean;
  isBundleOrMultipack: boolean;
  deliveryDays?: number;
  withinDeliveryWindow: boolean;
  passed: boolean;
  reasons: string[];
}

export class AmazonSourceValidationAgent {
  readonly name = 'AmazonSourceValidationAgent';
  private readonly log = logger.child(this.name);

  async run({ ottoProductId, asin, runId }: AmazonValidationInput): Promise<AgentResult<AmazonValidationData>> {
    const amazon = getAmazonBrowserClient();
    const supabase = getSupabase();
    const zip = env.pipeline.defaultZipCode;
    const maxDays = THRESHOLDS.DEFAULT_MAX_DELIVERY_DAYS;

    const snap = await amazon.getProduct(asin, zip);
    if (!snap) {
      const data: AmazonValidationData = {
        inStock: false,
        hasSourcePrice: false,
        isRenewedOrRefurbished: false,
        isAmazonBasics: false,
        isBundleOrMultipack: false,
        withinDeliveryWindow: false,
        passed: false,
        reasons: ['Could not fetch Amazon product snapshot'],
      };
      await this.persist(ottoProductId, asin, data);
      await recordRejection(ottoProductId, 'amazon_source', 'no_snapshot');
      const r = makeResult(this.name, ottoProductId, 'fail', 0, data.reasons, data);
      await persistAgentResult(r, runId);
      return r;
    }

    const reasons: string[] = [];
    const isBundle = snap.isBundleOrMultipack || detectMultipack(snap.title);
    const isRenewed = snap.isRenewedOrRefurbished || detectRenewed(snap.title);
    const isAB = snap.isAmazonBasics || detectAmazonBasics(snap.title, snap.brand);
    const hasPrice = typeof snap.price === 'number' && snap.price > 0;
    const inStock = snap.inStock;
    const deliveryDays = snap.deliveryDays;
    const withinWindow = deliveryDays === undefined ? true : deliveryDays <= maxDays;

    if (!inStock) reasons.push('Amazon source out of stock');
    if (!hasPrice) reasons.push('Amazon source has no price');
    if (isRenewed) reasons.push('Amazon source is renewed/refurbished');
    if (isAB) reasons.push('Amazon source is Amazon Basics');
    if (isBundle) reasons.push('Amazon source is bundle/multipack');
    if (!withinWindow) reasons.push(`Delivery ${deliveryDays}d > ${maxDays}d`);

    const passed = inStock && hasPrice && !isRenewed && !isAB && !isBundle && withinWindow;
    const data: AmazonValidationData = {
      snapshot: snap,
      inStock,
      hasSourcePrice: hasPrice,
      isRenewedOrRefurbished: isRenewed,
      isAmazonBasics: isAB,
      isBundleOrMultipack: isBundle,
      deliveryDays,
      withinDeliveryWindow: withinWindow,
      passed,
      reasons,
    };

    await this.persist(ottoProductId, asin, data);
    if (!passed) {
      await recordRejection(ottoProductId, 'amazon_source', reasons[0] ?? 'unspecified', { reasons });
    }

    const score = passed ? clamp(100 - reasons.length * 10) : 0;
    const result = makeResult(this.name, ottoProductId, passed ? 'pass' : 'fail', score, reasons, data);
    await persistAgentResult(result, runId);
    return result;
  }

  private async persist(ottoProductId: string, asin: string, data: AmazonValidationData): Promise<void> {
    const supabase = getSupabase();
    try {
      await supabase.from('amazon_source_checks').insert({
        otto_product_id: ottoProductId,
        asin,
        in_stock: data.inStock,
        has_source_price: data.hasSourcePrice,
        is_renewed_or_refurbished: data.isRenewedOrRefurbished,
        is_amazon_basics: data.isAmazonBasics,
        is_bundle_or_multipack: data.isBundleOrMultipack,
        delivery_days: data.deliveryDays ?? null,
        within_delivery_window: data.withinDeliveryWindow,
        passed: data.passed,
        reasons: data.reasons,
        raw_payload: (data.snapshot as unknown as Record<string, unknown>) ?? {},
      });
    } catch (err) {
      this.log.warn('amazon_source_checks insert failed', { err: (err as Error).message });
    }
  }
}
