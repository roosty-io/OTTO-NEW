/* eslint-disable no-console */
/**
 * test-ebay-demand.ts
 *
 * Drives the upgraded EbayDemandScoringAgent against real Amazon product
 * snapshots and prints the demand evaluation.
 *
 * Usage:
 *   npm run test:ebay-demand
 *   npm run test:ebay-demand -- --from-db
 *   npm run test:ebay-demand -- --asin B0C6MC5N19 --title "Spice Rack Organizer" --price 29.99 --keyword "spice rack organizer"
 *
 * Requires EBAY_CLIENT_ID + EBAY_CLIENT_SECRET (or EBAY_OAUTH_TOKEN).
 */

process.env.OTTO_MOCK_MODE = 'false';
process.env.OTTO_REAL_EBAY_DISCOVERY = 'true';

import { v4 as uuidv4 } from 'uuid';
import { logger } from '@/utils/logger';
import { env } from '@/config/env';
import { EbayDemandScoringAgent } from '@/agents/ebay/EbayDemandScoringAgent';
import { getSupabase } from '@/clients/supabaseClient';

interface Sample {
  asin?: string;
  amazonUrl?: string;
  productTitle: string;
  amazonBrand?: string;
  amazonPrice?: number;
  amazonCategoryBreadcrumbs?: string[];
  coreKeyword: string;
}

const DEFAULT_SAMPLES: Sample[] = [
  {
    asin: 'B0C6MC5N19',
    productTitle:
      'AOZITA Spice Rack Organizer for Cabinet, Spice Organizer with 28 Empty Spice Jars with Black Lids',
    amazonBrand: 'AOZITA',
    amazonPrice: 29.99,
    amazonCategoryBreadcrumbs: ['Home & Kitchen', 'Storage & Organization'],
    coreKeyword: 'spice rack organizer for cabinet',
  },
  {
    asin: 'B095RQ1F3T',
    productTitle:
      'reliahom Adjustable Broom Holder Wall Mount, Mop Storage Tool Racks, Broom Hanger Tool Organizer',
    amazonBrand: 'reliahom',
    amazonPrice: 9.89,
    amazonCategoryBreadcrumbs: ['Home & Kitchen', 'Storage & Organization'],
    coreKeyword: 'broom holder wall mount',
  },
  {
    asin: 'B08PQ8Z5T5',
    productTitle:
      'Drawer Divider Adjustable DIY Storage Organizer Separator for Tidying Clutter',
    amazonPrice: 13.99,
    amazonCategoryBreadcrumbs: ['Home & Kitchen', 'Storage & Organization'],
    coreKeyword: 'drawer divider organizer',
  },
  {
    asin: 'B0DD47PMQQ',
    productTitle:
      'BALEINE Patio Furniture Covers, Outdoor Furniture Covers Waterproof, Heavy Duty Oxford',
    amazonBrand: 'BALEINE',
    amazonPrice: 28.45,
    amazonCategoryBreadcrumbs: ['Patio, Lawn & Garden'],
    coreKeyword: 'patio furniture cover',
  },
  {
    asin: 'B0DHNY9BG4',
    productTitle:
      'BTSKY 3-Layer Plastic Dividing Storage Box Craft Organizer with Adjustable Spacers',
    amazonBrand: 'BTSKY',
    amazonPrice: 20.99,
    amazonCategoryBreadcrumbs: ['Arts, Crafts & Sewing', 'Storage'],
    coreKeyword: 'craft storage box organizer',
  },
];

const log = logger.child('test-ebay-demand');

function parseArgs(): { fromDb: boolean; sample?: Sample } {
  const args = process.argv.slice(2);
  const fromDb = args.includes('--from-db');
  const get = (name: string) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : undefined;
  };
  const asin = get('asin');
  const title = get('title');
  const priceStr = get('price');
  const keyword = get('keyword');
  const brand = get('brand');
  const amazonUrl = get('url');
  if (asin || title) {
    return {
      fromDb: false,
      sample: {
        asin,
        amazonUrl,
        productTitle: title ?? '',
        amazonBrand: brand,
        amazonPrice: priceStr ? Number(priceStr) : undefined,
        coreKeyword: keyword ?? title ?? '',
      },
    };
  }
  return { fromDb };
}

