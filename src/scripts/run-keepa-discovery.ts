/* eslint-disable no-console */
/**
 * run-keepa-discovery.ts
 *
 * ASIN-native discovery batch via Keepa rank movement, routed through the
 * SAME validation chain as run:real-qa.  Supports calibration profiles
 * (strict / balanced / broad / exploratory) and explicit overrides.
 *
 * Usage:
 *   npm run run:keepa-discovery -- --profile=balanced --limit=25
 *   npm run run:keepa-discovery -- --profile=broad --limit=25
 *   npm run run:keepa-discovery -- --min-rank-improvement=8 --min-price=12 --max-price=120
 *   npm run run:keepa-discovery -- --category="Home & Kitchen" --allow-repeats
 *   npm run run:keepa-discovery -- --repeat-policy=never_repeat
 *
 * Required env (real mode): KEEPA_API_KEY, eBay creds (demand scoring),
 * Playwright Chromium (Amazon source validation).
 */

process.env.OTTO_REAL_EBAY_DISCOVERY = process.env.OTTO_REAL_EBAY_DISCOVERY ?? 'true';

import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { getSupabase } from '@/clients/supabaseClient';
import { logger } from '@/utils/logger';
import { env } from '@/config/env';
import { isRepeatPolicy, normalizeRepeatPolicy, type RepeatPolicy } from '@/agents/export/crossBatchFilter';
import { resolveProfile, mergeKeepaOptions, type KeepaProfile } from '@/config/keepaProfiles';
import { executeKeepaDiscovery, type KeepaRunResult } from '@/pipeline/keepaDiscoveryRun';
import { preflightAmazon, proxyDiagnostics, type AmazonEnvReport } from '@/pipeline/amazonEnvironment';
import { resolveCategoryTargets } from '@/utils/keepaCategories';
import {
  parseStrategySelector,
  estimateKeepaTokens,
  tokenGuardDecision,
  type KeepaStrategyName,
} from '@/config/keepaStrategies';

const DEFAULT_LIMIT = 25;
const SAFE_LIMIT_MAX = 200;
const log = logger.child('run-keepa-discovery');

interface KeepaArgs {
  limit: number;
  profile: KeepaProfile | null;
  category?: string;
  minPrice?: number;
  maxPrice?: number;
  minRankImprovement?: number;
  strategies: KeepaStrategyName[];
  strategySelector: string;
  maxKeepaTokens: number;
  repeatPolicy: RepeatPolicy;
  repeatLookbackDays: number;
  preflightAmazon: boolean;
  force: boolean;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const reportTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const profileLabel = args.profile ? args.profile.name : 'custom/env';
  const strategyLabel = args.strategies.length === 6 ? 'all' : args.strategies.join(',');
  const commandRun = `npm run run:keepa-discovery -- --profile=${profileLabel} --strategy=${strategyLabel} --limit=${args.limit}`;

  const envProblems = validateEnv();
  if (envProblems.length > 0) {
    for (const p of envProblems) log.error(p);
    console.log('\nKeepa discovery aborted: missing required env.');
    console.log('  ' + envProblems.join('\n  '));
    process.exit(2);
  }

  const resolved = mergeKeepaOptions(
    args.profile,
    {
      minRankImprovementPercent: args.minRankImprovement,
      minAmazonPrice: args.minPrice,
      maxAmazonPrice: args.maxPrice,
      categorySelector: args.category,
      maxAsins: args.limit,
    },
    {
      minRankImprovementPercent: env.keepa.discoveryMinRankImprovementPercent,
      minAmazonPrice: env.keepa.discoveryMinAmazonPrice,
      maxAmazonPrice: env.keepa.discoveryMaxAmazonPrice,
      maxAsins: env.keepa.discoveryMaxAsins,
    },
  );

