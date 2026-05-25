# OTTO Real QA — Post-Shipping-Gate Comparison

- **Generated**: 2026-05-25
- **Shipping gate landed**: see commit `b9b9811` ("Trust Prime/FBA signals so slow guest delivery is not a false reject")
- **Pre-gate batch**:
  - command: `npm run run:real-qa -- --limit=25`
  - report: `reports/otto-real-qa-report-2026-05-24T20-19-59-529Z.md`
  - export: `exports/otto-validated-2026-05-24T20-41-18-980Z.csv`
- **Post-gate batches**:
  - smoke: `npm run run:real-qa -- --limit=10`
    - report: `reports/otto-real-qa-report-2026-05-25T02-09-31-128Z.md`
    - export: `exports/otto-validated-2026-05-25T02-19-10-033Z.csv`
  - main: `npm run run:real-qa -- --limit=25`
    - report: `reports/otto-real-qa-report-2026-05-25T02-19-28-878Z.md`
    - export: `exports/otto-validated-2026-05-25T02-41-52-570Z.csv`

## Side-by-side stage counts (limit=25 both times)

| Stage | Pre-gate (5-24) | Post-gate (5-25) | Δ |
| --- | ---:| ---:| ---:|
| raw candidates | 125 | 125 | 0 |
| ASIN resolved | 56 | 57 | +1 |
| ASIN failed | 69 | 68 | -1 |
| **Amazon source valid** | **46** | **48** | **+2** |
| Amazon source failed | 10 | 9 | -1 |
| demand passed | 38 | 41 | +3 |
| demand failed | 8 | 7 | -1 |
| compliance passed | 36 | 38 | +2 |
| compliance failed | 2 | 3 | +1 |
| final validated (before dedupe) | 34 | 37 | +3 |
| duplicate ASINs removed | 3 | 8 | +5 |
| **exported after dedupe** | **31** | **29** | **-2** |
| end-to-end pass rate (validated / raw) | 27.2% | 29.6% | +2.4 pp |

## Shipping-gate breakdown (new — post-gate batch)

| Outcome | Count |
| --- | ---:|
| `shipping pass` (clear & within window) | 47 |
| `prime_likely_pass` (Prime/FBA trusted) | 1 |
| `shipping_review_required = true` | 1 |
| rejected `DELIVERY_TOO_LONG` | 2 |
| rejected `DELIVERY_UNCLEAR` | 0 |

The pre-gate batch had `DELIVERY_TOO_LONG = 2`. Post-gate retains `2`,
and adds `1 prime_likely_pass` that the legacy gate would have hard-rejected.
Net: zero false rejects from the new behavior, and one rescue.

## Delivery-related comparison

| Metric | Pre-gate | Post-gate |
| --- | ---:| ---:|
| Amazon source valid | 46 | **48** |
| `DELIVERY_TOO_LONG` rejections | 2 | 2 |
| `DELIVERY_UNCLEAR` rejections | 0 | 0 |
| Products marked `prime_likely_pass` (advance with review) | n/a | 1 |
| Products marked `shipping_review_required = true` | n/a | 1 |
| Exported count | 31 | 29 |
| End-to-end pass rate | 27.2% | 29.6% |

Why exported is `-2` despite more source-valid: the dedupe step removed
8 duplicate ASINs this run vs 3 last run (natural variance in how many
keywords resolve to the same Amazon product). Pre-dedupe `final
validated` is up from **34 → 37** (+3), which is the apples-to-apples
quality measure. The export decrease is from dedupe doing more work,
not from quality regression.

## CSV schema validation

Both the canonical export CSV and the manual QA CSV include all 10
new shipping columns from the spec:

- `raw_delivery_text`
- `delivery_context`
- `prime_signal_detected`
- `prime_signal_source`
- `fba_signal_detected`
- `ships_from_amazon`
- `sold_by_amazon`
- `fulfilled_by_amazon`
- `shipping_gate_result`
- `shipping_review_required`

## Duplicate-ASIN check

Canonical export (29 rows): **29 unique ASINs, zero duplicates** (`uniq -d`
returned empty).

## Prime / FBA signal capture (sample from limit=10 export)

| ASIN | gate | review | prime | fba | source |
| --- | --- | --- | --- | --- | --- |
| B0DZC6CPNB | pass | false | false | false | (none) |
| B0DTY91JWP | pass | false | true | false | prime_badge |
| B0F1YL7C2T | pass | false | true | false | prime_badge |
| B0C8N81CZY | pass | false | true | false | prime_badge |
| B0F42R9NYQ | pass | false | false | false | (none) |
| B08GCJ9LHB | pass | false | true | false | prime_badge |
| B0DS1QSHJL | pass | false | true | false | prime_badge |
| B0GHZNDHKP | pass | false | false | false | (none) |
| B0D2X29NGL | pass | false | **true** | **true** | **prime_badge,sold_by_amazon,fulfilled_by_amazon** |
| B0BCJQ31XZ | pass | false | false | false | (none) |
| B0B6RCKQBS | pass | false | true | false | prime_badge |
| B0FK3K1228 | pass | false | true | false | prime_badge |
| B0D6VS8BQT | pass | false | true | false | prime_badge |

**9 of 13 limit=10 exported products had a Prime badge visible**; one
(B0D2X29NGL — HOOPLE Kneeling Pad) had the full Sold-by-Amazon /
Fulfilled-by-Amazon stack. All 13 had clean enough guest delivery to
take the normal `gate=pass` path, so no `prime_likely_pass` rescues
were needed in this slice (downstream demand / compliance filters
removed any upstream prime_likely_pass candidates).

## Verdict

- Shipping gate is live and behaving as designed in real conditions.
- Source-valid count rose (+2) without any new false rejects.
- One product (`prime_likely_pass`) was rescued from a delivery-only
  rejection that the legacy gate would have hard-blocked.
- All 10 new shipping columns reach both CSVs.
- Dedupe still works (29 rows / 29 unique ASINs).
- All fast regressions still green (mock pipeline 25/25, compliance
  15/15, shipping-gate 8/8).

## Next action

Open `exports/otto_manual_qa_review_2026-05-25.csv` (29 rows from the
limit=25 batch — the smoke-batch CSV got overwritten because both
share the same date-suffixed filename), fill the five reviewer
columns, then run:

```
npm run import:manual-qa -- \
  --file=exports/otto_manual_qa_review_2026-05-25.csv \
  --batch-label="post-shipping-gate QA limit=25"
```

Two consecutive batches at limit=25 with >= 70% would-list approval
unlocks a raise to `--limit=50`.
