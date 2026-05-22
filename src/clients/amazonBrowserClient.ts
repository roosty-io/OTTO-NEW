import { env } from '@/config/env';
import { logger } from '@/utils/logger';
import { amazonUrlFromAsin, extractAsin } from '@/utils/normalize';

/**
 * Playwright-backed Amazon scraper.  Implemented as a thin, mockable client
 * so the pipeline can be exercised without driving a real browser.
 *
 * TODO(real-browser):
 *   - Launch Playwright Chromium with proxy + ZIP cookie set to env.pipeline.defaultZipCode
 *   - Solve / handle captchas, rate limit, retry policy
 *   - Parse product page for price, stock, delivery, badges, variation attrs
 */

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

export interface AmazonSearchHit {
  asin: string;
  amazonUrl: string;
  title: string;
  brand?: string;
  price?: number;
}

export interface AmazonBrowserClient {
  /**
   * False when the underlying implementation is a placeholder (no real
   * browser automation wired up).  Callers should surface this as
   * `AMAZON_RESOLUTION_NOT_IMPLEMENTED` instead of silently failing.
   * True only when mock mode supplies deterministic synthetic data, or
   * when a real Playwright-backed client lands.
   */
  readonly isImplemented: boolean;
  searchByKeyword(keyword: string, limit?: number): Promise<AmazonSearchHit[]>;
  resolveByTitle(title: string): Promise<AmazonSearchHit | null>;
  getProduct(asin: string, zipCode?: string): Promise<AmazonProductSnapshot | null>;
  close(): Promise<void>;
}

class PlaceholderAmazonBrowserClient implements AmazonBrowserClient {
  private readonly log = logger.child('amazonBrowserClient');
  get isImplemented(): boolean {
    return env.runtime.mockMode;
  }

  async searchByKeyword(keyword: string, limit = 5): Promise<AmazonSearchHit[]> {
    if (env.runtime.mockMode) {
      return mockSearchByKeyword(keyword, limit);
    }
    this.log.warn(
      'PlaceholderAmazonBrowserClient.searchByKeyword called without mock mode; returning empty list.',
      { keyword },
    );
    return [];
  }

  async resolveByTitle(title: string): Promise<AmazonSearchHit | null> {
    if (env.runtime.mockMode) {
      const hits = mockSearchByKeyword(title, 1);
      return hits[0] ?? null;
    }
    this.log.warn('PlaceholderAmazonBrowserClient.resolveByTitle called without mock mode.', { title });
    return null;
  }

  async getProduct(asin: string, _zipCode?: string): Promise<AmazonProductSnapshot | null> {
    if (env.runtime.mockMode) {
      return mockGetProduct(asin);
    }
    this.log.warn('PlaceholderAmazonBrowserClient.getProduct called without mock mode.', { asin });
    return null;
  }

  async close(): Promise<void> {
    return;
  }
}

function mockSearchByKeyword(keyword: string, limit: number): AmazonSearchHit[] {
  const out: AmazonSearchHit[] = [];
  const base = stableAsinSeed(keyword);
  for (let i = 0; i < limit; i++) {
    const asin = synthesizeAsin(base + i);
    out.push({
      asin,
      amazonUrl: amazonUrlFromAsin(asin),
      title: `${keyword} - mock listing ${i + 1}`,
      brand: 'OttoMock',
      price: 8 + i * 3.25,
    });
  }
  return out;
}

function mockGetProduct(asin: string): AmazonProductSnapshot {
  const seed = asin.charCodeAt(asin.length - 1);
  const inStock = seed % 7 !== 0;
  const deliveryDays = (seed % 9) + 2; // 2 - 10
  return {
    asin,
    amazonUrl: amazonUrlFromAsin(asin),
    title: `Mock product ${asin}`,
    brand: 'OttoMock',
    price: 12 + (seed % 30),
    inStock,
    deliveryDays,
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

function stableAsinSeed(s: string): number {
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

// Re-export helpers consumers may need.
export { extractAsin };

let _client: AmazonBrowserClient | null = null;
export function getAmazonBrowserClient(): AmazonBrowserClient {
  if (!_client) _client = new PlaceholderAmazonBrowserClient();
  return _client;
}