  // Token guard (consumes no Keepa tokens): estimate before any spend and
  // stop an over-budget run unless --force was passed.
  const categoryCount = resolveCategoryTargets(resolved.categorySelector, env.keepa.discoveryAllowedCategories).length;
  const estimatedTokens = estimateKeepaTokens({
    strategies: args.strategies,
    categoryCount,
    maxAsins: resolved.maxAsins,
  });
  console.log('\nKeepa token guard');
  console.log('-----------------');
  console.log(`  strategies            : ${strategyLabel} (${args.strategies.length})`);
  console.log(`  categories targeted   : ${categoryCount}`);
  console.log(`  estimated Keepa tokens: ~${estimatedTokens} (rough; enforced against actual usage)`);
  console.log(`  max Keepa tokens/run  : ${args.maxKeepaTokens > 0 ? args.maxKeepaTokens : 'no guard'}`);
  if (tokenGuardDecision(estimatedTokens, args.maxKeepaTokens, args.force) === 'block') {
    console.log(`\nStopping before consuming Keepa tokens: estimate (~${estimatedTokens}) exceeds --max-keepa-tokens=${args.maxKeepaTokens}.`);
    console.log('No Keepa tokens were consumed. Re-run with --force to override, raise --max-keepa-tokens, or narrow --strategy/--limit.');
    process.exit(1);
  }

  // Amazon preflight (consumes no Keepa tokens).
  let preflight: AmazonEnvReport | undefined;
  if (args.preflightAmazon) {
    console.log('\nRunning Amazon environment preflight (no Keepa tokens consumed)...');
    const decision = await preflightAmazon(args.force);
    preflight = decision.report;
    console.log(`  Amazon environment: ${preflight.status} (loaded ${preflight.loaded}/${preflight.total}, proxy ${preflight.proxy.enabled ? 'enabled' : 'disabled'})`);
    if (!decision.proceed) {
      console.log(`\nStopping before consuming Keepa tokens: Amazon environment is ${preflight.status}.`);
      console.log('No Keepa tokens were consumed. Re-run with --force to override, or configure AMAZON_PROXY_SERVER.');
      const reportPath = writePreflightOnlyReport(reportTimestamp, commandRun, profileLabel, preflight);
      console.log(`  Report written: ${reportPath}\n`);
      process.exit(1);
    }
    if (preflight.status === 'AMAZON_ENV_PARTIAL') {
      console.log('  WARNING: Amazon environment is PARTIAL; expect higher source-validation failures.');
    }
    if (preflight.status === 'AMAZON_ENV_BLOCKED' || preflight.status === 'AMAZON_ENV_UNUSABLE') {
      console.log(`  WARNING: proceeding despite ${preflight.status} because --force was provided.`);
    }
  }

  const supabase = getSupabase();
  const runId = uuidv4();
  try {
    await supabase.from('discovery_runs').insert({
      id: runId,
      status: 'running',
      seed_keywords: [],
      notes: `Keepa discovery (profile=${profileLabel}, strategy=${strategyLabel}, limit=${args.limit})`,
    });
  } catch (err) {
    log.warn('discovery_runs insert failed', { err: (err as Error).message });
  }

  const result = await executeKeepaDiscovery({
    runId,
    maxAsins: resolved.maxAsins,
    categorySelector: resolved.categorySelector,
    minAmazonPrice: resolved.minAmazonPrice,
    maxAmazonPrice: resolved.maxAmazonPrice,
    minRankImprovementPercent: resolved.minRankImprovementPercent,
    strategies: args.strategies,
    maxKeepaTokens: args.maxKeepaTokens,
    force: args.force,
    repeatPolicy: args.repeatPolicy,
    repeatLookbackDays: args.repeatLookbackDays,
    isSynthetic: env.runtime.mockMode,
    closeBrowser: true,
  });

  await finishRun(supabase, runId, result);
  printSummary(profileLabel, resolved, runId, result, preflight);
  const reportPath = writeReport(reportTimestamp, commandRun, profileLabel, strategyLabel, estimatedTokens, args.maxKeepaTokens, resolved, runId, result, preflight);
  console.log(`  Keepa discovery report written: ${reportPath}\n`);

  if (result.validated.length === 0 && result.keepaError) {
    console.log(`No Keepa candidates produced. Keepa reported: ${result.keepaError.code} - ${result.keepaError.message}`);
    console.log('No fake candidates were generated.');
    process.exit(1);
  }
}

