import { Layout } from '@/components/Layout';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Badge } from '@/components/ui/Badge';
import { CopyButton } from '@/components/CopyButton';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { useExportExclusions } from '@/lib/queries';
import { fmtDate } from '@/lib/utils';
import type { ExportExclusion } from '@/lib/types';

const REASON_TONE: Record<string, 'bad' | 'warn' | 'muted'> = {
  PREVIOUSLY_EXPORTED_ASIN: 'bad',
  PREVIOUSLY_EXPORTED_RECENTLY: 'warn',
};

export function ExportExclusions() {
  const { data, isLoading, error } = useExportExclusions(1000);

  const columns: DataColumn<ExportExclusion>[] = [
    {
      key: 'asin',
      header: 'ASIN',
      sortable: true,
      sortValue: (r) => r.asin,
      cell: (r) => (
        <div className="flex items-center gap-1.5">
          <code className="text-xs font-mono">{r.asin}</code>
          <CopyButton value={r.asin} />
        </div>
      ),
    },
    {
      key: 'exclusion_reason',
      header: 'Reason',
      sortable: true,
      sortValue: (r) => r.exclusion_reason,
      cell: (r) => <Badge tone={REASON_TONE[r.exclusion_reason] ?? 'muted'}>{r.exclusion_reason}</Badge>,
    },
    {
      key: 'repeat_policy',
      header: 'Policy',
      sortable: true,
      sortValue: (r) => r.repeat_policy,
      cell: (r) => (
        <span className="text-xs text-muted">
          {r.repeat_policy}
          {r.repeat_policy === 'exclude_recent' && r.lookback_days != null ? ` (${r.lookback_days}d)` : ''}
        </span>
      ),
    },
    {
      key: 'prior_export_batch_id',
      header: 'Prior batch',
      cell: (r) => <code className="text-xs font-mono text-muted">{r.prior_export_batch_id?.slice(0, 8) ?? '—'}{r.prior_export_batch_id ? '…' : ''}</code>,
    },
    {
      key: 'prior_exported_at',
      header: 'Prior exported at',
      sortable: true,
      sortValue: (r) => (r.prior_exported_at ? new Date(r.prior_exported_at).getTime() : 0),
      cell: (r) => <span className="text-muted text-xs">{r.prior_exported_at ? fmtDate(r.prior_exported_at) : '—'}</span>,
    },
    {
      key: 'export_batch_id',
      header: 'Excluded in batch',
      cell: (r) => <code className="text-xs font-mono text-muted">{r.export_batch_id?.slice(0, 8) ?? '—'}{r.export_batch_id ? '…' : ''}</code>,
    },
    {
      key: 'created_at',
      header: 'When',
      sortable: true,
      sortValue: (r) => new Date(r.created_at).getTime(),
      cell: (r) => <span className="text-muted text-xs">{fmtDate(r.created_at)}</span>,
    },
  ];

  return (
    <Layout title="Export Exclusions" subtitle="ASINs skipped by the cross-batch repeat filter (already exported earlier).">
      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState error={error} />
      ) : !data || data.length === 0 ? (
        <EmptyState>No cross-batch exclusions recorded. Either no repeats occurred, or runs use --allow-repeats.</EmptyState>
      ) : (
        <DataTable
          rows={data}
          columns={columns}
          searchKeys={['asin' as const, 'exclusion_reason' as const, 'otto_product_id' as const]}
          searchPlaceholder="Search ASIN / reason / product..."
          initialSort={{ key: 'created_at', ascending: false }}
        />
      )}
    </Layout>
  );
}
