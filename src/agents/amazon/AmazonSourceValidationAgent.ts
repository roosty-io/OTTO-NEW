import {
  getAmazonBrowserClient,
  type AmazonProductPageData,
} from '@/clients/amazonBrowserClient';
import { getSupabase } from '@/clients/supabaseClient';
import { env } from '@/config/env';
import { THRESHOLDS } from '@/config/thresholds';
import { logger } from '@/utils/logger';
import { amazonUrlFromAsin } from '@/utils/normalize';
import { parseDelivery } from '@/utils/deliveryParser';
import {
  detectAmazonBasicsStrong,
  detectBundleOrMultipack,
  detectRestrictedSignals,
  detectUsedRenewedRefurbished,
  type RestrictedSignalCategory,
} from '@/utils/productRiskText';
import { scoreAmazonSource } from '@/utils/amazonSourceScoring';
import { evaluateShippingGate, type DeliveryContext, type ShippingGateResult, type ShippingConfidence } from '@/utils/amazonShippingGate';
import { makeResult, persistAgentResult, recordRejection } from '@/agents/baseAgent';
import { RejectionReason } from '@/utils/rejectionReasons';
import type { AgentResult } from '@/types/agent';

export interface AmazonValidationInput {
  ottoProductId: string;
  asin: string;
  amazonUrl?: string;
  runId?: string;
}

export interface AmazonValidationData {
  asin: string;
  amazonUrl: string;
  pageLoaded?: boolean;
  productTitle?: string;
  brand?: string;
  price?: number;
  priceCurrency?: string;
  stockStatus: 'in_stock' | 'out_of_stock' | 'unknown';
  inStock: boolean;
  buyable: boolean;
  hasSourcePrice: boolean;
  deliveryText?: string;
  rawDeliveryText?: string;
  fastestDeliveryText?: string;
  deliveryContext: DeliveryContext;
  addressZipUsed?: string;
  deliveryParseMethod?: string;
  estimatedDeliveryDays?: number;
  deliveryParseConfidence?: 'high' | 'medium' | 'low' | 'none';
  deliveryWindowStart?: string;
  deliveryWindowEnd?: string;
  withinDeliveryWindow: boolean;
  // Prime / FBA / Amazon-fulfillment signals
  primeSignalDetected: boolean;
  primeSignalSource?: string;
  fbaSignalDetected: boolean;
  shipsFromAmazon: boolean;
  soldByAmazon: boolean;
  fulfilledByAmazon: boolean;
  // Shipping gate outcome
  shippingGateResult: ShippingGateResult;
  shippingConfidence: ShippingConfidence;
  shippingReviewRequired: boolean;
  sellerText?: string;
  shipsFromText?: string;
  soldByText?: string;
  conditionText?: string;
  rating?: number;
  reviewCount?: number;
  couponDetected: boolean;
  couponText?: string;
  isAmazonBasics: boolean;
  isRenewedOrRefurbished: boolean;
  isBundleOrMultipack: boolean;
  restrictedSignals: string[];
  restrictedCategories: RestrictedSignalCategory[];
  warningBadges: string[];
  productBullets: string[];
  categoryBreadcrumbs: string[];
  sourceValidityScore: number;
  sourceValid: boolean;
  passed: boolean;
  reasons: string[];
  rejectionReason?: string;
  /** Legacy field referenced by the pipeline scripts. */
  snapshot?: AmazonProductPageData;
  deliveryDays?: number;
}

export class AmazonSourceValidationAgent {
  readonly name = 'AmazonSourceValidationAgent';
  private readonly log = logger.child(this.name);

  async run({ ottoProductId, asin, amazonUrl, runId }: AmazonValidationInput): Promise<AgentResult<AmazonValidationData>> {
    const amazon = getAmazonBrowserClient();
    const url = amazonUrl && /\/dp\//.test(amazonUrl) ? amazonUrl : amazonUrlFromAsin(asin);

    if (!amazon.isImplemented) {
      return this.failWithCode(
        ottoProductId,
        asin,
        url,
        runId,
        RejectionReason.AMAZON_VALIDATION_UNAVAILABLE,
        'Client is a placeholder',
      );
    }

    const page = await amazon.validateProductPage(asin, url, { zipCode: env.pipeline.defaultZipCode });

    if (!page.pageLoaded) {
      const code = page.blockedOrCaptcha
        ? RejectionReason.AMAZON_BLOCKED_OR_CAPTCHA
        : page.validationErrorCode === 'BROWSER_LAUNCH_FAILED'
          ? RejectionReason.AMAZON_VALIDATION_UNAVAILABLE
          : RejectionReason.AMAZON_PAGE_UNAVAILABLE;
      return this.failWithCode(ottoProductId, asin, url, runId, code, page.validationErrorCode ?? 'page_not_loaded', page);
    }

    const data = this.assessPage(ottoProductId, asin, url, page);

    await this.persist(ottoProductId, data);

    if (data.rejectionReason) {
      await recordRejection(ottoProductId, 'amazon_source', data.rejectionReason, {
        reasons: data.reasons,
        sourceValidityScore: data.sourceValidityScore,
        asin,
        amazonUrl: url,
      });
    }

    const result = makeResult(
      this.name,
      ottoProductId,
      data.passed ? 'pass' : 'fail',
      data.sourceValidityScore,
      data.reasons,
      data,
    );
    await persistAgentResult(result, runId);
    return result;
  }

