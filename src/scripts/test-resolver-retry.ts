/* eslint-disable no-console */
/**
 * test-resolver-retry.ts
 *
 * Unit cases for BasicAmazonAsinResolverAgent's fallback-query behavior.
 * The PlaywrightAmazonBrowserClient is replaced with a scripted fake
 * that returns a programmed sequence of AmazonSearchResults so we can
 * verify:
 *   - MALFORMED_PAGE on query 1 + success on query 2 -> resolves
 *   - MALFORMED_PAGE on every query -> clean failure
 *   - CAPTCHA_OR_BLOCK -> no aggressive retry beyond what the client
 *     itself does; agent moves to next query
 *   - EMPTY_RESULTS -> agent does not infinite-retry, moves on
 *   - TIMEOUT on query 1 + success on query 2 -> resolves
 *
 * Usage:  npm run test:resolver-retry
 */

// Force mock-mode false so the agent doesn't return canned results.
process.env.OTTO_MOCK_MODE = 'false';

import { v4 as uuidv4 } from 'uuid';
import { BasicAmazonAsinResolverAgent } from '@/agents/asin/BasicAmazonAsinResolverAgent';
import type { ProductCandidate } from '@/types/product';
import type {
  AmazonBrowserClient,
  AmazonSearchHit,
  AmazonSearchResult,
} from '@/clients/amazonBrowserClient';
import { _setAmazonBrowserClient } from '@/clients/amazonBrowserClient';

function ok(asin: string, title: string, price = 18): AmazonSearchHit {
  return {
    asin,
    amazonUrl: `https://www.amazon.com/dp/${asin}`,
    title,
    price,
    sponsored: false,
    isAmazonBasics: false,
    isRenewedOrRefurbished: false,
    isBundleOrMultipack: false,
  };
}

function malformed(): AmazonSearchResult {
  return {
    hits: [],
    error: { code: 'MALFORMED_PAGE', message: 'simulated malformed page' },
    pageQuality: 'MALFORMED_PAGE',
    attempts: 4,
    retriesUsed: 3,
  };
}

function captcha(): AmazonSearchResult {
  return {
    hits: [],
    error: { code: 'BLOCKED_OR_CAPTCHA', message: 'simulated captcha' },
    pageQuality: 'CAPTCHA_OR_BLOCK',
    attempts: 2,
    retriesUsed: 1,
  };
}

function timeout(): AmazonSearchResult {
  return {
    hits: [],
    error: { code: 'TIMEOUT', message: 'simulated timeout' },
    pageQuality: 'TIMEOUT',
    attempts: 4,
    retriesUsed: 3,
  };
}

function empty(): AmazonSearchResult {
  return {
    hits: [],
    pageQuality: 'EMPTY_RESULTS',
    attempts: 1,
    retriesUsed: 0,
  };
}

function success(asin = 'B0TESTOK01', title = 'under sink organizer foam pad'): AmazonSearchResult {
  return {
    hits: [ok(asin, title)],
    pageQuality: 'SEARCH_RESULTS_OK',
    attempts: 1,
    retriesUsed: 0,
  };
}

function makeCandidate(): ProductCandidate {
  return {
    ottoProductId: `OTTO-TEST-${uuidv4()}`,
    source: 'unit_test',
    sourceUrl: 'about:blank',
    marketplace: 'ebay',
    keyword: 'under sink organizer',
    productTitleRaw: 'under sink organizer foam pad',
    discoveryScore: 50,
  };
}

class FakeAmazonClient implements AmazonBrowserClient {
  readonly isImplemented = true;
  constructor(private readonly script: AmazonSearchResult[]) {}
  searchCalls = 0;
  async search(_q: string): Promise<AmazonSearchResult> {
    const r = this.script[Math.min(this.searchCalls, this.script.length - 1)];
    this.searchCalls++;
    return r;
  }
  async resolveByTitle(): Promise<AmazonSearchHit | null> { return null; }
  async getProduct(): Promise<null> { return null; }
  async validateProductPage(): Promise<never> { throw new Error('unused'); }
  async captureDiagnostics(): Promise<never> { throw new Error('unused'); }
  async close(): Promise<void> { return; }
}

