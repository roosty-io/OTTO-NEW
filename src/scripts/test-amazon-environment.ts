/* eslint-disable no-console */
/**
 * test-amazon-environment.ts
 *
 * Lightweight readiness check: can THIS environment actually load Amazon
 * product pages?  Loads a few known-stable ASINs with the same Playwright
 * client AmazonSourceValidationAgent uses, then classifies the
 * environment.  Consumes NO Keepa tokens.  Does NOT fake validation.
 *
 * Usage:
 *   npm run test:amazon-environment
 *
 * Exit codes: 0 = READY/PARTIAL (usable), 1 = BLOCKED/UNUSABLE.
 */

import { logger } from '@/utils/logger';
import {
  probeAmazonEnvironment,
  AMAZON_ENV_PROBE_ASINS,
  type AmazonEnvReport,
} from '@/pipeline/amazonEnvironment';

function yn(b: boolean): string {
  return b ? 'yes' : 'no';
}

export function printReport(report: AmazonEnvReport): void {
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
      console.log('  Captcha / blocking detected. Amazon source validation will fail until you');
      console.log('  use a residential/datacenter proxy (AMAZON_PROXY_SERVER). Avoid spending');
      console.log('  Keepa tokens until this is resolved.');
      break;
    case 'AMAZON_ENV_UNUSABLE':
      console.log('  No Amazon pages loaded. This environment cannot validate Amazon sources');
      console.log('  (network/egress likely blocked). Keepa can still discover ASINs, but they');
      console.log('  cannot pass source validation here. Configure a proxy or run where Amazon');
      console.log('  is reachable before scaling Keepa.');
      break;
  }
  console.log('');
}

async function main(): Promise<void> {
  logger.child('test-amazon-environment').info('Probing Amazon environment', { asins: AMAZON_ENV_PROBE_ASINS.length });
  const report = await probeAmazonEnvironment({ closeBrowser: true });
  printReport(report);
  const usable = report.status === 'AMAZON_ENV_READY' || report.status === 'AMAZON_ENV_PARTIAL';
  process.exit(usable ? 0 : 1);
}

main().catch((err) => {
  logger.error('test-amazon-environment failed', { err: (err as Error).message, stack: (err as Error).stack });
  process.exit(1);
});