function parseArgs(): KeepaArgs {
  const argv = process.argv.slice(2);
  let limit = DEFAULT_LIMIT;
  let profile: KeepaProfile | null = null;
  let category: string | undefined;
  let minPrice: number | undefined;
  let maxPrice: number | undefined;
  let minRankImprovement: number | undefined;
  let strategySelector = 'all';
  let maxKeepaTokens = env.keepa.discoveryMaxTokensPerRun;
  let repeatPolicy = normalizeRepeatPolicy(env.export.repeatPolicy);
  let repeatLookbackDays = env.export.repeatLookbackDays;
  let preflightAmazonFlag = false;
  let force = false;
  for (const a of argv) {
    if (a.startsWith('--limit=')) {
      const n = Number(a.split('=')[1]);
      if (Number.isFinite(n) && n > 0) limit = Math.min(n, SAFE_LIMIT_MAX);
    } else if (a.startsWith('--profile=')) {
      const p = resolveProfile(a.split('=')[1]);
      if (p) profile = p;
      else log.warn(`Unknown --profile=${a.split('=')[1]}; using custom/env defaults.`);
    } else if (a.startsWith('--category=')) {
      category = a.substring('--category='.length).trim().replace(/^"|"$/g, '');
    } else if (a.startsWith('--min-price=')) {
      const n = Number(a.split('=')[1]);
      if (Number.isFinite(n) && n >= 0) minPrice = n;
    } else if (a.startsWith('--max-price=')) {
      const n = Number(a.split('=')[1]);
      if (Number.isFinite(n) && n > 0) maxPrice = n;
    } else if (a.startsWith('--min-rank-improvement=')) {
      const n = Number(a.split('=')[1]);
      if (Number.isFinite(n) && n >= 0) minRankImprovement = n;
    } else if (a.startsWith('--strategy=')) {
      strategySelector = a.substring('--strategy='.length).trim();
    } else if (a.startsWith('--max-keepa-tokens=')) {
      const n = Number(a.split('=')[1]);
      if (Number.isFinite(n) && n >= 0) maxKeepaTokens = Math.trunc(n);
    } else if (a === '--allow-repeats') {
      repeatPolicy = 'allow_repeats';
    } else if (a.startsWith('--repeat-policy=')) {
      const raw = a.substring('--repeat-policy='.length).trim();
      if (isRepeatPolicy(raw)) repeatPolicy = raw;
      else log.warn(`Ignoring unknown --repeat-policy=${raw}; using ${repeatPolicy}`);
    } else if (a.startsWith('--repeat-lookback-days=')) {
      const n = Number(a.split('=')[1]);
      if (Number.isFinite(n) && n >= 0) repeatLookbackDays = Math.trunc(n);
    } else if (a === '--preflight-amazon') {
      preflightAmazonFlag = true;
    } else if (a === '--force') {
      force = true;
    }
  }
  const strategies = parseStrategySelector(strategySelector);
  return { limit, profile, category, minPrice, maxPrice, minRankImprovement, strategies, strategySelector, maxKeepaTokens, repeatPolicy, repeatLookbackDays, preflightAmazon: preflightAmazonFlag, force };
}

function validateEnv(): string[] {
  const problems: string[] = [];
  if (!env.runtime.mockMode) {
    if (!env.keepa.apiKey) problems.push('KEEPA_API_KEY is required for Keepa discovery (real mode).');
    if (!env.ebay.clientId || !env.ebay.clientSecret) {
      if (!env.ebay.oauthToken) {
        problems.push('EBAY_CLIENT_ID + EBAY_CLIENT_SECRET (or EBAY_OAUTH_TOKEN) are required for demand scoring.');
      }
    }
  }
  return problems;
}

async function finishRun(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  runId: string,
  result: KeepaRunResult,
): Promise<void> {
  try {
    await supabase.from('discovery_runs').update({
      status: 'completed',
      finished_at: new Date().toISOString(),
      stats: result.stats as unknown as Record<string, unknown>,
    }).eq('id', runId);
  } catch (err) {
    log.warn('discovery_runs update failed', { err: (err as Error).message });
  }
}

