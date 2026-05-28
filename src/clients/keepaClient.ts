import axios, { AxiosInstance } from 'axios';
import { env } from '@/config/env';
import { logger } from '@/utils/logger';

/**
 * Wrapper around the Keepa API.
 *
 * V1 endpoints used:
 *   - /product  (real)  -> product snapshots + 90-day stats
 *   - /query    (real)  -> Product Finder, for rank-movement discovery
 *
 * Keepa has no "fake" fallback in real mode.  If an endpoint isn't
 * available on the current plan the client returns a typed error
 * (KEEPA_PLAN_LIMITATION / KEEPA_ENDPOINT_UNAVAILABLE / KEEPA_API_ERROR)
 * rather than inventing candidates.  Mock data is only returned when
 * OTTO_MOCK_MODE=true.
 *
 * Keepa CSV indices used: 0=AMAZON price, 1=NEW price, 3=SALES rank,
 * 16=RATING (x10), 17=COUNT_REVIEWS, 18=BUY_BOX_SHIPPING price.
 * Prices are in cents.
 */

export type KeepaErrorCode =
  | 'KEEPA_ENDPOINT_UNAVAILABLE'
  | 'KEEPA_PLAN_LIMITATION'
  | 'KEEPA_API_ERROR'
  | 'KEEPA_NOT_CONFIGURED';

export interface KeepaError {
  code: KeepaErrorCode;
  message: string;
}

export interface KeepaTokenInfo {
  tokensConsumed?: number;
  tokensLeft?: number;
  refillIn?: number;
  refillRate?: number;
}

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

/** Normalized, pipeline-ready view of a Keepa product. */
export interface NormalizedKeepaProduct {
  asin: string;
  title?: string;
  brand?: string;
  amazonCategory?: string;
  categoryId?: number;
  rootCategory?: number;
  amazonPrice?: number; // dollars
  salesRankCurrent?: number;
  salesRank30dAvg?: number;
  salesRank90dAvg?: number;
  rankImprovement30d?: number; // % (positive = improving)
  rankImprovement90d?: number;
  keepaTrackingScore?: number; // derived 0-100
  reviewCount?: number;
  rating?: number;
  imageUrl?: string;
}

export interface RankMoversInput {
  rootCategory: number;
  maxResults: number;
  minRankImprovementPercent: number;
  maxSalesRank?: number; // 0/undefined = no ceiling
  minAvgRank30d?: number; // 0/undefined = no floor
  minAmazonPriceCents?: number;
  maxAmazonPriceCents?: number;
}

export interface RankMoversResult {
  asins: string[];
  tokens: KeepaTokenInfo;
  error?: KeepaError;
}

export interface FetchProductsResult {
  products: KeepaProductSummary[];
  tokens: KeepaTokenInfo;
  error?: KeepaError;
}

// Keepa CSV indices.
const IDX_AMAZON = 0;
const IDX_NEW = 1;
const IDX_SALES = 3;
const IDX_RATING = 16;
const IDX_REVIEWS = 17;
const IDX_BUYBOX = 18;

export class KeepaClient {
  private http: AxiosInstance;
  private readonly log = logger.child('keepaClient');

  constructor() {
    this.http = axios.create({ baseURL: 'https://api.keepa.com', timeout: 20000 });
  }

  private get domain(): number {
    return env.keepa.domain || 1;
  }

  async getProduct(asin: string): Promise<KeepaProductSummary | null> {
    if (env.runtime.mockMode) {
      return mockKeepaProduct(asin);
    }
    if (!env.keepa.apiKey) {
      this.log.warn('KEEPA_API_KEY not configured; skipping Keepa lookup.', { asin });
      return null;
    }
    const res = await this.fetchProductsByAsin([asin]);
    if (res.error || res.products.length === 0) return null;
    return res.products[0];
  }

  /**
   * Batch product lookup with 90-day stats.  Real /product call; mock in
   * mock mode.
   */
  async fetchProductsByAsin(asins: string[]): Promise<FetchProductsResult> {
    const unique = [...new Set(asins.map((a) => a.trim()).filter(Boolean))];
    if (unique.length === 0) return { products: [], tokens: {} };

    if (env.runtime.mockMode) {
      return { products: unique.map(mockKeepaProduct), tokens: { tokensLeft: 9999 } };
    }
    if (!env.keepa.apiKey) {
      return { products: [], tokens: {}, error: { code: 'KEEPA_NOT_CONFIGURED', message: 'KEEPA_API_KEY is not set' } };
    }

    try {
      const res = await this.http.get('/product', {
        params: {
          key: env.keepa.apiKey,
          domain: this.domain,
          asin: unique.join(','),
          stats: 90,
          rating: 1,
        },
      });
      const body = res.data ?? {};
      const tokens = readTokens(body);
      const products = ((body.products ?? []) as Record<string, unknown>[]).map((p) =>
        toProductSummary(p),
      );
      return { products, tokens };
    } catch (err) {
      return { products: [], tokens: {}, error: classifyKeepaError(err, this.log) };
    }
  }

