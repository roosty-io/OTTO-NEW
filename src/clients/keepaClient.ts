import axios, { AxiosInstance } from 'axios';
import { env } from '@/config/env';
import { logger } from '@/utils/logger';

/**
 * Thin wrapper around the Keepa API.  Only the endpoints needed for V1 are
 * stubbed; future agents (rank movement, price stability) can extend this.
 *
 * TODO(real-api):
 *   - Implement /product, /search, /deal endpoints
 *   - Respect Keepa's token cost system
 *   - Cache product snapshots keyed by ASIN + days back
 */

export interface KeepaProductSummary {
  asin: string;
  title?: string;
  brand?: string;
  salesRank?: number;
  buyBoxPrice?: number;
  buyBoxAvg30?: number;
  buyBoxAvg90?: number;
  outOfStockPercent30?: number;
  raw: Record<string, unknown>;
}

export class KeepaClient {
  private http: AxiosInstance;
  private readonly log = logger.child('keepaClient');

  constructor() {
    this.http = axios.create({ baseURL: 'https://api.keepa.com', timeout: 15000 });
  }

  async getProduct(asin: string): Promise<KeepaProductSummary | null> {
    if (env.runtime.mockMode) {
      return mockKeepaProduct(asin);
    }
    if (!env.keepa.apiKey) {
      this.log.warn('KEEPA_API_KEY not configured; skipping Keepa lookup.', { asin });
      return null;
    }
    try {
      const res = await this.http.get('/product', {
        params: { key: env.keepa.apiKey, domain: 1, asin, stats: 90 },
      });
      const products = (res.data?.products ?? []) as Record<string, unknown>[];
      const p = products[0];
      if (!p) return null;
      return {
        asin,
        title: p.title as string | undefined,
        brand: p.brand as string | undefined,
        salesRank: (p.salesRanks as Record<string, number[]> | undefined)
          ? Object.values(p.salesRanks as Record<string, number[]>)[0]?.slice(-1)[0]
          : undefined,
        raw: p,
      };
    } catch (err) {
      this.log.error('Keepa /product failed', { asin, err: (err as Error).message });
      return null;
    }
  }
}

function mockKeepaProduct(asin: string): KeepaProductSummary {
  const seed = asin.charCodeAt(asin.length - 1);
  return {
    asin,
    title: `Mock Keepa snapshot for ${asin}`,
    brand: 'OttoMock',
    salesRank: 5000 + seed * 73,
    buyBoxPrice: 12 + (seed % 30),
    buyBoxAvg30: 12 + (seed % 28),
    buyBoxAvg90: 13 + (seed % 25),
    outOfStockPercent30: seed % 8,
    raw: { source: 'mock' },
  };
}

let _client: KeepaClient | null = null;
export function getKeepaClient(): KeepaClient {
  if (!_client) _client = new KeepaClient();
  return _client;
}
