import { useMemo } from 'react';
import { ExternalLink } from 'lucide-react';
import { Layout } from '@/components/Layout';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Badge } from '@/components/ui/Badge';
import { CopyButton } from '@/components/CopyButton';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { useAmazonSourceChecks } from '@/lib/queries';
import { fmtNum } from '@/lib/utils';
import type { AmazonSourceCheck } from '@/lib/types';

const MAX_DELIVERY_DAYS = 10;

export function ShippingReview() {
  const { data, isLoading, error } = useAmazonSourceChecks(1000);

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.filter((r) => {
      if (r.shipping_review_required) return true;
      if (r.shipping_gate_result === 'prime_likely_pass') return true;
      const days = r.estimated_delivery_days ?? r.delivery_days ?? 0;
      if (days >= MAX_DELIVERY_DAYS - 1) return true;
      return false;
    });
  }, [data]);

  const columns: DataColumn<AmazonSourceCheck>[] = [
    {
      key: 'asin',
      header: 'ASIN',
      sortable: true,
      sortValue: (r) => r.asin ?? '',
      cell: (r) => (
        <div className="flex items-center gap-1.5">
          <code className="font-mono text-xs">{r.asin ?? '—'}</code>
          {r.asin && <CopyButton value={r.asin} />}
        </div>
      ),
    },
    {
      key: 'title',
      header: 'Title',
      cell: (r) => (
        <a
          href={r.amazon_url ?? '#'}
          target="_blank"
          rel="noreferrer"
          className="text-text hover:text-brand inline-flex items-center gap-1 truncate max-w-[44ch]"
          title={r.product_title ?? ''}
        >
          <span className="truncate">{r.product_title ?? '—'}</span>
          <ExternalLink className="h-3 w-3 shrink-0" />
        </a>
      ),
      width: '32%',
    },
    {
      key: 'delivery_days',
      header: 'Days',
      sortable: true,
      sortValue: (r) => r.estimated_delivery_days ?? r.delivery_days ?? null,
      cell: (r) => fmtNum(r.estimated_delivery_days ?? r.delivery_days),
      className: 'text-right tabular-nums',
    },
    {
      key: 'raw_delivery_text',
      header: 'Raw delivery text',
      cell: (r) => <span className="text-muted text-xs truncate max-w-[40ch] inline-block" title={r.raw_delivery_text ?? ''}>{r.raw_delivery_text ?? r.delivery_text ?? '—'}</span>,
      width: '28%',
    },
    {
      key: 'delivery_context',
      header: 'Context',
      cell: (r) => <Badge tone="muted">{r.delivery_context ?? '—'}</Badge>,
    },
    {
      key: 'prime',
      header: 'Prime',
      cell: (r) => (
        <div className="flex flex-wrap gap-1">
          {r.prime_signal_detected && <Badge tone="info">prime</Badge>}
          {r.fba_signal_detected && <Badge tone="info">fba</Badge>}
          {r.ships_from_amazon && <Badge tone="info">ships from amazon</Badge>}
          {r.sold_by_amazon && <Badge tone="info">sold by amazon</Badge>}
          {r.fulfilled_by_amazon && <Badge tone="info">fulfilled by amazon</Badge>}
          {!r.prime_signal_detected && !r.fba_signal_detected && <span className="text-muted text-xs">—</span>}
        </div>
      ),
    },
    {
      key: 'gate',
      header: 'Gate',
      cell: (r) => {
        const v = r.shipping_gate_result ?? 'unknown';
        const tone = v === 'pass' ? 'good' : v === 'prime_likely_pass' ? 'warn' : 'bad';
        return (
          <div className="flex items-center gap-1">
            <Badge tone={tone}>{v}</Badge>
            {r.shipping_review_required && <Badge tone="warn">review</Badge>}
          </div>
        );
      },
    },
  ];

  return (
    <Layout title="Shipping Review" subtitle="Products that need a manual shipping check (Prime-likely, near max delivery window, or flagged).">
      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState error={error} />
      ) : !data || filtered.length === 0 ? (
        <EmptyState>No products need shipping review right now.</EmptyState>
      ) : (
        <DataTable
          rows={filtered}
          columns={columns}
          searchKeys={['asin' as const, 'product_title' as const, 'brand' as const]}
          searchPlaceholder="Search ASIN / title / brand..."
          initialSort={{ key: 'delivery_days', ascending: false }}
        />
      )}
    </Layout>
  );
}
