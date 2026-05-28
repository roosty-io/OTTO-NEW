import { env } from '@/config/env';
import { logger } from '@/utils/logger';
import { amazonUrlFromAsin, extractAsin } from '@/utils/normalize';

/**
 * Amazon browser client.
 *
 * - `PlaywrightAmazonBrowserClient` is the real implementation. It launches a
 *   single headless Chromium browser on demand, reuses it across calls, and
 *   parses the organic Amazon search results page.
 * - `MockAmazonBrowserClient` returns deterministic synthetic data when
 *   `OTTO_MOCK_MODE=true` so mock-mode pipeline runs stay fast and offline.
 *
 * If Playwright can't launch a browser (e.g. browsers not installed, sandbox
 * blocks network, captcha wall), `search` returns `{ hits: [], error }` with
 * an explicit code.  Callers should translate that into `AMAZON_SEARCH_UNAVAILABLE`
 * rather than fabricating a result.
 */

export interface AmazonSearchHit {
  asin: string;
  amazonUrl: string;
  title: string;
  brand?: string;
  price?: number;
  rating?: number;
  reviewCount?: number;
  imageUrl?: string;
  deliveryText?: string;
  badgeText?: string;
  sponsored: boolean;
  isAmazonBasics: boolean;
  isRenewedOrRefurbished: boolean;
  isBundleOrMultipack: boolean;
}

export type AmazonErrorCode =
  | 'BROWSER_LAUNCH_FAILED'
  | 'NAVIGATION_FAILED'
  | 'TIMEOUT'
  | 'BLOCKED_OR_CAPTCHA'
  | 'MALFORMED_PAGE'
  | 'UNKNOWN';

export type AmazonPageQuality =
  | 'SEARCH_RESULTS_OK'
  | 'PRODUCT_PAGE_OK'
  | 'EMPTY_RESULTS'
  | 'SOFT_BLOCK'
  | 'CAPTCHA_OR_BLOCK'
  | 'PARTIAL_RENDER'
  | 'MALFORMED_PAGE'
  | 'NETWORK_FAILURE'
  | 'TIMEOUT';

export interface AmazonSearchResult {
  hits: AmazonSearchHit[];
  error?: { code: AmazonErrorCode; message: string };
  /** V1.3 reliability diagnostics. */
  pageQuality?: AmazonPageQuality;
  attempts?: number;
  retriesUsed?: number;
}

export interface AmazonProductSnapshot {
  asin: string;
  amazonUrl: string;
  title: string;
  brand?: string;
  price?: number;
  inStock: boolean;
  deliveryDays?: number;
  isAmazonBasics: boolean;
  isRenewedOrRefurbished: boolean;
  isBundleOrMultipack: boolean;
  rating?: number;
  reviewCount?: number;
  category?: string;
  variationAttributes?: Record<string, string>;
  couponDetected: boolean;
  raw: Record<string, unknown>;
}

export type ValidationErrorCode =
  | 'PAGE_UNAVAILABLE'
  | 'NAVIGATION_FAILED'
  | 'TIMEOUT'
  | 'BLOCKED_OR_CAPTCHA'
  | 'BROWSER_LAUNCH_FAILED'
  | 'PARSE_FAILED';

export interface AmazonProductPageData {
  asin: string;
  amazonUrl: string;
  pageLoaded: boolean;
  blockedOrCaptcha: boolean;
  productTitle?: string;
  brand?: string;
  price?: number;
  priceCurrency?: string;
  availabilityText?: string;
  inStock?: boolean;
  buyable?: boolean;
  deliveryText?: string;
  rawDeliveryText?: string;
  fastestDeliveryText?: string;
  estimatedDeliveryDays?: number;
  deliveryParseConfidence?: 'high' | 'medium' | 'low' | 'none';
  sellerText?: string;
  shipsFromText?: string;
  soldByText?: string;
  conditionText?: string;
  rating?: number;
  reviewCount?: number;
  couponDetected?: boolean;
  couponText?: string;
  productBullets: string[];
  productDescriptionSnippet?: string;
  categoryBreadcrumbs: string[];
  warningBadges: string[];
  restrictedSignals: string[];
  // Prime / FBA / Amazon-fulfillment signals (extracted from the public PDP).
  primeBadgeVisible: boolean;
  primeInDeliveryText: boolean;
  primeSignalDetected: boolean;
  primeSignalSource?: string;
  fbaSignalDetected: boolean;
  shipsFromAmazon: boolean;
  soldByAmazon: boolean;
  fulfilledByAmazon: boolean;
  validationErrorCode?: ValidationErrorCode;
}

