/* eslint-disable no-console */
/**
 * seed-manual-qa-negative-examples.ts
 *
 * Inserts a small set of operator-rejected ASINs into
 * manual_qa_negative_examples as PATTERN REFERENCES.  These are not a
 * hard ASIN blacklist; the scoring agents never auto-reject on a row
 * here.  They exist so future analysis / tuning passes can spot
 * recurring patterns in the operator's reject decisions.
 *
 * Usage:  npm run seed:negative-examples
 */

import { getSupabase } from '@/clients/supabaseClient';
import { logger } from '@/utils/logger';

const log = logger.child('seed-manual-qa-negative-examples');

interface Entry {
  asin: string;
  product_title: string;
  brand?: string;
  reason: string;
  batch_label: string;
}

const ENTRIES: Entry[] = [
  {
    asin: 'B089B4XZM4',
    product_title: 'VIVO Under Desk 17 inch Cable Management Tray, Power Strip Holder',
    reason: 'too many sellers / too many similar listings',
    batch_label: 'post-business-fit limit=25 (2026-05-25)',
  },
  {
    asin: 'B0CMCS65GB',
    product_title: 'HOOPLE Extra Thick Kneeling Pad, Soft Foam Kneeling Cushion',
    brand: 'HOOPLE',
    reason: 'too many sellers / too many similar listings',
    batch_label: 'post-business-fit limit=25 (2026-05-25)',
  },
  {
    asin: 'B0BCJQ31XZ',
    product_title: 'BTSKY 3-Layer Plastic Dividing Storage Box Craft Organizer',
    brand: 'BTSKY',
    reason: 'too many sellers / too many similar listings',
    batch_label: 'post-business-fit limit=25 (2026-05-25)',
  },
];

async function main(): Promise<void> {
  const supabase = getSupabase();
  try {
    await supabase.from('manual_qa_negative_examples').insert(ENTRIES);
    log.info('Seeded manual_qa_negative_examples', { count: ENTRIES.length });
  } catch (err) {
    log.error('Insert failed', { err: (err as Error).message });
    process.exit(1);
  }
  for (const e of ENTRIES) console.log(`  ${e.asin}  ${e.reason}`);
  console.log(`\nInserted ${ENTRIES.length} pattern reference rows (not a hard blacklist).`);
}

main();
