import { Layout } from '@/components/Layout';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { CopyButton } from '@/components/CopyButton';
import { Badge } from '@/components/ui/Badge';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { useExportBatches } from '@/lib/queries';
import { fmtDate, fmtNum } from '@/lib/utils';
import type { ExportBatch } from '@/lib/types';

function deriveQaPath(csvPath: string | null): string | null {
  if (!csvPath) return null;
  const m = csvPath.match(/otto-validated-(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return `exports/otto_manual_qa_review_${m[1]}-${m[2]}-${m[3]}.csv`;
}

export function ExportCenter() {
  const { data, isLoading, error } = useExportBatches(100);

  const columns: DataColumn<ExportBatch>[] = [
    {
      key: 'id',
      header: 'export_batch_id',
      sortable: true,
      sortValue: (r) => r.id,
      cell: (r) => <code className="text-xs font-mono">{r.id.slice(0, 8)}…</code>,
    },
    {
      key: 'discovery_run_id',
      header: 'discovery_run_id',
      cell: (r) => <code className="text-xs font-mono text-muted">{r.discovery_run_id?.slice(0, 8) ?? '—'}{r.discovery_run_id ? '…' : ''}</code>,
    },
    {
      key: 'created_at',
      header: 'Created',
      sortable: true,
      sortValue: (r) => new Date(r.created_at).getTime(),
      cell: (r) => <span className="text-muted text-xs">{fmtDate(r.created_at)}</span>,
    },
    {
      key: 'before',
      header: 'Pre-dedupe',
      sortable: true,
      sortValue: (r) => r.final_validated_before_dedupe,
      cell: (r) => fmtNum(r.final_validated_before_dedupe),
      className: 'text-right tabular-nums',
    },
    {
      key: 'same_batch',
      header: 'Same-batch dups',
      sortable: true,
      sortValue: (r) => r.same_batch_duplicates_removed ?? r.duplicate_asins_removed,
      cell: (r) => fmtNum(r.same_batch_duplicates_removed ?? r.duplicate_asins_removed),
      className: 'text-right tabular-nums',
    },
    {
      key: 'cross_batch',
      header: 'Cross-batch repeats',
      sortable: true,
      sortValue: (r) => r.cross_batch_repeats_removed ?? 0,
      cell: (r) => {
        const n = r.cross_batch_repeats_removed ?? 0;
        return <span className={n > 0 ? 'text-warn tabular-nums' : 'tabular-nums'}>{fmtNum(n)}</span>;
      },
      className: 'text-right',
    },
    {
      key: 'after',
      header: 'After all filters',
      sortable: true,
      sortValue: (r) => r.exported_after_all_filters ?? r.final_exported_after_dedupe ?? r.row_count,
      cell: (r) => <span className="font-medium tabular-nums">{fmtNum(r.exported_after_all_filters ?? r.final_exported_after_dedupe ?? r.row_count)}</span>,
      className: 'text-right',
    },
    {
      key: 'repeat_policy',
      header: 'Repeat policy',
      sortable: true,
      sortValue: (r) => r.repeat_policy ?? '',
      cell: (r) => {
        if (!r.repeat_policy) return <span className="text-muted">—</span>;
        const lookback = r.repeat_policy === 'exclude_recent' && r.repeat_lookback_days != null
          ? ` (${r.repeat_lookback_days}d)`
          : '';
        return <span className="text-xs text-muted">{r.repeat_policy}{lookback}</span>;
      },
    },
    {
      key: 'status',
      header: 'Status',
      cell: (r) => (
        <div className="flex items-center gap-1">
          <Badge tone={r.status === 'completed' ? 'good' : 'muted'}>{r.status}</Badge>
          {r.is_synthetic && <Badge tone="muted">synthetic</Badge>}
        </div>
      ),
    },
    {
      key: 'paths',
      header: 'Paths',
      cell: (r) => {
        const qa = deriveQaPath(r.file_path);
        return (
          <div className="flex flex-col gap-1 text-xs">
            <div className="flex items-center gap-1.5">
              <code className="font-mono truncate max-w-[40ch]" title={r.file_path}>{r.file_path}</code>
              <CopyButton value={r.file_path} label="csv" />
            </div>
            {qa && (
              <div className="flex items-center gap-1.5">
                <code className="font-mono truncate max-w-[40ch] text-muted" title={qa}>{qa}</code>
                <CopyButton value={qa} label="qa" />
              </div>
            )}
          </div>
        );
      },
      width: '40%',
    },
  ];

  return (
    <Layout title="Export Center" subtitle="Every CSV export batch with pre/post-dedupe counts and file paths.">
      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState error={error} />
      ) : !data || data.length === 0 ? (
        <EmptyState>No export batches recorded yet.</EmptyState>
      ) : (
        <DataTable
          rows={data}
          columns={columns}
          searchKeys={['id' as const, 'discovery_run_id' as const, 'file_path' as const]}
          searchPlaceholder="Search batch / run / path..."
          initialSort={{ key: 'created_at', ascending: false }}
        />
      )}
    </Layout>
  );
}