function printSummary(
  profileLabel: string,
  resolved: ReturnType<typeof mergeKeepaOptions>,
  runId: string,
  r: KeepaRunResult,
  preflight?: AmazonEnvReport,
): void {
  const s = r.stats;
  console.log('\n========== OTTO KEEPA DISCOVERY SUMMARY ==========');
  console.log(`  profile               : ${profileLabel} (rankImpr>=${resolved.minRankImprovementPercent}%, price $${resolved.minAmazonPrice}-$${resolved.maxAmazonPrice})`);
  console.log(`  discovery_run_id      : ${runId}`);
  console.log(`  export_batch_id       : ${r.exportBatchId || '(none)'}`);
  console.log('  ----- discovery -----');
  console.log(`  strategies run        : ${r.strategiesRun.join(', ')}`);
  console.log(`  raw Keepa products    : ${s.rawKeepaCandidates}`);
  console.log(`  unique ASIN candidates: ${r.uniqueAsinCandidates}`);
  console.log(`  ASIN-native candidates: ${s.asinNativeCandidates}`);
  console.log(`  duplicate ASINs across strategies: ${r.duplicateAsinsAcrossStrategies}`);
  if (r.tokenBudgetStopped) console.log('  NOTE: token budget reached; discovery stopped early (partial run).');
  console.log('  ----- per strategy (returned / unique / accepted / rejected) -----');
  for (const st of r.perStrategy) {
    console.log(`    ${st.strategy.padEnd(22)} returned=${st.rawProductsReturned} unique=${st.uniqueAsinsContributed} accepted=${st.accepted} rejected=${st.rejected}`);
  }
  console.log('  ----- keepa filter losses -----');
  for (const [code, n] of Object.entries(r.filterReasons).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${code.padEnd(34)} ${n}`);
  }
  console.log('  ----- validation -----');
  console.log(`  asin resolved/bypassed: ${s.asinResolved}`);
  console.log(`  amazon source valid   : ${s.amazonSourceValid} (failed ${s.amazonSourceFailed})`);
  console.log(`  demand passed         : ${s.demandPassed} (failed ${s.demandFailed})`);
  console.log(`  compliance passed     : ${s.compliancePassed} (failed ${s.complianceFailed})`);
  console.log(`  business fit passed   : ${s.businessFitPassed} (failed ${s.businessFitFailed})`);
  console.log(`  final validated       : ${s.finalValidated} (rejected ${s.finalRejected})`);
  console.log('  ----- export dedupe + cross-batch -----');
  console.log(`  validated before dedupe   : ${s.finalValidatedBeforeDedupe}`);
  console.log(`  same-batch dupes removed  : ${s.sameBatchDuplicatesRemoved}`);
  console.log(`  cross-batch repeats removed: ${s.crossBatchRepeatsRemoved}`);
  console.log(`  exported after all filters: ${s.exportedAfterAllFilters}`);
  console.log(`  repeat policy             : ${s.repeatPolicy} (lookback ${s.repeatLookbackDays}d)`);
  console.log('  ----- amazon environment -----');
  console.log(`  preflight performed   : ${preflight ? 'yes' : 'no'}`);
  console.log(`  amazon env status     : ${preflight ? preflight.status : 'not checked'}`);
  console.log(`  proxy enabled         : ${proxyDiagnostics().enabled}`);
  console.log('  ----- keepa api -----');
  console.log(`  tokens consumed       : ${r.tokens.tokensConsumed ?? 'n/a'}`);
  console.log(`  tokens left           : ${r.tokens.tokensLeft ?? 'n/a'}`);
  if (r.keepaError) console.log(`  keepa error           : ${r.keepaError.code} - ${r.keepaError.message}`);
  if (r.sourceFailureSamples.length > 0) {
    console.log('  ----- amazon source validation failures -----');
    for (const f of r.sourceFailureSamples.slice(0, 10)) {
      console.log(`    ${f.asin}  reason=${f.rejectionReason ?? 'n/a'}  pageLoaded=${f.pageLoaded}  price=${f.hasSourcePrice}  buyable=${f.buyable}  stock=${f.stockStatus}  gate=${f.shippingGateResult}${f.restrictedSignals.length ? `  restricted=[${f.restrictedSignals.join(',')}]` : ''}`);
    }
  }
  console.log('  ----- output -----');
  console.log(`  CSV path              : ${r.csvPath || '(none)'}`);
  console.log(`  manual QA CSV path    : ${r.qaPath || '(none)'}`);
  console.log('==================================================\n');
}

function reportsDir(): string {
  const dir = path.resolve(process.cwd(), 'reports');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeReport(
  timestamp: string,
  commandRun: string,
  profileLabel: string,
  strategyLabel: string,
  estimatedTokens: number,
  maxKeepaTokens: number,
  resolved: ReturnType<typeof mergeKeepaOptions>,
  runId: string,
  r: KeepaRunResult,
  preflight?: AmazonEnvReport,
): string {
  const file = path.join(reportsDir(), `otto-keepa-discovery-report-${timestamp}.md`);
  const s = r.stats;
  const proxy = proxyDiagnostics();
  const lines: string[] = [];
  lines.push('# OTTO Keepa Rank-Movement Discovery Report');
  lines.push('');
  lines.push(`- **Generated**: ${new Date().toISOString()}`);
  lines.push(`- **Command**: \`${commandRun}\``);
  lines.push(`- **Profile**: \`${profileLabel}\` (rank improvement >= ${resolved.minRankImprovementPercent}%, price $${resolved.minAmazonPrice}-$${resolved.maxAmazonPrice})`);
  lines.push(`- **Strategy**: \`${strategyLabel}\` (${r.strategiesRun.join(', ')})`);
  lines.push(`- **Token guard**: estimated ~${estimatedTokens}, max ${maxKeepaTokens > 0 ? maxKeepaTokens : 'no guard'}, actual consumed ${r.tokens.tokensConsumed ?? 'n/a'}${r.tokenBudgetStopped ? ' (STOPPED EARLY: budget reached)' : ''}`);
  lines.push(`- **discovery_run_id**: \`${runId}\``);
  lines.push(`- **export_batch_id**: \`${r.exportBatchId || '(none)'}\``);
  lines.push('');
  lines.push('## Amazon environment');
  lines.push('');
  lines.push(`- amazon_environment_status: \`${preflight ? preflight.status : 'not checked'}\``);
  lines.push(`- proxy_enabled: ${proxy.enabled}${proxy.enabled && proxy.serverMasked ? ` (${proxy.serverMasked})` : ''}`);
  lines.push(`- preflight_performed: ${preflight ? true : false}`);
  lines.push(`- preflight_result: ${preflight ? preflight.status : 'n/a'}`);
  lines.push('');
  lines.push('## Funnel');
  lines.push('');
  lines.push('| Stage | Count |');
  lines.push('| --- | --- |');
  lines.push(`| raw Keepa products | ${s.rawKeepaCandidates} |`);
  lines.push(`| unique ASIN candidates | ${r.uniqueAsinCandidates} |`);
  lines.push(`| duplicate ASINs across strategies | ${r.duplicateAsinsAcrossStrategies} |`);
  lines.push(`| ASIN-native candidates | ${s.asinNativeCandidates} |`);
  lines.push(`| Amazon source valid | ${s.amazonSourceValid} |`);
  lines.push(`| demand passed | ${s.demandPassed} |`);
  lines.push(`| compliance passed | ${s.compliancePassed} |`);
  lines.push(`| business fit passed | ${s.businessFitPassed} |`);
  lines.push(`| final validated before dedupe | ${s.finalValidatedBeforeDedupe} |`);
  lines.push(`| same-batch duplicates removed | ${s.sameBatchDuplicatesRemoved} |`);
  lines.push(`| cross-batch repeats removed | ${s.crossBatchRepeatsRemoved} |`);
  lines.push(`| exported after all filters | ${s.exportedAfterAllFilters} |`);
  lines.push('');
  lines.push('## Strategy diagnostics');
  lines.push('');
  lines.push('| Strategy | products returned | unique ASINs | accepted | rejected |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const st of r.perStrategy) {
    lines.push(`| \`${st.strategy}\` | ${st.rawProductsReturned} | ${st.uniqueAsinsContributed} | ${st.accepted} | ${st.rejected} |`);
  }
  lines.push('');
  lines.push(`- duplicate ASINs across strategies: ${r.duplicateAsinsAcrossStrategies}`);
  lines.push(`- final unique ASIN-native candidates: ${r.uniqueAsinCandidates}`);
  lines.push('');
  lines.push('### Filter reasons by strategy');
  lines.push('');
  const strategiesWithReasons = r.perStrategy.filter((st) => Object.keys(st.filterReasons).length > 0);
  if (strategiesWithReasons.length === 0) lines.push('_(none)_');
  else {
    for (const st of strategiesWithReasons) {
      const reasons = Object.entries(st.filterReasons).sort((a, b) => b[1] - a[1]);
      lines.push(`- \`${st.strategy}\`: ${reasons.map(([code, n]) => `${code}=${n}`).join(', ')}`);
    }
  }
  lines.push('');
  lines.push('## Keepa filter losses (reason codes)');
  lines.push('');
  const fr = Object.entries(r.filterReasons).sort((a, b) => b[1] - a[1]);
  if (fr.length === 0) lines.push('_(none)_');
  else {
    lines.push('| Reason | Count |');
    lines.push('| --- | --- |');
    for (const [code, n] of fr) lines.push(`| \`${code}\` | ${n} |`);
  }
  lines.push('');
  lines.push('## Keepa API usage');
  lines.push('');
  lines.push(`- tokens consumed: ${r.tokens.tokensConsumed ?? 'n/a'}`);
  lines.push(`- tokens left: ${r.tokens.tokensLeft ?? 'n/a'}`);
  if (r.keepaError) lines.push(`- **Keepa error**: \`${r.keepaError.code}\` — ${r.keepaError.message}`);
  lines.push('');
  lines.push('## Amazon source-validation failures (sample)');
  lines.push('');
  if (r.sourceFailureSamples.length === 0) lines.push('_(none)_');
  else {
    lines.push('| ASIN | reason | pageLoaded | price | buyable | stock | gate | restricted |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const f of r.sourceFailureSamples) {
      lines.push(`| \`${f.asin}\` | ${f.rejectionReason ?? 'n/a'} | ${f.pageLoaded} | ${f.hasSourcePrice} | ${f.buyable} | ${f.stockStatus} | ${f.shippingGateResult} | ${f.restrictedSignals.join(',') || '—'} |`);
    }
  }
  lines.push('');
  lines.push('## Top Keepa categories discovered');
  lines.push('');
  lines.push('| Category | rootId | raw | accepted | cat-filtered | price-filtered | rank-filtered |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const c of [...r.perCategory].sort((a, b) => b.accepted - a.accepted)) {
    lines.push(`| ${c.category} | ${c.rootId} | ${c.rawAsins} | ${c.accepted} | ${c.filteredCategory} | ${c.filteredPrice} | ${c.filteredRankImprovement} |`);
  }
  lines.push('');
  lines.push('## Top exported products');
  lines.push('');
  if (r.validated.length === 0) lines.push('_(none)_');
  else {
    lines.push('| ASIN | price | final | strategy | title |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const p of [...r.validated].sort((a, b) => b.finalValidationScore - a.finalValidationScore).slice(0, 15)) {
      const prov = r.strategyByAsin[p.asin];
      const strat = prov ? `${prov.primaryStrategy}${prov.strategyCount > 1 ? ` (+${prov.strategyCount - 1})` : ''}` : 'n/a';
      lines.push(`| \`${p.asin}\` | $${p.amazonPrice.toFixed(2)} | ${p.finalValidationScore.toFixed(0)} | ${strat} | ${(p.productTitle ?? '').slice(0, 60)} |`);
    }
  }
  lines.push('');
  lines.push('## Rejection breakdown (validation)');
  lines.push('');
  const codes = Object.entries(s.rejectionCounts).sort((a, b) => b[1] - a[1]);
  if (codes.length === 0) lines.push('_(none)_');
  else {
    lines.push('| Code | Count |');
    lines.push('| --- | --- |');
    for (const [code, n] of codes) lines.push(`| \`${code}\` | ${n} |`);
  }
  lines.push('');
  lines.push(`- **CSV export path**: \`${r.csvPath || '(none)'}\``);
  lines.push(`- **manual QA CSV path**: \`${r.qaPath || '(none)'}\``);
  lines.push('');
  fs.writeFileSync(file, lines.join('\n'), 'utf8');
  return file;
}

