import { useMemo, useState } from 'react';
import { Layout } from '@/components/Layout';
import { Card, CardBody, CardHeader, CardSubtitle, CardTitle } from '@/components/ui/Card';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Badge } from '@/components/ui/Badge';
import { Scorecard } from '@/components/Scorecard';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { useManualQaReviews } from '@/lib/queries';
import { fmtMoney, fmtNum, fmtPct } from '@/lib/utils';
import type { ManualQaReview } from '@/lib/types';

export function ManualQA() {
  const { data, isLoading, error } = useManualQaReviews(1000);

  const batches = useMemo(() => {
    const out = new Set<string>();
    for (const r of data ?? []) if (r.batch_label) out.add(r.batch_label);
    return Array.from(out).sort();
  }, [data]);
  const latestBatch = batches[batches.length - 1] ?? '';
  const [selectedBatch, setSelectedBatch] = useState('');

  const activeBatch = selectedBatch || latestBatch;
  const rows = useMemo(() => (data ?? []).filter((r) => !activeBatch || r.batch_label === activeBatch), [data, activeBatch]);

  const stats = useMemo(() => {
    let yes = 0, no = 0, blank = 0, asinYes = 0, asinRev = 0, demYes = 0, demRev = 0, lrYes = 0, lrRev = 0, notes = 0;
    for (const r of rows) {
      const wl = (r.would_list_yes_no ?? '').toLowerCase();
      if (wl === 'yes') yes++;
      else if (wl === 'no') no++;
      else blank++;
      const ar = (r.asin_real_yes_no ?? '').toLowerCase();
      if (ar === 'yes' || ar === 'no') { asinRev++; if (ar === 'yes') asinYes++; }
      const dm = (r.demand_makes_sense_yes_no ?? '').toLowerCase();
      if (dm === 'yes' || dm === 'no') { demRev++; if (dm === 'yes') demYes++; }
      const lr = (r.low_risk_yes_no ?? '').toLowerCase();
      if (lr === 'yes' || lr === 'no') { lrRev++; if (lr === 'yes') lrYes++; }
      if ((r.notes ?? '').trim().length > 0) notes++;
    }
    const reviewed = yes + no;
    const approval = reviewed === 0 ? null : (yes / reviewed) * 100;
    return {
      total: rows.length,
      reviewed,
      yes,
      no,
      blank,
      approval,
      asinRealYesRate: asinRev === 0 ? null : (asinYes / asinRev) * 100,
      demandYesRate: demRev === 0 ? null : (demYes / demRev) * 100,
      lowRiskYesRate: lrRev === 0 ? null : (lrYes / lrRev) * 100,
      notesCount: notes,
    };
  }, [rows]);

  const columns: DataColumn<ManualQaReview>[] = [
    {
      key: 'asin',
      header: 'ASIN',
      sortable: true,
      sortValue: (r) => r.asin ?? '',
      cell: (r) => <code className="text-xs font-mono">{r.asin ?? '—'}</code>,
    },
    {
      key: 'title',
      header: 'Title',
      sortable: true,
      sortValue: (r) => r.product_title ?? '',
      cell: (r) => <span className="truncate max-w-[44ch] inline-block" title={r.product_title ?? ''}>{r.product_title ?? '—'}</span>,
      width: '32%',
    },
    { key: 'brand', header: 'Brand', sortable: true, sortValue: (r) => r.brand ?? '', cell: (r) => <span className="text-muted">{r.brand ?? '—'}</span> },
    { key: 'price', header: 'Price', sortable: true, sortValue: (r) => r.amazon_price ?? null, cell: (r) => fmtMoney(r.amazon_price), className: 'text-right tabular-nums' },
    { key: 'conf', header: '30d conf', sortable: true, sortValue: (r) => r.sell_within_30_days_confidence ?? null, cell: (r) => fmtNum(r.sell_within_30_days_confidence), className: 'text-right tabular-nums' },
    { key: 'final', header: 'Final', sortable: true, sortValue: (r) => r.final_validation_score ?? null, cell: (r) => fmtNum(r.final_validation_score), className: 'text-right tabular-nums' },
    {
      key: 'verdicts',
      header: 'Reviewer answers',
      cell: (r) => (
        <div className="flex flex-wrap gap-1">
          {answerBadge('would_list', r.would_list_yes_no)}
          {answerBadge('asin_real', r.asin_real_yes_no)}
          {answerBadge('demand', r.demand_makes_sense_yes_no)}
          {answerBadge('low_risk', r.low_risk_yes_no)}
        </div>
      ),
    },
    {
      key: 'notes',
      header: 'Notes',
      cell: (r) => <span className="text-muted text-xs italic truncate max-w-[40ch] inline-block">{r.notes ?? ''}</span>,
      width: '24%',
    },
  ];

  return (
    <Layout title="Manual QA" subtitle="Operator reviewer answers grouped by batch.">
      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState error={error} />
      ) : !data || data.length === 0 ? (
        <EmptyState>No manual QA reviews imported yet. Use <code className="font-mono">npm run import:manual-qa</code> to load a CSV.</EmptyState>
      ) : (
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Batch</CardTitle>
              <CardSubtitle>{batches.length} distinct batches; defaulting to the most recent.</CardSubtitle>
            </CardHeader>
            <CardBody>
              <div className="flex flex-wrap gap-2">
                {[''].concat(batches).map((b) => (
                  <button
                    key={b || 'latest'}
                    onClick={() => setSelectedBatch(b)}
                    className={
                      'rounded border px-2.5 py-1 text-xs transition ' +
                      ((b === '' && selectedBatch === '') || selectedBatch === b
                        ? 'border-brand text-brand bg-brand/10'
                        : 'border-border text-muted hover:text-text hover:bg-panel2')
                    }
                  >
                    {b || `latest (${latestBatch || '—'})`}
                  </button>
                ))}
              </div>
            </CardBody>
          </Card>

          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-5 gap-3">
            <Scorecard label="Reviewed" value={fmtNum(stats.reviewed)} hint={`${stats.blank} blank · ${stats.total} total`} />
            <Scorecard label="Would-list yes" value={fmtNum(stats.yes)} tone="good" />
            <Scorecard label="Would-list no" value={fmtNum(stats.no)} tone={stats.no > 0 ? 'bad' : 'default'} />
            <Scorecard
              label="Approval rate"
              value={stats.approval === null ? '—' : fmtPct(stats.approval)}
              tone={stats.approval === null ? 'default' : stats.approval >= 70 ? 'good' : 'warn'}
              hint={
                stats.approval === null
                  ? 'No would_list answers'
                  : stats.approval >= 70
                  ? 'PASS — safe to scale'
                  : 'HOLD — do not scale yet'
              }
            />
            <Scorecard label="ASIN-real yes rate" value={stats.asinRealYesRate === null ? '—' : fmtPct(stats.asinRealYesRate)} />
            <Scorecard label="Demand-makes-sense yes rate" value={stats.demandYesRate === null ? '—' : fmtPct(stats.demandYesRate)} />
            <Scorecard label="Low-risk yes rate" value={stats.lowRiskYesRate === null ? '—' : fmtPct(stats.lowRiskYesRate)} />
            <Scorecard label="Reviewer notes" value={fmtNum(stats.notesCount)} hint="products with non-empty notes" />
          </div>

          <DataTable
            rows={rows}
            columns={columns}
            searchKeys={['asin' as const, 'product_title' as const, 'brand' as const, 'notes' as const]}
            searchPlaceholder="Search ASIN / title / brand / notes..."
            initialSort={{ key: 'final', ascending: false }}
          />
        </div>
      )}
    </Layout>
  );
}

function answerBadge(label: string, value: string | null): React.ReactNode {
  const v = (value ?? '').toLowerCase();
  if (v === 'yes') return <Badge key={label} tone="good">{label}: yes</Badge>;
  if (v === 'no') return <Badge key={label} tone="bad">{label}: no</Badge>;
  return <Badge key={label} tone="muted">{label}: —</Badge>;
}
