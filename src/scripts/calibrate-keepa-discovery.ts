/* eslint-disable no-console */
/**
 * calibrate-keepa-discovery.ts
 *
 * Runs the Keepa discovery profiles strict -> balanced -> broad in
 * sequence (each through the FULL validation chain) at a small safe
 * limit, then writes a side-by-side comparison report so we can choose
 * better default discovery settings.  Downstream validation gates are
 * unchanged; only Keepa input differs per profile.
 *
 * Usage:
 *   npm run calibrate:keepa-discovery -- --limit=25
 *   npm run calibrate:keepa-discovery -- --limit=10        # cheaper token cost
 *   npm run calibrate:keepa-discovery -- --profiles=strict,balanced
 *   npm run calibrate:keepa-discovery -- --allow-repeats   # apples-to-apples
 */

process.env.OTTO_REAL_EBAY_DISCOVERY = process.env.OTTO_REAL_EBAY_DISCOVERY ?? 'true';

import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { getSupabase } from '@/clients/supabaseClient';
import { logger } from '@/utils/logger';
import { env } from '@/config/env';
import { normalizeRepeatPolicy, isRepeatPolicy, type RepeatPolicy } from '@/agents/export/crossBatchFilter';
import { KEEPA_PROFILES, resolveProfile, type KeepaProfile, type KeepaProfileName } from '@/config/keepaProfiles';
import { executeKeepaDiscovery, type KeepaRunResult } from '@/pipeline/keepaDiscoveryRun';

const DEFAULT_LIMIT = 25;
const SAFE_LIMIT_MAX = 100;
const DEFAULT_PROFILES: KeepaProfileName[] = ['strict', 'balanced', 'broad'];
const log = logger.child('calibrate-keepa-discovery');

interface CalArgs {
  limit: number;
  profiles: KeepaProfile[];
  repeatPolicy: RepeatPolicy;
  repeatLookbackDays: number;
}

interface ProfileRun {
  profile: KeepaProfile;
  runId: string;
  result: KeepaRunResult;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  const problems = validateEnv();
  if (problems.length > 0) {
    for (const p of problems) log.error(p);
    console.log('\nCalibration aborted: missing required env.\n  ' + problems.join('\n  '));
    process.exit(2);
  }

  // Token cost guidance before doing real work.
  const estPerProfile = estimateTokens(args.limit);
  console.log('\nKeepa calibration plan');
  console.log('----------------------');
  console.log(`  profiles    : ${args.profiles.map((p) => p.name).join(', ')}`);
  console.log(`  limit/profile: ${args.limit}`);
  console.log(`  est. Keepa tokens/profile: ~${estPerProfile} (rough; 6 categories x Product Finder + /product)`);
  console.log(`  est. total tokens: ~${estPerProfile * args.profiles.length}`);
  console.log('');

  const supabase = getSupabase();
  const runs: ProfileRun[] = [];

  for (const profile of args.profiles) {
    const runId = uuidv4();
    try {
      await supabase.from('discovery_runs').insert({
        id: runId,
        status: 'running',
        seed_keywords: [],
        notes: `Keepa calibration (profile=${profile.name}, limit=${args.limit})`,
      });
    } catch (err) {
      log.warn('discovery_runs insert failed', { err: (err as Error).message });
    }

    console.log(`>>> Running profile: ${profile.name} (rankImpr>=${profile.minRankImprovementPercent}%, price $${profile.minAmazonPrice}-$${profile.maxAmazonPrice})`);
    const result = await executeKeepaDiscovery({
      runId,
      maxAsins: args.limit,
      minAmazonPrice: profile.minAmazonPrice,
      maxAmazonPrice: profile.maxAmazonPrice,
      minRankImprovementPercent: profile.minRankImprovementPercent,
      repeatPolicy: args.repeatPolicy,
      repeatLookbackDays: args.repeatLookbackDays,
      isSynthetic: env.runtime.mockMode,
      closeBrowser: false, // reuse the browser across profiles
    });

    try {
      await supabase.from('discovery_runs').update({
        status: 'completed',
        finished_at: new Date().toISOString(),
        stats: result.stats as unknown as Record<string, unknown>,
      }).eq('id', runId);
    } catch (err) {
      log.warn('discovery_runs update failed', { err: (err as Error).message });
    }

    runs.push({ profile, runId, result });
    printProfileLine(profile, result);
  }

