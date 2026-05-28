# OTTO V1 — Google Compute Engine Deployment Guide

A step-by-step, copy/paste guide to run OTTO discovery/validation jobs on
a Google Compute Engine (GCE) virtual machine — a runtime where the
browser (Playwright Chromium) can actually load Amazon product pages.

**Why a VM?** OTTO validates products by loading real amazon.com pages
with a headless browser. The Replit/Claude sandbox intercepts HTTPS, so
Chromium can't trust amazon.com (`net::ERR_CERT_AUTHORITY_INVALID`) and
the Amazon check reports `AMAZON_ENV_UNUSABLE`. A normal VM has clean
internet egress, so Amazon pages load.

> **Golden rule:** Do **not** run Keepa discovery until the Amazon check
> says `AMAZON_ENV_READY` or `AMAZON_ENV_PARTIAL`. If it says `BLOCKED` or
> `UNUSABLE`, stop and fix access first (see Troubleshooting). OTTO has a
> built-in `--preflight-amazon` guard that refuses to spend Keepa tokens
> when Amazon is unusable.

No secrets appear in this guide. Nothing is deployed for you — you run the
steps yourself.

---

## 0. What you'll end up with

- A small Linux VM in Google Cloud.
- OTTO installed from GitHub on branch `claude/keen-meitner-FT8xt`.
- A way to check the environment (`doctor:runtime`) and run small Keepa
  batches that persist real products into Supabase and show in the
  dashboard.

Estimated time: ~30–45 minutes the first time.

---

## 1. Create the VM in Google Cloud

You can do this entirely in the browser.

1. Go to **https://console.cloud.google.com** and sign in.
2. If you don't have a project yet: top bar → **project dropdown** →
   **New Project** → name it `otto-runtime` → **Create**. Select it.
3. Make sure **billing** is enabled (Billing in the left menu). A small VM
   costs only a few dollars/month if you stop it when idle.
4. Enable the Compute Engine API: search **"Compute Engine"** in the top
   search bar → open **Compute Engine** → click **Enable** if prompted
   (takes a minute).
5. Left menu → **Compute Engine → VM instances → Create instance**.
6. Fill in:
   - **Name**: `otto-vm`
   - **Region**: pick one near you, e.g. `us-central1`. **Zone**: any
     (e.g. `us-central1-a`).
   - **Machine configuration**: series **E2**, machine type
     **`e2-medium`** (2 vCPU, 4 GB RAM). This is the recommended size —
     enough for one headless Chromium.
   - **Boot disk**: click **Change** →
     - **Operating system**: **Debian**
     - **Version**: **Debian GNU/Linux 12 (bookworm)**
     - **Boot disk type**: Balanced persistent disk
     - **Size**: **20 GB**
     - Click **Select**.
   - **Firewall**: you do **not** need to check "Allow HTTP/HTTPS" for
     running jobs. Leave both unchecked (see §3 for the dashboard option).
7. Click **Create**. Wait ~1 minute until the VM shows a green check.

**Recommended size recap:** `e2-medium`, Debian 12, 20 GB disk.

---

## 2. Network / firewall settings

- **For running OTTO jobs (Keepa/eBay/Amazon validation):** no inbound
  firewall rules are needed. The VM only makes **outbound** calls
  (Supabase, eBay, Keepa, Amazon). Outbound is allowed by default.
- **You do NOT need a public web server.** OTTO jobs are command-line.
- **Optional — viewing the OTTO dashboard from the VM:** easiest and
  safest is **not** to open a firewall port. Instead use SSH port
  forwarding from your own computer later (advanced, optional). For most
  use, just view data in the **Supabase dashboard** (§14) and run the
  OTTO dashboard elsewhere. Do **not** expose the dashboard publicly — it
  has no login.

---

## 3. SSH into the VM (browser-based, no terminal needed)

1. **Compute Engine → VM instances**.
2. On the `otto-vm` row, click **SSH** (under the "Connect" column).
3. A browser terminal window opens, connected to the VM. Everything below
   is typed/pasted into **that** window.

