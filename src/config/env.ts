import dotenv from 'dotenv';

dotenv.config();

function str(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v && v.length > 0) return v;
  if (fallback !== undefined) return fallback;
  return '';
}

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (!v) return fallback;
  return v.toLowerCase() === 'true' || v === '1';
}

export const env = {
  supabase: {
    url: str('SUPABASE_URL'),
    serviceRoleKey: str('SUPABASE_SERVICE_ROLE_KEY'),
    anonKey: str('SUPABASE_ANON_KEY'),
  },
  ebay: {
    clientId: str('EBAY_CLIENT_ID'),
    clientSecret: str('EBAY_CLIENT_SECRET'),
    environment: str('EBAY_ENV', 'production'),
    oauthToken: str('EBAY_OAUTH_TOKEN'),
  },
  keepa: {
    apiKey: str('KEEPA_API_KEY'),
    // Discovery (Keepa Rank Movement) tuning.
    domain: num('KEEPA_DOMAIN', 1), // 1 = amazon.com
    discoveryMaxAsins: num('KEEPA_DISCOVERY_MAX_ASINS', 100),
    discoveryMinRankImprovementPercent: num('KEEPA_DISCOVERY_MIN_RANK_IMPROVEMENT_PERCENT', 20),
    discoveryMinAvgRank30d: num('KEEPA_DISCOVERY_MIN_AVG_RANK_30D', 0), // 0 = no floor
    // Ceiling on current sales rank so discovery doesn't fetch dead, high-rank
    // products (calibration found 11M-rank junk with no ceiling). 0 = no ceiling.
    discoveryMaxSalesRank: num('KEEPA_DISCOVERY_MAX_SALES_RANK', 150000),
    discoveryAllowedCategories: str('KEEPA_DISCOVERY_ALLOWED_CATEGORIES'), // blank = built-in V1 safe set
    discoveryExcludedCategories: str('KEEPA_DISCOVERY_EXCLUDED_CATEGORIES'),
    discoveryMinAmazonPrice: num('KEEPA_DISCOVERY_MIN_AMAZON_PRICE', 10),
    discoveryMaxAmazonPrice: num('KEEPA_DISCOVERY_MAX_AMAZON_PRICE', 150),
  },
  amazon: {
    // Legacy combined proxy URL (kept for back-compat with V1.0 env files).
    proxy: str('AMAZON_BROWSER_PROXY'),
    headless: bool('AMAZON_HEADLESS', bool('AMAZON_BROWSER_HEADLESS', true)),
    searchTimeoutMs: num('AMAZON_SEARCH_TIMEOUT_MS', 30000),
    maxResultsPerQuery: num('AMAZON_MAX_RESULTS_PER_QUERY', 10),
    maxQueriesPerCandidate: num('AMAZON_MAX_QUERIES_PER_CANDIDATE', 4),
    proxyServer: str('AMAZON_PROXY_SERVER'),
    proxyUsername: str('AMAZON_PROXY_USERNAME'),
    proxyPassword: str('AMAZON_PROXY_PASSWORD'),
    debug: bool('AMAZON_DEBUG', false),
    /** Dev/test escape hatch for environments behind a TLS-intercepting proxy. */
    ignoreHttpsErrors: bool('AMAZON_IGNORE_HTTPS_ERRORS', false),
    /** Resolver reliability tuning (V1.3). */
    malformedPageMaxRetries: num('AMAZON_MALFORMED_PAGE_MAX_RETRIES', 3),
    retryBaseDelayMs: num('AMAZON_RETRY_BASE_DELAY_MS', 1500),
    retryMaxDelayMs: num('AMAZON_RETRY_MAX_DELAY_MS', 12000),
    retryJitter: bool('AMAZON_RETRY_JITTER', true),
  },
  zik: {
    username: str('ZIK_USERNAME'),
    password: str('ZIK_PASSWORD'),
  },
  pipeline: {
    defaultZipCode: str('DEFAULT_ZIP_CODE', '84107'),
    defaultMaxDeliveryDays: num('DEFAULT_MAX_DELIVERY_DAYS', 10),
    defaultMarketplaceTarget: str('DEFAULT_MARKETPLACE_TARGET', 'EBAY_US'),
  },
  export: {
    // Cross-batch repeat policy: allow_repeats | exclude_recent | never_repeat
    repeatPolicy: str('EXPORT_REPEAT_POLICY', 'exclude_recent'),
    repeatLookbackDays: num('EXPORT_REPEAT_LOOKBACK_DAYS', 30),
  },
  runtime: {
    mockMode: bool('OTTO_MOCK_MODE', false),
    realEbayDiscovery: bool('OTTO_REAL_EBAY_DISCOVERY', false),
    logLevel: str('OTTO_LOG_LEVEL', 'info'),
  },
  exportDir: str('OTTO_EXPORT_DIR', './exports'),
};

export type Env = typeof env;