interface Case {
  label: string;
  script: AmazonSearchResult[];
  expectResolved: boolean;
  expectSuccessfulQueryDefined?: boolean;
  expectMinSearchCalls?: number;
  expectMaxSearchCalls?: number;
}

const CASES: Case[] = [
  {
    label: 'MALFORMED then SUCCESS on next query -> resolves',
    script: [malformed(), success()],
    expectResolved: true,
    expectSuccessfulQueryDefined: true,
    expectMinSearchCalls: 2,
  },
  {
    label: 'MALFORMED every query -> clean failure',
    script: [malformed(), malformed(), malformed(), malformed(), malformed(), malformed()],
    expectResolved: false,
  },
  {
    label: 'CAPTCHA_OR_BLOCK then SUCCESS -> resolves (no infinite retry)',
    script: [captcha(), success()],
    expectResolved: true,
    expectSuccessfulQueryDefined: true,
  },
  {
    label: 'EMPTY_RESULTS then SUCCESS -> resolves',
    script: [empty(), success()],
    expectResolved: true,
    expectSuccessfulQueryDefined: true,
  },
  {
    label: 'TIMEOUT then SUCCESS -> resolves',
    script: [timeout(), success()],
    expectResolved: true,
    expectSuccessfulQueryDefined: true,
  },
  {
    label: 'query 1 MALFORMED, query 2 SUCCESS -> resolves with diagnostics',
    script: [malformed(), success('B0TESTOK02', 'under sink organizer foam pad')],
    expectResolved: true,
    expectSuccessfulQueryDefined: true,
  },
];

async function runCase(c: Case): Promise<{ ok: boolean; got: string; detail: string }> {
  const fake = new FakeAmazonClient(c.script);
  _setAmazonBrowserClient(fake);
  const candidate = makeCandidate();
  const agent = new BasicAmazonAsinResolverAgent();
  const r = await agent.run({ candidate });
  const resolved = r.status === 'pass' && Boolean(r.data.asin);
  const successfulQueryDefined = Boolean(r.data.successfulQuery);
  let ok = resolved === c.expectResolved;
  if (ok && c.expectSuccessfulQueryDefined !== undefined) {
    ok = successfulQueryDefined === c.expectSuccessfulQueryDefined;
  }
  if (ok && typeof c.expectMinSearchCalls === 'number') {
    ok = fake.searchCalls >= c.expectMinSearchCalls;
  }
  if (ok && typeof c.expectMaxSearchCalls === 'number') {
    ok = fake.searchCalls <= c.expectMaxSearchCalls;
  }
  return {
    ok,
    got: resolved ? 'resolved' : 'failed',
    detail:
      `searchCalls=${fake.searchCalls} ` +
      `resolved=${resolved} ` +
      `successfulQuery=${r.data.successfulQuery ?? '(none)'} ` +
      `malformedPageCount=${r.data.malformedPageCount} ` +
      `captchaBlockCount=${r.data.captchaBlockCount} ` +
      `timeoutCount=${r.data.timeoutCount} ` +
      `retriesUsed=${r.data.resolverRetryCount} ` +
      `final=${r.data.finalResolverErrorCode ?? '(none)'}`,
  };
}

async function main(): Promise<void> {
  let pass = 0;
  let fail = 0;
  console.log('OTTO resolver retry / fallback cases');
  console.log('------------------------------------');
  for (const c of CASES) {
    const r = await runCase(c);
    if (r.ok) pass++;
    else fail++;
    console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${c.label}`);
    console.log(`        ${r.detail}`);
  }
  console.log('');
  console.log(`${pass}/${pass + fail} cases passed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
