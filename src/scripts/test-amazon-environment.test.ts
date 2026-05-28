/* eslint-disable no-console */
/**
 * test-amazon-environment.test.ts
 *
 * Unit cases for the Amazon environment readiness classifier, proxy
 * masking (no secret leak), and the preflight stop/force decision.
 * Pure functions only; no network.
 *
 * Usage: npm run test:amazon-env-classifier
 */

import {
  classifyAmazonEnv,
  shouldProceedAfterPreflight,
  maskProxyServer,
  type AmazonProbeResult,
} from '@/pipeline/amazonEnvironment';

function probe(over: Partial<AmazonProbeResult>): AmazonProbeResult {
  return {
    asin: over.asin ?? 'B0X',
    pageLoaded: over.pageLoaded ?? false,
    blockedOrCaptcha: over.blockedOrCaptcha ?? false,
    validationErrorCode: over.validationErrorCode,
    titleCaptured: over.titleCaptured ?? false,
    priceCaptured: over.priceCaptured ?? false,
    availabilityCaptured: over.availabilityCaptured ?? false,
    deliveryCaptured: over.deliveryCaptured ?? false,
    sourceValid: over.sourceValid ?? false,
  };
}

function good(asin: string): AmazonProbeResult {
  return probe({ asin, pageLoaded: true, titleCaptured: true, priceCaptured: true, availabilityCaptured: true, deliveryCaptured: true, sourceValid: true });
}
function loadedNoExtract(asin: string): AmazonProbeResult {
  return probe({ asin, pageLoaded: true });
}
function dead(asin: string): AmazonProbeResult {
  return probe({ asin, validationErrorCode: 'AMAZON_PAGE_UNAVAILABLE' });
}
function captcha(asin: string): AmazonProbeResult {
  return probe({ asin, blockedOrCaptcha: true, validationErrorCode: 'AMAZON_BLOCKED_OR_CAPTCHA' });
}

interface Case { label: string; run: () => boolean }

const CASES: Case[] = [
  {
    label: 'READY: 5/5 load, all capture title+price',
    run: () => classifyAmazonEnv([good('a'), good('b'), good('c'), good('d'), good('e')]) === 'AMAZON_ENV_READY',
  },
  {
    label: 'READY: 80% load + 60% capture meets thresholds',
    run: () => classifyAmazonEnv([good('a'), good('b'), good('c'), loadedNoExtract('d'), dead('e')]) === 'AMAZON_ENV_READY',
  },
  {
    label: 'PARTIAL: pages load but extraction inconsistent (<60% capture)',
    run: () => classifyAmazonEnv([good('a'), loadedNoExtract('b'), loadedNoExtract('c'), loadedNoExtract('d'), dead('e')]) === 'AMAZON_ENV_PARTIAL',
  },
  {
    label: 'BLOCKED: majority captcha',
    run: () => classifyAmazonEnv([captcha('a'), captcha('b'), captcha('c'), good('d'), dead('e')]) === 'AMAZON_ENV_BLOCKED',
  },
  {
    label: 'BLOCKED: captcha wall blocked everything (0 loaded, captcha present)',
    run: () => classifyAmazonEnv([captcha('a'), captcha('b')]) === 'AMAZON_ENV_BLOCKED',
  },
  {
    label: 'UNUSABLE: no pages load, no captcha (our sandbox case)',
    run: () => classifyAmazonEnv([dead('a'), dead('b'), dead('c'), dead('d'), dead('e')]) === 'AMAZON_ENV_UNUSABLE',
  },
  {
    label: 'UNUSABLE: empty probe set',
    run: () => classifyAmazonEnv([]) === 'AMAZON_ENV_UNUSABLE',
  },
  // preflight stop / force
  {
    label: 'preflight: READY proceeds without force',
    run: () => shouldProceedAfterPreflight('AMAZON_ENV_READY', false) === true,
  },
  {
    label: 'preflight: PARTIAL proceeds without force',
    run: () => shouldProceedAfterPreflight('AMAZON_ENV_PARTIAL', false) === true,
  },
  {
    label: 'preflight: BLOCKED stops without force, proceeds with --force',
    run: () => shouldProceedAfterPreflight('AMAZON_ENV_BLOCKED', false) === false && shouldProceedAfterPreflight('AMAZON_ENV_BLOCKED', true) === true,
  },
  {
    label: 'preflight: UNUSABLE stops without force, proceeds with --force',
    run: () => shouldProceedAfterPreflight('AMAZON_ENV_UNUSABLE', false) === false && shouldProceedAfterPreflight('AMAZON_ENV_UNUSABLE', true) === true,
  },
  // proxy masking — never leak password
  {
    label: 'proxy mask: strips user:pass@, returns host:port only',
    run: () => {
      const masked = maskProxyServer('http://ottouser:SuperSecret123@gate.smartproxy.com:7000');
      return masked === 'gate.smartproxy.com:7000' && !String(masked).includes('SuperSecret123') && !String(masked).includes('ottouser');
    },
  },
  {
    label: 'proxy mask: plain host:port unchanged; empty -> null',
    run: () => maskProxyServer('proxy.example.com:8080') === 'proxy.example.com:8080' && maskProxyServer('') === null && maskProxyServer(undefined) === null,
  },
];

function main(): void {
  let ok = 0, fail = 0;
  console.log('OTTO amazon-environment classifier cases');
  console.log('----------------------------------------');
  for (const c of CASES) {
    let pass = false; let err = '';
    try { pass = c.run(); } catch (e) { err = (e as Error).message; }
    if (pass) ok++; else fail++;
    console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${c.label}${err ? `  (threw: ${err})` : ''}`);
  }
  console.log('');
  console.log(`${ok}/${ok + fail} cases passed`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
