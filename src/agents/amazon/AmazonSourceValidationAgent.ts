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
  productTitle?: string;
  brand?: string;
  price?: number;
  priceCurrency?: string;
  stockStatus: 'in_stock' | 'out_of_stock' | 'unknown';
  inStock: boolean;
  buyable: boolean;
  hasSourcePrice: boolean;
  deliveryText?: string;
  estimatedDeliveryDays?: number;
  deliveryParseConfidence?: 'high' | 'medium' | 'low' | 'none';
  deliveryWindowStart?: string;
  deliveryWindowEnd?: string;
  withinDeliveryWindow: boolean;
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

    // Delivery rules: explicit out-of-stock text, fail. Parsed days > max, fail.
    // Low/none confidence + already-known stock issues: caller has more info.
    if (delivery.signals.includes('out_of_stock_text')) {
      // Already handled by stock checks; nothing extra to add.
    } else if (delivery.deliveryPassesMaxWindow === false) {
      fail(RejectionReason.DELIVERY_TOO_LONG, `Delivery exceeds ${THRESHOLDS.DEFAULT_MAX_DELIVERY_DAYS} days: ${delivery.rawText}`);
    } else if (delivery.deliveryParseConfidence === 'low' || delivery.deliveryParseConfidence === 'none') {
      fail(RejectionReason.DELIVERY_UNCLEAR, `Delivery text could not be parsed confidently: ${delivery.rawText || '(empty)'}`);
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
    });

    const passed = !rejectionReason && scoring.passed;
    const withinDeliveryWindow =
      delivery.deliveryPassesMaxWindow === undefined ? false : delivery.deliveryPassesMaxWindow;

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
      estimatedDeliveryDays: delivery.estimatedDeliveryDays ?? page.estimatedDeliveryDays,
      deliveryParseConfidence: delivery.deliveryParseConfidence,
      deliveryWindowStart: delivery.deliveryWindowStart,
      deliveryWindowEnd: delivery.deliveryWindowEnd,
      withinDeliveryWindow,
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
