import { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Layout } from '@/components/Layout';
import { Card, CardBody, CardHeader, CardSubtitle, CardTitle } from '@/components/ui/Card';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Badge } from '@/components/ui/Badge';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { useRejectedProducts } from '@/lib/queries';
import { fmtDate } from '@/lib/utils';
import type { RejectedProduct } from '@/lib/types';

interface ChartRow {
  reason: string;
  count: number;
}

export function RejectedProducts() {
  const { data, isLoading, error } = useRejectedProducts(1000);

  const chartRows: ChartRow[] = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of data ?? []) counts[r.reason] = (counts[r.reason] ?? 0) + 1;
    return Object.entries(counts)
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);
  }, [data]);

  const columns: DataColumn<RejectedProduct>[] = [
    {
      key: 'reason',
      header: 'Reason',
      sortable: true,
      sortValue: (r) => r.reason,
      cell: (r) => <Badge tone="bad">{r.reason}</Badge>,
    },
    {
      key: 'stage',
      header: 'Stage',
      sortable: true,
      sortValue: (r) => r.stage,
      cell: (r) => <span className="text-muted">{r.stage}</span>,
    },
    {
      key: 'otto_product_id',
      header: 'otto_product_id',
      cell: (r) => <code className="text-xs font-mono text-muted">{r.otto_product_id}</code>,
    },
    {
      key: 'details',
      header: 'Title / detail',
      cell: (r) => {
        const d = r.details ?? {};
        const title = (d.productTitleRaw ?? d.title ?? d.product_title ?? d.detail ?? '') as string;
        return <span className="text-muted text-xs truncate max-w-[44ch] inline-block">{title}</span>;
      },
      width: '40%',
    },
    {
      key: 'created_at',
      header: 'Created',
      sortable: true,
      sortValue: (r) => new Date(r.created_at).getTime(),
      cell: (r) => <span className="text-muted text-xs">{fmtDate(r.created_at)}</span>,
    },
  ];

  return (
    <Layout title="Rejected Products" subtitle="Per-stage rejection events from the latest batches.">
      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState error={error} />
      ) : !data || data.length === 0 ? (
        <EmptyState>No rejection events yet.</EmptyState>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle>Rejection counts by reason</CardTitle>
              <CardSubtitle>Top 15 reason codes across the last 1000 rejection events.</CardSubtitle>
            </CardHeader>
            <CardBody>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartRows} margin={{ left: 20, right: 20, top: 10, bottom: 80 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#232831" />
                    <XAxis dataKey="reason" stroke="#8b94a7" tick={{ fontSize: 10 }} angle={-30} height={90} textAnchor="end" interval={0} />
                    <YAxis stroke="#8b94a7" tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip contentStyle={{ background: '#13161b', border: '1px solid #232831', borderRadius: 6, fontSize: 12 }} cursor={{ fill: 'rgba(255,115,115,0.07)' }} />
                    <Bar dataKey="count" fill="#ff7373" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardBody>
          </Card>
          <div className="lg:col-span-3">
            <DataTable
              rows={data}
              columns={columns}
              searchKeys={['reason' as const, 'stage' as const, 'otto_product_id' as const]}
              searchPlaceholder="Search reason / stage / id..."
              initialSort={{ key: 'created_at', ascending: false }}
            />
          </div>
        </div>
      )}
    </Layout>
  );
}
