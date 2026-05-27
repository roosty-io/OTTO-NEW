import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Layout } from '@/components/Layout';
import { Card, CardBody, CardHeader, CardSubtitle, CardTitle } from '@/components/ui/Card';
import { ErrorState, LoadingState } from '@/components/States';
import { useLatestRun } from '@/lib/queries';
import { fmtNum, fmtPct } from '@/lib/utils';

interface Stage {
  name: string;
  count: number;
}

export function PipelineFunnel() {
  const { data, isLoading, error } = useLatestRun();
  return (
    <Layout title="Pipeline Funnel" subtitle="Latest run stage-to-stage pass rates.">
      {isLoading ? <LoadingState /> : error ? <ErrorState error={error} /> : !data ? <LoadingState /> : (
        <Body data={data} />
      )}
    </Layout>
  );
}

function Body({ data }: { data: NonNullable<ReturnType<typeof useLatestRun>['data']> }) {
  const m = data.metrics;
  const stages: Stage[] = [
    { name: 'raw candidates', count: m.rawCandidates },
    { name: 'ASIN resolved', count: m.asinResolved },
    { name: 'Amazon source valid', count: m.amazonSourceValid },
    { name: 'demand passed', count: m.demandPassed },
    { name: 'compliance passed', count: m.compliancePassed },
    { name: 'business fit passed', count: m.businessFitPassed },
    { name: 'final validated', count: m.finalValidated },
    { name: 'exported after dedupe', count: m.exportedAfterDedupe },
  ];
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Funnel by stage</CardTitle>
          <CardSubtitle>Raw candidates → exported after dedupe.</CardSubtitle>
        </CardHeader>
        <CardBody>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stages} margin={{ left: 20, right: 20, top: 12, bottom: 60 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#232831" />
                <XAxis
                  dataKey="name"
                  stroke="#8b94a7"
                  tick={{ fontSize: 11 }}
                  angle={-25}
                  height={70}
                  textAnchor="end"
                  interval={0}
                />
                <YAxis stroke="#8b94a7" tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    background: '#13161b',
                    border: '1px solid #232831',
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                  cursor={{ fill: 'rgba(122,162,255,0.07)' }}
                />
                <Bar dataKey="count" fill="#7aa2ff" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Stage-to-stage pass rates</CardTitle>
          <CardSubtitle>What % survived each step.</CardSubtitle>
        </CardHeader>
        <CardBody>
          <table className="w-full text-sm">
            <thead className="text-muted text-xs">
              <tr>
                <th className="text-left font-medium pb-2">Transition</th>
                <th className="text-right font-medium pb-2">From → To</th>
                <th className="text-right font-medium pb-2">Pass rate</th>
              </tr>
            </thead>
            <tbody>
              {stages.slice(0, -1).map((s, i) => {
                const next = stages[i + 1];
                const rate = s.count > 0 ? (next.count / s.count) * 100 : 0;
                return (
                  <tr key={s.name} className="border-t border-border/60">
                    <td className="py-2">{s.name} → {next.name}</td>
                    <td className="text-right text-muted">{fmtNum(s.count)} → {fmtNum(next.count)}</td>
                    <td className="text-right tabular-nums">{fmtPct(rate)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardBody>
      </Card>
    </div>
  );
}
