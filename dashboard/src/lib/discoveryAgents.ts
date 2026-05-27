// Static manifest of every planned OTTO discovery agent + its current
// implementation status.  The Discovery Agents page renders this directly;
// nothing here hits the database.

export type ImplementedStatus = 'real' | 'partial' | 'placeholder';

export interface DiscoveryAgentInfo {
  name: string;
  implemented: ImplementedStatus;
  dataSource: string;
  requiresCredentials: string;
  testCommand: string | null;
  lastSuccessfulRun: string | null;
  notes: string;
}

export const DISCOVERY_AGENTS: DiscoveryAgentInfo[] = [
  {
    name: 'eBay Keyword Discovery',
    implemented: 'real',
    dataSource: 'eBay Browse API',
    requiresCredentials: 'EBAY_CLIENT_ID + EBAY_CLIENT_SECRET (or EBAY_OAUTH_TOKEN)',
    testCommand: 'npm run test:ebay-demand',
    lastSuccessfulRun: 'V1.4 confirmation batch (limit=25, 125 candidates)',
    notes: 'Primary discovery path. Active in every real QA batch.',
  },
  {
    name: 'Zik Category Discovery',
    implemented: 'placeholder',
    dataSource: 'Zik Analytics (browser automation)',
    requiresCredentials: 'ZIK_USERNAME + ZIK_PASSWORD',
    testCommand: null,
    lastSuccessfulRun: null,
    notes: 'Stub client in zikBrowserClient.ts. Returns empty without Playwright login wiring.',
  },
  {
    name: 'Zik Product Discovery',
    implemented: 'placeholder',
    dataSource: 'Zik Analytics',
    requiresCredentials: 'ZIK_USERNAME + ZIK_PASSWORD',
    testCommand: null,
    lastSuccessfulRun: null,
    notes: 'Same client; not wired into the pipeline yet.',
  },
  {
    name: 'Zik Competitor Discovery',
    implemented: 'placeholder',
    dataSource: 'Zik Analytics',
    requiresCredentials: 'ZIK_USERNAME + ZIK_PASSWORD',
    testCommand: null,
    lastSuccessfulRun: null,
    notes: 'Future agent.',
  },
  {
    name: 'Zik Keyword Discovery',
    implemented: 'placeholder',
    dataSource: 'Zik Analytics',
    requiresCredentials: 'ZIK_USERNAME + ZIK_PASSWORD',
    testCommand: null,
    lastSuccessfulRun: null,
    notes: 'Future agent.',
  },
  {
    name: 'Zik Sell-Through Discovery',
    implemented: 'placeholder',
    dataSource: 'Zik Analytics',
    requiresCredentials: 'ZIK_USERNAME + ZIK_PASSWORD',
    testCommand: null,
    lastSuccessfulRun: null,
    notes: 'Future agent. Would inform demand scoring with sold-thru rates.',
  },
  {
    name: 'Zik Saturation Discovery',
    implemented: 'placeholder',
    dataSource: 'Zik Analytics',
    requiresCredentials: 'ZIK_USERNAME + ZIK_PASSWORD',
    testCommand: null,
    lastSuccessfulRun: null,
    notes: 'Future agent. Would feed the V1.4 competition gate.',
  },
  {
    name: 'Keepa Rank Movement',
    implemented: 'placeholder',
    dataSource: 'Keepa API',
    requiresCredentials: 'KEEPA_API_KEY',
    testCommand: null,
    lastSuccessfulRun: null,
    notes: 'KeepaClient stub in keepaClient.ts. Token cost system not yet wired.',
  },
  {
    name: 'Keepa Price Stability',
    implemented: 'placeholder',
    dataSource: 'Keepa API',
    requiresCredentials: 'KEEPA_API_KEY',
    testCommand: null,
    lastSuccessfulRun: null,
    notes: 'Future agent. Would feed the BusinessFit price-quality scorer.',
  },
  {
    name: 'Amazon Best Sellers',
    implemented: 'placeholder',
    dataSource: 'Amazon Best Sellers pages',
    requiresCredentials: 'Playwright browser (no Amazon login)',
    testCommand: null,
    lastSuccessfulRun: null,
    notes: 'Future agent. Would seed the discovery layer with category leaders.',
  },
  {
    name: 'Amazon Movers',
    implemented: 'placeholder',
    dataSource: 'Amazon Movers & Shakers pages',
    requiresCredentials: 'Playwright browser',
    testCommand: null,
    lastSuccessfulRun: null,
    notes: 'Future agent. Time-of-day signal for trend momentum.',
  },
  {
    name: 'Amazon Related Products',
    implemented: 'placeholder',
    dataSource: 'Amazon PDP related-product carousels',
    requiresCredentials: 'Playwright browser',
    testCommand: null,
    lastSuccessfulRun: null,
    notes: 'Future agent. Would surface adjacent / complementary products.',
  },
  {
    name: 'Walmart Trends',
    implemented: 'placeholder',
    dataSource: 'Walmart trending pages',
    requiresCredentials: 'Playwright browser',
    testCommand: null,
    lastSuccessfulRun: null,
    notes: 'Future radar agent.',
  },
  {
    name: 'Home Depot Trends',
    implemented: 'placeholder',
    dataSource: 'HomeDepot.com',
    requiresCredentials: 'Playwright browser',
    testCommand: null,
    lastSuccessfulRun: null,
    notes: 'Future radar agent.',
  },
  {
    name: 'Wayfair Trends',
    implemented: 'placeholder',
    dataSource: 'Wayfair.com',
    requiresCredentials: 'Playwright browser',
    testCommand: null,
    lastSuccessfulRun: null,
    notes: 'Future radar agent.',
  },
  {
    name: 'TikTok Shop Trends',
    implemented: 'placeholder',
    dataSource: 'TikTok Shop',
    requiresCredentials: 'Playwright browser',
    testCommand: null,
    lastSuccessfulRun: null,
    notes: 'Future radar agent. High-priority once trend velocity is needed.',
  },
  {
    name: 'Google Trends',
    implemented: 'placeholder',
    dataSource: 'Google Trends',
    requiresCredentials: 'None',
    testCommand: null,
    lastSuccessfulRun: null,
    notes: 'Future radar agent. Free signal; should be easy to wire.',
  },
];