Tip: to paste in the browser SSH window, use the paste icon (top-right) or
`Ctrl+Shift+V` / right-click → Paste.

---

## 4. Install git, Node.js LTS, npm, and browser dependencies

Paste these blocks one at a time into the SSH window. Wait for each to
finish.

**4a. Update the system and install git + tools:**

```bash
sudo apt-get update
sudo apt-get install -y git curl ca-certificates
```

**4b. Install Node.js 20 LTS (includes npm):**

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

Verify (should print v20.x and a version number):

```bash
node -v
npm -v
```

**4c. Install the Linux libraries Chromium needs:**

```bash
sudo apt-get install -y \
  libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
  libdbus-1-3 libxkbcommon0 libatspi2.0-0 libx11-6 libxcomposite1 \
  libxdamage1 libxext6 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 \
  libcairo2 libasound2 libxshmfence1 fonts-liberation
```

(Playwright can also install these automatically in step 6b; this block
makes it reliable on Debian.)

---

## 5. Get the OTTO code

**5a. Clone the repository:**

```bash
cd ~
git clone https://github.com/roosty-io/OTTO-NEW.git
cd OTTO-NEW
```

> If the repo is **private**, the clone will ask for a username and
> password. GitHub no longer accepts your account password here — you need
> a **Personal Access Token (PAT)**:
> 1. On github.com → your avatar → **Settings → Developer settings →
>    Personal access tokens → Tokens (classic) → Generate new token**.
> 2. Scope: check **repo**. Generate, and **copy** the token.
> 3. When `git clone` asks for **Username**, enter your GitHub username.
>    When it asks for **Password**, paste the **token** (not your password).
>
> Do not paste the token anywhere else or commit it.

**5b. Switch to the correct branch:**

```bash
git checkout claude/keen-meitner-FT8xt
git branch --show-current
```

The second command must print:

```
claude/keen-meitner-FT8xt
```

**5c. Sanity check you're on the OTTO engine (not the old Next.js admin):**

```bash
ls
```

You should see `src`, `dashboard`, `reports`, `exports`,
`OTTO_RUNTIME_DEPLOYMENT_PLAN.md`, `package.json`. You should **not** see
`app/` or `next.config.js`.

---

## 6. Install OTTO and the browser

**6a. Install Node dependencies:**

```bash
npm install
```

**6b. Install the Chromium browser for Playwright:**

```bash
npx playwright install --with-deps chromium
```

(`--with-deps` lets Playwright add any system libraries it still needs.)

---

## 7. Create the `.env` file safely

OTTO reads its credentials from a file named `.env` in the `OTTO-NEW`
folder. You will create it and paste in values. **Never commit this file**
(it is already in `.gitignore`).

Open the editor:

```bash
nano .env
```

Paste the template below, then replace each `REPLACE_ME` with the real
value (get these from your existing OTTO `.env` / password manager — the
same values used in the Replit environment). **Do not share these.**

```
# --- Supabase ---
SUPABASE_URL=REPLACE_ME
SUPABASE_SERVICE_ROLE_KEY=REPLACE_ME
SUPABASE_ANON_KEY=REPLACE_ME

# --- eBay Browse API ---
EBAY_CLIENT_ID=REPLACE_ME
EBAY_CLIENT_SECRET=REPLACE_ME
EBAY_ENV=production

# --- Keepa ---
KEEPA_API_KEY=REPLACE_ME

# --- Amazon (browser) ---
AMAZON_HEADLESS=true
AMAZON_IGNORE_HTTPS_ERRORS=false

# --- Runtime flags ---
OTTO_MOCK_MODE=false
OTTO_REAL_EBAY_DISCOVERY=true
OTTO_LOG_LEVEL=info
```

To save in nano: press **Ctrl+O**, then **Enter**, then **Ctrl+X** to
exit.

Lock the file's permissions so only your user can read it:

```bash
chmod 600 .env
```

> Leave `AMAZON_IGNORE_HTTPS_ERRORS=false`. It is a dev-only escape hatch;
> a real VM does not need it, and turning it on would hide genuine
> certificate problems.

