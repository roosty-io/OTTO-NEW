/* eslint-disable no-console */
/**
 * calibrate-keepa-discovery.ts
 *
 * Runs a small matrix of Keepa discovery PROFILES x STRATEGIES (each cell
 * through the FULL validation chain) at a safe limit, then writes a
 * side-by-side comparison report and a recommended profile/strategy. Downstream
 * validation gates are unchanged; only Keepa input differs per cell.
 *
 * Profiles supported:   strict, balanced, broad, exploratory
 * Strategy cells:       rank_drops_30d, rank_drops_90d, current_rank_only,
 *                       category_movers, price_band_movers,
 *                       review_quality_movers, all
 *
 * Defaults are intentionally SMALL/safe. Widen explicitly when you want a
 * fuller sweep (mind the Keepa token cost — guarded by --max-keepa-tokens):
 *   npm run calibrate:keepa-discovery -- --limit=10
 *   npm run calibrate:keepa-discovery -- --profiles=strict,balanced,broad,exploratory --strategies=rank_drops_30d,current_rank_only,category_movers,price_band_movers,all
 *   npm run calibrate:keepa-discovery -- --allow-repeats   # apples-to-apples
 *   npm run calibrate:keepa-discovery -- --max-keepa-tokens=2000 --force
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
import { preflightAmazon, proxyDiagnostics, type AmazonEnvReport } from '@/pipeline/amazonEnvironment';
import { resolveCategoryTargets } from '@/utils/keepaCategories';
import {
  KEEPA_STRATEGY_NAMES,
  isKeepaStrategyName,
  estimateKeepaTokens,
  tokenGuardDecision,
  type KeepaStrategyName,
} from '@/config/keepaStrategies';

const DEFAULT_LIMIT = 25;
const SAFE_LIMIT_MAX = 100;
// Small/safe defaults; widen with --profiles / --strategies.
const DEFAULT_PROFILES: KeepaProfileName[] = ['balanced', 'broad'];
const DEFAULT_STRATEGY_CELLS = ['rank_drops_30d', 'current_rank_only', 'all'];
const log = logger.child('calibrate-keepa-discovery');

/** A calibration cell's strategy axis: a single strategy, or 'all'. */
interface StrategyCell {
  label: string;
  strategies: KeepaStrategyName[];
}

interface CalArgs {
  limit: number;
  profiles: KeepaProfile[];
  strategyCells: StrategyCell[];
  maxKeepaTokens: number;
  repeatPolicy: RepeatPolicy;
  repeatLookbackDays: number;
  preflightAmazon: boolean;
  force: boolean;
}

interface CellRun {
  profile: KeepaProfile;
  cell: StrategyCell;
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

  // Amazon preflight (consumes no Keepa tokens) BEFORE any token spend.
  let preflight: AmazonEnvReport | undefined;
  if (args.preflightAmazon) {
    console.log('\nRunning Amazon environment preflight (no Keepa tokens consumed)...');
    const decision = await preflightAmazon(args.force);
    preflight = decision.report;
    console.log(`  Amazon environment: ${preflight.status} (loaded ${preflight.loaded}/${preflight.total}, proxy ${preflight.proxy.enabled ? 'enabled' : 'disabled'})`);
    if (!decision.proceed) {
      console.log(`\nStopping before consuming Keepa tokens: Amazon environment is ${preflight.status}.`);
      console.log('No Keepa tokens were consumed. Re-run with --force to override, or configure AMAZON_PROXY_SERVER.');
      await closeBrowserQuietly();
      const reportPath = writePreflightOnlyReport(timestamp, args, preflight);
      console.log(`Calibration report written: ${reportPath}\n`);
      process.exit(1);
    }
    if (preflight.status === 'AMAZON_ENV_PARTIAL') {
      console.log('  WARNING: Amazon environment is PARTIAL; expect higher source-validation failures.');
    } else if (preflight.status === 'AMAZON_ENV_BLOCKED' || preflight.status === 'AMAZON_ENV_UNUSABLE') {
      console.log(`  WARNING: proceeding despite ${preflight.status} because --force was provided.`);
    }
  }

