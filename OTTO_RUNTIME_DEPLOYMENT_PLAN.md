# OTTO Runtime / Deployment Plan

_Date: 2026-05-28. Planning only — nothing is deployed by this document._

## The one thing that determines the right runtime

OTTO's validation chain is gated on **loading real amazon.com product
pages with Playwright Chromium** (`AmazonSourceValidationAgent`). Discovery
(eBay Browse API, Keepa Product Finder) is cheap and works over plain
HTTPS, but **no candidate can be validated unless Amazon PDPs load**.

Diagnosis of the current sandbox (`npm run doctor:runtime`):

| Check | Result |
| --- | --- |
| Supabase connection | OK |
| eBay API (live token + Browse) | OK |
| Keepa API | key present (works; confirmed earlier) |
| **Amazon Playwright PDP load** | **FAIL — `AMAZON_ENV_UNUSABLE` / `NAVIGATION_FAILED` / `net::ERR_CERT_AUTHORITY_INVALID`** |

So the blocker is **not** Amazon blocking us and **not** general egress —
it's that this sandbox does **TLS interception** and Playwright's bundled
Chromium won't trust the injected certificate for `amazon.com`. eBay/Keepa
(axios) tolerate it; headless Chromium does not.

That makes the runtime requirement precise. We need an environment where:

1. **Outbound TLS is not intercepted** (so Chromium trusts amazon.com), AND
2. **The exit IP isn't aggressively captcha-walled by Amazon** (residential
   IPs are best; many datacenter IPs get `CAPTCHA_OR_BLOCK`), AND
3. **Playwright Chromium can run** (Linux deps installed; enough RAM).

We do **not** loosen TLS validation in production
(`AMAZON_IGNORE_HTTPS_ERRORS` stays `false`) — that's a dev-only escape
hatch and would mask real MITM/cert problems.

## Option comparison

Legend: Reliability = expected Amazon PDP load success.

### Local machine (developer laptop)

- **Ease of setup**: easiest (`npm install`, `npx playwright install chromium`).
- **Amazon reliability**: high — residential IP, clean egress, no MITM.
- **Playwright**: native, full control (headful/headless, devtools).
- **Proxy**: optional; usually not needed.
- **Cost**: $0.
- **Scaling**: none (single machine, manual runs).
- **Ops complexity**: low.
- **Recommended use**: **short-term testing and calibration** once
  `test:amazon-environment` is READY.

### Replit

- **Ease of setup**: easy (repo already binds dashboard to 0.0.0.0:5173).
- **Amazon reliability**: medium — datacenter IP; may hit
  `CAPTCHA_OR_BLOCK`; egress generally clean (no MITM).
- **Playwright**: works but needs `npx playwright install chromium` and
  occasionally extra system libs; memory-limited on small plans.
- **Proxy**: supported via `AMAZON_PROXY_SERVER`.
- **Cost**: low (free/Core tiers).
- **Scaling**: limited; not for heavy daily batches.
- **Ops complexity**: low.
- **Recommended use**: quick shared testing / dashboard demos; add a
  residential proxy if Amazon preflight is BLOCKED.

### Google Cloud Run

- **Ease of setup**: medium (containerize; install Chromium + deps in image).
- **Amazon reliability**: low–medium **without** a proxy — datacenter
  egress IPs are frequently captcha'd; clean TLS though.
- **Playwright**: works in a container (use an image with Chromium deps);
  cold starts + 1-CPU/512MB defaults need bumping for Chromium.
- **Proxy**: required in practice (residential) for reliable Amazon.
- **Cost**: low at low volume (scale-to-zero); pay per request/CPU.
- **Scaling**: excellent (request/job-driven), but stateless + max
  request timeouts (use Cloud Run Jobs for batch, not the request path).
- **Ops complexity**: medium (image, secrets, jobs, proxy).
- **Recommended use**: scheduled/triggered batch jobs **with a residential
  proxy**, once the workflow is proven on a VM.

### Google Compute Engine VM

- **Ease of setup**: medium (provision VM, install Node + Playwright deps).
- **Amazon reliability**: medium–high — static IP you control; clean TLS;
  pair with a residential proxy if the VM's datacenter IP gets captcha'd.
- **Playwright**: full control, persistent browser, easy debugging,
  headful via Xvfb if ever needed.
- **Proxy**: easily configured; can run a persistent proxy client.
- **Cost**: predictable (e.g. small e2-medium running only during jobs).
- **Scaling**: vertical easily; horizontal via more VMs/queue.
- **Ops complexity**: medium (you manage the box), but most forgiving for
  long Playwright sessions and cron-style batches.
