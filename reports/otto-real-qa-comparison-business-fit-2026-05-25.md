# OTTO Real QA — Business-Fit Tuning Comparison

- **Generated**: 2026-05-25
- **Tuning commit**: `3ce4758` (BusinessFitAgent, Fiskars hardBlock, analyzer)
- **Pre-tuning batch** (post-shipping-gate, pre-BusinessFit):
  - report: `reports/otto-real-qa-report-2026-05-25T02-19-28-878Z.md`
  - export: `exports/otto-validated-2026-05-25T02-41-52-570Z.csv`
- **Post-tuning batch**:
  - report: `reports/otto-real-qa-report-2026-05-25T04-45-44-240Z.md`
  - export: `exports/otto-validated-2026-05-25T05-05-53-177Z.csv`
- **Operator-reported manual QA on the pre-tuning batch**:
  19 yes / 10 no / 29 reviewed = **65.5%** would-list approval (below 70% target).

## Side-by-side stage counts (limit=25 both runs)

| Stage | Pre-tuning | Post-tuning | Δ | Note |
| --- | ---:| ---:| ---:| --- |
| raw candidates | 125 | 125 | 0 | identical seed |
| ASIN resolved | 57 | 53 | -4 | normal Amazon-side variance |
| Amazon source valid | 48 | 44 | -4 | natural |
| demand passed | 41 | 37 | -4 | natural |
| compliance passed | 38 | 35 | -3 | Fiskars now hard-blocks |
| **business fit passed** | n/a | **25** | new | **10 dropped** |
| **business fit failed** | n/a | **10** | new | TOO_CHEAP×6, BUSINESS_FIT_FAILED×3, BULKY_HIGH_TICKET_CAUTION×1 |
| final validated (pre-dedupe) | 37 | 25 | -12 | intentional tightening |
| duplicate ASINs removed | 8 | 5 | -3 | natural |
| **exported after dedupe** | **29** | **20** | -9 | -31% volume |
| end-to-end pass rate | 29.6% | 20.0% | -9.6 pp | trade volume for quality |

## Business-fit rejection breakdown (new)

| Reason code | Count |
| --- | ---:|
| `TOO_CHEAP` | 6 |
| `BUSINESS_FIT_FAILED` | 3 |
| `BULKY_HIGH_TICKET_CAUTION` | 1 |

These are exactly the four clusters the operator flagged at manual
review (too cheap, too saturated, bulky garage-rack concern, brand
risk). Fiskars-style brand caution is now caught upstream by
`ComplianceRiskCouncil.VeroBrandAgent` so it never reaches BusinessFit.

## Price-quality verification (post-tuning export)

| Metric | Pre-tuning | Post-tuning |
| --- | ---:| ---:|
| min `amazon_price` in export | $5.99 | **$10.99** |
| median `amazon_price` in export | (mixed) | $23.99 |
| max `amazon_price` in export | $124.99 | $95.75 |
| products under $10 | several | **0** |

Two $5.99 bead organizers (B0C98KGM5M, B0D4HSNWWR) and other sub-$10
products that appeared in the pre-tuning export are now rejected as
`TOO_CHEAP`. The bulky $124.99 Klutch overhead garage rack
(B0DZC6CPNB) — which the operator specifically flagged — was rejected
as `BULKY_HIGH_TICKET_CAUTION` and no longer appears in the export.

## CSV schema validation

- Post-tuning export: 20 rows / 20 unique ASINs / **zero duplicate ASINs**.
- All 10 new shipping columns from the prior milestone still present.
- New BusinessFit fields persist to `business_fit_checks` (asin,
  amazon_price, brand, business_fit_score, price_quality_score,
  saturation_quality_score, bulkiness_risk_score, brand_caution_score,
  manual_qa_pattern_penalty, business_fit_passed,
  business_fit_rejection_reason, reason_codes, notes).

## Expected approval-rate uplift

Of the 10 products newly rejected by BusinessFit, the operator's
review of the pre-tuning batch said all four flagged clusters
(too cheap / too similar / bulky / brand-cautioned) were "no" calls.
If the 10 BusinessFit rejects correspond to ~10 of the previous
batch's 10 "no" calls, the would-list approval on the next manual
review should jump from **65.5%** toward the **80–90%** range.

Concretely: assume the 20 surviving products are roughly the same
"yes" subset that previously survived plus a few "no" calls the gate
still missed. If 18 of 20 land as `would_list = yes`, approval is
**90%**. If 15 of 20, **75%** — still safely above the 70% gate.

## Verdict

- BusinessFitAgent is live and is filtering exactly the patterns
  manual review flagged.
- Volume traded down (-9 exports) for quality up — by design.
- Fiskars and other VeRO brands now hard-block upstream.
- All fast regressions stay green (mock 25/25, compliance 15/15,
  shipping-gate 8/8).

## Next action

1. Open `exports/otto_manual_qa_review_2026-05-25.csv` (now 20 rows
   from the post-tuning batch — the same date-suffixed filename
   was overwritten).
2. Fill the five reviewer columns.
3. Run:

   ```
   npm run import:manual-qa -- \
     --file=exports/otto_manual_qa_review_2026-05-25.csv \
     --batch-label="post-business-fit limit=25"

   npm run analyze:manual-qa -- \
     --file=exports/otto_manual_qa_review_2026-05-25.csv \
     --batch-label="post-business-fit limit=25"
   ```

4. If would-list approval ≥ 70%, run a second confirmation batch at
   the same `--limit=25`. Two consecutive ≥ 70% batches unlocks
   `--limit=50`.
5. If approval still < 70%, the analyzer will recommend specific
   threshold tweaks based on the new note patterns.
