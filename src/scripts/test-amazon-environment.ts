/* eslint-disable no-console */
/**
 * test-amazon-environment.ts
 *
 * Lightweight readiness check: can THIS environment load Amazon product
 * pages?  Uses the same PlaywrightAmazonBrowserClient as
 * AmazonSourceValidationAgent.  Consumes NO Keepa tokens.  Never fakes
 * validation.
 *
 * Usage:
 *   npm run test:amazon-environment
 *   npm run test:amazon-environment -- --no-proxy
 *   npm run test:amazon-environment -- --proxy
 *   npm run test:amazon-environment -- --asin=B0DZC7TZNL --debug
 *   npm run test:amazon-environment -- --headful --zip=84107
 *
 * Flags:
 *   --no-proxy   force proxy off even if env vars exist
 *   --proxy      require proxy env vars (fail clearly if missing)
 *   --debug      save diagnostics (screenshot/html/meta) to reports/amazon-env-diagnostics/<ts>/
 *   --headful    launch a visible browser (if the environment supports it)
 *   --asin=X     test a single ASIN
 *   --zip=NNNNN  delivery ZIP (best-effort; passed to validateProductPage)
 *
 * Exit codes: 0 = READY/PARTIAL (usable), 1 = BLOCKED/UNUSABLE, 2 = bad flags.
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '@/utils/logger';
import { env } from '@/config/env';
import {
  getAmazonBrowserClient,
  setAmazonBrowserOverrides,
  type AmazonPageDiagnostics,
} from '@/clients/amazonBrowserClient';
import {
  probeAmazonEnvironment,
  proxyDiagnostics,
  persistAmazonEnvCheck,
  AMAZON_ENV_PROBE_ASINS,
  type AmazonEnvReport,
} from '@/pipeline/amazonEnvironment';

interface Args {
  noProxy: boolean;
  proxy: boolean;
  debug: boolean;
  headful: boolean;
  asin?: string;
  zip?: string;
}

function parseArgs(): Args {
  const out: Args = { noProxy: false, proxy: false, debug: false, headful: false };
  for (const a of process.argv.slice(2)) {
    if (a === '--no-proxy') out.noProxy = true;
    else if (a === '--proxy') out.proxy = true;
    else if (a === '--debug') out.debug = true;
    else if (a === '--headful') out.headful = true;
    else if (a.startsWith('--asin=')) out.asin = a.split('=')[1]?.trim().toUpperCase();
    else if (a.startsWith('--zip=')) out.zip = a.split('=')[1]?.trim();
  }
  return out;
}

function yn(b: boolean): string {
  return b ? 'yes' : 'no';
}

function printReport(report: AmazonEnvReport): void {
  console.log('\n========== AMAZON ENVIRONMENT READINESS ==========');
  console.log('  proxy mode            : ' + (report.proxy.enabled ? `enabled (${report.proxy.serverMasked ?? 'configured'})` : 'disabled'));
  console.log('');
  console.log('  ASIN        loaded  blocked  errorCode               title price avail deliv srcValid');
  for (const p of report.probes) {
    console.log(
      `  ${p.asin.padEnd(10)} ${yn(p.pageLoaded).padEnd(6)} ${yn(p.blockedOrCaptcha).padEnd(7)} ` +
        `${(p.validationErrorCode ?? '-').padEnd(22)} ${yn(p.titleCaptured).padEnd(5)} ${yn(p.priceCaptured).padEnd(5)} ` +
        `${yn(p.availabilityCaptured).padEnd(5)} ${yn(p.deliveryCaptured).padEnd(5)} ${yn(p.sourceValid)}`,
    );
  }
  console.log('');
  console.log(`  pages loaded          : ${report.loaded}/${report.total} (${(report.loadRate * 100).toFixed(0)}%)`);
  console.log(`  title+price captured  : ${report.captured}/${report.total} (${(report.captureRate * 100).toFixed(0)}%)`);
  console.log(`  blocked/captcha       : ${report.blocked}/${report.total}`);
  console.log('');
  console.log(`  RESULT: ${report.status}`);
  console.log('==================================================\n');
  printGuidance(report.status);
}

function printGuidance(status: AmazonEnvReport['status']): void {
  switch (status) {
    case 'AMAZON_ENV_READY':
      console.log('  Amazon pages load and extract cleanly. Safe to run Keepa discovery.');
      break;
    case 'AMAZON_ENV_PARTIAL':
      console.log('  Some pages load but extraction is inconsistent. Keepa discovery will work');
      console.log('  but expect higher Amazon source-validation failure rates.');
      break;
    case 'AMAZON_ENV_BLOCKED':
      console.log('  Captcha / blocking detected. Use a proxy (AMAZON_PROXY_SERVER) and re-test.');
      console.log('  Avoid spending Keepa tokens until this is resolved. See AMAZON_ACCESS_RUNBOOK.md.');
      break;
    case 'AMAZON_ENV_UNUSABLE':
      console.log('  No Amazon pages loaded. This environment cannot validate Amazon sources.');
      console.log('  Configure a proxy or run where Amazon is reachable. See AMAZON_ACCESS_RUNBOOK.md.');
      break;
  }
  console.log('');
}

function diagnosticsDir(): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.resolve(process.cwd(), 'reports', 'amazon-env-diagnostics', ts);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function saveDiagnostics(dir: string, d: AmazonPageDiagnostics): void {
  const base = d.asin;
  // Screenshot (best-effort; present mainly on reachable/blocked pages).
  if (d.screenshot && d.screenshot.length > 0) {
    try { fs.writeFileSync(path.join(dir, `${base}.png`), d.screenshot); } catch { /* ignore */ }
  }
  // HTML snapshot (public PDP content; no cookies/credentials captured).
  if (d.html) {
    try { fs.writeFileSync(path.join(dir, `${base}.html`), d.html); } catch { /* ignore */ }
  }
  // Metadata — explicitly excludes cookies, credentials, and proxy password.
  const meta = {
    asin: d.asin,
    requestedUrl: d.requestedUrl,
    finalUrl: d.finalUrl ?? null,
    userAgent: d.userAgent,
    viewport: d.viewport,
    proxyEnabled: d.proxyEnabled,
    pageLoaded: d.pageLoaded,
    blockedOrCaptcha: d.blockedOrCaptcha,
    validationErrorCode: d.validationErrorCode ?? null,
    errorClassification: classifyError(d),
    networkErrors: d.networkErrors,
  };
  try { fs.writeFileSync(path.join(dir, `${base}.meta.json`), JSON.stringify(meta, null, 2)); } catch { /* ignore */ }
}