  private assessPage(
    ottoProductId: string,
    asin: string,
    amazonUrl: string,
    page: AmazonProductPageData,
  ): AmazonValidationData {
    const reasons: string[] = [];
    let rejectionReason: string | undefined;
    const fail = (code: string, reason: string) => {
      if (!rejectionReason) rejectionReason = code;
      reasons.push(reason);
    };

    const title = page.productTitle ?? '';
    const brand = page.brand;
    const bullets = page.productBullets ?? [];
    const breadcrumbs = page.categoryBreadcrumbs ?? [];
    const warningBadges = page.warningBadges ?? [];

    const delivery = parseDelivery(page.deliveryText, THRESHOLDS.DEFAULT_MAX_DELIVERY_DAYS);
    const isAmazonBasics = detectAmazonBasicsStrong({ title, brand });
    const condition = detectUsedRenewedRefurbished(`${title} ${page.conditionText ?? ''}`);
    const bundleHit = detectBundleOrMultipack(title);
    const restricted = detectRestrictedSignals({
      title,
      bullets,
      breadcrumbs,
      warningBadges,
      description: page.productDescriptionSnippet,
    });

    const inStock = page.inStock ?? false;
    const buyable = page.buyable ?? false;
    const priceKnown = typeof page.price === 'number' && page.price > 0;

    if (!priceKnown) fail(RejectionReason.AMAZON_PRICE_MISSING, 'Amazon page has no parseable price');
    if (!inStock) fail(RejectionReason.AMAZON_OUT_OF_STOCK, 'Amazon page reports out of stock');
    if (!buyable) fail(RejectionReason.AMAZON_NOT_BUYABLE, 'Amazon page has no add-to-cart / buy-now button');

    if (isAmazonBasics) fail(RejectionReason.AMAZON_BASICS_EXCLUDED, 'Product is Amazon Basics');
    if (condition.matched) {
      fail(RejectionReason.USED_RENEWED_REFURBISHED, `Condition keyword: ${condition.phrase}`);
    }
    if (bundleHit.matched) {
      fail(RejectionReason.BUNDLE_OR_MULTIPACK_EXCLUDED, `Bundle/multipack: ${bundleHit.phrase ?? bundleHit.reason ?? 'pack'}`);
    }

    const restrictedCategories = restricted.categories;
    if (restrictedCategories.length > 0) {
      const top = restrictedCategories[0];
      const code = restrictedCategoryToCode(top);
      fail(code, `Restricted signal: ${restricted.hits.slice(0, 3).map((h) => h.phrase).join(', ')}`);
    }

    // V1 shipping gate: trust Prime/FBA/Amazon-fulfillment signals even
    // when the guest delivery estimate is slow or unparseable.  Out-of-stock
    // is already captured above as AMAZON_OUT_OF_STOCK.
    const gate = evaluateShippingGate({
      delivery,
      primeSignals: {
        primeBadgeVisible: page.primeBadgeVisible,
        primeInDeliveryText: page.primeInDeliveryText,
        fastestDeliveryText: page.fastestDeliveryText,
        shipsFromAmazon: page.shipsFromAmazon,
        soldByAmazon: page.soldByAmazon,
        fulfilledByAmazon: page.fulfilledByAmazon,
      },
      maxDeliveryDays: THRESHOLDS.DEFAULT_MAX_DELIVERY_DAYS,
      outOfStock: !inStock,
    });
    if (gate.shippingGateResult === 'reject' && gate.rejectionCode &&
        gate.rejectionCode !== RejectionReason.AMAZON_OUT_OF_STOCK) {
      fail(gate.rejectionCode, gate.notes);
    }
    if (gate.shippingGateResult === 'prime_likely_pass') {
      reasons.push(RejectionReason.PRIME_LIKELY_DELIVERY_PASS, gate.notes);
      if (gate.shippingReviewRequired) {
        reasons.push(RejectionReason.SHIPPING_REVIEW_REQUIRED);
      }
      if (gate.primeSignalDetected) reasons.push(RejectionReason.PRIME_SIGNAL_DETECTED);
      if (gate.fbaSignalDetected) reasons.push(RejectionReason.FBA_SIGNAL_DETECTED);
    }

    const scoring = scoreAmazonSource({
      pageLoaded: page.pageLoaded,
      blockedOrCaptcha: page.blockedOrCaptcha,
      hasAsin: Boolean(asin),
      hasAmazonUrl: Boolean(amazonUrl),
      inStock,
      buyable,
      priceKnown,
      isAmazonBasics,
      isUsedRenewedRefurbished: condition.matched,
      isBundleOrMultipack: bundleHit.matched,
      restrictedSignalCount: restricted.hits.length,
      hasHardRestriction: restrictedCategories.length > 0,
      delivery,
      maxDeliveryDays: THRESHOLDS.DEFAULT_MAX_DELIVERY_DAYS,
      shippingGateResult: gate.shippingGateResult,
    });

    const passed = !rejectionReason && scoring.passed;
    const withinDeliveryWindow =
      gate.shippingGateResult === 'pass' || gate.shippingGateResult === 'prime_likely_pass';

    return {
      asin,
      amazonUrl,
      productTitle: page.productTitle,
      brand: page.brand,
      price: page.price,
      priceCurrency: page.priceCurrency,
      stockStatus: inStock ? 'in_stock' : (page.availabilityText ? 'out_of_stock' : 'unknown'),
      inStock,
      buyable,
      hasSourcePrice: priceKnown,
      deliveryText: page.deliveryText,
      rawDeliveryText: page.rawDeliveryText ?? page.deliveryText,
      fastestDeliveryText: page.fastestDeliveryText,
      deliveryContext: 'public_guest_zip',
      addressZipUsed: env.pipeline.defaultZipCode,
      deliveryParseMethod: delivery.signals.join(',') || 'unparsed',
      estimatedDeliveryDays: delivery.estimatedDeliveryDays ?? page.estimatedDeliveryDays,
      deliveryParseConfidence: delivery.deliveryParseConfidence,
      deliveryWindowStart: delivery.deliveryWindowStart,
      deliveryWindowEnd: delivery.deliveryWindowEnd,
      withinDeliveryWindow,
      primeSignalDetected: gate.primeSignalDetected,
      primeSignalSource: gate.primeSignalSource,
      fbaSignalDetected: gate.fbaSignalDetected,
      shipsFromAmazon: page.shipsFromAmazon,
      soldByAmazon: page.soldByAmazon,
      fulfilledByAmazon: page.fulfilledByAmazon,
      shippingGateResult: gate.shippingGateResult,
      shippingConfidence: gate.shippingConfidence,
      shippingReviewRequired: gate.shippingReviewRequired,
      sellerText: page.sellerText,
      shipsFromText: page.shipsFromText,
      soldByText: page.soldByText,
      conditionText: page.conditionText,
      rating: page.rating,
      reviewCount: page.reviewCount,
      couponDetected: Boolean(page.couponDetected),
      couponText: page.couponText,
      isAmazonBasics,
      isRenewedOrRefurbished: condition.matched,
      isBundleOrMultipack: bundleHit.matched,
      restrictedSignals: restricted.hits.map((h) => h.signal),
      restrictedCategories,
      warningBadges,
      productBullets: bullets,
      categoryBreadcrumbs: breadcrumbs,
      sourceValidityScore: scoring.sourceValidityScore,
      sourceValid: passed,
      passed,
      reasons,
      rejectionReason,
      snapshot: page,
      deliveryDays: delivery.estimatedDeliveryDays ?? page.estimatedDeliveryDays,
    };
  }

