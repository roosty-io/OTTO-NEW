/**
 * Amazon environment readiness check.
 *
 * Detects whether the current environment can actually load Amazon
 * product pages BEFORE OTTO spends Keepa tokens or runs large discovery
 * jobs.  Uses the same PlaywrightAmazonBrowserClient that
 * AmazonSourceValidationAgent uses — it does NOT fake validation and does
 * NOT change any validation gate.  "source_valid" here means only "the
 * page loaded and title+price were extractable", i.e. the environment can
 * support source validation — not that the product passes business gates.
 */

import { getAmazonBrowserClient } from '@/clients/amazonBrowserClient';
import { env } from '@/config/env';
import { logger } from '@/utils/logger';

const log = logger.child('amazon-environment');

export type AmazonEnvStatus =
  | 'AMAZON_ENV_READY'
  | 'AMAZON_ENV_PARTIAL'
  | 'AMAZON_ENV_BLOCKED'
  | 'AMAZON_ENV_UNUSABLE';

/** Known-stable ASINs from prior successful batches. */
export const AMAZON_ENV_PROBE_ASINS = [
  'B0BCJQ31XZ',
  'B0B6RCKQBS',
  'B0DZC7TZNL',
  'B0FK3K1228',
  'B098QQ2B4B',
];

export interface AmazonProbeResult {
  asin: string;
  pageLoaded: boolean;
  blockedOrCaptcha: boolean;
  validationErrorCode?: string;
  titleCaptured: boolean;
  priceCaptured: boolean;
  availabilityCaptured: boolean;
  deliveryCaptured: boolean;
  /** environment can support source validation for this page (loaded + title + price). */
  sourceValid: boolean;
}

export interface ProxyDiagnostics {
  enabled: boolean;
  /** Host:port only — never includes username/password. */
  serverMasked: string | null;
}

export interface AmazonEnvReport {
  status: AmazonEnvStatus;
  probes: AmazonProbeResult[];
  total: number;
  loaded: number;
  captured: number;
  blocked: number;
  loadRate: number;
  captureRate: number;
  proxy: ProxyDiagnostics;
}

/**
 * Strip any credentials from a proxy server string and return host:port
 * only.  Never returns the password.  Returns null for empty input.
 */