  /**
   * Product Finder (/query) for rank-movement discovery: products in a
   * root category whose sales rank improved over the last 30 days.
   * Returns a list of ASINs only (then enrich with fetchProductsByAsin).
   */
  async findRankMovers(input: RankMoversInput): Promise<RankMoversResult> {
    if (env.runtime.mockMode) {
      // Deterministic mock ASINs so the pipeline can be exercised offline.
      const n = Math.max(1, Math.min(input.maxResults, 5));
      const asins = Array.from({ length: n }, (_, i) => `B0KEEPA${String(input.rootCategory).slice(-2)}${i}`);
      return { asins, tokens: { tokensLeft: 9999 } };
    }
    if (!env.keepa.apiKey) {
      return { asins: [], tokens: {}, error: { code: 'KEEPA_NOT_CONFIGURED', message: 'KEEPA_API_KEY is not set' } };
    }

    // Keepa Product Finder selection. delta30_SALES < 0 means the sales
    // rank number dropped (improved) over 30 days.  Sorted by the biggest
    // 30-day improvement first.
    // Keepa Product Finder requires a page size within its allowed range
    // (small values like 0-4 are rejected with "too small").  Request a
    // standard page (50) and slice to the caller's budget afterward.
    const perPage = Math.max(50, Math.min(input.maxResults, 100));
    const selection: Record<string, unknown> = {
      rootCategory: input.rootCategory,
      productType: [0, 1], // standard + variation parent
      perPage,
      page: 0,
      sort: [['delta30_SALES', 'asc']],
      delta30_SALES_lte: -1, // rank improved at all over 30d
    };
    if (input.maxSalesRank && input.maxSalesRank > 0) {
      selection.current_SALES_lte = input.maxSalesRank;
    }
    if (input.minAvgRank30d && input.minAvgRank30d > 0) {
      selection.avg30_SALES_gte = input.minAvgRank30d;
    }
    if (input.minAmazonPriceCents && input.minAmazonPriceCents > 0) {
      selection.current_AMAZON_gte = input.minAmazonPriceCents;
    }
    if (input.maxAmazonPriceCents && input.maxAmazonPriceCents > 0) {
      selection.current_AMAZON_lte = input.maxAmazonPriceCents;
    }

    try {
      const res = await this.http.get('/query', {
        params: {
          key: env.keepa.apiKey,
          domain: this.domain,
          selection: JSON.stringify(selection),
        },
      });
      const body = res.data ?? {};
      const tokens = readTokens(body);
      const asinList = (body.asinList ?? body.asins ?? []) as string[];
      if (!Array.isArray(asinList)) {
        return { asins: [], tokens, error: { code: 'KEEPA_API_ERROR', message: 'Unexpected /query response shape' } };
      }
      return { asins: asinList.slice(0, input.maxResults), tokens };
    } catch (err) {
      return { asins: [], tokens: {}, error: classifyKeepaError(err, this.log) };
    }
  }
}