  // Close the shared Amazon browser once at the end.
  try {
    const { getAmazonBrowserClient } = await import('@/clients/amazonBrowserClient');
    await getAmazonBrowserClient().close();
  } catch (err) {
    log.warn('amazon browser close failed', { err: (err as Error).message });
  }

  const reportPath = writeComparisonReport(timestamp, args, runs);
  console.log(`\nCalibration report written: ${reportPath}\n`);
}

function parseArgs(): CalArgs {
  const argv = process.argv.slice(2);
  let limit = DEFAULT_LIMIT;
  let profiles: KeepaProfile[] = DEFAULT_PROFILES.map((n) => KEEPA_PROFILES[n]);
  let repeatPolicy = normalizeRepeatPolicy(env.export.repeatPolicy);
  let repeatLookbackDays = env.export.repeatLookbackDays;
  for (const a of argv) {
    if (a.startsWith('--limit=')) {
      const n = Number(a.split('=')[1]);
      if (Number.isFinite(n) && n > 0) limit = Math.min(n, SAFE_LIMIT_MAX);
    } else if (a.startsWith('--profiles=')) {
      const names = a.substring('--profiles='.length).split(',').map((s) => s.trim()).filter(Boolean);
      const resolved = names.map((n) => resolveProfile(n)).filter((p): p is KeepaProfile => p !== null);
      if (resolved.length > 0) profiles = resolved;
    } else if (a === '--allow-repeats') {
      repeatPolicy = 'allow_repeats';
    } else if (a.startsWith('--repeat-policy=')) {
      const raw = a.substring('--repeat-policy='.length).trim();
      if (isRepeatPolicy(raw)) repeatPolicy = raw;
    } else if (a.startsWith('--repeat-lookback-days=')) {
      const n = Number(a.split('=')[1]);
      if (Number.isFinite(n) && n >= 0) repeatLookbackDays = Math.trunc(n);
    }
  }
  return { limit, profiles, repeatPolicy, repeatLookbackDays };
}

function validateEnv(): string[] {
  const problems: string[] = [];
  if (!env.runtime.mockMode) {
    if (!env.keepa.apiKey) problems.push('KEEPA_API_KEY is required for Keepa calibration (real mode).');
    if (!env.ebay.clientId || !env.ebay.clientSecret) {
      if (!env.ebay.oauthToken) problems.push('EBAY_CLIENT_ID + EBAY_CLIENT_SECRET (or EBAY_OAUTH_TOKEN) are required.');
    }
  }
  return problems;
}

// Rough estimate: ~6 categories, Product Finder query (~cheap) + /product
// with stats (~1-2 tokens/ASIN).  Upper-bounded by limit.
function estimateTokens(limit: number): number {
  const categories = 6;
  const queryCost = categories * 1;
  const productCost = Math.min(limit, categories * 50) * 1;
  return queryCost + productCost;
}

function printProfileLine(profile: KeepaProfile, r: KeepaRunResult): void {
  const s = r.stats;
  console.log(
    `    ${profile.name.padEnd(11)} raw=${s.rawKeepaCandidates} asinNative=${s.asinNativeCandidates} ` +
      `srcValid=${s.amazonSourceValid} demand=${s.demandPassed} compliance=${s.compliancePassed} ` +
      `bizfit=${s.businessFitPassed} final=${s.finalValidatedBeforeDedupe} exported=${s.exportedAfterAllFilters} ` +
      `tokens=${r.tokens.tokensConsumed ?? 'n/a'}${r.keepaError ? ` ERROR=${r.keepaError.code}` : ''}`,
  );
}

