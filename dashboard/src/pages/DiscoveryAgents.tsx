import { Layout } from '@/components/Layout';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Badge } from '@/components/ui/Badge';
import { Card, CardBody, CardHeader, CardSubtitle, CardTitle } from '@/components/ui/Card';
import { Scorecard } from '@/components/Scorecard';
import { DISCOVERY_AGENTS, type DiscoveryAgentInfo, type ImplementedStatus } from '@/lib/discoveryAgents';

const TONE: Record<ImplementedStatus, 'good' | 'warn' | 'muted'> = {
  real: 'good',
  partial: 'warn',
  placeholder: 'muted',
};

export function DiscoveryAgents() {
  const realCount = DISCOVERY_AGENTS.filter((a) => a.implemented === 'real').length;
  const partialCount = DISCOVERY_AGENTS.filter((a) => a.implemented === 'partial').length;
  const placeholderCount = DISCOVERY_AGENTS.filter((a) => a.implemented === 'placeholder').length;

  const columns: DataColumn<DiscoveryAgentInfo>[] = [
    { key: 'name', header: 'Agent', sortable: true, sortValue: (r) => r.name, cell: (r) => <span className="font-medium">{r.name}</span>, width: '20%' },
    {
      key: 'implemented',
      header: 'Status',
      sortable: true,
      sortValue: (r) => r.implemented,
      cell: (r) => <Badge tone={TONE[r.implemented]}>{r.implemented}</Badge>,
    },
    { key: 'dataSource', header: 'Data source', cell: (r) => <span className="text-muted">{r.dataSource}</span> },
    { key: 'requiresCredentials', header: 'Requires', cell: (r) => <span className="text-muted text-xs">{r.requiresCredentials}</span> },
    { key: 'testCommand', header: 'Test command', cell: (r) => r.testCommand ? <code className="text-xs font-mono">{r.testCommand}</code> : <span className="text-muted">—</span> },
    { key: 'lastSuccessfulRun', header: 'Last success', cell: (r) => <span className="text-muted text-xs">{r.lastSuccessfulRun ?? '—'}</span> },
    { key: 'notes', header: 'Notes', cell: (r) => <span className="text-muted text-xs">{r.notes}</span>, width: '30%' },
  ];

  return (
    <Layout title="Discovery Agents" subtitle="Implementation status of every planned OTTO discovery agent.">
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Scorecard label="Real / implemented" value={realCount} tone="good" />
          <Scorecard label="Partial" value={partialCount} tone="warn" />
          <Scorecard label="Placeholder" value={placeholderCount} tone="default" />
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Manifest</CardTitle>
            <CardSubtitle>This page is a static manifest in src/lib/discoveryAgents.ts; it does not query the DB.</CardSubtitle>
          </CardHeader>
          <CardBody>
            <DataTable
              rows={DISCOVERY_AGENTS}
              columns={columns}
              searchKeys={['name' as const, 'dataSource' as const, 'notes' as const]}
              searchPlaceholder="Search agent / data source..."
              initialSort={{ key: 'implemented', ascending: true }}
            />
          </CardBody>
        </Card>
      </div>
    </Layout>
  );
}
