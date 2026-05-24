/* eslint-disable no-console */
/**
 * check-env.ts
 *
 * Reports which environment variables OTTO needs are present.  Never
 * prints secret values - only present/missing/default.
 *
 * Usage: npm run check:env
 *
 * Exit codes:
 *   0  all required vars present and runtime flags configured for real QA
 *   1  one or more required vars missing or misconfigured
 */

import { env } from '@/config/env';

interface Check {
  name: string;
  present: boolean;
  required: boolean;
  note?: string;
}

function main(): void {
  const checks: Check[] = [
    // eBay - required for real discovery / demand
    { name: 'EBAY_CLIENT_ID', present: Boolean(env.ebay.clientId), required: true },
    { name: 'EBAY_CLIENT_SECRET', present: Boolean(env.ebay.clientSecret), required: true },
    { name: 'EBAY_OAUTH_TOKEN', present: Boolean(env.ebay.oauthToken), required: false, note: 'optional pre-fetched token' },
    // Supabase - required for persistence (falls back to in-memory stub if missing)
    { name: 'SUPABASE_URL', present: Boolean(env.supabase.url), required: true },
    { name: 'SUPABASE_SERVICE_ROLE_KEY', present: Boolean(env.supabase.serviceRoleKey), required: true },
    // Keepa - optional for V1
    { name: 'KEEPA_API_KEY', present: Boolean(env.keepa.apiKey), required: false, note: 'optional in V1' },
    // Zik - optional in V1 (placeholder client)
    { name: 'ZIK_USERNAME', present: Boolean(env.zik.username), required: false, note: 'optional in V1' },
    { name: 'ZIK_PASSWORD', present: Boolean(env.zik.password), required: false, note: 'optional in V1' },
    // Pipeline defaults
    { name: 'DEFAULT_ZIP_CODE', present: Boolean(env.pipeline.defaultZipCode), required: false, note: `default ${env.pipeline.defaultZipCode}` },
  ];

  const flags: { name: string; value: string; expected?: string; note?: string }[] = [
    { name: 'OTTO_MOCK_MODE', value: String(env.runtime.mockMode), expected: 'false', note: 'must be false for real QA' },
    { name: 'OTTO_REAL_EBAY_DISCOVERY', value: String(env.runtime.realEbayDiscovery), expected: 'true', note: 'must be true for real QA' },
    { name: 'AMAZON_HEADLESS', value: String(env.amazon.headless), note: 'true in CI / production' },
    { name: 'AMAZON_DEBUG', value: String(env.amazon.debug), note: 'true only for local debugging' },
    { name: 'AMAZON_IGNORE_HTTPS_ERRORS', value: String(env.amazon.ignoreHttpsErrors), note: 'dev/test only' },
  ];

  console.log('OTTO env check');
  console.log('--------------');
  console.log('Required & optional variables:');
  let missing = 0;
  for (const c of checks) {
    const status = c.present ? 'present' : (c.required ? 'MISSING' : 'absent');
    const tag = c.required ? '[required]' : '[optional]';
    const noteText = c.note ? `  (${c.note})` : '';
    console.log(`  ${c.name.padEnd(28)} ${status.padEnd(8)} ${tag}${noteText}`);
    if (c.required && !c.present) missing++;
  }
  console.log('\nRuntime flags:');
  let flagIssue = 0;
  for (const f of flags) {
    const matchesExpected = f.expected === undefined || f.value === f.expected;
    const tag = f.expected ? (matchesExpected ? '[ok]' : `[expected ${f.expected}]`) : '';
    const noteText = f.note ? `  (${f.note})` : '';
    console.log(`  ${f.name.padEnd(28)} ${f.value.padEnd(8)} ${tag}${noteText}`);
    if (f.expected && !matchesExpected) flagIssue++;
  }

  console.log('\nSummary:');
  if (missing === 0 && flagIssue === 0) {
    console.log(`  OK - environment is configured for real QA (no secrets were printed).`);
    process.exit(0);
  } else {
    console.log(`  ${missing} required variable(s) missing, ${flagIssue} runtime flag(s) mis-set.`);
    if (missing > 0) {
      console.log('  -> Add the missing vars to .env and re-run `npm run check:env`.');
    }
    if (flagIssue > 0) {
      console.log('  -> Set the flagged runtime values to the expected state before running real QA.');
    }
    process.exit(1);
  }
}

main();
