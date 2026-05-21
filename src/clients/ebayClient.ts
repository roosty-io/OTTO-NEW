import axios, { AxiosInstance } from 'axios';
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

const BASE_URL = 'https://api.ebay.com';
const OAUTH_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const SCOPE = 'https://api.ebay.com/oauth/api_scope';

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

  private async ensureToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiresAt - 60_000) return this.token;
    if (!env.ebay.clientId || !env.ebay.clientSecret) {
      throw new Error('EBAY_CLIENT_ID / EBAY_CLIENT_SECRET are required to mint a Browse API token.');
    }
    const basic = Buffer.from(`${env.ebay.clientId}:${env.ebay.clientSecret}`).toString('base64');
    const body = new URLSearchParams({ grant_type: 'client_credentials', scope: SCOPE });
    const res = await axios.post(OAUTH_URL, body.toString(), {
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    this.token = res.data.access_token as string;
    this.tokenExpiresAt = Date.now() + (res.data.expires_in as number) * 1000;
    return this.token;
  }

  async search(keyword: string, opts: EbaySearchOptions = {}): Promise<EbayBrowseItem[]> {
    if (env.runtime.mockMode) {
      return mockSearchResults(keyword, opts.limit ?? 5);
    }
    if (!env.ebay.clientId && !env.ebay.oauthToken) {
      this.log.warn('No eBay credentials present; returning empty result set. Set OTTO_MOCK_MODE=true for test data.');
      return [];
    }
    const token = await this.ensureToken();
    const params: Record<string, string> = {
      q: keyword,
      limit: String(opts.limit ?? 20),
    };
    if (opts.categoryIds && opts.categoryIds.length > 0) {
      params.category_ids = opts.categoryIds.join(',');
    }
    const marketplace = opts.marketplaceId ?? env.pipeline.defaultMarketplaceTarget ?? 'EBAY_US';
    try {
      const res = await this.http.get('/buy/browse/v1/item_summary/search', {
        params,
        headers: {
          Authorization: `Bearer ${token}`,
          'X-EBAY-C-MARKETPLACE-ID': marketplace,
          'Content-Type': 'application/json',
        },
      });
      const items = (res.data?.itemSummaries ?? []) as EbayBrowseItem[];
      return items;
    } catch (err) {
      this.log.error('eBay Browse search failed', { keyword, err: (err as Error).message });
      return [];
    }
  }
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
