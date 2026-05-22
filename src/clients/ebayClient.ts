import axios, { AxiosInstance, AxiosError } from 'axios';
import { env } from '@/config/env';
import { logger } from '@/utils/logger';

export interface EbayBrowseItem {
  itemId: string;
  title: string;
  price?: { value: string; currency: string };
  itemWebUrl: string;
  image?: { imageUrl: string };
  seller?: { username: string; feedbackPercentage?: string; feedbackScore?: number };
  categories?: { categoryId: string; categoryName: string }[];
  condition?: string;
  shippingOptions?: { shippingCost?: { value: string } }[];
  buyingOptions?: string[];
  itemAffiliateWebUrl?: string;
  estimatedAvailabilities?: { estimatedAvailabilityStatus?: string }[];
  topRatedBuyingExperience?: boolean;
}

export interface EbaySearchOptions {
  limit?: number;
  marketplaceId?: string;
  categoryIds?: string[];
}

export type EbayErrorCode =
  | 'MISSING_CREDENTIALS'
  | 'TOKEN_EXPIRED'
  | 'RATE_LIMITED'
  | 'NETWORK_TIMEOUT'
  | 'MALFORMED_RESPONSE'
  | 'UPSTREAM_ERROR';

export interface EbaySearchResult {
  items: EbayBrowseItem[];
  error?: { code: EbayErrorCode; message: string; httpStatus?: number };
}

const BASE_URL = 'https://api.ebay.com';
const OAUTH_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const SCOPE = 'https://api.ebay.com/oauth/api_scope';
const SEARCH_PATH = '/buy/browse/v1/item_summary/search';

const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 750;

export class EbayClient {
  private http: AxiosInstance;
  private token?: string;
  private tokenExpiresAt = 0;
  private readonly log = logger.child('ebayClient');

  constructor() {
    this.http = axios.create({ baseURL: BASE_URL, timeout: 15000 });
    if (env.ebay.oauthToken) {
      this.token = env.ebay.oauthToken;
      this.tokenExpiresAt = Date.now() + 60 * 60 * 1000;
    }
  }

  /**
   * Decide whether this call should return mocked data. Mock mode is bypassed
   * when OTTO_REAL_EBAY_DISCOVERY=true so callers can force live API hits.
   */
  private shouldUseMock(): boolean {
    if (env.runtime.realEbayDiscovery) return false;
    return env.runtime.mockMode;
  }

  private hasCredentials(): boolean {
    return Boolean(env.ebay.oauthToken || (env.ebay.clientId && env.ebay.clientSecret));
  }

  private async ensureToken(forceRefresh = false): Promise<string> {
    if (!forceRefresh && this.token && Date.now() < this.tokenExpiresAt - 60_000) return this.token;
    if (!env.ebay.clientId || !env.ebay.clientSecret) {
      throw new EbayClientError('MISSING_CREDENTIALS', 'EBAY_CLIENT_ID / EBAY_CLIENT_SECRET are required to mint a Browse API token.');
    }
    const basic = Buffer.from(`${env.ebay.clientId}:${env.ebay.clientSecret}`).toString('base64');
    const body = new URLSearchParams({ grant_type: 'client_credentials', scope: SCOPE });
    try {
      const res = await axios.post(OAUTH_URL, body.toString(), {
        headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 10000,
      });
      this.token = res.data.access_token as string;
      this.tokenExpiresAt = Date.now() + (res.data.expires_in as number) * 1000;
      return this.token;
    } catch (err) {
      const axErr = err as AxiosError;
      throw new EbayClientError('UPSTREAM_ERROR', `OAuth token mint failed: ${axErr.message}`, axErr.response?.status);
    }
  }

