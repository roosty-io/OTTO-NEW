/* eslint-disable no-console */
/**
 * test-asin-resolver.ts
 *
 * Drives the real BasicAmazonAsinResolverAgent against a fixed list of
 * product titles to verify Playwright integration end-to-end.
 *
 * Usage:
 *   npm run test:asin-resolver
 *   npm run test:asin-resolver -- "kw 1" "kw 2"
 *
 * If Playwright Chromium can't launch (browsers not installed, sandboxed
 * network, captcha), each title will print an AMAZON_SEARCH_UNAVAILABLE
 * rejection rather than crashing the script.
 */

// Make sure mock mode is off so we exercise the real Playwright client.
process.env.OTTO_MOCK_MODE = 'false';

import { v4 as uuidv4 } from 'uuid';
import { logger } from '@/utils/logger';
import { env } from '@/config/env';
import { BasicAmazonAsinResolverAgent } from '@/agents/asin/BasicAmazonAsinResolverAgent';
import { buildAmazonQueries } from '@/utils/amazonQueryBuilder';
import { getAmazonBrowserClient } from '@/clients/amazonBrowserClient';
import type { ProductCandidate } from '@/types/product';

const DEFAULT_TITLES = [
  'under sink organizer sliding drawer',
  'garage storage rack wall mounted',
  'desk cable organizer tray',
  'garden kneeling pad with handles',
  'craft storage box organizer',
  'broom holder wall mount',
  'spice rack organizer for cabinet',
  'pet toy storage basket',
  'drawer divider organizer',
  'patio furniture cover',
];

const log = logger.child('test-asin-resolver');

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const titles = args.length > 0 ? args : DEFAULT_TITLES;
  const agent = new BasicAmazonAsinResolverAgent();
  const client = getAmazonBrowserClient();

  log.info('Test ASIN resolver starting', {
    titles: titles.length,
    headless: env.amazon.headless,
    debug: env.amazon.debug,
    maxQueries: env.amazon.maxQueriesPerCandidate,
    maxResults: env.amazon.maxResultsPerQuery,
  });

  const summary: { title: string; status: 'PASS' | 'FAIL'; reason?: string }[] = [];

  for (const title of titles) {
    const candidate: ProductCandidate = {
      ottoProductId: `OTTO-TEST-${uuidv4()}`,
      source: 'cli_test',
      sourceUrl: 'about:blank',
      marketplace: 'ebay',
      keyword: title,
      productTitleRaw: title,
      discoveryScore: 50,
    };
    const queries = buildAmazonQueries(candidate, env.amazon.maxQueriesPerCandidate);
    const result = await agent.run({ candidate });

    console.log('\n--------------------------------------------------------');
    console.log(`input title           : ${title}`);
    console.log(`generated queries     :`);
    for (const q of queries) {
      console.log(`  - [${q.label}] ${q.query}`);
    }
    if (result.status === 'pass') {
      console.log(`status                : PASS`);
      console.log(`best ASIN             : ${result.data.asin}`);
      console.log(`Amazon URL            : ${result.data.amazonUrl}`);
      console.log(`product title         : ${result.data.title}`);
      console.log(`match type            : ${result.data.productMatchType}`);
      console.log(`match confidence      : ${result.data.finalProductMatchConfidence.toFixed(0)}`);
      console.log(`title similarity      : ${result.data.titleSimilarityScore?.toFixed(0)}`);
      console.log(`keyword overlap       : ${result.data.keywordOverlapScore?.toFixed(0)}`);
      console.log(`attempts persisted    : ${result.data.attempts}`);
      summary.push({ title, status: 'PASS' });
    } else {
      console.log(`status                : FAIL`);
      console.log(`rejection reason      : ${result.data.rejectionReason ?? 'unknown'}`);
      console.log(`attempts persisted    : ${result.data.attempts}`);
      summary.push({ title, status: 'FAIL', reason: result.data.rejectionReason ?? 'unknown' });
    }
  }

  try {
    await client.close();
  } catch (err) {
    log.warn('Browser close failed', { err: (err as Error).message });
  }

  console.log('\n========== TEST ASIN RESOLVER SUMMARY ==========');
  const passes = summary.filter((s) => s.status === 'PASS').length;
  console.log(`  ${passes}/${summary.length} titles produced an accepted ASIN`);
  for (const s of summary) {
    if (s.status === 'PASS') console.log(`    PASS  ${s.title}`);
    else console.log(`    FAIL  ${s.title}   (${s.reason})`);
  }
  console.log('================================================\n');
}

main().catch((err) => {
  logger.error('test-asin-resolver failed', { err: (err as Error).message, stack: (err as Error).stack });
  process.exit(1);
});
