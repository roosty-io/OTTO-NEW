import { Layout } from '@/components/Layout';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Badge } from '@/components/ui/Badge';
import { Card, CardBody, CardHeader, CardSubtitle, CardTitle } from '@/components/ui/Card';
import { Scorecard } from '@/components/Scorecard';
import { useLatestAmazonEnvCheck } from '@/lib/queries';
import { fmtDate } from '@/lib/utils';
import { DISCOVERY_AGENTS, KEEPA_PROFILES, type DiscoveryAgentInfo, type ImplementedStatus } from '@/lib/discoveryAgents';

const TONE: Record<ImplementedStatus, 'good' | 'warn' | 'muted'> = {
  real: 'good',
  partial: 'warn',
  placeholder: 'muted',
};

const ENV_TONE: Record<string, 'good' | 'warn' | 'bad' | 'muted'> = {
  AMAZON_ENV_READY: 'good',
  AMAZON_ENV_PARTIAL: 'warn',
  AMAZON_ENV_BLOCKED: 'bad',
  AMAZON_ENV_UNUSABLE: 'bad',
};

function AmazonEnvCard() {
  const { data, isLoading } = useLatestAmazonEnvCheck();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Amazon environment</CardTitle>
        <CardSubtitle>
          Latest <code className="font-mono">npm run test:amazon-environment</code> result. Keepa discovery should
          only run at scale when this is READY or PARTIAL.
        </CardSubtitle>
      </CardHeader>
      <CardBody>
        {isLoading ? (
          <span className="text-muted text-sm">Loading…</span>
        ) : !data ? (
          <span className="text-muted text-sm">
            No environment check recorded yet. Run <code className="font-mono">npm run test:amazon-environment</code>.
          </span>
        ) : (
          <div className="flex flex-col gap-2 text-sm">
            <div className="flex items-center gap-2">
              <Badge tone={ENV_TONE[data.status] ?? 'muted'}>{data.status}</Badge>
              <span className="text-muted text-xs">{fmtDate(data.created_at)}</span>
            </div>
            <div className="text-muted text-xs">
              loaded {data.loaded_count}/{(data.tested_asins ?? []).length} · blocked {data.blocked_count} · timeout {data.timeout_count} · nav-failed {data.navigation_failed_count} ·
              proxy {data.proxy_enabled ? `enabled${data.proxy_host_masked ? ` (${data.proxy_host_masked})` : ''}` : 'disabled'}
            </div>
            {(data.status === 'AMAZON_ENV_BLOCKED' || data.status === 'AMAZON_ENV_UNUSABLE') && (
              <div className="text-xs text-red-300">
                Amazon source validation will fail here — configure AMAZON_PROXY_SERVER or run where Amazon is reachable.
                See AMAZON_ACCESS_RUNBOOK.md.
              </div>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

export function DiscoveryAgents() {
  const realCount = DISCOVERY_AGENTS.filter((a) => a.implemented === 'real').length;
  const partialCount = DISCOVERY_AGENTS.filter((a) => a.implemented === 'partial').length;
  const placeholderCount = DISCOVERY_AGENTS.filter((a) => a.implemented === 'placeholder').length;

  const nextBuild = DISCOVERY_AGENTS
    .filter((a) => a.priority !== null)
    .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));

  const columns: DataColumn<DiscoveryAgentInfo>[] = [
    { key: 'name', header: 'Agent', sortable: true, sortValue: (r) => r.name, cell: (r) => <span className="font-medium">{r.name}</span>, width: '18%' },
    {
      key: 'implemented',
      header: 'Status',
      sortable: true,
      sortValue: (r) => r.implemented,
      cell: (r) => <Badge tone={TONE[r.implemented]}>{r.implemented}</Badge>,
    },
    {
      key: 'priority',
      header: 'Next build',
      sortable: true,
      sortValue: (r) => r.priority ?? 99,
      cell: (r) =>
        r.implemented === 'real'
          ? <Badge tone="good">live</Badge>
          : r.priority !== null
            ? <Badge tone={r.priority === 1 ? 'warn' : 'muted'}>priority {r.priority}</Badge>
            : <span className="text-muted">—</span>,
    },
    { key: 'dataSource', header: 'Data source', cell: (r) => <span className="text-muted">{r.dataSource}</span> },
    { key: 'requiresCredentials', header: 'Requires', cell: (r) => <span className="text-muted text-xs">{r.requiresCredentials}</span> },
    { key: 'testCommand', header: 'Test command', cell: (r) => r.testCommand ? <code className="text-xs font-mono">{r.testCommand}</code> : <span className="text-muted">—</span> },
    { key: 'lastSuccessfulRun', header: 'Last success', cell: (r) => <span className="text-muted text-xs">{r.lastSuccessfulRun ?? '—'}</span> },
    { key: 'notes', header: 'Notes', cell: (r) => <span className="text-muted text-xs">{r.notes}</span>, width: '26%' },
  ];

  return (
    <Layout title="Discovery Agents" subtitle="Implementation status of every planned OTTO discovery agent.">
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Scorecard label="Real / implemented" value={realCount} tone="good" />
          <Scorecard label="Partial" value={partialCount} tone="warn" />
          <Scorecard label="Placeholder" value={placeholderCount} tone="default" />
        </div>
        <AmazonEnvCard />
        <Card>
          <CardHeader>
            <CardTitle>Status &amp; next implementation priority</CardTitle>
            <CardSubtitle>
              Real today: eBay Keyword Discovery + Keepa Rank Movement (ASIN-native).
              Recommended next build order (see DISCOVERY_EXPANSION_PLAN.md):
            </CardSubtitle>
          </CardHeader>
          <CardBody>
            <ol className="flex flex-col gap-1 text-sm">
              {nextBuild.map((a) => (
                <li key={a.name} className="flex items-center gap-2">
                  <Badge tone={a.priority === 1 ? 'warn' : 'muted'}>priority {a.priority}</Badge>
                  <span className="font-medium">{a.name}</span>
                  <span className="text-muted text-xs">— {a.dataSource}</span>
                </li>
              ))}
            </ol>
            <p className="text-muted text-xs mt-3">
              Rationale: the top funnel loss is ASIN_NOT_RESOLVED (~60% of rejections), so ASIN-native
              sources (Keepa, Amazon) that skip eBay→ASIN resolution come before eBay-native Zik.
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Keepa discovery calibration</CardTitle>
            <CardSubtitle>
              Keepa Rank Movement supports calibration profiles (discovery input only — validation gates unchanged).
            </CardSubtitle>
          </CardHeader>
          <CardBody>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
              {KEEPA_PROFILES.map((p) => (
                <div key={p.name} className="flex items-start gap-2">
                  <Badge tone={p.diagnosticsOnly ? 'muted' : 'good'}>{p.name}</Badge>
                  <span className="text-muted text-xs">
                    rank ≥ {p.minRankImprovementPercent}% · ${p.minAmazonPrice}–${p.maxAmazonPrice}
                    {p.diagnosticsOnly ? ' · diagnostics only' : ''}
                  </span>
                </div>
              ))}
            </div>
            <p className="text-muted text-xs mt-3">
              Calibrate: <code className="font-mono">npm run calibrate:keepa-discovery -- --limit=25</code>.
              Reports saved to <code className="font-mono">reports/otto-keepa-calibration-&lt;timestamp&gt;.md</code>.
              Filter losses are reported with <code className="font-mono">KEEPA_*</code> reason codes.
            </p>
          </CardBody>
        </Card>
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
              initialSort={{ key: 'priority', ascending: true }}
            />
          </CardBody>
        </Card>
      </div>
    </Layout>
  );
}
