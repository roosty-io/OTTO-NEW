/* eslint-disable no-console */
/**
 * test-amazon-source.ts
 *
 * Drives the real AmazonSourceValidationAgent against a list of ASINs.
 *
 * Usage:
 *   npm run test:amazon-source                              # default list
 *   npm run test:amazon-source -- B0DHNY9BG4 B0C6MC5N19     # specific ASINs
 *   npm run test:amazon-source -- --from-db                 # pull from accepted asin_candidates
 *
 * Browser failures degrade to clear rejection reasons; the script never
 * fabricates a "source valid" result.
 */

process.env.OTTO_MOCK_MODE = 'false';

import { v4 as uuidv4 } from 'uuid';
import { logger } from '@/utils/logger';
import { AmazonSourceValidationAgent } from '@/agents/amazon/AmazonSourceValidationAgent';
import { getAmazonBrowserClient } from '@/clients/amazonBrowserClient';
import { getSupabase } from '@/clients/supabaseClient';
import { amazonUrlFromAsin } from '@/utils/normalize';

// ASINs confirmed by `npm run test:asin-resolver` in earlier runs.  Real
// Amazon product data, so the test exercises the full extraction path.
const DEFAULT_ASINS = [
  'B0DHNY9BG4', // craft storage box organizer
  'B0C6MC5N19', // spice rack organizer for cabinet
  'B095RQ1F3T', // broom holder wall mount
  'B08PQ8Z5T5', // drawer divider organizer
  'B0DD47PMQQ', // patio furniture cover
];

const log = logger.child('test-amazon-source');

interface AsinInput {
  asin: string;
  amazonUrl: string;
}

async function loadFromDb(limit = 5): Promise<AsinInput[]> {
  const supabase = getSupabase();
  // The minimal client query shape we need; the helper isn't on our typed
  // wrapper so we cast through unknown to call .order/.limit.
  const query = supabase.from('asin_candidates').select('asin, amazon_url, accepted') as unknown as {
    eq: (col: string, val: unknown) => {
      order: (col: string, opts: { ascending: boolean }) => {
        limit: (n: number) => Promise<{ data: { asin: string; amazon_url: string }[] | null; error: { message: string } | null }>;
      };
    };
  };
  const { data, error } = await query.eq('accepted', true).order('created_at', { ascending: false }).limit(limit);
  if (error) {
    log.warn('Could not load accepted asin_candidates', { err: error.message });
    return [];
  }
  return (data ?? [])
    .filter((r) => r && r.asin)
    .map((r) => ({ asin: r.asin, amazonUrl: r.amazon_url || amazonUrlFromAsin(r.asin) }));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const fromDb = args.includes('--from-db');
  const cliAsins = args.filter((a) => !a.startsWith('--')).map((a) => a.trim()).filter(Boolean);

  let inputs: AsinInput[];
  if (cliAsins.length > 0) {
    inputs = cliAsins.map((a) => ({ asin: a, amazonUrl: amazonUrlFromAsin(a) }));
  } else if (fromDb) {
    inputs = await loadFromDb();
    if (inputs.length === 0) {
      log.warn('No accepted ASIN candidates in DB; falling back to default list.');
      inputs = DEFAULT_ASINS.map((a) => ({ asin: a, amazonUrl: amazonUrlFromAsin(a) }));
    }
  } else {
    inputs = DEFAULT_ASINS.map((a) => ({ asin: a, amazonUrl: amazonUrlFromAsin(a) }));
  }

  const agent = new AmazonSourceValidationAgent();
  const client = getAmazonBrowserClient();
  const summary: { asin: string; sourceValid: boolean; reason?: string }[] = [];

  for (const inp of inputs) {
    const ottoProductId = `OTTO-TEST-${uuidv4()}`;
    const result = await agent.run({ ottoProductId, asin: inp.asin, amazonUrl: inp.amazonUrl });
    const d = result.data;
    console.log('\n--------------------------------------------------------');
    console.log(`ASIN                   : ${inp.asin}`);
    console.log(`title                  : ${d.productTitle ?? '(unknown)'}`);
    console.log(`price                  : ${d.price !== undefined ? `${d.priceCurrency ?? ''} ${d.price}`.trim() : '(missing)'}`);
    console.log(`stock status           : ${d.stockStatus}`);
    console.log(`buyable                : ${d.buyable}`);
    console.log(`delivery text          : ${d.deliveryText ?? '(none)'}`);
    console.log(`estimated delivery days: ${d.estimatedDeliveryDays ?? '(unknown)'}`);
    console.log(`delivery confidence    : ${d.deliveryParseConfidence ?? 'none'}`);
    console.log(`restricted signals     : ${d.restrictedSignals.length === 0 ? '(none)' : d.restrictedSignals.join(', ')}`);
    console.log(`Amazon Basics          : ${d.isAmazonBasics}`);
    console.log(`used/renewed/refurb    : ${d.isRenewedOrRefurbished}`);
    console.log(`bundle / multipack     : ${d.isBundleOrMultipack}`);
    console.log(`prime signal detected  : ${d.primeSignalDetected} ${d.primeSignalSource ? '(' + d.primeSignalSource + ')' : ''}`);
    console.log(`fba signal detected    : ${d.fbaSignalDetected}`);
    console.log(`ships from amazon      : ${d.shipsFromAmazon}`);
    console.log(`sold by amazon         : ${d.soldByAmazon}`);
    console.log(`shipping gate result   : ${d.shippingGateResult}  (${d.shippingConfidence})`);
    console.log(`shipping review req    : ${d.shippingReviewRequired}`);
    console.log(`source validity score  : ${d.sourceValidityScore.toFixed(0)}`);
    console.log(`source valid           : ${d.sourceValid}`);
    if (!d.sourceValid) {
      console.log(`rejection reason       : ${d.rejectionReason ?? '(unspecified)'}`);
      if (d.reasons.length > 1) {
        console.log(`additional reasons     :`);
        for (const r of d.reasons.slice(1)) console.log(`  - ${r}`);
      }
    }
    summary.push({ asin: inp.asin, sourceValid: d.sourceValid, reason: d.rejectionReason });
  }

  try {
    await client.close();
  } catch (err) {
    log.warn('Browser close failed', { err: (err as Error).message });
  }

  console.log('\n========== TEST AMAZON SOURCE SUMMARY ==========');
  const passes = summary.filter((s) => s.sourceValid).length;
  console.log(`  ${passes}/${summary.length} ASINs source-valid`);
  for (const s of summary) {
    if (s.sourceValid) console.log(`    PASS  ${s.asin}`);
    else console.log(`    FAIL  ${s.asin}   (${s.reason ?? 'unknown'})`);
  }
  console.log('================================================\n');
}

main().catch((err) => {
  logger.error('test-amazon-source failed', { err: (err as Error).message, stack: (err as Error).stack });
  process.exit(1);
});