  async search(keyword: string, opts: EbaySearchOptions = {}): Promise<EbaySearchResult> {
    if (this.shouldUseMock()) {
      return { items: mockSearchResults(keyword, opts.limit ?? 5) };
    }
    if (!this.hasCredentials()) {
      return {
        items: [],
        error: {
          code: 'MISSING_CREDENTIALS',
          message: 'eBay credentials not configured. Set EBAY_CLIENT_ID and EBAY_CLIENT_SECRET (or EBAY_OAUTH_TOKEN).',
        },
      };
    }

    const marketplace = opts.marketplaceId ?? env.pipeline.defaultMarketplaceTarget ?? 'EBAY_US';
    const params: Record<string, string> = {
      q: keyword,
      limit: String(Math.min(Math.max(opts.limit ?? 50, 1), 200)),
    };
    if (opts.categoryIds && opts.categoryIds.length > 0) {
      params.category_ids = opts.categoryIds.join(',');
    }

    let lastErr: { code: EbayErrorCode; message: string; httpStatus?: number } | undefined;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const token = await this.ensureToken(attempt > 1 && lastErr?.code === 'TOKEN_EXPIRED');
        const res = await this.http.get(SEARCH_PATH, {
          params,
          headers: {
            Authorization: `Bearer ${token}`,
            'X-EBAY-C-MARKETPLACE-ID': marketplace,
            'Content-Type': 'application/json',
          },
        });
        if (!res.data || typeof res.data !== 'object') {
          return { items: [], error: { code: 'MALFORMED_RESPONSE', message: 'eBay returned non-JSON body' } };
        }
        const items = (res.data.itemSummaries ?? []) as EbayBrowseItem[];
        if (!Array.isArray(items)) {
          return { items: [], error: { code: 'MALFORMED_RESPONSE', message: 'itemSummaries is not an array' } };
        }
        return { items };
      } catch (err) {
        if (err instanceof EbayClientError) {
          lastErr = { code: err.code, message: err.message, httpStatus: err.httpStatus };
          if (err.code === 'MISSING_CREDENTIALS') break;
          continue;
        }
        const axErr = err as AxiosError;
        const status = axErr.response?.status;
        const code: EbayErrorCode = mapHttpToCode(status, axErr.code);
        lastErr = {
          code,
          message: `eBay search failed: ${axErr.message}`,
          httpStatus: status,
        };
        this.log.warn('eBay Browse search error', {
          keyword,
          attempt,
          code,
          httpStatus: status,
          message: axErr.message,
        });

        // Token may have been revoked.  Force a refresh on the next loop.
        if (status === 401) {
          this.token = undefined;
          this.tokenExpiresAt = 0;
        }

        if (!isRetryable(code) || attempt === MAX_RETRIES) break;
        await sleep(BASE_BACKOFF_MS * Math.pow(2, attempt - 1));
      }
    }

    return { items: [], error: lastErr ?? { code: 'UPSTREAM_ERROR', message: 'Unknown eBay error' } };
  }
}

class EbayClientError extends Error {
  constructor(public code: EbayErrorCode, message: string, public httpStatus?: number) {
    super(message);
  }
}

function mapHttpToCode(status: number | undefined, axiosCode: string | undefined): EbayErrorCode {
  if (axiosCode === 'ECONNABORTED' || axiosCode === 'ETIMEDOUT') return 'NETWORK_TIMEOUT';
  if (status === 401) return 'TOKEN_EXPIRED';
  if (status === 429) return 'RATE_LIMITED';
  return 'UPSTREAM_ERROR';
}

function isRetryable(code: EbayErrorCode): boolean {
  return code === 'TOKEN_EXPIRED' || code === 'RATE_LIMITED' || code === 'NETWORK_TIMEOUT' || code === 'UPSTREAM_ERROR';
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function mockSearchResults(keyword: string, limit: number): EbayBrowseItem[] {
  const out: EbayBrowseItem[] = [];
  for (let i = 0; i < limit; i++) {
    out.push({
      itemId: `v1|MOCK-${keyword.replace(/\s+/g, '_')}-${i}|0`,
      title: `${keyword} #${i + 1}`,
      price: { value: (10 + i * 4.5).toFixed(2), currency: 'USD' },
      itemWebUrl: `https://www.ebay.com/itm/MOCK${i}`,
      image: { imageUrl: 'https://example.com/img.jpg' },
      categories: [{ categoryId: '11700', categoryName: 'Home & Garden' }],
      condition: 'NEW',
      seller: { username: `seller_${i}`, feedbackPercentage: '99.0', feedbackScore: 1000 + i * 50 },
      buyingOptions: ['FIXED_PRICE'],
      estimatedAvailabilities: [{ estimatedAvailabilityStatus: 'IN_STOCK' }],
    });
  }
  return out;
}

let _client: EbayClient | null = null;
export function getEbayClient(): EbayClient {
  if (!_client) _client = new EbayClient();
  return _client;
}