---

## 8. Required `.env` variables (names only — no secrets)

**Required for all real jobs:**
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `EBAY_CLIENT_ID`
- `EBAY_CLIENT_SECRET`

**Required for Keepa discovery:**
- `KEEPA_API_KEY`

**Recommended / runtime flags:**
- `SUPABASE_ANON_KEY` (needed by the dashboard)
- `EBAY_ENV` (set to `production`)
- `OTTO_MOCK_MODE` (set to `false` for real jobs)
- `OTTO_REAL_EBAY_DISCOVERY` (set to `true`)
- `AMAZON_HEADLESS` (set to `true` on a server)
- `AMAZON_IGNORE_HTTPS_ERRORS` (keep `false`)

**Optional — only if Amazon is blocked and you add a proxy (see §19):**
- `AMAZON_PROXY_SERVER`
- `AMAZON_PROXY_USERNAME`
- `AMAZON_PROXY_PASSWORD`

**Optional — Keepa discovery tuning (sensible defaults exist):**
- `KEEPA_DOMAIN`
- `KEEPA_DISCOVERY_MAX_ASINS`
- `KEEPA_DISCOVERY_MIN_RANK_IMPROVEMENT_PERCENT`
- `KEEPA_DISCOVERY_MAX_SALES_RANK`
- `KEEPA_DISCOVERY_MIN_AMAZON_PRICE`
- `KEEPA_DISCOVERY_MAX_AMAZON_PRICE`
- `KEEPA_DISCOVERY_ALLOWED_CATEGORIES`
- `KEEPA_DISCOVERY_EXCLUDED_CATEGORIES`

**Optional — export repeat policy (defaults to exclude_recent / 30 days):**
- `EXPORT_REPEAT_POLICY`
- `EXPORT_REPEAT_LOOKBACK_DAYS`