export interface AmazonBrowserClient {
  readonly isImplemented: boolean;
  search(query: string, limit?: number): Promise<AmazonSearchResult>;
  /** Legacy single-best lookup, retained for any older caller. */
  resolveByTitle(title: string): Promise<AmazonSearchHit | null>;
  getProduct(asin: string, zipCode?: string): Promise<AmazonProductSnapshot | null>;
  validateProductPage(
    asin: string,
    amazonUrl: string,
    options?: { zipCode?: string },
  ): Promise<AmazonProductPageData>;
  /** Navigate a PDP and capture raw diagnostics (screenshot/html/finalUrl/ua). */
  captureDiagnostics(
    asin: string,
    amazonUrl: string,
    options?: { zipCode?: string },
  ): Promise<AmazonPageDiagnostics>;
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Mock client (mock mode only).
// ---------------------------------------------------------------------------
class MockAmazonBrowserClient implements AmazonBrowserClient {
  readonly isImplemented = true;
  async search(query: string, limit = 5): Promise<AmazonSearchResult> {
    const hits: AmazonSearchHit[] = [];
    const base = stableSeed(query);
    for (let i = 0; i < limit; i++) {
      const asin = synthesizeAsin(base + i);
      hits.push({
        asin,
        amazonUrl: amazonUrlFromAsin(asin),
        title: `${query} - mock listing ${i + 1}`,
        brand: 'OttoMock',
        price: 8 + i * 3.25,
        rating: 4.2,
        reviewCount: 150 + i * 7,
        imageUrl: 'https://example.com/img.jpg',
        sponsored: false,
        isAmazonBasics: false,
        isRenewedOrRefurbished: false,
        isBundleOrMultipack: false,
      });
    }
    return { hits };
  }
  async resolveByTitle(title: string): Promise<AmazonSearchHit | null> {
    const r = await this.search(title, 1);
    return r.hits[0] ?? null;
  }
  async getProduct(asin: string): Promise<AmazonProductSnapshot | null> {
    const seed = asin.charCodeAt(asin.length - 1);
    return {
      asin,
      amazonUrl: amazonUrlFromAsin(asin),
      title: `Mock product ${asin}`,
      brand: 'OttoMock',
      price: 12 + (seed % 30),
      inStock: seed % 7 !== 0,
      deliveryDays: (seed % 9) + 2,
      isAmazonBasics: false,
      isRenewedOrRefurbished: false,
      isBundleOrMultipack: false,
      rating: 4.2 + ((seed % 5) / 10),
      reviewCount: 150 + seed * 7,
      category: 'Home & Kitchen',
      variationAttributes: {},
      couponDetected: seed % 3 === 0,
      raw: { source: 'mock' },
    };
  }
  async validateProductPage(asin: string, amazonUrl: string): Promise<AmazonProductPageData> {
    const seed = asin.charCodeAt(asin.length - 1);
    const deliveryDays = (seed % 9) + 2; // 2-10 days, always inside the window
    return {
      asin,
      amazonUrl,
      pageLoaded: true,
      blockedOrCaptcha: false,
      productTitle: `Mock product ${asin}`,
      brand: 'OttoMock',
      price: 12 + (seed % 30),
      priceCurrency: 'USD',
      availabilityText: 'In Stock',
      inStock: true,
      buyable: true,
      deliveryText: `FREE delivery in ${deliveryDays} days`,
      estimatedDeliveryDays: deliveryDays,
      deliveryParseConfidence: 'medium',
      sellerText: 'Amazon.com',
      shipsFromText: 'Amazon',
      soldByText: 'Amazon.com',
      conditionText: 'New',
      rating: 4.2 + ((seed % 5) / 10),
      reviewCount: 150 + seed * 7,
      couponDetected: seed % 3 === 0,
      couponText: seed % 3 === 0 ? '5% off coupon' : undefined,
      productBullets: ['Mock bullet 1', 'Mock bullet 2'],
      productDescriptionSnippet: 'Mock description',
      categoryBreadcrumbs: ['Home & Kitchen', 'Storage & Organization'],
      warningBadges: [],
      restrictedSignals: [],
      rawDeliveryText: `FREE delivery in ${deliveryDays} days`,
      fastestDeliveryText: undefined,
      primeBadgeVisible: true,
      primeInDeliveryText: true,
      primeSignalDetected: true,
      primeSignalSource: 'prime_badge,delivery_text_prime',
      fbaSignalDetected: true,
      shipsFromAmazon: true,
      soldByAmazon: true,
      fulfilledByAmazon: true,
    };
  }
  async captureDiagnostics(asin: string, amazonUrl: string): Promise<AmazonPageDiagnostics> {
    return {
      asin,
      requestedUrl: amazonUrl,
      finalUrl: amazonUrl,
      userAgent: 'mock-user-agent',
      viewport: { width: 1366, height: 900 },
      proxyEnabled: false,
      pageLoaded: true,
      blockedOrCaptcha: false,
      networkErrors: [],
      html: '<html><body>mock</body></html>',
    };
  }
  async close(): Promise<void> {
    return;
  }
}

// ---------------------------------------------------------------------------
// Real Playwright client.
// ---------------------------------------------------------------------------

interface PlaywrightModule {
  chromium: {
    launch(opts: {
      headless: boolean;
      slowMo?: number;
      proxy?: { server: string; username?: string; password?: string };
    }): Promise<PwBrowser>;
  };
}

interface PwBrowser {
  newContext(opts?: {
    userAgent?: string;
    locale?: string;
    viewport?: { width: number; height: number };
    ignoreHTTPSErrors?: boolean;
  }): Promise<PwContext>;
  close(): Promise<void>;
  isConnected(): boolean;
}

interface PwContext {
  newPage(): Promise<PwPage>;
  close(): Promise<void>;
}

interface PwPage {
  goto(url: string, opts?: { timeout?: number; waitUntil?: string }): Promise<unknown>;
  content(): Promise<string>;
  url(): string;
  close(): Promise<void>;
  // The DOM types aren't in our TS lib; use `unknown` and cast inside the page fn.
  $$eval<T>(selector: string, fn: (els: unknown[]) => T): Promise<T>;
  $eval<T>(selector: string, fn: (el: unknown) => T): Promise<T>;
}

// Per-run launch overrides for diagnostics / readiness probes.  Must be
// set BEFORE the browser launches lazily (the readiness script does this).
export interface AmazonBrowserOverrides {
  headless?: boolean;
  debug?: boolean;
  disableProxy?: boolean;
}
let _amazonOverrides: AmazonBrowserOverrides = {};
export function setAmazonBrowserOverrides(o: AmazonBrowserOverrides): void {
  _amazonOverrides = { ..._amazonOverrides, ...o };
}
export function resetAmazonBrowserOverrides(): void {
  _amazonOverrides = {};
}
/** Effective proxy state given env + per-run overrides. No secrets. */
export function amazonProxyEffective(): boolean {
  if (_amazonOverrides.disableProxy) return false;
  return Boolean(env.amazon.proxyServer || env.amazon.proxy);
}

export interface AmazonPageDiagnostics {
  asin: string;
  requestedUrl: string;
  finalUrl?: string;
  userAgent: string;
  viewport: { width: number; height: number };
  proxyEnabled: boolean;
  pageLoaded: boolean;
  blockedOrCaptcha: boolean;
  validationErrorCode?: ValidationErrorCode;
  networkErrors: string[];
  /** PNG screenshot bytes (best-effort; may be undefined if capture failed). */
  screenshot?: Buffer;
  /** Raw page HTML (caller is responsible for any redaction before saving). */
  html?: string;
}

class PlaywrightAmazonBrowserClient implements AmazonBrowserClient {
  readonly isImplemented = true;
  private readonly log = logger.child('amazonBrowserClient');
  private browser: PwBrowser | null = null;
  private launchAttempted = false;
  private launchError: string | null = null;

  private get debugEffective(): boolean {
    return _amazonOverrides.debug ?? env.amazon.debug;
  }

  private get headless(): boolean {
    if (typeof _amazonOverrides.headless === 'boolean') return _amazonOverrides.headless;
    return this.debugEffective ? false : env.amazon.headless;
  }

  private get slowMo(): number | undefined {
    return this.debugEffective ? 250 : undefined;
  }

  private get proxyConfig(): { server: string; username?: string; password?: string } | undefined {
    if (_amazonOverrides.disableProxy) return undefined;
    if (env.amazon.proxyServer) {
      return {
        server: env.amazon.proxyServer,
        username: env.amazon.proxyUsername || undefined,
        password: env.amazon.proxyPassword || undefined,
      };
    }
    if (env.amazon.proxy) return { server: env.amazon.proxy };
    return undefined;
  }

