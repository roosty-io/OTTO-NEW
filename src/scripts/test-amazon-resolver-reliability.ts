/* eslint-disable no-console */
/**
 * test-amazon-resolver-reliability.ts
 *
 * Drives the real PlaywrightAmazonBrowserClient + BasicAmazonAsinResolverAgent
 * against a short list of representative product titles and prints
 * resolver reliability metrics per title.  No mock data.
 *
 * Usage:
 *   npm run test:amazon-resolver-reliability
 *   npm run test:amazon-resolver-reliability -- "custom title 1" "custom title 2"
 */

process.env.OTTO_MOCK_MODE = 'false';

import { v4 as uuidv4 } from 'uuid';
import { logger } from '@/utils/logger';
import { env } from '@/config/env';
import { BasicAmazonAsinResolverAgent } from '@/agents/asin/BasicAmazonAsinResolverAgent';
import { getAmazonBrowserClient } from '@/clients/amazonBrowserClient';
import type { ProductCandidate } from '@/types/product';

const DEFAULT_TITLES = [
  'under sink organizer',
  'craft storage box',
  'garage storage rack',
  'desk cable organizer',
  'garden kneeling pad',
  'bead organizer box',
  'parts organizer drawers',
  'cable management tray',
  'wooden artist storage box',
  'foam kneeling pad',
];

const log = logger.child('test-amazon-resolver-reliability');

async function main(): Promise<void> {
  const cli = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const titles = cli.length > 0 ? cli : DEFAULT_TITLES;
  const agent = new BasicAmazonAsinResolverAgent();
  const client = getAmazonBrowserClient();

  log.info('Resolver reliability test starting', {
    titles: titles.length,
    headless: env.amazon.headless,
    maxQueries: env.amazon.maxQueriesPerCandidate,
    maxResults: env.amazon.maxResultsPerQuery,
    malformedMaxRetries: env.amazon.malformedPageMaxRetries,
  });

  interface Row {
    title: string;
    resolved: boolean;
    asin?: string;
    queryAttempts: number;
    retriesUsed: number;
    malformed: number;
    captcha: number;
    timeoutPages: number;
    successfulQuery?: string;
    recoveredAfterRetry: boolean;
    finalError?: string;
  }
  const rows: Row[] = [];
  for (const title of titles) {
    const candidate: ProductCandidate = {
      ottoProductId: `OTTO-TEST-${uuidv4()}`,
      source: 'reliability_test',
      sourceUrl: 'about:blank',
      marketplace: 'ebay',
      keyword: title,
      productTitleRaw: title,
      discoveryScore: 50,
    };
    const result = await agent.run({ candidate });
    const d = result.data;
    const recovered = d.successfulQuery !== undefined && (d.malformedPageCount > 0 || d.timeoutCount > 0);
    rows.push({
      title,
      resolved: result.status === 'pass' && Boolean(d.asin),
      asin: d.asin,
      queryAttempts: d.amazonQueryAttemptsCount,
      retriesUsed: d.resolverRetryCount,
      malformed: d.malformedPageCount,
      captcha: d.captchaBlockCount,
      timeoutPages: d.timeoutCount,
      successfulQuery: d.successfulQuery,
      recoveredAfterRetry: recovered,
      finalError: d.finalResolverErrorCode,
    });
  }
  try { await client.close(); } catch (err) { log.warn('close failed', { err: (err as Error).message }); }

  console.log('\n========== AMAZON RESOLVER RELIABILITY ==========');
  let pass = 0;
  let totalQueryAttempts = 0;
  let totalMalformed = 0;
  let totalRecovered = 0;
  let totalRetries = 0;
  for (const r of rows) {
    if (r.resolved) pass++;
    totalQueryAttempts += r.queryAttempts;
    totalMalformed += r.malformed;
    if (r.recoveredAfterRetry) totalRecovered++;
    totalRetries += r.retriesUsed;
    console.log(`\n  ${r.resolved ? 'PASS' : 'FAIL'}  ${r.title}`);
    console.log(`    query attempts          : ${r.queryAttempts}`);
    console.log(`    retries used            : ${r.retriesUsed}`);
    console.log(`    malformed page count    : ${r.malformed}`);
    console.log(`    captcha / block count   : ${r.captcha}`);
    console.log(`    timeout count           : ${r.timeoutPages}`);
    console.log(`    successful query        : ${r.successfulQuery ?? '(none)'}`);
    console.log(`    recovered after retry   : ${r.recoveredAfterRetry}`);
    console.log(`    ASIN                    : ${r.asin ?? '(none)'}`);
    console.log(`    final error             : ${r.finalError ?? '(none)'}`);
  }
  console.log('');
  console.log(`  totals: ${pass}/${rows.length} resolved`);
  console.log(`  totals: ${totalQueryAttempts} query attempts, ${totalRetries} retries, ${totalMalformed} malformed pages, ${totalRecovered} recovered`);
  console.log('=================================================\n');
}

main().catch((e) => {
  logger.error('test-amazon-resolver-reliability failed', { err: (e as Error).message });
  process.exit(1);
});
