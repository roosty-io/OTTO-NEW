import { env } from '@/config/env';
import { logger } from '@/utils/logger';

/**
 * Placeholder client for Zik Analytics browser automation.
 *
 * Zik does not expose a public API, so this will eventually use Playwright
 * to log in and scrape the category / product / competitor / keyword screens.
 *
 * For V1 this exists so future agents (Zik Category, Sell-Through, Saturation,
 * etc.) can be slotted in without changing the call sites.
 *
 * TODO(real-browser):
 *   - Launch Playwright Chromium with persistent storage state for Zik login
 *   - Implement: searchProducts, getCategoryStats, getKeywordStats
 *   - Cache results to source_signals
 */

export interface ZikProductRow {
  title: string;
  averageSellPrice?: number;
  successfulListings?: number;
  totalListings?: number;
  sellThroughRate?: number;
  saturation?: number;
}

export interface ZikKeywordStats {
  keyword: string;
  searches?: number;
  competition?: number;
  averagePrice?: number;
}

export interface ZikCategoryStats {
  category: string;
  velocityScore?: number;
  saturationScore?: number;
}

export interface ZikBrowserClient {
  searchProducts(keyword: string): Promise<ZikProductRow[]>;
  getKeywordStats(keyword: string): Promise<ZikKeywordStats | null>;
  getCategoryStats(category: string): Promise<ZikCategoryStats | null>;
  close(): Promise<void>;
}

class PlaceholderZikBrowserClient implements ZikBrowserClient {
  private readonly log = logger.child('zikBrowserClient');

  async searchProducts(keyword: string): Promise<ZikProductRow[]> {
    if (env.runtime.mockMode) {
      return [
        { title: `${keyword} - mock zik row`, averageSellPrice: 25, successfulListings: 18, totalListings: 50, sellThroughRate: 36, saturation: 40 },
      ];
    }
    this.log.warn('Zik browser client not implemented; returning empty.', { keyword });
    return [];
  }

  async getKeywordStats(keyword: string): Promise<ZikKeywordStats | null> {
    if (env.runtime.mockMode) {
      return { keyword, searches: 1200, competition: 45, averagePrice: 25 };
    }
    return null;
  }

  async getCategoryStats(category: string): Promise<ZikCategoryStats | null> {
    if (env.runtime.mockMode) {
      return { category, velocityScore: 70, saturationScore: 40 };
    }
    return null;
  }

  async close(): Promise<void> {
    return;
  }
}

let _client: ZikBrowserClient | null = null;
export function getZikBrowserClient(): ZikBrowserClient {
  if (!_client) _client = new PlaceholderZikBrowserClient();
  return _client;
}