export function maskProxyServer(raw: string | undefined): string | null {
  if (!raw || raw.trim() === '') return null;
  let s = raw.trim();
  // Drop protocol.
  s = s.replace(/^[a-z0-9]+:\/\//i, '');
  // Drop any embedded user:pass@ credentials.
  const at = s.lastIndexOf('@');
  if (at >= 0) s = s.slice(at + 1);
  return s || null;
}

export function proxyDiagnostics(): ProxyDiagnostics {
  const server = env.amazon.proxyServer || env.amazon.proxy || '';
  const enabled = Boolean(server);
  return { enabled, serverMasked: enabled ? maskProxyServer(server) : null };
}

/**
 * Pure classifier.  Order of precedence:
 *  - captcha wall that blocked everything -> BLOCKED
 *  - nothing loaded (and not captcha) -> UNUSABLE
 *  - captcha dominates (>= half) -> BLOCKED
 *  - >=80% load and >=60% capture title+price -> READY
 *  - otherwise -> PARTIAL
 */
export function classifyAmazonEnv(probes: AmazonProbeResult[]): AmazonEnvStatus {
  const total = probes.length;
  if (total === 0) return 'AMAZON_ENV_UNUSABLE';
  const loaded = probes.filter((p) => p.pageLoaded).length;
  const blocked = probes.filter((p) => p.blockedOrCaptcha).length;
  const captured = probes.filter((p) => p.pageLoaded && p.titleCaptured && p.priceCaptured).length;
  const loadRate = loaded / total;
  const captureRate = captured / total;

  if (blocked > 0 && loaded === 0) return 'AMAZON_ENV_BLOCKED';
  if (loaded === 0) return 'AMAZON_ENV_UNUSABLE';
  if (blocked >= Math.ceil(total / 2)) return 'AMAZON_ENV_BLOCKED';
  if (loadRate >= 0.8 && captureRate >= 0.6) return 'AMAZON_ENV_READY';
  return 'AMAZON_ENV_PARTIAL';
}

export function summarize(probes: AmazonProbeResult[]): Omit<AmazonEnvReport, 'proxy'> {
  const total = probes.length;
  const loaded = probes.filter((p) => p.pageLoaded).length;
  const blocked = probes.filter((p) => p.blockedOrCaptcha).length;
  const captured = probes.filter((p) => p.pageLoaded && p.titleCaptured && p.priceCaptured).length;
  return {
    status: classifyAmazonEnv(probes),
    probes,
    total,
    loaded,
    captured,
    blocked,
    loadRate: total ? loaded / total : 0,
    captureRate: total ? captured / total : 0,
  };
}

export interface ProbeOptions {
  asins?: string[];
  closeBrowser?: boolean;
}

/**
 * Run the readiness probes against the real Amazon browser client.
 * Consumes NO Keepa tokens.  In mock mode the mock client reports loaded
 * pages, so this returns READY offline.
 */
export async function probeAmazonEnvironment(options: ProbeOptions = {}): Promise<AmazonEnvReport> {
  const asins = options.asins ?? AMAZON_ENV_PROBE_ASINS;
  const client = getAmazonBrowserClient();
  const probes: AmazonProbeResult[] = [];

  for (const asin of asins) {
    const url = `https://www.amazon.com/dp/${asin}`;
    try {
      const page = await client.validateProductPage(asin, url);
      const titleCaptured = Boolean(page.productTitle && page.productTitle.trim().length > 0);
      const priceCaptured = typeof page.price === 'number' && page.price > 0;
      const availabilityCaptured =
        Boolean(page.availabilityText && page.availabilityText.trim().length > 0) || typeof page.inStock === 'boolean';
      const deliveryCaptured = Boolean(
        (page.deliveryText && page.deliveryText.trim().length > 0) ||
          typeof page.estimatedDeliveryDays === 'number',
      );
      probes.push({
        asin,
        pageLoaded: Boolean(page.pageLoaded),
        blockedOrCaptcha: Boolean(page.blockedOrCaptcha),
        validationErrorCode: page.validationErrorCode,
        titleCaptured,
        priceCaptured,
        availabilityCaptured,
        deliveryCaptured,
        sourceValid: Boolean(page.pageLoaded) && titleCaptured && priceCaptured,
      });
    } catch (err) {
      log.warn('Amazon probe threw', { asin, err: (err as Error).message });
      probes.push({
        asin,
        pageLoaded: false,
        blockedOrCaptcha: false,
        validationErrorCode: 'PROBE_EXCEPTION',
        titleCaptured: false,
        priceCaptured: false,
        availabilityCaptured: false,
        deliveryCaptured: false,
        sourceValid: false,
      });
    }
  }

  if (options.closeBrowser) {
    try {
      await client.close();
    } catch (err) {
      log.warn('amazon browser close failed', { err: (err as Error).message });
    }
  }

  return { ...summarize(probes), proxy: proxyDiagnostics() };
}

export interface PreflightDecision {
  performed: boolean;
  report: AmazonEnvReport;
  /** Whether the caller should proceed to spend Keepa tokens. */
  proceed: boolean;
  forced: boolean;
}

/**
 * Decide, from an env status, whether a Keepa run should proceed.
 * READY/PARTIAL proceed; BLOCKED/UNUSABLE stop unless forced.  Pure.
 */
export function shouldProceedAfterPreflight(status: AmazonEnvStatus, force: boolean): boolean {
  if (status === 'AMAZON_ENV_READY' || status === 'AMAZON_ENV_PARTIAL') return true;
  return force; // BLOCKED / UNUSABLE only proceed when forced
}

/**
 * Run the Amazon preflight (keeps the browser warm for the subsequent
 * run).  Consumes no Keepa tokens.
 */
export async function preflightAmazon(force: boolean): Promise<PreflightDecision> {
  const report = await probeAmazonEnvironment({ closeBrowser: false });
  const proceed = shouldProceedAfterPreflight(report.status, force);
  return { performed: true, report, proceed, forced: force };
}
