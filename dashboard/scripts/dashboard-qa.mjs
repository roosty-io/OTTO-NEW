/* eslint-disable no-console */
/**
 * dashboard-qa.mjs
 *
 * Headless QA driver for the OTTO Ops Dashboard.  Assumes a Vite dev
 * server is already running at http://localhost:5173.  Visits every
 * route, captures rendered text snippets, console errors, and any
 * failed network responses.  Outputs a single JSON object on stdout
 * so callers can post-process.
 *
 * Usage:
 *   node dashboard/scripts/dashboard-qa.mjs > /tmp/qa.json
 */

import { chromium } from 'playwright';

const BASE = process.env.QA_BASE_URL ?? 'http://localhost:5173';

const ROUTES = [
  { path: '/',                 name: 'Command Center' },
  { path: '/funnel',           name: 'Pipeline Funnel' },
  { path: '/validated',        name: 'Validated Products' },
  { path: '/rejected',         name: 'Rejected Products' },
  { path: '/competition',      name: 'Competition Review' },
  { path: '/shipping',         name: 'Shipping Review' },
  { path: '/exports',          name: 'Export Center' },
  { path: '/exclusions',       name: 'Export Exclusions' },
  { path: '/manual-qa',        name: 'Manual QA' },
  { path: '/agent-logs',       name: 'Agent Logs' },
  { path: '/discovery-agents', name: 'Discovery Agents' },
];

const browser = await chromium.launch();
// ignoreHTTPSErrors is required because this sandbox does TLS interception;
// a normal Chrome/Replit user will trust real Supabase certs without this.
const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
const page = await ctx.newPage();

const results = [];
for (const route of ROUTES) {
  const consoleErrors = [];
  const failedRequests = [];
  page.removeAllListeners('console');
  page.removeAllListeners('requestfailed');
  page.removeAllListeners('response');
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('requestfailed', (req) => {
    failedRequests.push(`${req.method()} ${req.url()} -- ${req.failure()?.errorText ?? 'unknown'}`);
  });
  page.on('response', (resp) => {
    if (resp.status() >= 400) {
      failedRequests.push(`HTTP ${resp.status()} ${resp.request().method()} ${resp.url()}`);
    }
  });

  const start = Date.now();
  let navError = null;
  try {
    await page.goto(`${BASE}${route.path}`, { waitUntil: 'networkidle', timeout: 20000 });
  } catch (e) {
    navError = String(e);
  }
  // Give react-query a brief moment in case networkidle resolved early.
  await page.waitForTimeout(500);

  const title = await page.title();
  const bodyText = (await page.locator('body').innerText()).slice(0, 4000);

  // Look for the empty-state copy or error banner.
  const hasLoadingSpinner = bodyText.includes('Loading...');
  const hasErrorBanner = /Error:|failed|error_/i.test(bodyText.slice(0, 500));
  // Heuristic: extract numeric scorecards (e.g. "125\nRaw candidates").
  const numericMatches = [...bodyText.matchAll(/^(\d[\d,]*)\s*$/gm)].map((m) => m[1]).slice(0, 20);

  results.push({
    route: route.path,
    name: route.name,
    title,
    navMs: Date.now() - start,
    navError,
    consoleErrors,
    failedRequests,
    hasLoadingSpinner,
    hasErrorBanner,
    bodySnippet: bodyText,
    numericMatches,
  });
}

await browser.close();
console.log(JSON.stringify(results, null, 2));
