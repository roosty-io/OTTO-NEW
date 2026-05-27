/* eslint-disable no-console */
/**
 * migrate-to-new-project.ts
 *
 * One-shot migration: copy every OTTO V1 table from the OLD shared
 * Supabase project to the NEW dedicated project.
 *
 * Reads OLD project credentials from OLD_SUPABASE_URL +
 * OLD_SUPABASE_SERVICE_ROLE_KEY, and NEW project credentials from the
 * standard SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (so the rest of the
 * codebase keeps working against the new project after .env is updated).
 *
 * Migrates in dependency order so foreign keys resolve.  Batches inserts
 * to keep payloads under PostgREST limits.  Idempotent on re-run via
 * upsert where a unique key exists, plain insert (ignoring duplicate
 * pkey errors per-batch) otherwise.
 *
 * Usage:
 *   npm run migrate:to-new-project
 */

import dotenv from 'dotenv';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

dotenv.config();

const OLD_URL = process.env.OLD_SUPABASE_URL ?? '';
const OLD_KEY = process.env.OLD_SUPABASE_SERVICE_ROLE_KEY ?? '';
const NEW_URL = process.env.SUPABASE_URL ?? '';
const NEW_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

function assertEnv(): void {
  const missing: string[] = [];
  if (!OLD_URL) missing.push('OLD_SUPABASE_URL');
  if (!OLD_KEY) missing.push('OLD_SUPABASE_SERVICE_ROLE_KEY');
  if (!NEW_URL) missing.push('SUPABASE_URL');
  if (!NEW_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (missing.length > 0) {
    console.error('Missing env vars:', missing.join(', '));
    process.exit(1);
  }
  if (OLD_URL === NEW_URL) {
    console.error('OLD_SUPABASE_URL and SUPABASE_URL must differ.');
    process.exit(1);
  }
}

// Dependency order: tables referenced by FKs first.
const TABLES: { name: string; conflictColumn?: string; pageSize?: number }[] = [
  { name: 'discovery_runs' },
  { name: 'raw_candidates' },
  { name: 'product_opportunities', conflictColumn: 'otto_product_id' },
  { name: 'opportunity_relationships' },
  { name: 'marketplace_signals' },
  { name: 'source_signals' },
  { name: 'asin_candidates', pageSize: 500 },
  { name: 'amazon_source_checks', pageSize: 200 },
  { name: 'ebay_demand_checks', pageSize: 200 },
  { name: 'compliance_checks', pageSize: 200 },
  { name: 'cost_calculations' },
  { name: 'final_validation_results' },
  { name: 'validated_products', conflictColumn: 'otto_product_id' },
  { name: 'rejected_products' },
  { name: 'export_batches' },
  { name: 'deduped_products' },
  { name: 'business_fit_checks' },
  { name: 'manual_qa_negative_examples' },
  { name: 'manual_qa_reviews' },
  { name: 'agent_logs', pageSize: 500 },
  { name: 'agent_votes', pageSize: 500 },
  { name: 'agent_messages' },
  { name: 'blacklist_brands', conflictColumn: 'brand' },
  { name: 'blacklist_keywords', conflictColumn: 'keyword' },
  { name: 'restricted_categories', conflictColumn: 'name' },
  { name: 'allowed_categories', conflictColumn: 'name' },
  { name: 'validation_thresholds', conflictColumn: 'key' },
  { name: 'product_feedback' },
  { name: 'source_quality_scores', conflictColumn: 'source' },
  { name: 'category_performance_scores', conflictColumn: 'category' },
  { name: 'weekly_model_adjustments' },
];

async function countRows(client: SupabaseClient, table: string): Promise<number> {
  const { count, error } = await client.from(table).select('*', { count: 'exact', head: true });
  if (error) {
    console.error(`  count(${table}) failed: ${error.message}`);
    return -1;
  }
  return count ?? 0;
}

async function migrateTable(
  oldClient: SupabaseClient,
  newClient: SupabaseClient,
  table: { name: string; conflictColumn?: string; pageSize?: number },
): Promise<{ total: number; migrated: number }> {
  const pageSize = table.pageSize ?? 1000;
  const total = await countRows(oldClient, table.name);
  if (total <= 0) {
    console.log(`  ${table.name.padEnd(30)} ${total === 0 ? 'empty' : 'count-error'} - skipping`);
    return { total: 0, migrated: 0 };
  }

  let migrated = 0;
  let from = 0;
  while (from < total) {
    const to = Math.min(from + pageSize - 1, total - 1);
    // Order by id (primary key, always unique) for stable pagination.
    const { data, error } = await oldClient
      .from(table.name)
      .select('*')
      .order('id', { ascending: true })
      .range(from, to);
    if (error) {
      console.error(`  ${table.name} fetch range ${from}-${to} failed: ${error.message}`);
      return { total, migrated };
    }
    if (!data || data.length === 0) break;
    const insertResult = await insertBatch(newClient, table, data);
    migrated += insertResult;
    from += data.length;
  }
  console.log(`  ${table.name.padEnd(30)} ${migrated}/${total} migrated`);
  return { total, migrated };
}

async function insertBatch(
  newClient: SupabaseClient,
  table: { name: string; conflictColumn?: string },
  rows: Record<string, unknown>[],
): Promise<number> {
  // Upsert on id (the primary key) so re-runs are idempotent and any
  // pagination overlap doesn't blow up on duplicate pkey.
  const { error } = await newClient
    .from(table.name)
    .upsert(rows, { onConflict: 'id', ignoreDuplicates: false });
  if (error) {
    console.error(`  ${table.name} upsert (${rows.length} rows) failed: ${error.message}`);
    return 0;
  }
  return rows.length;
}

async function main(): Promise<void> {
  assertEnv();
  const oldClient = createClient(OLD_URL, OLD_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const newClient = createClient(NEW_URL, NEW_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log('OTTO V1 cross-project migration');
  console.log('-------------------------------');
  console.log(`  source: ${OLD_URL}`);
  console.log(`  target: ${NEW_URL}`);
  console.log('');

  const summary: { table: string; old: number; new: number; migrated: number }[] = [];
  for (const t of TABLES) {
    const { total, migrated } = await migrateTable(oldClient, newClient, t);
    const newCount = await countRows(newClient, t.name);
    summary.push({ table: t.name, old: total, new: newCount, migrated });
  }

  console.log('');
  console.log('Final verification (old vs new row counts):');
  console.log('  table                          old   new   migrated');
  let mismatches = 0;
  for (const s of summary) {
    const mark = s.old === s.new ? 'OK' : 'DIFF';
    if (s.old !== s.new) mismatches++;
    console.log(`  ${s.table.padEnd(30)} ${String(s.old).padStart(5)} ${String(s.new).padStart(5)} ${String(s.migrated).padStart(8)}   ${mark}`);
  }
  console.log('');
  if (mismatches === 0) {
    console.log(`All ${summary.length} tables migrated cleanly.`);
    process.exit(0);
  } else {
    console.log(`${mismatches} table(s) have row-count mismatches between old and new.`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