  private async failWithCode(
    ottoProductId: string,
    asin: string,
    amazonUrl: string,
    runId: string | undefined,
    code: string,
    detail: string,
    page?: AmazonProductPageData,
  ): Promise<AgentResult<AmazonValidationData>> {
    const data: AmazonValidationData = {
      asin,
      amazonUrl,
      stockStatus: 'unknown',
      inStock: false,
      buyable: false,
      hasSourcePrice: false,
      withinDeliveryWindow: false,
      deliveryContext: 'public_guest_zip',
      addressZipUsed: env.pipeline.defaultZipCode,
      primeSignalDetected: false,
      fbaSignalDetected: false,
      shipsFromAmazon: false,
      soldByAmazon: false,
      fulfilledByAmazon: false,
      shippingGateResult: 'reject',
      shippingConfidence: 'low',
      shippingReviewRequired: false,
      isAmazonBasics: false,
      isRenewedOrRefurbished: false,
      isBundleOrMultipack: false,
      restrictedSignals: [],
      restrictedCategories: [],
      warningBadges: page?.warningBadges ?? [],
      productBullets: page?.productBullets ?? [],
      categoryBreadcrumbs: page?.categoryBreadcrumbs ?? [],
      couponDetected: false,
      sourceValidityScore: 0,
      sourceValid: false,
      passed: false,
      reasons: [code, detail],
      rejectionReason: code,
      snapshot: page,
    };
    await this.persist(ottoProductId, data);
    await recordRejection(ottoProductId, 'amazon_source', code, {
      detail,
      asin,
      amazonUrl,
    });
    const result = makeResult(this.name, ottoProductId, 'fail', 0, data.reasons, data);
    await persistAgentResult(result, runId);
    return result;
  }