  // Token plan + guard (consumes no Keepa tokens).
  const categoryCount = resolveCategoryTargets(undefined, env.keepa.discoveryAllowedCategories).length;
  const cells: { profile: KeepaProfile; cell: StrategyCell }[] = [];
  for (const profile of args.profiles) for (const cell of args.strategyCells) cells.push({ profile, cell });
  const totalEstimate = cells.reduce(
    (sum, c) => sum + estimateKeepaTokens({ strategies: c.cell.strategies, categoryCount, maxAsins: args.limit }),
    0,
  );

  console.log('\nKeepa calibration plan');
  console.log('----------------------');
  console.log(`  profiles      : ${args.profiles.map((p) => p.name).join(', ')}`);
  console.log(`  strategy cells: ${args.strategyCells.map((c) => c.label).join(', ')}`);
  console.log(`  limit/cell    : ${args.limit}`);
  console.log(`  matrix size   : ${cells.length} runs`);
  console.log(`  est. total Keepa tokens: ~${totalEstimate} (rough; enforced against actual usage)`);
  console.log(`  max Keepa tokens       : ${args.maxKeepaTokens > 0 ? args.maxKeepaTokens : 'no guard'}`);
  if (tokenGuardDecision(totalEstimate, args.maxKeepaTokens, args.force) === 'block') {
    console.log(`\nStopping before consuming Keepa tokens: estimate (~${totalEstimate}) exceeds --max-keepa-tokens=${args.maxKeepaTokens}.`);
    console.log('No Keepa tokens were consumed. Re-run with --force, raise --max-keepa-tokens, or narrow --profiles/--strategies/--limit.');
    await closeBrowserQuietly();
    process.exit(1);
  }
  console.log('');

  const supabase = getSupabase();
  const runs: CellRun[] = [];