function classifyError(d: AmazonPageDiagnostics): string {
  if (d.blockedOrCaptcha) return 'CAPTCHA_OR_BLOCK';
  if (d.validationErrorCode === 'TIMEOUT') return 'TIMEOUT';
  if (d.validationErrorCode === 'NAVIGATION_FAILED') return 'NAVIGATION_FAILED';
  if (d.validationErrorCode === 'BROWSER_LAUNCH_FAILED') return 'BROWSER_LAUNCH_FAILED';
  if (!d.pageLoaded) return 'PAGE_NOT_LOADED';
  return 'OK';
}

async function main(): Promise<void> {
  const args = parseArgs();

  // --proxy requires real proxy env vars.
  if (args.proxy && !env.amazon.proxyServer && !env.amazon.proxy) {
    console.error('--proxy was requested but no AMAZON_PROXY_SERVER (or AMAZON_BROWSER_PROXY) is configured.');
    console.error('Set AMAZON_PROXY_SERVER/USERNAME/PASSWORD or omit --proxy.');
    process.exit(2);
  }
  if (args.proxy && args.noProxy) {
    console.error('--proxy and --no-proxy are mutually exclusive.');
    process.exit(2);
  }

  // Apply per-run launch overrides BEFORE the browser launches.
  // Note: --debug only controls diagnostics SAVING (script-side); it must
  // NOT force a headful browser (that fails in display-less environments).
  // Use --headful to request a visible browser explicitly.
  setAmazonBrowserOverrides({
    disableProxy: args.noProxy ? true : args.proxy ? false : undefined,
    headless: args.headful ? false : undefined,
  });

  const asins = args.asin ? [args.asin] : AMAZON_ENV_PROBE_ASINS;
  logger.child('test-amazon-environment').info('Probing Amazon environment', { asins: asins.length, debug: args.debug });

  // Keep the browser open if we still need it for --debug captures.
  const report = await probeAmazonEnvironment({ asins, zip: args.zip, closeBrowser: !args.debug });
  printReport(report);

  if (args.debug) {
    const dir = diagnosticsDir();
    console.log(`  --debug: saving diagnostics to ${dir}`);
    const client = getAmazonBrowserClient();
    for (const asin of asins) {
      try {
        const diag = await client.captureDiagnostics(asin, `https://www.amazon.com/dp/${asin}`, args.zip ? { zipCode: args.zip } : undefined);
        saveDiagnostics(dir, diag);
      } catch (err) {
        logger.warn('diagnostics capture failed', { asin, err: (err as Error).message });
      }
    }
    try { await client.close(); } catch { /* ignore */ }
    // Write a top-level summary too.
    const proxy = proxyDiagnostics();
    fs.writeFileSync(
      path.join(dir, 'summary.json'),
      JSON.stringify({ status: report.status, loaded: report.loaded, total: report.total, blocked: report.blocked, proxyEnabled: proxy.enabled, proxyHostMasked: proxy.serverMasked }, null, 2),
    );
    console.log('  diagnostics saved (no cookies, credentials, or proxy password).\n');
  }

  // Persist the check (best-effort) so the dashboard can show latest status.
  await persistAmazonEnvCheck(report, args.debug ? 'debug run' : undefined);

  const usable = report.status === 'AMAZON_ENV_READY' || report.status === 'AMAZON_ENV_PARTIAL';
  process.exit(usable ? 0 : 1);
}

main().catch((err) => {
  logger.error('test-amazon-environment failed', { err: (err as Error).message, stack: (err as Error).stack });
  process.exit(1);
});