**Dashboard (only if you run the dashboard, in `dashboard/.env`):**
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_MOCK_DASHBOARD` (set to `false`)

> ZIK variables are intentionally omitted — Zik is not implemented yet.

---

## 9. Run the readiness check

This checks Supabase, eBay, the Amazon browser, and Keepa key presence.
**It consumes no Keepa tokens.**

```bash
npm run doctor:runtime
```

### 10. What the output means

At the bottom you'll see three lines:

```
RUNTIME_READY_FOR_EBAY_QA          : true/false
RUNTIME_READY_FOR_KEEPA_DISCOVERY  : true/false
RUNTIME_READY_FOR_DASHBOARD        : true/false
```

The **Amazon environment** line is the one that decides whether you can
run real jobs:

| Amazon result | Meaning | Do this |
| --- | --- | --- |
| `AMAZON_ENV_READY` | ≥80% of Amazon pages loaded and extracted cleanly | ✅ Proceed to §11 |
| `AMAZON_ENV_PARTIAL` | Pages load but extraction is inconsistent | ✅ Proceed; expect more validation failures; start small |
| `AMAZON_ENV_BLOCKED` | Captcha / robot wall detected | ⛔ Stop. Add a proxy (§19) and re-check |
| `AMAZON_ENV_UNUSABLE` | No Amazon pages loaded | ⛔ Stop. Fix access (§19) and re-check |

> If Amazon is `BLOCKED` or `UNUSABLE`, **do not run Keepa discovery.**
> You would only waste Keepa tokens finding ASINs that can't be validated.

You can also run the deeper check:

```bash
npm run test:amazon-environment
```

---

## 11. First small Keepa run (only if Amazon is READY/PARTIAL)

Start with a tiny batch to confirm everything works end-to-end. The
`--preflight-amazon` flag re-checks Amazon and **stops automatically
without spending Keepa tokens** if Amazon is unusable.

```bash
npm run run:keepa-discovery -- --profile=balanced --limit=10 --preflight-amazon
```

Watch the summary at the end. You want to see ASIN-native candidates,
some passing Amazon source validation, and a CSV path + export batch id.

### 12. If the small run worked, run the standard batch

```bash
npm run run:keepa-discovery -- --profile=balanced --limit=25 --preflight-amazon
```

---

## 13. (Reference) profiles and other useful commands

- Compare discovery profiles (uses Keepa tokens for each):
  ```bash
  npm run calibrate:keepa-discovery -- --limit=10 --preflight-amazon
  ```
- A real eBay→Amazon QA batch (no Keepa):
  ```bash
  npm run run:real-qa -- --limit=10
  ```
- One-command production gate (env + Amazon):
  ```bash
  npm run preflight:production
  ```

---

## 14. How to view the output

- **`reports/` folder** (on the VM): human-readable run reports.
  ```bash
  ls -t reports | head
  cat reports/$(ls -t reports | head -1)
  ```
- **`exports/` folder** (on the VM): the canonical CSV and manual-QA CSV.
  ```bash
  ls -t exports | head
  ```
  To download a file to your computer: in the SSH window's top-right menu
  choose **Download file** and enter the path, e.g.
  `OTTO-NEW/exports/otto-validated-....csv`.
- **Supabase dashboard** (in your browser): open your Supabase project,
  go to **Table editor**, and look at `validated_products` (newest rows),
  `export_batches`, and `amazon_environment_checks`.
- **OTTO dashboard**: run it wherever convenient (e.g. your local machine
  or Replit) pointed at the same Supabase project; new export batches
  appear on **Command Center**, **Validated Products** (filter by export
  batch), and **Export Center**. The latest Amazon check shows on
  **Discovery Agents**.

---

## 15. How to stop a stuck or long-running job

- In the SSH window, press **Ctrl+C**. This stops the current command
  safely. Partial work already written to Supabase is harmless — OTTO does
  not upload or list anything anywhere.
- If a browser process seems stuck, you can also close it:
  ```bash
  pkill -f chromium || true
  ```
- To stop spending Keepa tokens: simply don't run the
  `run:keepa-discovery` / `calibrate:keepa-discovery` commands. The
  `--preflight-amazon` flag also stops automatically when Amazon is
  unusable.
- To disable all real external calls quickly: set `OTTO_MOCK_MODE=true` in
  `.env` (everything then runs on synthetic data and is marked synthetic).

---

## 16. How to update OTTO later

In the SSH window:

```bash
cd ~/OTTO-NEW
git pull
```

If `package.json` changed (the pull output mentions it), also run:

```bash
npm install
```

If Playwright was updated, refresh the browser:

```bash
npx playwright install chromium
```

Your `.env` is not touched by `git pull`.

---

## 17. How to avoid committing `.env`

- `.env` is already listed in the repo's `.gitignore`, so git ignores it.
- Never run `git add .env` or `git add -A` and then commit secrets. To
  check what git would commit:
  ```bash
  git status
  ```
  `.env` should **not** appear in the list. If you ever see it staged:
  ```bash
  git restore --staged .env
  ```
- Keep `chmod 600 .env` so only your user can read it.

---

## 18. (Later, optional) Schedule recurring runs with cron — DO NOT set up yet

Only do this **after** several successful manual runs and after confirming
Amazon stays READY/PARTIAL. Documented here for reference; **do not enable
it now.**

Example (would run a balanced batch daily at 09:00 VM time):

```bash
# Reference only — do not add yet.
# crontab -e
# 0 9 * * * cd ~/OTTO-NEW && /usr/bin/npm run run:keepa-discovery -- --profile=balanced --limit=25 --preflight-amazon >> ~/otto-cron.log 2>&1
```

Because the command includes `--preflight-amazon`, a scheduled run will
still refuse to spend Keepa tokens if Amazon ever becomes unusable.

> **Cost tip:** if you only run jobs occasionally, **stop** the VM when
> idle (Compute Engine → VM instances → ⋮ → **Stop**) so you don't pay for
> compute. Start it again before running. A cron schedule requires the VM
> to be running at the scheduled time.

---

## 19. Troubleshooting

**Amazon shows `UNUSABLE` with `ERR_CERT_AUTHORITY_INVALID` (TLS error):**
- This means something is intercepting HTTPS (common in sandboxes, not on
  a clean VM). On a normal GCE VM this should not happen.
- Confirm the VM has normal internet: `curl -I https://www.amazon.com`
  should return HTTP headers (e.g. `HTTP/2 200` or `503`), not a
  certificate error.
