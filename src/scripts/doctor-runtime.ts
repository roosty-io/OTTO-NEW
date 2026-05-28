/* eslint-disable no-console */
/**
 * doctor-runtime.ts
 *
 * Runtime readiness doctor: can THIS environment actually run OTTO jobs?
 * Checks env vars, Supabase connectivity, eBay credentials (live token via
 * a tiny Browse call), and Amazon page access (same Playwright client as
 * validation).  Keepa is checked by KEY PRESENCE ONLY so we never burn
 * Keepa tokens.  Prints no secrets.
 *
 * Usage:
 *   npm run doctor:runtime
 *   npm run doctor:runtime -- --no-proxy
 *   npm run doctor:runtime -- --skip-amazon   # fast, env + connectivity only
 *
 * Output booleans:
 *   RUNTIME_READY_FOR_EBAY_QA
 *   RUNTIME_READY_FOR_KEEPA_DISCOVERY
 *   RUNTIME_READY_FOR_DASHBOARD
 */

import { logger } from '@/utils/logger';
import { env } from '@/config/env';
import { getSupabase } from '@/clients/supabaseClient';
import { getEbayClient } from '@/clients/ebayClient';
import { setAmazonBrowserOverrides } from '@/clients/amazonBrowserClient';
import { probeAmazonEnvironment, persistAmazonEnvCheck, type AmazonEnvStatus } from '@/pipeline/amazonEnvironment';

const log = logger.child('doctor-runtime');

function ok(b: boolean): string {
  return b ? 'OK' : 'FAIL';
}

async function checkSupabase(): Promise<{ present: boolean; connected: boolean }> {
  const present = Boolean(env.supabase.url && env.supabase.serviceRoleKey);
  if (!present) return { present, connected: false };
  try {
    const { error } = await getSupabase()
      .from('discovery_runs')
      .select('*', { count: 'exact', head: true });
    return { present, connected: !error };
  } catch {
    return { present, connected: false };
  }
}

async function checkEbay(): Promise<{ present: boolean; live: boolean }> {
  const present = Boolean((env.ebay.clientId && env.ebay.clientSecret) || env.ebay.oauthToken);
  if (!present) return { present, live: false };
  if (env.runtime.mockMode) return { present, live: true }; // mock client is always "live"
  try {
    // Tiny Browse call exercises the OAuth token + connectivity (no Keepa tokens).
    const res = await getEbayClient().search('storage organizer', { limit: 1 });
    return { present, live: !res.error };
  } catch {
    return { present, live: false };
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const skipAmazon = argv.includes('--skip-amazon');
  if (argv.includes('--no-proxy')) setAmazonBrowserOverrides({ disableProxy: true });
  if (argv.includes('--proxy')) setAmazonBrowserOverrides({ disableProxy: false });

  console.log('\n========== OTTO RUNTIME DOCTOR ==========');
  console.log('  Checks whether this environment can run OTTO jobs. No secrets printed.');
  console.log('  Keepa is checked by key presence only (no tokens consumed).\n');

  // --- env presence + runtime flags ---
  const ebayPresent = Boolean((env.ebay.clientId && env.ebay.clientSecret) || env.ebay.oauthToken);
  const keepaPresent = Boolean(env.keepa.apiKey);
  const supabaseUrlPresent = Boolean(env.supabase.url);
  const supabaseServicePresent = Boolean(env.supabase.serviceRoleKey);
  const supabaseAnonPresent = Boolean(env.supabase.anonKey);
  const mockMode = env.runtime.mockMode;

  console.log('  --- env presence ---');
  console.log(`    eBay credentials           : ${ok(ebayPresent)}`);
  console.log(`    KEEPA_API_KEY              : ${ok(keepaPresent)} (presence only)`);
  console.log(`    SUPABASE_URL               : ${ok(supabaseUrlPresent)}`);
  console.log(`    SUPABASE_SERVICE_ROLE_KEY  : ${ok(supabaseServicePresent)}`);
  console.log(`    SUPABASE_ANON_KEY          : ${ok(supabaseAnonPresent)}`);
  console.log(`    OTTO_MOCK_MODE             : ${mockMode} ${mockMode ? '(must be false for real jobs)' : ''}`);

  // --- live connectivity ---
  console.log('\n  --- connectivity ---');
  const supabase = await checkSupabase();
  console.log(`    Supabase connection        : ${ok(supabase.connected)}`);
  const ebay = await checkEbay();
  console.log(`    eBay API (live token+search): ${ok(ebay.live)}`);

  // --- amazon page access ---
  let amazonStatus: AmazonEnvStatus = 'AMAZON_ENV_UNUSABLE';
  if (skipAmazon) {
    console.log('\n  --- amazon ---\n    (skipped: --skip-amazon)');
  } else {
    console.log('\n  --- amazon page access (Playwright; no Keepa tokens) ---');
    const report = await probeAmazonEnvironment({ closeBrowser: true });
    amazonStatus = report.status;
    console.log(`    Amazon environment         : ${amazonStatus} (loaded ${report.loaded}/${report.total}, proxy ${report.proxy.enabled ? 'enabled' : 'disabled'})`);
    await persistAmazonEnvCheck(report, 'doctor:runtime');
  }
  const amazonUsable = amazonStatus === 'AMAZON_ENV_READY' || amazonStatus === 'AMAZON_ENV_PARTIAL';

  // --- readiness verdicts ---
  const dashboardReady = supabaseUrlPresent && supabaseAnonPresent && supabase.connected;
  const ebayQaReady = ebay.live && supabase.connected && !mockMode && (skipAmazon ? false : amazonUsable);
  const keepaReady = keepaPresent && ebay.live && supabase.connected && !mockMode && (skipAmazon ? false : amazonUsable);

  console.log('\n========== RUNTIME READINESS ==========');
  console.log(`  RUNTIME_READY_FOR_EBAY_QA          : ${ebayQaReady}`);
  console.log(`  RUNTIME_READY_FOR_KEEPA_DISCOVERY  : ${keepaReady}`);
  console.log(`  RUNTIME_READY_FOR_DASHBOARD        : ${dashboardReady}`);
  console.log('=======================================');

  if (!ebayQaReady || !keepaReady) {
    console.log('\n  Notes:');
    if (mockMode) console.log('   - OTTO_MOCK_MODE is true; set it to false for real jobs.');
    if (!supabase.connected) console.log('   - Supabase not reachable; check SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY and network.');
    if (!ebay.live) console.log('   - eBay API check failed; verify EBAY_CLIENT_ID / EBAY_CLIENT_SECRET and egress.');
    if (!skipAmazon && !amazonUsable) console.log(`   - Amazon page access is ${amazonStatus}. See AMAZON_ACCESS_RUNBOOK.md (configure a proxy or run where Amazon is reachable). Do NOT spend Keepa tokens until READY/PARTIAL.`);
    if (skipAmazon) console.log('   - Amazon was not verified (--skip-amazon); QA/Keepa readiness cannot be confirmed.');
    if (!keepaPresent) console.log('   - KEEPA_API_KEY not set (only needed for Keepa discovery).');
  }
  console.log('');

  // Exit 0 only when both job paths are ready (dashboard alone is not enough).
  process.exit(ebayQaReady && keepaReady ? 0 : 1);
}

main().catch((err) => {
  log.error('doctor:runtime failed', { err: (err as Error).message, stack: (err as Error).stack });
  process.exit(1);
});
