import { useMemo, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Layout } from '@/components/Layout';
import { Card, CardBody, CardHeader, CardSubtitle, CardTitle } from '@/components/ui/Card';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { CopyButton } from '@/components/CopyButton';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import {
  useAmazonSourceChecks,
  useBusinessFitChecks,
  useValidatedProducts,
  useValidatedProductBatches,
} from '@/lib/queries';
import { fmtDate, fmtMoney, fmtNum } from '@/lib/utils';
import type { AmazonSourceCheck, BusinessFitCheck, ValidatedProduct } from '@/lib/types';

type MergedRow = ValidatedProduct;

export function ValidatedProducts() {
  const [selectedBatch, setSelectedBatch] = useState<string>(''); // '' = latest
  const [showSynthetic, setShowSynthetic] = useState(false);

  const batches = useValidatedProductBatches(showSynthetic);
  // Latest batch = first entry (sorted by exported_at desc by the hook).
  const latestBatchId = batches.data?.[0]?.exportBatchId ?? null;
  const effectiveBatchId = selectedBatch || latestBatchId || undefined;

  const products = useValidatedProducts({
    exportBatchId: effectiveBatchId,
    includeSynthetic: showSynthetic,
  });
  const sourceChecks = useAmazonSourceChecks();
  const businessFit = useBusinessFitChecks();

  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [maxDelivery, setMaxDelivery] = useState('');
  const [minSell, setMinSell] = useState('');
  const [maxPolicy, setMaxPolicy] = useState('');
  const [minBusinessFit, setMinBusinessFit] = useState('');
  const [minCompetition, setMinCompetition] = useState('');
  const [minFinal, setMinFinal] = useState('');
  const [brand, setBrand] = useState('');
  const [reviewOnly, setReviewOnly] = useState(false);
  const [primeOnly, setPrimeOnly] = useState(false);

  // Prefer fields persisted on validated_products itself; fall back to
  // joined amazon_source_checks / business_fit_checks rows for older
  // products that pre-date V1.5 persistence.
  const merged: MergedRow[] = useMemo(() => {
    if (!products.data) return [];
    const sourceByAsin = new Map<string, AmazonSourceCheck>();
    for (const s of sourceChecks.data ?? []) if (s.asin) sourceByAsin.set(s.asin, s);
    const fitByAsin = new Map<string, BusinessFitCheck>();
    for (const f of businessFit.data ?? []) if (f.asin) fitByAsin.set(f.asin, f);
    return products.data.map((p) => ({
      ...p,
      raw_delivery_text: p.raw_delivery_text ?? sourceByAsin.get(p.asin)?.raw_delivery_text ?? null,
      shipping_gate_result: p.shipping_gate_result ?? sourceByAsin.get(p.asin)?.shipping_gate_result ?? null,
      shipping_review_required: p.shipping_review_required ?? sourceByAsin.get(p.asin)?.shipping_review_required ?? null,
      business_fit_score: p.business_fit_score ?? fitByAsin.get(p.asin)?.business_fit_score ?? null,
      competition_quality_score: p.competition_quality_score ?? fitByAsin.get(p.asin)?.competition_quality_score ?? null,
    }));
  }, [products.data, sourceChecks.data, businessFit.data]);

  const filtered = useMemo(() => {
    const minP = num(minPrice);
    const maxP = num(maxPrice);
    const maxD = num(maxDelivery);
    const minS = num(minSell);
    const maxPol = num(maxPolicy);
    const minBF = num(minBusinessFit);
    const minCQ = num(minCompetition);
    const minF = num(minFinal);
    const brandLc = brand.trim().toLowerCase();
    return merged.filter((r) => {
      if (minP !== null && (r.amazon_price ?? 0) < minP) return false;
      if (maxP !== null && (r.amazon_price ?? 0) > maxP) return false;
      if (maxD !== null && (r.delivery_days ?? 0) > maxD) return false;
      if (minS !== null && (r.sell_within_30_days_confidence ?? 0) < minS) return false;
      if (maxPol !== null && (r.policy_risk_score ?? 0) > maxPol) return false;
      if (minBF !== null && (r.business_fit_score ?? 0) < minBF) return false;
      if (minCQ !== null && (r.competition_quality_score ?? 0) < minCQ) return false;
      if (minF !== null && (r.final_validation_score ?? 0) < minF) return false;
      if (brandLc && !(r.brand ?? '').toLowerCase().includes(brandLc)) return false;
      if (reviewOnly && !r.shipping_review_required) return false;
      return true;
    });
  }, [merged, minPrice, maxPrice, maxDelivery, minSell, maxPolicy, minBusinessFit, minCompetition, minFinal, brand, reviewOnly]);

  const columns: DataColumn<MergedRow>[] = [
    {
      key: 'asin',
      header: 'ASIN',
      sortable: true,
      sortValue: (r) => r.asin,
      cell: (r) => (
        <div className="flex items-center gap-1.5">
          <code className="font-mono text-xs">{r.asin}</code>
          <CopyButton value={r.asin} />
        </div>
      ),
    },
    {
      key: 'product_title',
      header: 'Title',
      sortable: true,
      sortValue: (r) => r.product_title,
      cell: (r) => (
        <a
          href={r.amazon_url}
          target="_blank"
          rel="noreferrer"
          className="text-text hover:text-brand inline-flex items-center gap-1 max-w-[44ch] truncate"
          title={r.product_title}
        >
          <span className="truncate">{r.product_title}</span>
          <ExternalLink className="h-3 w-3 shrink-0" />
        </a>
      ),
      width: '38%',
    },
    {
      key: 'brand',
      header: 'Brand',
      sortable: true,
      sortValue: (r) => r.brand ?? '',
      cell: (r) => <span className="text-muted">{r.brand ?? '—'}</span>,
    },
    { key: 'amazon_price', header: 'Price', sortable: true, sortValue: (r) => r.amazon_price, cell: (r) => fmtMoney(r.amazon_price), className: 'text-right tabular-nums' },
    { key: 'delivery_days', header: 'Delivery', sortable: true, sortValue: (r) => r.delivery_days ?? null, cell: (r) => `${fmtNum(r.delivery_days)}d`, className: 'text-right tabular-nums' },
    {
      key: 'shipping_gate_result',
      header: 'Shipping',
      sortable: true,
      sortValue: (r) => r.shipping_gate_result ?? '',
      cell: (r) => {
        if (!r.shipping_gate_result) return <span className="text-muted">—</span>;
        const tone = r.shipping_gate_result === 'pass' ? 'good' : r.shipping_gate_result === 'prime_likely_pass' ? 'warn' : 'bad';
        return (
          <div className="flex items-center gap-1">
            <Badge tone={tone}>{r.shipping_gate_result}</Badge>
            {r.shipping_review_required && <Badge tone="warn">review</Badge>}
          </div>
        );
      },
    },
    { key: 'sell', header: '30d conf', sortable: true, sortValue: (r) => r.sell_within_30_days_confidence ?? null, cell: (r) => fmtNum(r.sell_within_30_days_confidence), className: 'text-right tabular-nums' },
    { key: 'stag', header: 'Stagnation', sortable: true, sortValue: (r) => r.stagnation_risk_score ?? null, cell: (r) => fmtNum(r.stagnation_risk_score), className: 'text-right tabular-nums' },
    { key: 'policy', header: 'Policy risk', sortable: true, sortValue: (r) => r.policy_risk_score ?? null, cell: (r) => fmtNum(r.policy_risk_score), className: 'text-right tabular-nums' },
    { key: 'bf', header: 'Business fit', sortable: true, sortValue: (r) => r.business_fit_score ?? null, cell: (r) => fmtNum(r.business_fit_score), className: 'text-right tabular-nums' },
    { key: 'cq', header: 'Competition', sortable: true, sortValue: (r) => r.competition_quality_score ?? null, cell: (r) => fmtNum(r.competition_quality_score), className: 'text-right tabular-nums' },
    { key: 'final', header: 'Final', sortable: true, sortValue: (r) => r.final_validation_score ?? null, cell: (r) => fmtNum(r.final_validation_score), className: 'text-right tabular-nums font-medium' },
    {
      key: 'actions',
      header: '',
      cell: (r) => (
        <div className="flex items-center gap-1">
          <CopyButton value={r.amazon_url} label="URL" />
        </div>
      ),
    },
  ];

  void primeOnly; // reserved filter for future when prime is on the merged row directly

  if (products.isLoading) return <Layout title="Validated Products"><LoadingState /></Layout>;
  if (products.error) return <Layout title="Validated Products"><ErrorState error={products.error} /></Layout>;

  const batchList = batches.data ?? [];
  const subtitle = effectiveBatchId
    ? `${filtered.length} of ${merged.length} validated products in batch ${effectiveBatchId.slice(0, 8)}…`
    : `${filtered.length} of ${merged.length} validated products`;

  return (
    <Layout title="Validated Products" subtitle={subtitle}>
      {batchList.length === 0 && merged.length === 0 ? (
        <EmptyState>
          No real validated products in the DB yet.  Run <code>npm run run:real-qa</code> to produce a real export,
          or <code>npm run backfill:exported-products -- --latest</code> to import an existing CSV.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Export batch</CardTitle>
              <CardSubtitle>
                {batchList.length} {batchList.length === 1 ? 'batch' : 'batches'} available.
                Defaulting to the most recent.
              </CardSubtitle>
            </CardHeader>
            <CardBody>
              <div className="flex flex-wrap gap-2 items-center">
                <button
                  key="latest"
                  onClick={() => setSelectedBatch('')}
                  className={
                    'rounded border px-2.5 py-1 text-xs transition ' +
                    (selectedBatch === ''
                      ? 'border-brand text-brand bg-brand/10'
                      : 'border-border text-muted hover:text-text hover:bg-panel2')
                  }
                >
                  latest{latestBatchId ? ` (${latestBatchId.slice(0, 8)}…)` : ''}
                </button>
                {batchList.map((b) => (
                  <button
                    key={b.exportBatchId}
                    onClick={() => setSelectedBatch(b.exportBatchId)}
                    className={
                      'rounded border px-2.5 py-1 text-xs transition ' +
                      (selectedBatch === b.exportBatchId
                        ? 'border-brand text-brand bg-brand/10'
                        : 'border-border text-muted hover:text-text hover:bg-panel2')
                    }
                    title={`${b.exportBatchId} — ${b.rowCount} rows — ${fmtDate(b.latestExportedAt)}`}
                  >
                    {b.exportBatchId.slice(0, 8)}… <span className="text-muted">({b.rowCount})</span>
                  </button>
                ))}
                <label className="flex items-center gap-2 text-xs text-muted ml-4">
                  <input
                    type="checkbox"
                    checked={showSynthetic}
                    onChange={(e) => {
                      setShowSynthetic(e.target.checked);
                      setSelectedBatch('');
                    }}
                  />
                  show synthetic / test rows
                </label>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Filters</CardTitle>
              <CardSubtitle>Stack any combination; values are inclusive bounds.</CardSubtitle>
            </CardHeader>
            <CardBody>
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                <Field label="Min price"><Input type="number" value={minPrice} onChange={(e) => setMinPrice(e.target.value)} placeholder="$" /></Field>
                <Field label="Max price"><Input type="number" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} placeholder="$" /></Field>
                <Field label="Max delivery days"><Input type="number" value={maxDelivery} onChange={(e) => setMaxDelivery(e.target.value)} placeholder="10" /></Field>
                <Field label="Min sell confidence"><Input type="number" value={minSell} onChange={(e) => setMinSell(e.target.value)} placeholder="70" /></Field>
                <Field label="Max policy risk"><Input type="number" value={maxPolicy} onChange={(e) => setMaxPolicy(e.target.value)} placeholder="35" /></Field>
                <Field label="Min business fit"><Input type="number" value={minBusinessFit} onChange={(e) => setMinBusinessFit(e.target.value)} placeholder="70" /></Field>
                <Field label="Min competition"><Input type="number" value={minCompetition} onChange={(e) => setMinCompetition(e.target.value)} placeholder="60" /></Field>
                <Field label="Min final score"><Input type="number" value={minFinal} onChange={(e) => setMinFinal(e.target.value)} placeholder="75" /></Field>
                <Field label="Brand contains"><Input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="" /></Field>
                <Field label="Shipping review only">
                  <label className="flex items-center gap-2 text-sm h-8">
                    <input type="checkbox" checked={reviewOnly} onChange={(e) => setReviewOnly(e.target.checked)} />
                    <span className="text-muted">show only review-required</span>
                  </label>
                </Field>
              </div>
            </CardBody>
          </Card>

          <DataTable
            rows={filtered}
            columns={columns}
            searchKeys={['asin' as const, 'product_title' as const, 'brand' as const]}
            searchPlaceholder="Search ASIN / title / brand..."
            initialSort={{ key: 'final', ascending: false }}
            emptyMessage="No products match the current filters."
          />
        </div>
      )}
    </Layout>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-wider text-muted">{label}</span>
      {children}
    </label>
  );
}

function num(s: string): number | null {
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