  private async ensureBrowser(): Promise<PwBrowser | null> {
    if (this.browser && this.browser.isConnected()) return this.browser;
    if (this.launchAttempted && this.launchError) return null;
    this.launchAttempted = true;
    let pw: PlaywrightModule;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      pw = require('playwright') as PlaywrightModule;
    } catch (err) {
      this.launchError = `Playwright module not installed: ${(err as Error).message}`;
      this.log.error(this.launchError);
      return null;
    }
    try {
      this.browser = await pw.chromium.launch({
        headless: this.headless,
        slowMo: this.slowMo,
        proxy: this.proxyConfig,
      });
      this.log.info('Playwright Chromium launched', {
        headless: this.headless,
        proxy: Boolean(this.proxyConfig),
      });
      return this.browser;
    } catch (err) {
      this.launchError = `Chromium launch failed: ${(err as Error).message}`;
      this.log.error(this.launchError);
      this.browser = null;
      return null;
    }
  }

  async search(query: string, limit?: number): Promise<AmazonSearchResult> {
    const cleaned = (query ?? '').trim();
    if (!cleaned) {
      return {
        hits: [],
        error: { code: 'MALFORMED_PAGE', message: 'empty query' },
        pageQuality: 'MALFORMED_PAGE',
        attempts: 0,
        retriesUsed: 0,
      };
    }
    const browser = await this.ensureBrowser();
    if (!browser) {
      return {
        hits: [],
        error: { code: 'BROWSER_LAUNCH_FAILED', message: this.launchError ?? 'unknown launch failure' },
        pageQuality: 'NETWORK_FAILURE',
        attempts: 0,
        retriesUsed: 0,
      };
    }

    const cap = Math.min(limit ?? env.amazon.maxResultsPerQuery, 30);
    const url = `https://www.amazon.com/s?k=${encodeURIComponent(cleaned)}`;
    const maxRetries = Math.max(0, env.amazon.malformedPageMaxRetries);

    let attempts = 0;
    let retriesUsed = 0;
    let lastQuality: AmazonPageQuality = 'MALFORMED_PAGE';
    let lastError: { code: AmazonErrorCode; message: string } | undefined;

    // attempts = 1 + retries; loop while we have retries left.
    for (let i = 0; i <= maxRetries; i++) {
      attempts++;
      // Rotate UA / viewport between retries so Amazon doesn't return the
      // same partial render for the same fingerprint.
      const profile = browserProfile(i);
      const once = await this.searchOnce(browser, url, cap, profile);
      lastQuality = once.pageQuality;
      lastError = once.error;

      if (once.pageQuality === 'SEARCH_RESULTS_OK') {
        return {
          hits: once.hits,
          pageQuality: 'SEARCH_RESULTS_OK',
          attempts,
          retriesUsed,
        };
      }
      // EMPTY_RESULTS is terminal - Amazon legitimately has no products.
      if (once.pageQuality === 'EMPTY_RESULTS') {
        return {
          hits: [],
          pageQuality: 'EMPTY_RESULTS',
          attempts,
          retriesUsed,
        };
      }
      // CAPTCHA / SOFT_BLOCK: retrying just burns IP reputation. Allow at
      // most one retry total when blocked.
      if (once.pageQuality === 'CAPTCHA_OR_BLOCK' || once.pageQuality === 'SOFT_BLOCK') {
        if (retriesUsed >= 1) break;
        retriesUsed++;
        await sleep(backoffDelay(retriesUsed));
        continue;
      }
      // MALFORMED_PAGE / PARTIAL_RENDER / TIMEOUT / NETWORK_FAILURE: retry
      // up to maxRetries with exponential backoff and jitter.
      if (i < maxRetries) {
        retriesUsed++;
        this.log.warn('Amazon search retry', {
          attempt: attempts,
          quality: once.pageQuality,
          message: once.error?.message,
        });
        await sleep(backoffDelay(retriesUsed));
        continue;
      }
      break;
    }
    return {
      hits: [],
      error: lastError ?? { code: 'MALFORMED_PAGE', message: `gave up after ${attempts} attempts` },
      pageQuality: lastQuality,
      attempts,
      retriesUsed,
    };
  }

  private async searchOnce(
    browser: PwBrowser,
    url: string,
    cap: number,
    profile: BrowserProfile,
  ): Promise<{ hits: AmazonSearchHit[]; pageQuality: AmazonPageQuality; error?: { code: AmazonErrorCode; message: string } }> {
    const timeoutMs = env.amazon.searchTimeoutMs;
    let context: PwContext | null = null;
    let page: PwPage | null = null;
    try {
      context = await browser.newContext({
        userAgent: profile.userAgent,
        locale: 'en-US',
        viewport: profile.viewport,
        ignoreHTTPSErrors: env.amazon.ignoreHttpsErrors,
      });
      page = await context.newPage();
      try {
        await page.goto(url, { timeout: timeoutMs, waitUntil: 'domcontentloaded' });
      } catch (err) {
        const msg = (err as Error).message;
        const isTimeout = /timeout/i.test(msg);
        return {
          hits: [],
          pageQuality: isTimeout ? 'TIMEOUT' : 'NETWORK_FAILURE',
          error: { code: isTimeout ? 'TIMEOUT' : 'NAVIGATION_FAILED', message: msg },
        };
      }
      // Wait for results / no-results / block markers to race; bounded so
      // a partial render still classifies as MALFORMED_PAGE quickly.
      await waitForSearchReady(page, Math.min(timeoutMs, 8000));
      // Trigger lazy rendering with a small scroll.
      await safeScroll(page);

      const html = await page.content();
      const currentUrl = page.url();
      const rawHits = await this.extractHits(page, cap);
      const bodyLen = await safeBodyTextLength(page);
      const quality = classifyAmazonSearchPage(html, currentUrl, rawHits.length, bodyLen);

      if (quality === 'SEARCH_RESULTS_OK') return { hits: rawHits, pageQuality: quality };
      if (quality === 'EMPTY_RESULTS') return { hits: [], pageQuality: quality };
      if (quality === 'CAPTCHA_OR_BLOCK' || quality === 'SOFT_BLOCK') {
        return {
          hits: [],
          pageQuality: quality,
          error: { code: 'BLOCKED_OR_CAPTCHA', message: `Amazon ${quality.toLowerCase()} page` },
        };
      }
      return {
        hits: [],
        pageQuality: quality,
        error: { code: 'MALFORMED_PAGE', message: `page quality: ${quality} (body ${bodyLen} bytes, ${rawHits.length} tiles)` },
      };
    } catch (err) {
      return {
        hits: [],
        pageQuality: 'MALFORMED_PAGE',
        error: { code: 'UNKNOWN', message: `search failed: ${(err as Error).message}` },
      };
    } finally {
      try { if (page) await page.close(); } catch { /* ignore */ }
      try { if (context) await context.close(); } catch { /* ignore */ }
    }
  }