function reportsDir(): string {
  const dir = path.resolve(process.cwd(), 'reports');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeComparisonReport(timestamp: string, args: CalArgs, runs: ProfileRun[]): string {
  const file = path.join(reportsDir(), `otto-keepa-calibration-${timestamp}.md`);
  const lines: string[] = [];
  lines.push('# OTTO Keepa Discovery Calibration');
  lines.push('');
  lines.push(`- **Generated**: ${new Date().toISOString()}`);
  lines.push(`- **Limit/profile**: ${args.limit}`);
  lines.push(`- **Repeat policy**: \`${args.repeatPolicy}\` (lookback ${args.repeatLookbackDays}d)`);
  lines.push(`- **Keepa endpoint**: Product Finder (\`/query\`) + \`/product\` (stats=90)`);
  lines.push('');
  lines.push('## Profile comparison');
  lines.push('');
  lines.push('| Profile | rankImpr%% | price band | tokens | raw | ASIN-native | src valid | demand | compliance | biz fit | final (pre-dedupe) | exported | error |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const { profile, result } of runs) {
    const s = result.stats;
    lines.push(
      `| \`${profile.name}\` | ${profile.minRankImprovementPercent} | $${profile.minAmazonPrice}-$${profile.maxAmazonPrice} | ${result.tokens.tokensConsumed ?? 'n/a'} | ${s.rawKeepaCandidates} | ${s.asinNativeCandidates} | ${s.amazonSourceValid} | ${s.demandPassed} | ${s.compliancePassed} | ${s.businessFitPassed} | ${s.finalValidatedBeforeDedupe} | ${s.exportedAfterAllFilters} | ${result.keepaError?.code ?? '—'} |`,
    );
  }
  lines.push('');

  for (const { profile, runId, result } of runs) {
    const s = result.stats;
    lines.push(`## Profile: ${profile.name}`);
    lines.push('');
    lines.push(`- ${profile.description}`);
    lines.push(`- discovery_run_id: \`${runId}\`, export_batch_id: \`${result.exportBatchId || '(none)'}\``);
    lines.push(`- Keepa tokens consumed: ${result.tokens.tokensConsumed ?? 'n/a'}, tokens left: ${result.tokens.tokensLeft ?? 'n/a'}`);
    if (result.keepaError) lines.push(`- **Keepa error**: \`${result.keepaError.code}\` — ${result.keepaError.message}`);
    lines.push('');
    lines.push('Keepa filter losses:');
    const fr = Object.entries(result.filterReasons).sort((a, b) => b[1] - a[1]);
    if (fr.length === 0) lines.push('- _(none)_');
    else for (const [code, n] of fr) lines.push(`- \`${code}\`: ${n}`);
    lines.push('');
    lines.push('Validation rejection breakdown:');
    const rc = Object.entries(s.rejectionCounts).sort((a, b) => b[1] - a[1]);
    if (rc.length === 0) lines.push('- _(none)_');
    else for (const [code, n] of rc) lines.push(`- \`${code}\`: ${n}`);
    lines.push('');
    if (result.sourceFailureSamples.length > 0) {
      lines.push('Amazon source-validation failures (sample):');
      lines.push('');
      lines.push('| ASIN | reason | pageLoaded | price | buyable | stock | gate | restricted |');
      lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
      for (const f of result.sourceFailureSamples) {
        lines.push(`| \`${f.asin}\` | ${f.rejectionReason ?? 'n/a'} | ${f.pageLoaded} | ${f.hasSourcePrice} | ${f.buyable} | ${f.stockStatus} | ${f.shippingGateResult} | ${f.restrictedSignals.join(',') || '—'} |`);
      }
      lines.push('');
    }
    if (result.validated.length > 0) {
      lines.push('Top exported products:');
      lines.push('');
      lines.push('| ASIN | price | final | title |');
      lines.push('| --- | --- | --- | --- |');
      for (const p of [...result.validated].sort((a, b) => b.finalValidationScore - a.finalValidationScore).slice(0, 10)) {
        lines.push(`| \`${p.asin}\` | $${p.amazonPrice.toFixed(2)} | ${p.finalValidationScore.toFixed(0)} | ${(p.productTitle ?? '').slice(0, 60)} |`);
      }
      lines.push('');
    }
  }

  fs.writeFileSync(file, lines.join('\n'), 'utf8');
  return file;
}

main().catch((err) => {
  logger.error('calibrate-keepa-discovery failed', { err: (err as Error).message, stack: (err as Error).stack });
  process.exit(1);
});
