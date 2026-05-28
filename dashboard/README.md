# OTTO Dashboard (internal)

Read-only operations dashboard for the OTTO V1 product engine.  Connects
directly to the OTTO Supabase project and surfaces every signal the
pipeline writes.

## Stack

- Vite + React 18 + TypeScript
- Tailwind CSS (dark theme)
- TanStack Query
- Recharts
- Supabase JS client
- A small Tailwind UI kit inline in `src/components/ui` (Card / Button /
  Badge / Input / DataTable) - shadcn-flavored without the CLI step.

## Quick start

```bash
cd dashboard
cp .env.example .env             # fill in VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
npm install
npm run dev                      # http://localhost:5173
```

For offline UI preview without Supabase:

```bash
VITE_MOCK_DASHBOARD=true npm run dev
```

## Replit

The Vite dev server already binds to `0.0.0.0:5173`. On Replit just run
`npm run dev` from the `dashboard/` directory; the workspace will
expose it on your `*.replit.dev` host.

## Pages

| Route | Page | What it shows |
| --- | --- | --- |
| `/` | Command Center | Latest run scorecards (exported, pass rate, manual QA approval, dupes, shipping review, top rejection reason), stage counts, CSV paths. |
| `/funnel` | Pipeline Funnel | Bar chart + stage-to-stage pass rate table for the latest run. |
| `/validated` | Validated Products | Searchable / filterable table of `validated_products` joined with `amazon_source_checks` + `business_fit_checks`.  Filters: price range, delivery, sell confidence, policy risk, business fit, competition, final score, brand, shipping-review-only. |
| `/rejected` | Rejected Products | `rejected_products` + reason-count bar chart (top 15). |
| `/competition` | Competition Review | Products flagged with HIGH_DUPLICATE_MARKET / HIGH_SELLER_COMPETITION / LOW_DIFFERENTIATION / SATURATED_GENERIC_PRODUCT / etc., with full competition scores. |
| `/shipping` | Shipping Review | `amazon_source_checks` with `shipping_review_required=true`, `prime_likely_pass`, or near-window delivery. Surfaces all Prime / FBA / ships-from-amazon signals. |
| `/exports` | Export Center | `export_batches` with pre-dedupe, same-batch dupes, cross-batch repeats removed, exported-after-all-filters counts, repeat policy/lookback, and copy-able CSV + manual QA paths. |
| `/exclusions` | Export Exclusions | `export_exclusions` - ASINs skipped by the cross-batch repeat filter (PREVIOUSLY_EXPORTED_ASIN / PREVIOUSLY_EXPORTED_RECENTLY), with prior batch + prior export date. |
| `/manual-qa` | Manual QA | `manual_qa_reviews` grouped by `batch_label`. Approval rate, asin-real / demand / low-risk rates, PASS / HOLD verdict. |
| `/agent-logs` | Agent Logs | `agent_logs` + `agent_votes` tabbed view with agent / product / level filters. |
| `/discovery-agents` | Discovery Agents | Static manifest of every planned discovery agent + its implementation status (real / partial / placeholder). |

## Security

- **No login / auth.** Internal dashboard only. Run locally or behind
  the Replit workspace gate.
- **No service-role key in the browser.** Only the anon key is read
  from `.env`. For non-localhost deployment, you need RLS policies on
  the OTTO tables (currently RLS is disabled — see the operator
  advisory in the main repo).
- **No fake data unless `VITE_MOCK_DASHBOARD=true`.** Production runs
  always query Supabase.

## Build

```bash
npm run build       # type-check + Vite build into dist/
npm run preview     # serve the built bundle on 0.0.0.0:5173
```