- Do **not** set `AMAZON_IGNORE_HTTPS_ERRORS=true` to "fix" it — that
  hides real problems. If a clean VM still shows this, your network is
  being intercepted; use a different network/VM.

**Amazon shows `BLOCKED` (captcha / robot wall):**
- The VM's IP is being challenged by Amazon. Add a **residential proxy**:
  set `AMAZON_PROXY_SERVER`, `AMAZON_PROXY_USERNAME`, `AMAZON_PROXY_PASSWORD`
  in `.env`, then:
  ```bash
  npm run test:amazon-environment -- --proxy
  ```
- Save evidence for debugging (no secrets saved):
  ```bash
  npm run test:amazon-environment -- --asin=B0DZC7TZNL --debug
  ```
  Diagnostics are written under `reports/amazon-env-diagnostics/`.
- Don't run Keepa discovery until it reports READY/PARTIAL.

**Amazon shows `TIMEOUT`:**
- Often a slow proxy or throttled IP. Try a faster/residential proxy and
  re-test. See `AMAZON_ACCESS_RUNBOOK.md` for details.

**Playwright install errors (`browserType.launch` / missing libraries):**
- Re-run with deps: `npx playwright install --with-deps chromium`.
- Make sure the §4c library block ran without errors.

**"Missing env vars" / `check:env` failures:**
- Run `npm run check:env` to see which variable is missing (names only,
  no secret values are printed). Edit `.env` (`nano .env`) and re-save.

**Supabase connection errors:**
- Verify `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are correct and
  have no trailing spaces/newlines in `.env`.
- Check the VM has internet: `curl -I $SUPABASE_URL` (after
  `set -a; source .env; set +a`).

**eBay credential errors:**
- Confirm `EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET` are the **production**
  keys and `EBAY_ENV=production`.
- `npm run doctor:runtime` shows `eBay API (live token+search): OK/FAIL`.

**Keepa token issues:**
- If a run reports `KEEPA_PLAN_LIMITATION` or `KEEPA_ENDPOINT_UNAVAILABLE`,
  the Keepa account/plan doesn't allow the Product Finder endpoint — OTTO
  will say so and produce **zero** candidates rather than faking any.
- If you run out of tokens, wait for Keepa's token refill or reduce
  `--limit`. OTTO prints tokens consumed/left after each run.

---

## 20. Final checklist

Tick these off in order:

- [ ] `git branch --show-current` prints `claude/keen-meitner-FT8xt`
- [ ] `npm install` and `npx playwright install --with-deps chromium`
      completed without errors
- [ ] `.env` created, `chmod 600 .env`, and **not** shown by `git status`
- [ ] `npm run doctor:runtime` shows Supabase OK, eBay OK, Keepa key
      present
- [ ] **Amazon environment is `READY` or `PARTIAL`** (if `BLOCKED`/
      `UNUSABLE`, stop — do not run Keepa)
- [ ] Small run completed:
      `npm run run:keepa-discovery -- --profile=balanced --limit=10 --preflight-amazon`
- [ ] Standard run completed:
      `... --limit=25 --preflight-amazon`
- [ ] Exported products appear in Supabase `validated_products`
      (newest rows) and `export_batches`
- [ ] OTTO dashboard shows the new export batch (Command Center /
      Validated Products / Export Center)
- [ ] (Optional) VM **stopped** when idle to save cost

---

**Reminders:** Do not run Keepa discovery while Amazon is `UNUSABLE` or
`BLOCKED`. Do not commit `.env`. Keep `AMAZON_IGNORE_HTTPS_ERRORS=false`.
Validation gates, Amazon validation, and RLS are unchanged by this guide.