/** Pure normalization of a raw Keepa product object into a candidate view. */
export function normalizeKeepaProduct(raw: Record<string, unknown>): NormalizedKeepaProduct | null {
  const asin = typeof raw.asin === 'string' ? raw.asin : undefined;
  if (!asin) return null;

  const stats = (raw.stats ?? {}) as Record<string, unknown>;
  const current = asNumberArray(stats.current);
  const avg30 = asNumberArray(stats.avg30);
  const avg90 = asNumberArray(stats.avg90);

  const salesRankCurrent = pickRank(current, IDX_SALES) ?? pickRankFromSalesRanks(raw, 'current');
  const salesRank30dAvg = pickRank(avg30, IDX_SALES);
  const salesRank90dAvg = pickRank(avg90, IDX_SALES);

  const rankImprovement30d = rankImprovement(salesRank30dAvg, salesRankCurrent);
  const rankImprovement90d = rankImprovement(salesRank90dAvg, salesRankCurrent);

  const priceCents =
    pickPrice(current, IDX_AMAZON) ?? pickPrice(current, IDX_BUYBOX) ?? pickPrice(current, IDX_NEW);
  const amazonPrice = priceCents !== undefined ? Math.round(priceCents) / 100 : undefined;

  const ratingRaw = pickValue(current, IDX_RATING);
  const rating = ratingRaw !== undefined && ratingRaw >= 0 ? ratingRaw / 10 : undefined;
  const reviewVal = pickValue(current, IDX_REVIEWS);
  const reviewCount = reviewVal !== undefined && reviewVal >= 0 ? reviewVal : undefined;

  const categoryTree = (raw.categoryTree ?? []) as { catId?: number; name?: string }[];
  const amazonCategory = Array.isArray(categoryTree) && categoryTree.length > 0
    ? categoryTree.map((c) => c?.name).filter(Boolean).join(' > ')
    : undefined;
  const categoryId = Array.isArray(categoryTree) && categoryTree.length > 0
    ? categoryTree[categoryTree.length - 1]?.catId
    : undefined;
  const rootCategory = typeof raw.rootCategory === 'number' ? (raw.rootCategory as number) : undefined;

  const imagesCsv = typeof raw.imagesCSV === 'string' ? (raw.imagesCSV as string) : undefined;
  const firstImage = imagesCsv ? imagesCsv.split(',')[0] : undefined;
  const imageUrl = firstImage ? `https://m.media-amazon.com/images/I/${firstImage}` : undefined;

  return {
    asin,
    title: typeof raw.title === 'string' ? raw.title : undefined,
    brand: pickBrand(raw),
    amazonCategory,
    categoryId,
    rootCategory,
    amazonPrice,
    salesRankCurrent,
    salesRank30dAvg,
    salesRank90dAvg,
    rankImprovement30d,
    rankImprovement90d,
    keepaTrackingScore: keepaTrackingScore(salesRankCurrent, rankImprovement30d),
    reviewCount,
    rating,
    imageUrl,
  };
}

/** Discovery score 0-100 from rank improvement + current rank quality. */
export function keepaDiscoveryScore(p: NormalizedKeepaProduct): number {
  let score = 50;
  if (typeof p.rankImprovement30d === 'number') {
    score += Math.max(-20, Math.min(30, p.rankImprovement30d * 0.5));
  }
  if (typeof p.salesRankCurrent === 'number' && p.salesRankCurrent > 0) {
    // Better (smaller) rank => small bonus.
    if (p.salesRankCurrent < 5000) score += 15;
    else if (p.salesRankCurrent < 25000) score += 8;
    else if (p.salesRankCurrent < 100000) score += 3;
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}

// --------------------------------------------------------------------------
// helpers
// --------------------------------------------------------------------------

function keepaTrackingScore(rankCurrent?: number, improvement30d?: number): number | undefined {
  if (rankCurrent === undefined && improvement30d === undefined) return undefined;
  let s = 50;
  if (typeof improvement30d === 'number') s += Math.max(-25, Math.min(35, improvement30d * 0.6));
  if (typeof rankCurrent === 'number' && rankCurrent > 0 && rankCurrent < 20000) s += 10;
  return Math.max(0, Math.min(100, Math.round(s)));
}

function rankImprovement(avg?: number, current?: number): number | undefined {
  if (!avg || !current || avg <= 0 || current <= 0) return undefined;
  // Lower rank number is better, so improvement = (avg - current) / avg.
  return ((avg - current) / avg) * 100;
}

function asNumberArray(v: unknown): number[] | undefined {
  return Array.isArray(v) ? (v as number[]) : undefined;
}

function pickValue(arr: number[] | undefined, idx: number): number | undefined {
  if (!arr || idx >= arr.length) return undefined;
  const v = arr[idx];
  return typeof v === 'number' && v !== -1 ? v : undefined;
}

function pickRank(arr: number[] | undefined, idx: number): number | undefined {
  const v = pickValue(arr, idx);
  return v !== undefined && v > 0 ? v : undefined;
}

function pickPrice(arr: number[] | undefined, idx: number): number | undefined {
  const v = pickValue(arr, idx);
  return v !== undefined && v > 0 ? v : undefined;
}

function pickRankFromSalesRanks(raw: Record<string, unknown>, which: 'current'): number | undefined {
  const sr = raw.salesRanks as Record<string, number[]> | undefined;
  if (!sr) return undefined;
  const first = Object.values(sr)[0];
  if (!Array.isArray(first) || first.length === 0) return undefined;
  // salesRanks arrays are [keepaTime, rank, keepaTime, rank, ...]; last rank:
  const last = first[first.length - 1];
  return typeof last === 'number' && last > 0 ? last : undefined;
}

function pickBrand(raw: Record<string, unknown>): string | undefined {
  const b = raw.brand ?? raw.manufacturer;
  return typeof b === 'string' && b.length > 0 ? b : undefined;
}

function toProductSummary(p: Record<string, unknown>): KeepaProductSummary {
  const stats = (p.stats ?? {}) as Record<string, unknown>;
  const current = asNumberArray(stats.current);
  const avg30 = asNumberArray(stats.avg30);
  const avg90 = asNumberArray(stats.avg90);
  return {
    asin: String(p.asin ?? ''),
    title: typeof p.title === 'string' ? p.title : undefined,
    brand: pickBrand(p),
    salesRank: pickRank(current, IDX_SALES),
    buyBoxPrice: priceDollars(pickPrice(current, IDX_BUYBOX) ?? pickPrice(current, IDX_AMAZON)),
    buyBoxAvg30: priceDollars(pickPrice(avg30, IDX_BUYBOX) ?? pickPrice(avg30, IDX_AMAZON)),
    buyBoxAvg90: priceDollars(pickPrice(avg90, IDX_BUYBOX) ?? pickPrice(avg90, IDX_AMAZON)),
    raw: p,
  };
}

function priceDollars(cents?: number): number | undefined {
  return cents === undefined ? undefined : Math.round(cents) / 100;
}

function readTokens(body: Record<string, unknown>): KeepaTokenInfo {
  return {
    tokensConsumed: typeof body.tokensConsumed === 'number' ? body.tokensConsumed : undefined,
    tokensLeft: typeof body.tokensLeft === 'number' ? body.tokensLeft : undefined,
    refillIn: typeof body.refillIn === 'number' ? body.refillIn : undefined,
    refillRate: typeof body.refillRate === 'number' ? body.refillRate : undefined,
  };
}

function classifyKeepaError(err: unknown, log: ReturnType<typeof logger.child>): KeepaError {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ax = err as any;
  const status = ax?.response?.status as number | undefined;
  const data = ax?.response?.data as Record<string, unknown> | undefined;
  const message = extractKeepaMessage(data) || ax?.message || 'Keepa request failed';
  log.error('Keepa request failed', { status, message });
  // 400/402 from Product Finder typically mean the plan doesn't include it
  // or the selection used unavailable fields.
  if (status === 402 || status === 403) {
    return { code: 'KEEPA_PLAN_LIMITATION', message: `Keepa plan limitation (HTTP ${status}): ${message}` };
  }
  if (status === 400) {
    return { code: 'KEEPA_ENDPOINT_UNAVAILABLE', message: `Keepa endpoint/selection unavailable (HTTP 400): ${message}` };
  }
  return { code: 'KEEPA_API_ERROR', message: `${status ? `HTTP ${status}: ` : ''}${message}` };
}

function extractKeepaMessage(data: Record<string, unknown> | undefined): string | undefined {
  if (!data) return undefined;
  const e = data.error;
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object') {
    const eo = e as Record<string, unknown>;
    const msg = (eo.message as string) || (eo.type as string);
    return msg || JSON.stringify(e);
  }
  if (typeof data.message === 'string') return data.message;
  // Fall back to a truncated dump of the body so the operator sees something.
  try {
    const dump = JSON.stringify(data);
    return dump && dump !== '{}' ? dump.slice(0, 300) : undefined;
  } catch {
    return undefined;
  }
}