function writePreflightOnlyReport(
  timestamp: string,
  commandRun: string,
  profileLabel: string,
  preflight: AmazonEnvReport,
): string {
  const file = path.join(reportsDir(), `otto-keepa-discovery-report-${timestamp}.md`);
  const proxy = proxyDiagnostics();
  const lines: string[] = [];
  lines.push('# OTTO Keepa Rank-Movement Discovery Report (preflight stop)');
  lines.push('');
  lines.push(`- **Generated**: ${new Date().toISOString()}`);
  lines.push(`- **Command**: \`${commandRun}\``);
  lines.push(`- **Profile**: \`${profileLabel}\``);
  lines.push('');
  lines.push('## Amazon environment');
  lines.push('');
  lines.push(`- amazon_environment_status: \`${preflight.status}\``);
  lines.push(`- proxy_enabled: ${proxy.enabled}${proxy.enabled && proxy.serverMasked ? ` (${proxy.serverMasked})` : ''}`);
  lines.push(`- preflight_performed: true`);
  lines.push(`- preflight_result: ${preflight.status}`);
  lines.push('');
  lines.push('**Stopped before discovery — no Keepa tokens were consumed.** Re-run with `--force` to override.');
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
  logger.error('run-keepa-discovery failed', { err: (err as Error).message, stack: (err as Error).stack });
  process.exit(1);
});
