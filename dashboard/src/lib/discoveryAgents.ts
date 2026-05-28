// Static manifest of every planned OTTO discovery agent + its current
// implementation status.  The Discovery Agents page renders this directly;
// nothing here hits the database.
//
// Kept in sync with DISCOVERY_AGENT_STATUS.md / DISCOVERY_EXPANSION_PLAN.md.

export type ImplementedStatus = 'real' | 'partial' | 'placeholder';

export interface DiscoveryAgentInfo {
  name: string;
  implemented: ImplementedStatus;
  dataSource: string;
  requiresCredentials: string;
  testCommand: string | null;
  lastSuccessfulRun: string | null;
  /** 1/2/3 = recommended next build order; null = live or not prioritized. */
  priority: 1 | 2 | 3 | null;
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
    priority: null,
    notes: 'LIVE. The only real discovery source in run:real-qa. Limitation: eBay listings must resolve to an Amazon ASIN, and ~60% die at ASIN_NOT_RESOLVED.',
  },
  {
    name: 'Keepa Rank Movement',
    implemented: 'placeholder',
    dataSource: 'Keepa API',
    requiresCredentials: 'KEEPA_API_KEY',
    testCommand: null,
    lastSuccessfulRun: null,
    priority: 1,
    notes: 'NEXT BUILD. Client keepaClient.ts is partially real (live /product). ASIN-native: bypasses the ASIN_NOT_RESOLVED bottleneck. Needs a discovery endpoint + token budgeting + agent. Low risk (API).',
  },
  {
    name: 'Amazon Best Sellers',
    implemented: 'placeholder',
    dataSource: 'Amazon Best Sellers pages',
    requiresCredentials: 'Playwright browser (no Amazon login)',
    testCommand: null,
    lastSuccessfulRun: null,
    priority: 2,
    notes: 'Reuses the REAL Playwright client (amazonBrowserClient.ts). ASIN-native. Needs a best-sellers page scraper + agent.',
  },
  {
    name: 'Amazon Related Products',
    implemented: 'placeholder',
    dataSource: 'Amazon PDP related-product carousels',
    requiresCredentials: 'Playwright browser (no Amazon login)',
    testCommand: null,
    lastSuccessfulRun: null,
    priority: 2,
    notes: 'Reuses the REAL Playwright client. ASIN-native; expands from already-validated winners and can populate opportunity_relationships.',
  },
  {
    name: 'Zik Keyword Discovery',
    implemented: 'placeholder',
    dataSource: 'Zik Analytics (browser automation)',
    requiresCredentials: 'ZIK_USERNAME + ZIK_PASSWORD',
    testCommand: null,
    lastSuccessfulRun: null,
    priority: 3,
    notes: 'eBay-demand-aligned. Client zikBrowserClient.ts is a stub (no login). Highest build effort + brittleness; still feeds the lossy eBay->ASIN resolver.',
  },
  {
    name: 'Zik Product Discovery',
    implemented: 'placeholder',
    dataSource: 'Zik Analytics',
    requiresCredentials: 'ZIK_USERNAME + ZIK_PASSWORD',
    testCommand: null,
    lastSuccessfulRun: null,
    priority: null,
    notes: 'Same stub client (searchProducts); not wired into the pipeline.',
  },
  {
    name: 'Zik Competitor Discovery',
    implemented: 'placeholder',
    dataSource: 'Zik Analytics',
    requiresCredentials: 'ZIK_USERNAME + ZIK_PASSWORD',
    testCommand: null,
    lastSuccessfulRun: null,
    priority: null,
    notes: 'Future agent. No client method yet.',
  },
  {
    name: 'Zik Category Discovery',
    implemented: 'placeholder',
    dataSource: 'Zik Analytics (browser automation)',
    requiresCredentials: 'ZIK_USERNAME + ZIK_PASSWORD',
    testCommand: null,
    lastSuccessfulRun: null,
    priority: null,
    notes: 'Stub client getCategoryStats. Returns empty without Playwright login wiring.',
  },
  {
    name: 'Zik Sell-Through Discovery',
    implemented: 'placeholder',
    dataSource: 'Zik Analytics',
    requiresCredentials: 'ZIK_USERNAME + ZIK_PASSWORD',
    testCommand: null,
    lastSuccessfulRun: null,
    priority: null,
    notes: 'Future agent. Would enrich demand scoring with sold-through rates.',
  },
  {
    name: 'Zik Saturation Discovery',
    implemented: 'placeholder',
    dataSource: 'Zik Analytics',
    requiresCredentials: 'ZIK_USERNAME + ZIK_PASSWORD',
    testCommand: null,
    lastSuccessfulRun: null,
    priority: null,
    notes: 'Future agent. Would feed the V1.4 competition gate.',
  },
  {
    name: 'Keepa Price Stability',
    implemented: 'placeholder',
    dataSource: 'Keepa API',
    requiresCredentials: 'KEEPA_API_KEY',
    testCommand: null,
    lastSuccessfulRun: null,
    priority: null,
    notes: 'Partial client (keepaClient.ts). Enrichment more than discovery; would feed the BusinessFit price-quality scorer.',
  },
  {
    name: 'Amazon Movers',
    implemented: 'placeholder',
    dataSource: 'Amazon Movers & Shakers pages',
    requiresCredentials: 'Playwright browser (no Amazon login)',
    testCommand: null,
    lastSuccessfulRun: null,
    priority: null,
    notes: 'Reuses the real Playwright client. ASIN-native trend-momentum signal.',
  },
  {
    name: 'Walmart Trends',
    implemented: 'placeholder',
    dataSource: 'Walmart trending pages',
    requiresCredentials: 'Playwright browser',
    testCommand: null,
    lastSuccessfulRun: null,
    priority: null,
    notes: 'Future radar agent. No client yet; non-Amazon products still hit the ASIN resolver.',
  },
  {
    name: 'Home Depot Trends',
    implemented: 'placeholder',
    dataSource: 'HomeDepot.com',
    requiresCredentials: 'Playwright browser',
    testCommand: null,
    lastSuccessfulRun: null,
    priority: null,
    notes: 'Future radar agent. No client yet.',
  },
  {
    name: 'Wayfair Trends',
    implemented: 'placeholder',
    dataSource: 'Wayfair.com',
    requiresCredentials: 'Playwright browser',
    testCommand: null,
    lastSuccessfulRun: null,
    priority: null,
    notes: 'Future radar agent. No client yet.',
  },
  {
    name: 'TikTok Shop Trends',
    implemented: 'placeholder',
    dataSource: 'TikTok Shop',
    requiresCredentials: 'Playwright browser',
    testCommand: null,
    lastSuccessfulRun: null,
    priority: null,
    notes: 'Future radar agent. High build effort.',
  },
  {
    name: 'Google Trends',
    implemented: 'placeholder',
    dataSource: 'Google Trends',
    requiresCredentials: 'None',
    testCommand: null,
    lastSuccessfulRun: null,
    priority: null,
    notes: 'Future radar agent. Free signal but produces keywords (feeds keyword discovery), not ASINs.',
  },
];
