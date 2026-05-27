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
      key: 'removed',
      header: 'Dup removed',
      sortable: true,
      sortValue: (r) => r.duplicate_asins_removed,
      cell: (r) => fmtNum(r.duplicate_asins_removed),
      className: 'text-right tabular-nums',
    },
    {
      key: 'after',
      header: 'Exported',
      sortable: true,
      sortValue: (r) => r.final_exported_after_dedupe ?? r.row_count,
      cell: (r) => <span className="font-medium tabular-nums">{fmtNum(r.final_exported_after_dedupe ?? r.row_count)}</span>,
      className: 'text-right',
    },
    {
      key: 'status',
      header: 'Status',
      cell: (r) => <Badge tone={r.status === 'completed' ? 'good' : 'muted'}>{r.status}</Badge>,
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