  private async extractHits(page: PwPage, cap: number): Promise<AmazonSearchHit[]> {
    type RawTile = {
      asin: string | null;
      url: string | null;
      title: string | null;
      priceText: string | null;
      ratingText: string | null;
      reviewCountText: string | null;
      imageUrl: string | null;
      deliveryText: string | null;
      badgeText: string | null;
      sponsored: boolean;
    };
    let raws: RawTile[] = [];
    try {
      // NB: this function executes in the browser, so DOM globals are real
      // even though TS doesn't have DOM types loaded here.
      // Broaden the tile selector so any ASIN-bearing result card is picked
      // up even when Amazon swaps the outer container class.
      const tileSelector =
        'div.s-result-item[data-asin], [data-component-type="s-search-result"][data-asin], [data-asin][cel_widget_id*="MAIN-SEARCH_RESULTS"]';
      raws = await page.$$eval(tileSelector, (els) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const list = els as any[];
        const out: RawTile[] = [];
        const ASIN_RE = /\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?:\b|\/|$)/;
        for (const el of list) {
          // ASIN: prefer data-asin, fall back to /dp/ or /gp/product/ href.
          let asin: string | null = el.getAttribute('data-asin');
          if (!asin || asin.length < 8) {
            const anyLink = el.querySelector('a[href*="/dp/"], a[href*="/gp/product/"]');
            const href = anyLink ? anyLink.getAttribute('href') : null;
            const m = href ? href.match(ASIN_RE) : null;
            if (m) asin = m[1];
          }
          if (!asin || asin.length < 8) continue;
          // Title: try multiple selectors, plus aria-label and image alt as
          // low-confidence fallbacks.
          const titleEl =
            el.querySelector('h2 a span') ||
            el.querySelector('[data-cy="title-recipe"] span') ||
            el.querySelector('h2 span') ||
            el.querySelector('h2 a');
          const titleAria = el.querySelector('h2 a[aria-label]');
          const imgAlt = el.querySelector('img.s-image[alt]');
          const titleText =
            (titleEl && titleEl.textContent ? titleEl.textContent.trim() : '') ||
            (titleAria ? titleAria.getAttribute('aria-label') ?? '' : '') ||
            (imgAlt ? imgAlt.getAttribute('alt') ?? '' : '');
          const linkEl =
            el.querySelector('h2 a[href*="/dp/"]') ||
            el.querySelector('a.a-link-normal[href*="/dp/"]') ||
            el.querySelector('a[href*="/dp/"]') ||
            el.querySelector('a[href*="/gp/product/"]') ||
            el.querySelector('h2 a');
          // Price: standard accessible offscreen first, then whole/fraction
          // composite, then aria-label fallback.
          const priceOff = el.querySelector('.a-price .a-offscreen');
          let priceTextLocal: string | null = null;
          if (priceOff && priceOff.textContent) priceTextLocal = priceOff.textContent.trim();
          if (!priceTextLocal) {
            const whole = el.querySelector('.a-price .a-price-whole');
            const frac = el.querySelector('.a-price .a-price-fraction');
            if (whole && whole.textContent) {
              const w = whole.textContent.replace(/[^0-9.]/g, '');
              const f = frac && frac.textContent ? frac.textContent.replace(/[^0-9]/g, '') : '';
              priceTextLocal = f ? `$${w}.${f}` : `$${w}`;
            }
          }
          if (!priceTextLocal) {
            const priceAria = el.querySelector('[aria-label][data-a-color]');
            if (priceAria) priceTextLocal = priceAria.getAttribute('aria-label');
          }
          const ratingEl = el.querySelector('.a-icon-star-small .a-icon-alt, .a-icon-star .a-icon-alt');
          const reviewEl = el.querySelector('[data-csa-c-content-id="ratings-count"] span, .a-size-base.s-underline-text');
          const imgEl = el.querySelector('img.s-image');
          const deliveryEl = el.querySelector('[data-cy="delivery-recipe"]');
          const badgeEl = el.querySelector('.a-badge-label-inner, .s-badge-region .a-badge-text');
          const sponsoredEl = el.querySelector('.puis-sponsored-label-text, .puis-label-popover-default-pulse');
          out.push({
            asin,
            url: linkEl ? linkEl.getAttribute('href') : null,
            title: titleText || null,
            priceText: priceTextLocal,
            ratingText: ratingEl && ratingEl.textContent ? ratingEl.textContent.trim() : null,
            reviewCountText: reviewEl && reviewEl.textContent ? reviewEl.textContent.trim() : null,
            imageUrl: imgEl ? imgEl.getAttribute('src') : null,
            deliveryText: deliveryEl && deliveryEl.textContent ? deliveryEl.textContent.trim() : null,
            badgeText: badgeEl && badgeEl.textContent ? badgeEl.textContent.trim() : null,
            sponsored: Boolean(sponsoredEl),
          });
        }
        return out;
      });
    } catch (err) {
      this.log.warn('extractHits selector failed', { err: (err as Error).message });
      raws = [];
    }

    const seen = new Set<string>();
    const hits: AmazonSearchHit[] = [];
    for (const r of raws) {
      const asin = r.asin && extractAsin(r.asin) ? extractAsin(r.asin)! : r.asin ?? '';
      if (!asin || asin.length < 8) continue;
      if (seen.has(asin)) continue;
      seen.add(asin);

      const amazonUrl = absoluteAmazonUrl(r.url, asin);
      const title = (r.title ?? '').trim();
      if (!title) continue;

      const lcTitle = title.toLowerCase();
      const lcBadge = (r.badgeText ?? '').toLowerCase();
      const isAmazonBasics = lcTitle.includes('amazon basics') || lcTitle.includes('amazonbasics');
      const isRenewedOrRefurbished =
        lcTitle.includes('renewed') ||
        lcTitle.includes('refurbished') ||
        lcTitle.includes('open box') ||
        lcBadge.includes('renewed');
      const isBundleOrMultipack =
        /\b\d+\s*[- ]?\s*(?:packs?|pk|counts?|cts?|tiers?|pcs?)\b/i.test(title) ||
        lcTitle.includes('bundle') ||
        lcTitle.includes('multipack') ||
        lcTitle.includes('multi-pack');

      hits.push({
        asin,
        amazonUrl,
        title,
        brand: undefined, // not reliably available on the search results card
        price: parsePrice(r.priceText),
        rating: parseRating(r.ratingText),
        reviewCount: parseReviewCount(r.reviewCountText),
        imageUrl: r.imageUrl ?? undefined,
        deliveryText: r.deliveryText ?? undefined,
        badgeText: r.badgeText ?? undefined,
        sponsored: r.sponsored,
        isAmazonBasics,
        isRenewedOrRefurbished,
        isBundleOrMultipack,
      });
      if (hits.length >= cap) break;
    }
    return hits;
  }

  async resolveByTitle(title: string): Promise<AmazonSearchHit | null> {
    const r = await this.search(title, 1);
    return r.hits[0] ?? null;
  }

  /** Deprecated. Kept so older callers still compile. */
  async getProduct(_asin: string, _zipCode?: string): Promise<AmazonProductSnapshot | null> {
    return null;
  }

  async validateProductPage(
    asin: string,
    amazonUrl: string,
    _options?: { zipCode?: string },
  ): Promise<AmazonProductPageData> {
    const canonicalUrl = amazonUrl && /\/dp\//.test(amazonUrl) ? amazonUrl : amazonUrlFromAsin(asin);
    const empty: AmazonProductPageData = {
      asin,
      amazonUrl: canonicalUrl,
      pageLoaded: false,
      blockedOrCaptcha: false,
      productBullets: [],
      categoryBreadcrumbs: [],
      warningBadges: [],
      restrictedSignals: [],
      primeBadgeVisible: false,
      primeInDeliveryText: false,
      primeSignalDetected: false,
      fbaSignalDetected: false,
      shipsFromAmazon: false,
      soldByAmazon: false,
      fulfilledByAmazon: false,
    };

    const browser = await this.ensureBrowser();
    if (!browser) {
      return {
        ...empty,
        validationErrorCode: 'BROWSER_LAUNCH_FAILED',
      };
    }

    const timeoutMs = env.amazon.searchTimeoutMs;
    let context: PwContext | null = null;
    let page: PwPage | null = null;
    try {
      context = await browser.newContext({
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/537.36 (KHTML, like Gecko) ' +
          'Chrome/124.0.0.0 Safari/537.36',
        locale: 'en-US',
        viewport: { width: 1366, height: 900 },
        ignoreHTTPSErrors: env.amazon.ignoreHttpsErrors,
      });
      page = await context.newPage();

      try {
        await page.goto(canonicalUrl, { timeout: timeoutMs, waitUntil: 'domcontentloaded' });
      } catch (err) {
        const msg = (err as Error).message;
        const code: ValidationErrorCode = /timeout/i.test(msg) ? 'TIMEOUT' : 'NAVIGATION_FAILED';
        return { ...empty, validationErrorCode: code };
      }

      const html = await page.content();
      if (looksBlocked(html, page.url())) {
        return { ...empty, blockedOrCaptcha: true, validationErrorCode: 'BLOCKED_OR_CAPTCHA' };
      }

      const parsed = await this.extractProductPage(page);
      return {
        asin,
        amazonUrl: canonicalUrl,
        pageLoaded: true,
        blockedOrCaptcha: false,
        productTitle: parsed.productTitle ?? undefined,
        brand: parsed.brand ?? undefined,
        price: parsePrice(parsed.priceText),
        priceCurrency: parsePriceCurrency(parsed.priceText),
        availabilityText: parsed.availabilityText ?? undefined,
        inStock: inferInStock(parsed.availabilityText, parsed.buyable),
        buyable: parsed.buyable,
        deliveryText: parsed.deliveryText ?? undefined,
        rawDeliveryText: parsed.deliveryText ?? undefined,
        fastestDeliveryText: parsed.fastestDeliveryText ?? undefined,
        sellerText: parsed.sellerText ?? undefined,
        shipsFromText: parsed.shipsFromText ?? undefined,
        soldByText: parsed.soldByText ?? undefined,
        conditionText: parsed.conditionText ?? undefined,
        rating: parseRating(parsed.ratingText),
        reviewCount: parseReviewCount(parsed.reviewCountText),
        couponDetected: Boolean(parsed.couponText),
        couponText: parsed.couponText ?? undefined,
        productBullets: parsed.productBullets,
        productDescriptionSnippet: parsed.descriptionSnippet ?? undefined,
        categoryBreadcrumbs: parsed.categoryBreadcrumbs,
        warningBadges: parsed.warningBadges,
        restrictedSignals: [],
        ...computePrimeFlags(parsed),
      };
    } catch (err) {
      return {
        ...empty,
        validationErrorCode: 'PARSE_FAILED',
        availabilityText: `extract failed: ${(err as Error).message}`,
      };
    } finally {
      try { if (page) await page.close(); } catch { /* ignore */ }
      try { if (context) await context.close(); } catch { /* ignore */ }
    }
  }

  async captureDiagnostics(
    asin: string,
    amazonUrl: string,
    _options?: { zipCode?: string },
  ): Promise<AmazonPageDiagnostics> {
    const canonicalUrl = amazonUrl || amazonUrlFromAsin(asin);
    const userAgent =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'Chrome/124.0.0.0 Safari/537.36';
    const viewport = { width: 1366, height: 900 };
    const proxyEnabled = amazonProxyEffective();
    const networkErrors: string[] = [];
    const base: AmazonPageDiagnostics = {
      asin,
      requestedUrl: canonicalUrl,
      userAgent,
      viewport,
      proxyEnabled,
      pageLoaded: false,
      blockedOrCaptcha: false,
      networkErrors,
    };

    const browser = await this.ensureBrowser();
    if (!browser) {
      return { ...base, validationErrorCode: 'BROWSER_LAUNCH_FAILED' };
    }

    const timeoutMs = env.amazon.searchTimeoutMs;
    let context: PwContext | null = null;
    let page: PwPage | null = null;
    try {
      context = await browser.newContext({
        userAgent,
        locale: 'en-US',
        viewport,
        ignoreHTTPSErrors: env.amazon.ignoreHttpsErrors,
      });
      page = await context.newPage();
      // Record failed network requests (URL + error text only; no bodies/cookies).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (page as any).on('requestfailed', (req: unknown) => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const r = req as any;
          const failure = r.failure?.();
          networkErrors.push(`${r.method?.() ?? ''} ${redactUrl(r.url?.() ?? '')} -- ${failure?.errorText ?? 'failed'}`.trim());
        } catch { /* ignore */ }
      });

      let navError: ValidationErrorCode | undefined;
      try {
        await page.goto(canonicalUrl, { timeout: timeoutMs, waitUntil: 'domcontentloaded' });
      } catch (err) {
        const msg = (err as Error).message;
        navError = /timeout/i.test(msg) ? 'TIMEOUT' : 'NAVIGATION_FAILED';
      }

      let html: string | undefined;
      let finalUrl: string | undefined;
      try { finalUrl = redactUrl(page.url()); } catch { /* ignore */ }
      try { html = await page.content(); } catch { /* ignore */ }

      let screenshot: Buffer | undefined;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        screenshot = (await (page as any).screenshot({ fullPage: false })) as Buffer;
      } catch { /* ignore */ }

      const blocked = html ? looksBlocked(html, finalUrl ?? canonicalUrl) : false;
      const pageLoaded = !navError && Boolean(html);
      const validationErrorCode = navError ?? (blocked ? 'BLOCKED_OR_CAPTCHA' : undefined);

      return {
        ...base,
        finalUrl,
        pageLoaded,
        blockedOrCaptcha: blocked,
        validationErrorCode,
        networkErrors: networkErrors.slice(0, 50),
        screenshot,
        html,
      };
    } catch (err) {
      return { ...base, validationErrorCode: 'PARSE_FAILED', networkErrors: [`exception: ${(err as Error).message}`] };
    } finally {
      try { if (page) await page.close(); } catch { /* ignore */ }
      try { if (context) await context.close(); } catch { /* ignore */ }
    }
  }

  private async extractProductPage(page: PwPage): Promise<{
    productTitle: string | null;
    brand: string | null;
    priceText: string | null;
    availabilityText: string | null;
    buyable: boolean;
    deliveryText: string | null;
    fastestDeliveryText: string | null;
    primeBadgeVisible: boolean;
    sellerText: string | null;
    shipsFromText: string | null;
    soldByText: string | null;
    conditionText: string | null;
    ratingText: string | null;
    reviewCountText: string | null;
    couponText: string | null;
    productBullets: string[];
    descriptionSnippet: string | null;
    categoryBreadcrumbs: string[];
    warningBadges: string[];
  }> {
    try {
      return await page.$$eval('body', (els) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const doc = (els as any[])[0] as { querySelector: (s: string) => unknown; querySelectorAll: (s: string) => unknown };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const $ = (sel: string): any => (doc as any).querySelector(sel);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const $$ = (sel: string): any[] => Array.from((doc as any).querySelectorAll(sel));
        const text = (el: unknown): string | null => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const e = el as any;
          if (!e || !e.textContent) return null;
          const v = String(e.textContent).replace(/\s+/g, ' ').trim();
          return v.length ? v : null;
        };
        const tryAll = (selectors: string[]): string | null => {
          for (const s of selectors) {
            const v = text($(s));
            if (v) return v;
          }
          return null;
        };
        const productTitle = tryAll(['#productTitle', '#title', 'h1.a-size-large']);
        const brand = (() => {
          const b = text($('#bylineInfo'));
          if (!b) return null;
          // "Visit the X Store" or "Brand: X"
          return b
            .replace(/^Visit the\s+/i, '')
            .replace(/\s+Store$/i, '')
            .replace(/^Brand:\s*/i, '')
            .trim();
        })();
        const priceText = tryAll([
          '.priceToPay .a-offscreen',
          '#corePrice_feature_div .a-offscreen',
          '#corePriceDisplay_desktop_feature_div .a-offscreen',
          '#priceblock_ourprice',
          '#priceblock_dealprice',
          '#priceblock_saleprice',
          '.a-price .a-offscreen',
        ]);
        const availabilityText = tryAll([
          '#availability .a-color-success',
          '#availability .a-color-state',
          '#availability span',
          '#outOfStock',
        ]);
        const buyable = Boolean($('#add-to-cart-button') || $('#buy-now-button'));
        const deliveryText = tryAll([
          '#deliveryBlockMessage',
          '#mir-layout-DELIVERY_BLOCK',
          '[data-csa-c-content-id="DEXUnifiedCXPDM"]',
          '#ddmDeliveryMessage',
          '.a-color-success.a-text-bold',
        ]);
        // Prime / fastest-delivery signals. Amazon shows a separate "Or
        // fastest delivery <day>" line in the delivery block; capture it
        // even when the primary delivery date is slower.
        const fastestDeliveryText = (() => {
          const blocks = $$('#mir-layout-DELIVERY_BLOCK, #deliveryBlockMessage, #ddmDeliveryMessage, [data-csa-c-content-id="DEXUnifiedCXPDM"]');
          for (const b of blocks) {
            const t = text(b) ?? '';
            const m = t.match(/Or fastest delivery\s+([^\n.]+)/i);
            if (m) return m[1].trim();
          }
          // Fastest-delivery message can also appear as its own node.
          const node = $('#mir-fastest-delivery-message, .a-color-success.a-text-bold');
          const v = text(node) ?? '';
          if (/tomorrow|overnight|today/i.test(v)) return v;
          return null;
        })();
        const primeBadgeVisible = Boolean(
          $('i.a-icon-prime, span.a-icon-prime, .a-icon-prime, #primeBadgeBranded, .prime-savings-badge'),
        );
        const sellerText = tryAll(['#merchant-info', '[data-feature-name="merchantInfoFeature"]']);
        const shipsFromText = (() => {
          // Look for "Ships from" label in offer-display rows
          const labels = $$('.tabular-buybox-text, .a-section.a-spacing-none.a-spacing-top-mini, #offerDisplayFeatures_feature_div');
          for (const l of labels) {
            const t = text(l) ?? '';
            const m = t.match(/Ships from[:\s]+([^\n.|]+?)(?:\.|Sold by|Returns|$)/i);
            if (m) return m[1].trim();
          }
          return null;
        })();
        const soldByText = (() => {
          const labels = $$('.tabular-buybox-text, #offerDisplayFeatures_feature_div, #merchant-info');
          for (const l of labels) {
            const t = text(l) ?? '';
            const m = t.match(/Sold by[:\s]+([^\n.|]+?)(?:\.|Ships from|Returns|$)/i);
            if (m) return m[1].trim();
          }
          return null;
        })();
        const conditionText = tryAll([
          '#condition-display',
          '#twister-plus-feature-display-condition-row .a-text-bold',
          '#cmrs-atf-condition_feature_div .a-text-bold',
        ]);
        const ratingText = tryAll([
          '#acrPopover .a-icon-alt',
          '[data-hook="rating-out-of-text"]',
          '.AverageCustomerReviews .a-icon-alt',
          '#averageCustomerReviews .a-icon-alt',
        ]);
        const reviewCountText = tryAll([
          '#acrCustomerReviewText',
          '[data-hook="total-review-count"]',
        ]);
        const couponText = tryAll([
          '.couponBadge',
          '#promoPriceBlockMessage_feature_div',
          '.promoPriceBlockMessageCard_feature_div',
          '#vpcCouponNotPriceCheckbox_feature_div',
        ]);
        const productBullets: string[] = [];
        for (const li of $$('#feature-bullets li span.a-list-item, #feature-bullets li .a-list-item')) {
          const t = text(li);
          if (t && t.length > 1) productBullets.push(t);
        }
        const descriptionSnippet = tryAll([
          '#productDescription p',
          '#productDescription',
          '#productOverview_feature_div',
        ]);
        const categoryBreadcrumbs: string[] = [];
        for (const c of $$('#wayfinding-breadcrumbs_feature_div li, #wayfinding-breadcrumbs_container li')) {
          const t = text(c);
          if (t && t !== '›' && t !== '/') categoryBreadcrumbs.push(t.replace(/›/g, '').trim());
        }
        const warningBadges: string[] = [];
        for (const w of $$('.a-alert-warning, .a-box-warning, #regulatory_label_feature_div, .a-color-error')) {
          const t = text(w);
          if (t && t.length > 0 && t.length < 400) warningBadges.push(t);
        }
        return {
          productTitle,
          brand,
          priceText,
          availabilityText,
          buyable,
          deliveryText,
          fastestDeliveryText,
          primeBadgeVisible,
          sellerText,
          shipsFromText,
          soldByText,
          conditionText,
          ratingText,
          reviewCountText,
          couponText,
          productBullets,
          descriptionSnippet,
          categoryBreadcrumbs,
          warningBadges,
        };
      });
    } catch (err) {
      this.log.warn('extractProductPage failed', { err: (err as Error).message });
      return {
        productTitle: null,
        brand: null,
        priceText: null,
        availabilityText: null,
        buyable: false,
        deliveryText: null,
        fastestDeliveryText: null,
        primeBadgeVisible: false,
        sellerText: null,
        shipsFromText: null,
        soldByText: null,
        conditionText: null,
        ratingText: null,
        reviewCountText: null,
        couponText: null,
        productBullets: [],
        descriptionSnippet: null,
        categoryBreadcrumbs: [],
        warningBadges: [],
      };
    }
  }

  async close(): Promise<void> {
    try {
      if (this.browser) await this.browser.close();
    } catch {
      /* ignore */
    } finally {
      this.browser = null;
      this.launchAttempted = false;
      this.launchError = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip query string / fragment from a URL so saved diagnostics never
 *  contain tokens, session ids, or proxy creds embedded in URLs. */
function redactUrl(raw: string): string {
  if (!raw) return raw;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return raw; // e.g. about:blank
    return `${u.origin}${u.pathname}`;
  } catch {
    return raw.split('?')[0].split('#')[0];
  }
}

function looksBlocked(html: string, currentUrl: string): boolean {
  if (!html) return false;
  if (/\/errors\/validateCaptcha/i.test(currentUrl)) return true;
  if (/api-services-support@amazon\.com/i.test(html) && /robot/i.test(html)) return true;
  if (/Enter the characters you see below/i.test(html)) return true;
  return false;
}

// Page-quality classifier.  Separates a healthy results page from soft
// blocks, captchas, and genuinely malformed responses so the retry loop
// can decide whether to retry, give up, or move to the next query.
export function classifyAmazonSearchPage(
  html: string,
  currentUrl: string,
  tileCount: number,
  bodyTextLength: number,
): AmazonPageQuality {
  if (!html) return 'MALFORMED_PAGE';
  if (/\/errors\/validateCaptcha/i.test(currentUrl)) return 'CAPTCHA_OR_BLOCK';
  if (/Enter the characters you see below/i.test(html)) return 'CAPTCHA_OR_BLOCK';
  if (/Type the characters you see in this image/i.test(html)) return 'CAPTCHA_OR_BLOCK';
  if (/api-services-support@amazon\.com/i.test(html) && /robot/i.test(html)) return 'CAPTCHA_OR_BLOCK';
  if (/Robot Check/i.test(html)) return 'SOFT_BLOCK';
  if (/automated access to Amazon data/i.test(html)) return 'SOFT_BLOCK';
  if (/Sorry, we just need to make sure you'?re not a robot/i.test(html)) return 'SOFT_BLOCK';
  if (tileCount > 0) return 'SEARCH_RESULTS_OK';
  if (/no results for/i.test(html) || /did not match any products/i.test(html)) return 'EMPTY_RESULTS';
  if (bodyTextLength < 600) return 'PARTIAL_RENDER';
  return 'MALFORMED_PAGE';
}

// Race-wait for any of: search result cards, no-results message, captcha.
async function waitForSearchReady(page: PwPage, timeoutMs: number): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = page as any;
    if (typeof p.waitForSelector === 'function') {
      // Best-effort race; whichever resolves first wins.
      await Promise.race([
        p.waitForSelector('[data-component-type="s-search-result"]', { timeout: timeoutMs, state: 'attached' }),
        p.waitForSelector('div.s-result-item[data-asin]', { timeout: timeoutMs, state: 'attached' }),
        p.waitForSelector('.s-no-outline.s-noresults-message, [data-cel-widget="search-results"] .s-no-outline', { timeout: timeoutMs, state: 'attached' }),
        new Promise((resolve) => setTimeout(resolve, timeoutMs)),
      ]).catch(() => undefined);
    }
  } catch {
    /* ignore */
  }
}

