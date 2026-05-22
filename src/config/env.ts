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
  },
  amazon: {
    proxy: str('AMAZON_BROWSER_PROXY'),
    headless: bool('AMAZON_BROWSER_HEADLESS', true),
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
  runtime: {
    mockMode: bool('OTTO_MOCK_MODE', false),
    realEbayDiscovery: bool('OTTO_REAL_EBAY_DISCOVERY', false),
    logLevel: str('OTTO_LOG_LEVEL', 'info'),
  },
  exportDir: str('OTTO_EXPORT_DIR', './exports'),
};

export type Env = typeof env;