async function loadFromDb(limit = 5): Promise<Sample[]> {
  const supabase = getSupabase();
  const query = supabase.from('amazon_source_checks').select(
    'asin, amazon_url, product_title, brand, source_price, source_valid',
  ) as unknown as {
    eq: (col: string, val: unknown) => {
      order: (col: string, opts: { ascending: boolean }) => {
        limit: (n: number) => Promise<{
          data: Record<string, unknown>[] | null;
          error: { message: string } | null;
        }>;
      };
    };
  };
  const { data, error } = await query.eq('source_valid', true).order('created_at', { ascending: false }).limit(limit);
  if (error) {
    log.warn('Could not load source-valid amazon_source_checks', { err: error.message });
    return [];
  }
  return (data ?? [])
    .filter((r) => r && r.product_title)
    .map((r) => ({
      asin: r.asin as string | undefined,
      amazonUrl: r.amazon_url as string | undefined,
      productTitle: (r.product_title as string) ?? '',
      amazonBrand: (r.brand as string | undefined) ?? undefined,
      amazonPrice: r.source_price ? Number(r.source_price) : undefined,
      coreKeyword: (r.product_title as string).split(' ').slice(0, 4).join(' '),
    }));
}

async function main(): Promise<void> {
  if (!env.ebay.clientId && !env.ebay.oauthToken) {
    log.error('Missing eBay credentials. Set EBAY_CLIENT_ID + EBAY_CLIENT_SECRET (or EBAY_OAUTH_TOKEN).');
    process.exit(2);
  }

  const args = parseArgs();
  let samples: Sample[];
  if (args.sample) {
    samples = [args.sample];
  } else if (args.fromDb) {
    samples = await loadFromDb();
    if (samples.length === 0) {
      log.warn('No source-valid Amazon products in DB; falling back to default samples.');
      samples = DEFAULT_SAMPLES;
    }
  } else {
    samples = DEFAULT_SAMPLES;
  }

  const agent = new EbayDemandScoringAgent();
  const summary: { asin?: string; passed: boolean; reason?: string }[] = [];

  for (const sample of samples) {
    const ottoProductId = `OTTO-TEST-${uuidv4()}`;
    const result = await agent.run({
      ottoProductId,
      asin: sample.asin,
      amazonUrl: sample.amazonUrl,
      productTitle: sample.productTitle,
      amazonBrand: sample.amazonBrand,
      amazonPrice: sample.amazonPrice,
      amazonCategoryBreadcrumbs: sample.amazonCategoryBreadcrumbs,
      keyword: sample.coreKeyword,
    });
    const d = result.data;
    console.log('\n--------------------------------------------------------');
    console.log(`ASIN                       : ${sample.asin ?? '(none)'}`);
    console.log(`title                      : ${sample.productTitle}`);
    console.log(`core keyword               : ${sample.coreKeyword}`);
    console.log(`generated eBay queries     :`);
    for (const q of d.generatedQueries) console.log(`  - ${q}`);
    console.log(`active listings found      : ${d.activeListingCount}`);
    console.log(`relevant comparables       : ${d.relevantComparableCount}`);
    console.log(`exact / similar matches    : ${d.exactOrSimilarMatchCount}`);
    console.log(`unique sellers             : ${d.sellerCount}`);
    console.log(`seller concentration       : ${d.sellerConcentrationScore.toFixed(0)}`);
    console.log(`median price               : ${d.medianComparablePrice?.toFixed(2) ?? '(none)'}`);
    console.log(`price band                 : ${formatPriceBand(d)}`);
    console.log(`price viability            : ${d.priceViabilityScore.toFixed(0)}`);
    console.log(`demand type                : ${d.demandType}`);
    console.log(`sell within 30 days conf   : ${d.sellWithin30DaysConfidence.toFixed(0)}`);
    console.log(`stagnation risk            : ${d.stagnationRiskScore.toFixed(0)}`);
    console.log(`demand score               : ${d.demandScore.toFixed(0)}`);
    console.log(`demand passed              : ${d.demandPassed}`);
    if (!d.demandPassed) {
      console.log(`rejection reason           : ${d.rejectionReason ?? '(none)'}`);
    }
    summary.push({ asin: sample.asin, passed: d.demandPassed, reason: d.rejectionReason });
  }

  console.log('\n========== TEST EBAY DEMAND SUMMARY ==========');
  const passes = summary.filter((s) => s.passed).length;
  console.log(`  ${passes}/${summary.length} samples passed demand`);
  for (const s of summary) {
    const id = s.asin ?? '(no-asin)';
    if (s.passed) console.log(`    PASS  ${id}`);
    else console.log(`    FAIL  ${id}   (${s.reason ?? 'unknown'})`);
  }
  console.log('===============================================\n');
}

function formatPriceBand(d: { priceBandMin?: number; priceBandMax?: number }): string {
  if (d.priceBandMin === undefined || d.priceBandMax === undefined) return '(none)';
  return `${d.priceBandMin.toFixed(2)} - ${d.priceBandMax.toFixed(2)}`;
}

main().catch((err) => {
  logger.error('test-ebay-demand failed', { err: (err as Error).message, stack: (err as Error).stack });
  process.exit(1);
});
