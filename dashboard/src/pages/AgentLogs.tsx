import { useMemo, useState } from 'react';
import { Layout } from '@/components/Layout';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Badge } from '@/components/ui/Badge';
import { Card, CardBody, CardHeader, CardSubtitle, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { useAgentLogs, useAgentVotes } from '@/lib/queries';
import { fmtDate } from '@/lib/utils';
import type { AgentLog, AgentVote } from '@/lib/types';

export function AgentLogs() {
  const logs = useAgentLogs(500);
  const votes = useAgentVotes(500);
  const [tab, setTab] = useState<'logs' | 'votes'>('logs');
  const [agentFilter, setAgentFilter] = useState('');
  const [productFilter, setProductFilter] = useState('');
  const [levelFilter, setLevelFilter] = useState('');

  const filteredLogs = useMemo(() => {
    return (logs.data ?? []).filter((r) => {
      if (agentFilter && !r.agent_name.toLowerCase().includes(agentFilter.toLowerCase())) return false;
      if (productFilter && !(r.otto_product_id ?? '').toLowerCase().includes(productFilter.toLowerCase())) return false;
      if (levelFilter && r.level !== levelFilter) return false;
      return true;
    });
  }, [logs.data, agentFilter, productFilter, levelFilter]);

  const filteredVotes = useMemo(() => {
    return (votes.data ?? []).filter((r) => {
      if (agentFilter && !r.agent_name.toLowerCase().includes(agentFilter.toLowerCase())) return false;
      if (productFilter && !r.otto_product_id.toLowerCase().includes(productFilter.toLowerCase())) return false;
      return true;
    });
  }, [votes.data, agentFilter, productFilter]);

  const logColumns: DataColumn<AgentLog>[] = [
    { key: 'created_at', header: 'When', sortable: true, sortValue: (r) => new Date(r.created_at).getTime(), cell: (r) => <span className="text-muted text-xs">{fmtDate(r.created_at)}</span> },
    { key: 'agent_name', header: 'Agent', sortable: true, sortValue: (r) => r.agent_name, cell: (r) => <code className="text-xs font-mono">{r.agent_name}</code> },
    {
      key: 'level',
      header: 'Level',
      sortable: true,
      sortValue: (r) => r.level,
      cell: (r) => {
        const tone = r.level === 'error' ? 'bad' : r.level === 'warn' ? 'warn' : 'muted';
        return <Badge tone={tone}>{r.level}</Badge>;
      },
    },
    {
      key: 'message',
      header: 'Message',
      cell: (r) => <span className="text-text text-xs">{r.message}</span>,
      width: '60%',
    },
    { key: 'otto_product_id', header: 'Product', cell: (r) => <code className="text-xs font-mono text-muted">{r.otto_product_id ?? '—'}</code> },
  ];

  const voteColumns: DataColumn<AgentVote>[] = [
    { key: 'created_at', header: 'When', sortable: true, sortValue: (r) => new Date(r.created_at).getTime(), cell: (r) => <span className="text-muted text-xs">{fmtDate(r.created_at)}</span> },
    { key: 'agent_name', header: 'Agent', sortable: true, sortValue: (r) => r.agent_name, cell: (r) => <code className="text-xs font-mono">{r.agent_name}</code> },
    {
      key: 'vote',
      header: 'Vote',
      sortable: true,
      sortValue: (r) => r.vote,
      cell: (r) => {
        const tone = r.vote === 'approve' ? 'good' : r.vote === 'reject' ? 'bad' : 'warn';
        return <Badge tone={tone}>{r.vote}</Badge>;
      },
    },
    { key: 'reason', header: 'Reason', cell: (r) => <span className="text-xs text-muted">{r.reason ?? '—'}</span>, width: '60%' },
    { key: 'otto_product_id', header: 'Product', cell: (r) => <code className="text-xs font-mono text-muted">{r.otto_product_id}</code> },
  ];

  return (
    <Layout title="Agent Logs" subtitle="Recent agent log entries and votes.">
      {logs.isLoading || votes.isLoading ? (
        <LoadingState />
      ) : logs.error ? (
        <ErrorState error={logs.error} />
      ) : votes.error ? (
        <ErrorState error={votes.error} />
      ) : !logs.data || logs.data.length === 0 ? (
        <EmptyState>No agent logs yet.</EmptyState>
      ) : (
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Filters</CardTitle>
              <CardSubtitle>Filter by agent name, product, or log level.</CardSubtitle>
            </CardHeader>
            <CardBody>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <label className="flex flex-col gap-1"><span className="text-[11px] uppercase text-muted">Agent contains</span><Input value={agentFilter} onChange={(e) => setAgentFilter(e.target.value)} /></label>
                <label className="flex flex-col gap-1"><span className="text-[11px] uppercase text-muted">Product id contains</span><Input value={productFilter} onChange={(e) => setProductFilter(e.target.value)} /></label>
                <label className="flex flex-col gap-1"><span className="text-[11px] uppercase text-muted">Level</span><Input value={levelFilter} onChange={(e) => setLevelFilter(e.target.value)} placeholder="info / warn / error" /></label>
                <div className="flex items-end">
                  <div className="inline-flex rounded-md border border-border overflow-hidden">
                    <button onClick={() => setTab('logs')} className={tab === 'logs' ? 'bg-panel2 text-text px-3 py-1.5 text-sm' : 'text-muted hover:text-text px-3 py-1.5 text-sm'}>Logs</button>
                    <button onClick={() => setTab('votes')} className={tab === 'votes' ? 'bg-panel2 text-text px-3 py-1.5 text-sm border-l border-border' : 'text-muted hover:text-text px-3 py-1.5 text-sm border-l border-border'}>Votes</button>
                  </div>
                </div>
              </div>
            </CardBody>
          </Card>

          {tab === 'logs' ? (
            <DataTable
              rows={filteredLogs}
              columns={logColumns}
              searchKeys={['agent_name' as const, 'message' as const, 'otto_product_id' as const]}
              searchPlaceholder="Search agent / message / product..."
              initialSort={{ key: 'created_at', ascending: false }}
            />
          ) : (
            <DataTable
              rows={filteredVotes}
              columns={voteColumns}
              searchKeys={['agent_name' as const, 'reason' as const, 'otto_product_id' as const]}
              searchPlaceholder="Search agent / reason / product..."
              initialSort={{ key: 'created_at', ascending: false }}
            />
          )}
        </div>
      )}
    </Layout>
  );
}