function mockKeepaProduct(asin: string): KeepaProductSummary {
  const seed = asin.charCodeAt(asin.length - 1);
  // Build a mock that normalizeKeepaProduct can parse via stats arrays.
  const current: number[] = [];
  current[IDX_AMAZON] = 1500 + (seed % 50) * 100; // cents -> $15-$65
  current[IDX_SALES] = 3000 + seed * 50;
  current[IDX_RATING] = 45;
  current[IDX_REVIEWS] = 800 + seed * 7;
  const avg30: number[] = [];
  avg30[IDX_SALES] = 6000 + seed * 50; // worse 30d avg => improving
  avg30[IDX_AMAZON] = current[IDX_AMAZON];
  const avg90: number[] = [];
  avg90[IDX_SALES] = 7000 + seed * 50;
  avg90[IDX_AMAZON] = current[IDX_AMAZON];
  return {
    asin,
    title: `Mock Keepa product ${asin} - storage organizer bin`,
    brand: 'OttoMock',
    salesRank: current[IDX_SALES],
    buyBoxPrice: current[IDX_AMAZON] / 100,
    raw: {
      asin,
      title: `Mock Keepa product ${asin} - storage organizer bin`,
      brand: 'OttoMock',
      rootCategory: 1055398,
      categoryTree: [
        { catId: 1055398, name: 'Home & Kitchen' },
        { catId: 3741331, name: 'Storage & Organization' },
      ],
      imagesCSV: '71mockimage.jpg',
      stats: { current, avg30, avg90 },
      source: 'mock',
    },
  };
}

let _client: KeepaClient | null = null;
export function getKeepaClient(): KeepaClient {
  if (!_client) _client = new KeepaClient();
  return _client;
}