- **Recommended use**: **best production-like home for daily OTTO jobs.**

### Render

- **Ease of setup**: easy–medium (background worker / cron job; Docker or
  native). Similar tradeoffs to Cloud Run.
- **Amazon reliability**: low–medium without a proxy (datacenter IP).
- **Playwright**: works with a Chromium-ready image / buildpack.
- **Proxy**: supported via env.
- **Cost**: low–medium (cron/worker plans).
- **Scaling**: good for scheduled workers.
- **Ops complexity**: medium.
- **Recommended use**: managed scheduled jobs if you prefer Render over
  GCP; still pair with a residential proxy.

### Browserless / remote browser service

- **Ease of setup**: medium (point Playwright at a remote
  `wss://` endpoint instead of launching local Chromium — small client
  change).
- **Amazon reliability**: medium–high **if** the service offers
  residential/stealth egress; some providers are themselves captcha'd.
- **Playwright**: compatible via `chromium.connect()`; offloads browser
  hosting + system deps.
- **Proxy**: usually built in (provider-managed egress / proxy).
- **Cost**: usage-based; can be the priciest per page at volume.
- **Scaling**: excellent (no local browser to manage).
- **Ops complexity**: low–medium (one endpoint + key), **but requires a
  small code change**: `amazonBrowserClient.ensureBrowser()` currently
  calls `chromium.launch()`; a remote option would use `chromium.connect()`.
- **Recommended use**: if we want to avoid managing Chromium/proxies and
  accept per-page cost; good fallback if VM+proxy is fiddly.

### Residential proxy with the current runtime

- **Ease of setup**: easy (set `AMAZON_PROXY_SERVER/USERNAME/PASSWORD`,
  re-run `test:amazon-environment -- --proxy`). Already supported.
- **Amazon reliability**: high for captcha avoidance — **but does NOT fix
  TLS interception.** A proxy routes traffic; if the local environment
  still MITMs TLS, Chromium will still see a bad cert. So a proxy helps
  with *blocking/IP* problems, not the *sandbox cert* problem we have here.
- **Playwright**: unchanged.
- **Cost**: residential proxies are metered (GB or per-IP).
- **Scaling**: orthogonal — layer on any runtime.
- **Ops complexity**: low–medium.
- **Recommended use**: **add-on** to any datacenter runtime
  (Cloud Run/GCE/Render) to beat Amazon captcha. Not a fix for a
  TLS-intercepting host.

## Recommendation

### Short-term (testing & calibration) — **local machine**

Run on a developer laptop (residential IP, no TLS MITM):

```bash
npm install && npx playwright install chromium
npm run doctor:runtime           # expect Amazon READY/PARTIAL
npm run run:real-qa -- --limit=10
npm run run:keepa-discovery -- --profile=balanced --limit=10 --preflight-amazon
```

Replit is an acceptable second choice for shared testing; if its
datacenter IP triggers `CAPTCHA_OR_BLOCK`, add a residential proxy.

### Production-like (daily jobs) — **GCE VM (+ residential proxy if needed)**

A small always-available VM is the most forgiving home for long Playwright
batches and cron-style scheduling:

- Clean, non-intercepted TLS egress (Chromium trusts amazon.com).
- Add `AMAZON_PROXY_SERVER` (residential) only if the VM IP gets captcha'd.
- Schedule `run:keepa-discovery` / `run:real-qa` via cron, each gated by
  `--preflight-amazon` so a degraded environment never burns Keepa tokens.

Cloud Run **Jobs** (not the request path) or Render cron are good managed
alternatives once proven — both effectively require a residential proxy
for Amazon. Browserless is the lowest-ops option if we accept per-page
cost and make the small `chromium.connect()` change.

### Hard rule

**Keepa scaling waits until `test:amazon-environment` reports READY or
PARTIAL in the target runtime.** Until then, discovery can find ASINs but
none can be validated, so it would only waste Keepa tokens. `doctor:runtime`
and `preflight:production` enforce this, and the Keepa runners stop at
`--preflight-amazon` when Amazon is BLOCKED/UNUSABLE.

## Code touchpoints (for reference, not changed here)

- `src/clients/amazonBrowserClient.ts` — `ensureBrowser()` uses
  `chromium.launch({ headless, proxy })`. A remote-browser runtime would
  add a `chromium.connect(wss)` branch (small, opt-in change — not done in
  this planning task).
- Proxy is already wired: `AMAZON_PROXY_SERVER/USERNAME/PASSWORD`.
- `AMAZON_IGNORE_HTTPS_ERRORS` stays `false` in production (dev-only).