// Trigger lazy-loaded result cards by scrolling halfway down and back.
async function safeScroll(page: PwPage): Promise<void> {
  try {
    await page.$$eval('body', (els) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = (els as any[])[0] as any;
      if (w && w.ownerDocument && w.ownerDocument.defaultView) {
        w.ownerDocument.defaultView.scrollTo(0, 800);
      }
      return 0;
    });
    await new Promise((r) => setTimeout(r, 600));
  } catch {
    /* ignore */
  }
}

async function safeBodyTextLength(page: PwPage): Promise<number> {
  try {
    return await page.$$eval('body', (els) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const e = (els as any[])[0] as any;
      const t = e && e.textContent ? String(e.textContent) : '';
      return t.length;
    });
  } catch {
    return 0;
  }
}

interface BrowserProfile {
  userAgent: string;
  viewport: { width: number; height: number };
}

const PROFILES: BrowserProfile[] = [
  {
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 900 },
  },
  {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
  },
  {
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
  },
  {
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
    viewport: { width: 1512, height: 982 },
  },
];

function browserProfile(attemptIndex: number): BrowserProfile {
  return PROFILES[attemptIndex % PROFILES.length];
}

function backoffDelay(retryNumber: number): number {
  // Exponential backoff with optional jitter, capped at AMAZON_RETRY_MAX_DELAY_MS.
  const base = env.amazon.retryBaseDelayMs;
  const cap = env.amazon.retryMaxDelayMs;
  const raw = Math.min(cap, base * Math.pow(2, Math.max(0, retryNumber - 1)));
  if (!env.amazon.retryJitter) return Math.floor(raw);
  // ±20% jitter.
  const jitter = raw * (0.8 + Math.random() * 0.4);
  return Math.floor(Math.min(cap, jitter));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function absoluteAmazonUrl(href: string | null, asin: string): string {
  // Always prefer the canonical /dp/<ASIN> form. Amazon search tiles use
  // tracking redirects (/sspa/click, /gp/slredirect, /gp/redirect) for
  // sponsored placements; following them later would obscure the real ASIN
  // page and may serve different content.
  if (!href) return amazonUrlFromAsin(asin);
  const cleaned = href.split('?')[0];
  if (!/\/dp\//.test(cleaned)) return amazonUrlFromAsin(asin);
  if (cleaned.startsWith('http')) return cleaned;
  if (cleaned.startsWith('/')) return `https://www.amazon.com${cleaned}`;
  return amazonUrlFromAsin(asin);
}

function parsePrice(s: string | null | undefined): number | undefined {
  if (!s) return undefined;
  const m = s.replace(/[^0-9.]/g, '');
  const n = Number(m);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function parsePriceCurrency(s: string | null | undefined): string | undefined {
  if (!s) return undefined;
  if (s.includes('$')) return 'USD';
  if (s.includes('£')) return 'GBP';
  if (s.includes('€')) return 'EUR';
  if (/USD/i.test(s)) return 'USD';
  return undefined;
}

function computePrimeFlags(parsed: {
  deliveryText: string | null;
  fastestDeliveryText: string | null;
  primeBadgeVisible: boolean;
  shipsFromText: string | null;
  soldByText: string | null;
  sellerText: string | null;
}): {
  primeBadgeVisible: boolean;
  primeInDeliveryText: boolean;
  primeSignalDetected: boolean;
  primeSignalSource?: string;
  fbaSignalDetected: boolean;
  shipsFromAmazon: boolean;
  soldByAmazon: boolean;
  fulfilledByAmazon: boolean;
} {
  const isAmazon = (s: string | null | undefined): boolean => {
    if (!s) return false;
    const lc = s.toLowerCase();
    return /\bamazon(\.com)?\b/.test(lc) && !/3rd|third[- ]party/.test(lc);
  };
  const deliveryBlob = `${parsed.deliveryText ?? ''} ${parsed.fastestDeliveryText ?? ''}`;
  const primeInDeliveryText = /\bprime\b/i.test(deliveryBlob) ||
    /\bfree\s+(?:two[- ]day|same[- ]day|next[- ]day|one[- ]day|overnight|tomorrow)\b/i.test(deliveryBlob);
  const shipsFromAmazon = isAmazon(parsed.shipsFromText);
  const soldByAmazon = isAmazon(parsed.soldByText);
  const sellerBlob = `${parsed.sellerText ?? ''} ${parsed.shipsFromText ?? ''} ${parsed.soldByText ?? ''}`;
  const fulfilledByAmazon = /fulfilled\s+by\s+amazon/i.test(sellerBlob);

  const sources: string[] = [];
  if (parsed.primeBadgeVisible) sources.push('prime_badge');
  if (primeInDeliveryText) sources.push('delivery_text_prime');
  if (parsed.fastestDeliveryText && /tomorrow|overnight|same\s*day|today/i.test(parsed.fastestDeliveryText)) {
    sources.push('fastest_delivery_overnight');
  }
  if (shipsFromAmazon) sources.push('ships_from_amazon');
  if (soldByAmazon) sources.push('sold_by_amazon');
  if (fulfilledByAmazon) sources.push('fulfilled_by_amazon');

  const primeSignalDetected = parsed.primeBadgeVisible || primeInDeliveryText ||
    (parsed.fastestDeliveryText !== null && /tomorrow|overnight|same\s*day|today/i.test(parsed.fastestDeliveryText));
  const fbaSignalDetected = shipsFromAmazon || fulfilledByAmazon;

  return {
    primeBadgeVisible: parsed.primeBadgeVisible,
    primeInDeliveryText,
    primeSignalDetected,
    primeSignalSource: sources.length > 0 ? sources.join(',') : undefined,
    fbaSignalDetected,
    shipsFromAmazon,
    soldByAmazon,
    fulfilledByAmazon,
  };
}

function inferInStock(availabilityText: string | undefined | null, buyable: boolean | undefined): boolean {
  const lc = (availabilityText ?? '').toLowerCase();
  if (lc.includes('in stock')) return true;
  if (lc.includes('only ') && lc.includes('left in stock')) return true;
  if (lc.includes('currently unavailable')) return false;
  if (lc.includes('temporarily out of stock')) return false;
  if (lc.includes('out of stock')) return false;
  // Fall back to the buy-button presence.
  return Boolean(buyable);
}

function parseRating(s: string | null): number | undefined {
  if (!s) return undefined;
  const m = s.match(/([0-9]+(?:\.[0-9]+)?)/);
  if (!m) return undefined;
  const n = Number(m[1]);
  return n >= 0 && n <= 5 ? n : undefined;
}

function parseReviewCount(s: string | null): number | undefined {
  if (!s) return undefined;
  const cleaned = s.replace(/[,()]/g, '').trim();
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function stableSeed(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 100000;
}

function synthesizeAsin(seed: number): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let rem = seed;
  let s = '';
  for (let i = 0; i < 8; i++) {
    s += alphabet[rem % alphabet.length];
    rem = Math.floor(rem / alphabet.length) + 7;
  }
  return `B0${s}`;
}

export { extractAsin };

let _client: AmazonBrowserClient | null = null;
export function getAmazonBrowserClient(): AmazonBrowserClient {
  if (_client) return _client;
  _client = env.runtime.mockMode ? new MockAmazonBrowserClient() : new PlaywrightAmazonBrowserClient();
  return _client;
}

/** Test-only: reset the cached singleton (useful for scripts that need a fresh browser). */
export function _resetAmazonBrowserClient(): void {
  _client = null;
}

/** Test-only: inject a fake client so unit tests can script retry behavior. */
export function _setAmazonBrowserClient(client: AmazonBrowserClient | null): void {
  _client = client;
}