  private async persist(ottoProductId: string, data: AmazonValidationData): Promise<void> {
    const supabase = getSupabase();
    try {
      await supabase.from('amazon_source_checks').insert({
        otto_product_id: ottoProductId,
        asin: data.asin,
        amazon_url: data.amazonUrl,
        product_title: data.productTitle ?? null,
        brand: data.brand ?? null,
        stock_status: data.stockStatus,
        in_stock: data.inStock,
        buyable: data.buyable,
        has_source_price: data.hasSourcePrice,
        source_price: data.price ?? null,
        price_currency: data.priceCurrency ?? null,
        is_renewed_or_refurbished: data.isRenewedOrRefurbished,
        is_amazon_basics: data.isAmazonBasics,
        is_bundle_or_multipack: data.isBundleOrMultipack,
        delivery_days: data.estimatedDeliveryDays ?? null,
        estimated_delivery_days: data.estimatedDeliveryDays ?? null,
        delivery_text: data.deliveryText ?? null,
        delivery_parse_confidence: data.deliveryParseConfidence ?? null,
        delivery_window_start: data.deliveryWindowStart ?? null,
        delivery_window_end: data.deliveryWindowEnd ?? null,
        within_delivery_window: data.withinDeliveryWindow,
        raw_delivery_text: data.rawDeliveryText ?? null,
        fastest_delivery_text: data.fastestDeliveryText ?? null,
        delivery_context: data.deliveryContext,
        address_zip_used: data.addressZipUsed ?? null,
        delivery_parse_method: data.deliveryParseMethod ?? null,
        prime_signal_detected: data.primeSignalDetected,
        prime_signal_source: data.primeSignalSource ?? null,
        fba_signal_detected: data.fbaSignalDetected,
        ships_from_amazon: data.shipsFromAmazon,
        sold_by_amazon: data.soldByAmazon,
        fulfilled_by_amazon: data.fulfilledByAmazon,
        shipping_confidence: data.shippingConfidence,
        shipping_review_required: data.shippingReviewRequired,
        shipping_gate_result: data.shippingGateResult,
        seller_text: data.sellerText ?? null,
        ships_from_text: data.shipsFromText ?? null,
        sold_by_text: data.soldByText ?? null,
        condition_text: data.conditionText ?? null,
        rating: data.rating ?? null,
        review_count: data.reviewCount ?? null,
        coupon_detected: data.couponDetected,
        coupon_text: data.couponText ?? null,
        restricted_signals: data.restrictedSignals,
        warning_badges: data.warningBadges,
        source_validity_score: data.sourceValidityScore,
        source_valid: data.sourceValid,
        rejection_reason: data.rejectionReason ?? null,
        passed: data.passed,
        reasons: data.reasons,
        raw_payload: (data.snapshot as unknown as Record<string, unknown>) ?? {},
      });
    } catch (err) {
      this.log.warn('amazon_source_checks insert failed', { err: (err as Error).message });
    }
  }
}

function restrictedCategoryToCode(category: RestrictedSignalCategory): string {
  switch (category) {
    case 'hazmat':
      return RejectionReason.HAZMAT_SIGNAL;
    case 'medical_device':
      return RejectionReason.MEDICAL_DEVICE_SIGNAL;
    case 'weapon':
      return RejectionReason.WEAPON_SIGNAL;
    case 'food_supplement':
      return RejectionReason.FOOD_SUPPLEMENT_SIGNAL;
    case 'baby_safety':
    case 'health_beauty':
    case 'restricted_other':
    default:
      return RejectionReason.RESTRICTED_PRODUCT_SIGNAL;
  }
}