  for (const { profile, cell } of cells) {
    const runId = uuidv4();
    try {
      await supabase.from('discovery_runs').insert({
        id: runId,
        status: 'running',
        seed_keywords: [],
        notes: `Keepa calibration (profile=${profile.name}, strategy=${cell.label}, limit=${args.limit})`,
      });
    } catch (err) {
      log.warn('discovery_runs insert failed', { err: (err as Error).message });
    }

    console.log(`>>> profile=${profile.name} strategy=${cell.label} (rankImpr>=${profile.minRankImprovementPercent}%, price $${profile.minAmazonPrice}-$${profile.maxAmazonPrice})`);
    const result = await executeKeepaDiscovery({
      runId,
      maxAsins: args.limit,
      minAmazonPrice: profile.minAmazonPrice,
      maxAmazonPrice: profile.maxAmazonPrice,
      minRankImprovementPercent: profile.minRankImprovementPercent,
      strategies: cell.strategies,
      maxKeepaTokens: args.maxKeepaTokens,
      force: args.force,
      repeatPolicy: args.repeatPolicy,
      repeatLookbackDays: args.repeatLookbackDays,
      isSynthetic: env.runtime.mockMode,
      closeBrowser: false, // reuse the browser across cells
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

    runs.push({ profile, cell, runId, result });
    printCellLine(profile, cell, result);
  }

  // Close the shared Amazon browser once at the end.
  await closeBrowserQuietly();

  const reportPath = writeComparisonReport(timestamp, args, runs, preflight);
  const rec = recommend(runs);
  if (rec) {
    console.log(`\nRecommended: profile=${rec.profile.name} strategy=${rec.cell.label} (exported ${rec.result.stats.exportedAfterAllFilters}, unique ASIN candidates ${rec.result.uniqueAsinCandidates}, tokens ${rec.result.tokens.tokensConsumed ?? 'n/a'})`);
  }
  console.log(`\nCalibration report written: ${reportPath}\n`);
}

async function closeBrowserQuietly(): Promise<void> {
  try {
    const { getAmazonBrowserClient } = await import('@/clients/amazonBrowserClient');
    await getAmazonBrowserClient().close();
  } catch (err) {
    log.warn('amazon browser close failed', { err: (err as Error).message });
  }
}

function parseArgs(): CalArgs {
  const argv = process.argv.slice(2);
  let limit = DEFAULT_LIMIT;
  let profiles: KeepaProfile[] = DEFAULT_PROFILES.map((n) => KEEPA_PROFILES[n]);
  let strategyCells = DEFAULT_STRATEGY_CELLS.map(toStrategyCell).filter((c): c is StrategyCell => c !== null);
  let maxKeepaTokens = env.keepa.discoveryMaxTokensPerRun;
  let repeatPolicy = normalizeRepeatPolicy(env.export.repeatPolicy);
  let repeatLookbackDays = env.export.repeatLookbackDays;
  let preflightAmazonFlag = false;
  let force = false;
  for (const a of argv) {
    if (a.startsWith('--limit=')) {
      const n = Number(a.split('=')[1]);
      if (Number.isFinite(n) && n > 0) limit = Math.min(n, SAFE_LIMIT_MAX);
    } else if (a.startsWith('--profiles=')) {
      const names = a.substring('--profiles='.length).split(',').map((s) => s.trim()).filter(Boolean);
      const resolved = names.map((n) => resolveProfile(n)).filter((p): p is KeepaProfile => p !== null);
      if (resolved.length > 0) profiles = resolved;
    } else if (a.startsWith('--strategies=')) {
      const tokens = a.substring('--strategies='.length).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
      const resolved = tokens.map(toStrategyCell).filter((c): c is StrategyCell => c !== null);
      if (resolved.length > 0) strategyCells = resolved;
    } else if (a.startsWith('--max-keepa-tokens=')) {
      const n = Number(a.split('=')[1]);
      if (Number.isFinite(n) && n >= 0) maxKeepaTokens = Math.trunc(n);
    } else if (a === '--allow-repeats') {
      repeatPolicy = 'allow_repeats';
    } else if (a.startsWith('--repeat-policy=')) {
      const raw = a.substring('--repeat-policy='.length).trim();
      if (isRepeatPolicy(raw)) repeatPolicy = raw;
    } else if (a.startsWith('--repeat-lookback-days=')) {
      const n = Number(a.split('=')[1]);
      if (Number.isFinite(n) && n >= 0) repeatLookbackDays = Math.trunc(n);
    } else if (a === '--preflight-amazon') {
      preflightAmazonFlag = true;
    } else if (a === '--force') {
      force = true;
    }
  }
  return { limit, profiles, strategyCells, maxKeepaTokens, repeatPolicy, repeatLookbackDays, preflightAmazon: preflightAmazonFlag, force };
}

/** Resolve a strategy-cell token: 'all' => every strategy; a known name => single. */
function toStrategyCell(token: string): StrategyCell | null {
  const t = token.trim().toLowerCase();
  if (t === 'all') return { label: 'all', strategies: [...KEEPA_STRATEGY_NAMES] };
  if (isKeepaStrategyName(t)) return { label: t, strategies: [t] };
  return null;
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

/** Best cell: most exported, tie-break by unique candidates, then fewest tokens. */
function recommend(runs: CellRun[]): CellRun | null {
  if (runs.length === 0) return null;
  return [...runs].sort((a, b) => {
    const ax = a.result.stats.exportedAfterAllFilters;
    const bx = b.result.stats.exportedAfterAllFilters;
    if (bx !== ax) return bx - ax;
    const au = a.result.uniqueAsinCandidates;
    const bu = b.result.uniqueAsinCandidates;
    if (bu !== au) return bu - au;
    return (a.result.tokens.tokensConsumed ?? Infinity) - (b.result.tokens.tokensConsumed ?? Infinity);
  })[0];
}

function printCellLine(profile: KeepaProfile, cell: StrategyCell, r: KeepaRunResult): void {
  const s = r.stats;
  console.log(
    `    ${`${profile.name}/${cell.label}`.padEnd(28)} raw=${s.rawKeepaCandidates} unique=${r.uniqueAsinCandidates} ` +
      `srcValid=${s.amazonSourceValid} demand=${s.demandPassed} compliance=${s.compliancePassed} ` +
      `bizfit=${s.businessFitPassed} final=${s.finalValidatedBeforeDedupe} exported=${s.exportedAfterAllFilters} ` +
      `dupes=${r.duplicateAsinsAcrossStrategies} tokens=${r.tokens.tokensConsumed ?? 'n/a'}${r.keepaError ? ` ERROR=${r.keepaError.code}` : ''}`,
  );
}

function reportsDir(): string {
  const dir = path.resolve(process.cwd(), 'reports');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeComparisonReport(timestamp: string, args: CalArgs, runs: CellRun[], preflight?: AmazonEnvReport): string {
  const file = path.join(reportsDir(), `otto-keepa-calibration-${timestamp}.md`);
  const proxy = proxyDiagnostics();
  const lines: string[] = [];
  lines.push('# OTTO Keepa Discovery Calibration');
  lines.push('');
  lines.push(`- **Generated**: ${new Date().toISOString()}`);
  lines.push(`- **Limit/cell**: ${args.limit}`);
  lines.push(`- **Profiles**: ${args.profiles.map((p) => p.name).join(', ')}`);
  lines.push(`- **Strategy cells**: ${args.strategyCells.map((c) => c.label).join(', ')}`);
  lines.push(`- **Repeat policy**: \`${args.repeatPolicy}\` (lookback ${args.repeatLookbackDays}d)`);
  lines.push(`- **Max Keepa tokens**: ${args.maxKeepaTokens > 0 ? args.maxKeepaTokens : 'no guard'}`);
  lines.push(`- **Keepa endpoint**: Product Finder (\`/query\`) + \`/product\` (stats=90)`);
  lines.push('');
  lines.push('## Amazon environment');
  lines.push('');
  lines.push(`- amazon_environment_status: \`${preflight ? preflight.status : 'not checked'}\``);
  lines.push(`- proxy_enabled: ${proxy.enabled}${proxy.enabled && proxy.serverMasked ? ` (${proxy.serverMasked})` : ''}`);
  lines.push(`- preflight_performed: ${preflight ? true : false}`);
  lines.push(`- preflight_result: ${preflight ? preflight.status : 'n/a'}`);
  lines.push('');

  const rec = recommend(runs);
  if (rec) {
    lines.push('## Recommendation');
    lines.push('');
    lines.push(`- **profile=\`${rec.profile.name}\` strategy=\`${rec.cell.label}\`** — exported ${rec.result.stats.exportedAfterAllFilters}, unique ASIN candidates ${rec.result.uniqueAsinCandidates}, tokens ${rec.result.tokens.tokensConsumed ?? 'n/a'}`);
    lines.push('- Chosen by: most exported, then most unique ASIN candidates, then fewest tokens.');
    lines.push('');
  }

  lines.push('## Profile x Strategy comparison');
  lines.push('');
  lines.push('| Profile | Strategy | rankImpr% | price band | tokens | raw | unique ASIN | src valid | demand | compliance | biz fit | final | exported | dup ASINs | error |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const { profile, cell, result } of runs) {
    const s = result.stats;
    lines.push(
      `| \`${profile.name}\` | \`${cell.label}\` | ${profile.minRankImprovementPercent} | $${profile.minAmazonPrice}-$${profile.maxAmazonPrice} | ${result.tokens.tokensConsumed ?? 'n/a'} | ${s.rawKeepaCandidates} | ${result.uniqueAsinCandidates} | ${s.amazonSourceValid} | ${s.demandPassed} | ${s.compliancePassed} | ${s.businessFitPassed} | ${s.finalValidatedBeforeDedupe} | ${s.exportedAfterAllFilters} | ${result.duplicateAsinsAcrossStrategies} | ${result.keepaError?.code ?? '—'} |`,
    );
  }
  lines.push('');

  for (const { profile, cell, runId, result } of runs) {
    const s = result.stats;
    lines.push(`## ${profile.name} / ${cell.label}`);
    lines.push('');
    lines.push(`- ${profile.description}`);
    lines.push(`- strategies run: ${result.strategiesRun.join(', ')}`);
    lines.push(`- discovery_run_id: \`${runId}\`, export_batch_id: \`${result.exportBatchId || '(none)'}\``);
    lines.push(`- Keepa tokens consumed: ${result.tokens.tokensConsumed ?? 'n/a'}, tokens left: ${result.tokens.tokensLeft ?? 'n/a'}${result.tokenBudgetStopped ? ' (STOPPED EARLY: budget reached)' : ''}`);
    if (result.keepaError) lines.push(`- **Keepa error**: \`${result.keepaError.code}\` — ${result.keepaError.message}`);
    lines.push('');
    if (result.perStrategy.length > 0) {
      lines.push('Strategy diagnostics:');
      lines.push('');
      lines.push('| Strategy | returned | unique | accepted | rejected |');
      lines.push('| --- | --- | --- | --- | --- |');
      for (const st of result.perStrategy) {
        lines.push(`| \`${st.strategy}\` | ${st.rawProductsReturned} | ${st.uniqueAsinsContributed} | ${st.accepted} | ${st.rejected} |`);
      }
      lines.push('');
    }
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
    if (result.validated.length > 0) {
      lines.push('Top exported products:');
      lines.push('');
      lines.push('| ASIN | price | final | strategy | title |');
      lines.push('| --- | --- | --- | --- | --- |');
      for (const p of [...result.validated].sort((a, b) => b.finalValidationScore - a.finalValidationScore).slice(0, 10)) {
        const prov = result.strategyByAsin[p.asin];
        const strat = prov ? prov.primaryStrategy : 'n/a';
        lines.push(`| \`${p.asin}\` | $${p.amazonPrice.toFixed(2)} | ${p.finalValidationScore.toFixed(0)} | ${strat} | ${(p.productTitle ?? '').slice(0, 60)} |`);
      }
      lines.push('');
    }
  }

  fs.writeFileSync(file, lines.join('\n'), 'utf8');
  return file;
}

function writePreflightOnlyReport(timestamp: string, args: CalArgs, preflight: AmazonEnvReport): string {
  const file = path.join(reportsDir(), `otto-keepa-calibration-${timestamp}.md`);
  const proxy = proxyDiagnostics();
  const lines: string[] = [];
  lines.push('# OTTO Keepa Discovery Calibration (preflight stop)');
  lines.push('');
  lines.push(`- **Generated**: ${new Date().toISOString()}`);
  lines.push(`- **Limit/cell**: ${args.limit}`);
  lines.push('');
  lines.push('## Amazon environment');
  lines.push('');
  lines.push(`- amazon_environment_status: \`${preflight.status}\``);
  lines.push(`- proxy_enabled: ${proxy.enabled}${proxy.enabled && proxy.serverMasked ? ` (${proxy.serverMasked})` : ''}`);
  lines.push(`- preflight_performed: true`);
  lines.push(`- preflight_result: ${preflight.status}`);
  lines.push('');
  lines.push('**Stopped before any cell ran — no Keepa tokens were consumed.** Re-run with `--force` to override.');
  lines.push('');
  lines.push('| ASIN | loaded | blocked | error | title | price |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const p of preflight.probes) {
    lines.push(`| \`${p.asin}\` | ${p.pageLoaded} | ${p.blockedOrCaptcha} | ${p.validationErrorCode ?? '-'} | ${p.titleCaptured} | ${p.priceCaptured} |`);
  }
  lines.push('');
  fs.writeFileSync(file, lines.join('\n'), 'utf8');
  return file;
}

main().catch((err) => {
  logger.error('calibrate-keepa-discovery failed', { err: (err as Error).message, stack: (err as Error).stack });
  process.exit(1);
});
