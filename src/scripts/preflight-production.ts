/* eslint-disable no-console */
/**
 * preflight-production.ts
 *
 * One command to decide whether it's safe to run Keepa discovery at scale
 * in the current environment.  Runs:
 *   1. npm run check:env            (required vars + runtime flags)
 *   2. npm run test:amazon-environment (can we load Amazon PDPs?)
 *   3. (optional) dashboard typecheck
 *
 * Prints a clear verdict: OK or NOT OK to run Keepa discovery.
 * Consumes NO Keepa tokens.
 *
 * Usage:
 *   npm run preflight:production
 *   npm run preflight:production -- --no-proxy
 *   npm run preflight:production -- --with-dashboard-typecheck
 *   npm run preflight:production -- --skip-amazon   # env-only
 */

import { spawnSync } from 'child_process';

interface Step {
  name: string;
  cmd: string;
  args: string[];
  required: boolean;
}

function run(step: Step): { ok: boolean; code: number } {
  console.log(`\n>>> ${step.name}: ${step.cmd} ${step.args.join(' ')}`);
  const res = spawnSync(step.cmd, step.args, { stdio: 'inherit', shell: false });
  const code = res.status ?? 1;
  return { ok: code === 0, code };
}

function main(): void {
  const argv = process.argv.slice(2);
  const passThrough: string[] = [];
  if (argv.includes('--no-proxy')) passThrough.push('--no-proxy');
  if (argv.includes('--proxy')) passThrough.push('--proxy');
  const withDashboard = argv.includes('--with-dashboard-typecheck');
  const skipAmazon = argv.includes('--skip-amazon');

  console.log('========== OTTO PRODUCTION PREFLIGHT ==========');
  console.log('  Decides whether it is safe to run Keepa discovery at scale.');
  console.log('  No Keepa tokens are consumed by this preflight.');

  const results: { step: string; ok: boolean; code: number }[] = [];

  // 1. env check (required)
  {
    const r = run({ name: 'Environment variables', cmd: 'npm', args: ['run', '--silent', 'check:env'], required: true });
    results.push({ step: 'check:env', ok: r.ok, code: r.code });
  }

  // 2. amazon environment (required unless skipped)
  let amazonOk = true;
  if (!skipAmazon) {
    const amazonArgs = ['run', '--silent', 'test:amazon-environment'];
    if (passThrough.length) amazonArgs.push('--', ...passThrough);
    const r = run({ name: 'Amazon environment readiness', cmd: 'npm', args: amazonArgs, required: true });
    amazonOk = r.ok; // exit 0 => READY/PARTIAL (usable); non-zero => BLOCKED/UNUSABLE
    results.push({ step: 'test:amazon-environment', ok: r.ok, code: r.code });
  } else {
    console.log('\n(skipping Amazon environment check: --skip-amazon)');
  }

  // 3. optional dashboard typecheck
  if (withDashboard) {
    const r = run({ name: 'Dashboard typecheck', cmd: 'npm', args: ['run', '--silent', '--prefix', 'dashboard', 'typecheck'], required: false });
    results.push({ step: 'dashboard typecheck', ok: r.ok, code: r.code });
  }

  const envOk = results.find((r) => r.step === 'check:env')?.ok ?? false;

  console.log('\n========== PREFLIGHT RESULT ==========');
  for (const r of results) {
    console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.step}${r.ok ? '' : ` (exit ${r.code})`}`);
  }
  console.log('');

  // Keepa discovery is OK only when env is configured AND Amazon is usable.
  const okToRunKeepa = envOk && (skipAmazon ? false : amazonOk);
  if (okToRunKeepa) {
    console.log('  VERDICT: OK to run Keepa discovery.');
    console.log('  -> npm run run:keepa-discovery -- --profile=balanced --limit=25 --preflight-amazon');
    console.log('======================================\n');
    process.exit(0);
  } else {
    console.log('  VERDICT: NOT OK to run Keepa discovery.');
    if (!envOk) console.log('  - Environment variables are missing/misconfigured (see check:env output).');
    if (skipAmazon) console.log('  - Amazon environment was not verified (--skip-amazon); cannot confirm readiness.');
    else if (!amazonOk) console.log('  - Amazon page access is BLOCKED/UNUSABLE. Configure AMAZON_PROXY_SERVER or run where Amazon is reachable. See AMAZON_ACCESS_RUNBOOK.md.');
    console.log('  Do NOT spend Keepa tokens until this is resolved.');
    console.log('======================================\n');
    process.exit(1);
  }
}

main();
