import { useMemo, useState } from 'react';
import { Layout } from '@/components/Layout';
import { Card, CardBody, CardHeader, CardSubtitle, CardTitle } from '@/components/ui/Card';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { useBusinessFitChecks } from '@/lib/queries';
import { fmtNum } from '@/lib/utils';
import type { BusinessFitCheck } from '@/lib/types';

const COMP_CODES = new Set([
  'HIGH_DUPLICATE_MARKET',
  'HIGH_SELLER_COMPETITION',
  'LOW_DIFFERENTIATION',
  'SATURATED_GENERIC_PRODUCT',
  'EXACT_MATCH_SATURATION',
  'PRICE_COMPRESSED_MARKET',
  'COMPETITION_GATE_FAILED',
  'TOO_MANY_SIMILAR_LISTINGS',
  'GENERIC_COMMODITY_MARKET',
]);

export function CompetitionReview() {
  const { data, isLoading, error } = useBusinessFitChecks(1000);
  const [filterGate, setFilterGate] = useState('');

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.filter((r) => {
      const codes = r.reason_codes ?? [];
      const hasCompCode =
        codes.some((c) => COMP_CODES.has(c)) ||
        r.competition_gate_result === 'saturated' ||
        r.competition_gate_result === 'borderline' ||
        r.competition_rejection_reason !== null;
      if (!hasCompCode) return false;
      if (filterGate && r.competition_gate_result !== filterGate) return false;
      return true;
    });
  }, [data, filterGate]);

  const columns: DataColumn<BusinessFitCheck>[] = [
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
      cell: (r) => <span className="truncate max-w-[40ch] inline-block" title={r.product_title ?? ''}>{r.product_title ?? '—'}</span>,
      width: '36%',
    },
    {
      key: 'gate',
      header: 'Gate',
      sortable: true,
      sortValue: (r) => r.competition_gate_result ?? '',
      cell: (r) => {
        const v = r.competition_gate_result ?? 'unknown';
        const tone = v === 'healthy' ? 'good' : v === 'borderline' ? 'warn' : v === 'saturated' ? 'bad' : 'muted';
        return <Badge tone={tone}>{v}</Badge>;
      },
    },
    { key: 'cq', header: 'CQ score', sortable: true, sortValue: (r) => r.competition_quality_score ?? null, cell: (r) => fmtNum(r.competition_quality_score), className: 'text-right tabular-nums' },
    { key: 'dup', header: 'Dup ratio', sortable: true, sortValue: (r) => r.duplicate_ratio ?? null, cell: (r) => fmtNum(r.duplicate_ratio), className: 'text-right tabular-nums' },
    { key: 'sellers', header: 'Sellers', sortable: true, sortValue: (r) => r.seller_count ?? null, cell: (r) => fmtNum(r.seller_count), className: 'text-right tabular-nums' },
    { key: 'exact', header: 'Exact', sortable: true, sortValue: (r) => r.exact_or_similar_match_count ?? null, cell: (r) => fmtNum(r.exact_or_similar_match_count), className: 'text-right tabular-nums' },
    { key: 'price_comp', header: 'Price comp', sortable: true, sortValue: (r) => r.price_compression_score ?? null, cell: (r) => fmtNum(r.price_compression_score), className: 'text-right tabular-nums' },
    {
      key: 'codes',
      header: 'Reason codes',
      cell: (r) => (
        <div className="flex flex-wrap gap-1">
          {(r.reason_codes ?? []).filter((c) => COMP_CODES.has(c)).map((c) => (
            <Badge key={c} tone="bad">{c}</Badge>
          ))}
        </div>
      ),
      width: '24%',
    },
  ];

  return (
    <Layout title="Competition Review" subtitle="Products flagged by the V1.4 competition gate.">
      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState error={error} />
      ) : !data || filtered.length === 0 ? (
        <EmptyState>No competition-flagged products yet.</EmptyState>
      ) : (
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Filter</CardTitle>
              <CardSubtitle>Filter by competition gate verdict.</CardSubtitle>
            </CardHeader>
            <CardBody>
              <div className="flex items-center gap-2">
                <Input value={filterGate} onChange={(e) => setFilterGate(e.target.value)} placeholder="gate (healthy / borderline / saturated)" className="max-w-xs" />
                <button className="text-xs text-muted hover:text-text underline" onClick={() => setFilterGate('')}>clear</button>
              </div>
            </CardBody>
          </Card>
          <DataTable
            rows={filtered}
            columns={columns}
            searchKeys={['asin' as const, 'product_title' as const, 'brand' as const]}
            searchPlaceholder="Search ASIN / title / brand..."
            initialSort={{ key: 'cq', ascending: true }}
          />
        </div>
      )}
    </Layout>
  );
}
