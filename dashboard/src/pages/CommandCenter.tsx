import { Layout } from '@/components/Layout';
import { Scorecard } from '@/components/Scorecard';
import { Card, CardBody, CardHeader, CardSubtitle, CardTitle } from '@/components/ui/Card';
import { CopyButton } from '@/components/CopyButton';
import { ErrorState, LoadingState } from '@/components/States';
import { useLatestRun } from '@/lib/queries';
import { fmtNum, fmtPct } from '@/lib/utils';

export function CommandCenter() {
  const { data, isLoading, error } = useLatestRun();

  return (
    <Layout
      title="Command Center"
      subtitle="Latest discovery run, stage funnel, and current QA approval rate."
    >
      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState error={error} />
      ) : !data ? (
        <LoadingState />
      ) : (
        <CommandCenterBody data={data} />
      )}
    </Layout>
  );
}

function CommandCenterBody({ data }: { data: NonNullable<ReturnType<typeof useLatestRun>['data']> }) {
  const m = data.metrics;
  const approvalTone = m.latestManualQaApprovalRate === null
    ? 'default'
    : m.latestManualQaApprovalRate >= 70 ? 'good' : 'warn';
  const passTone = m.endToEndPassRate >= 5 ? 'good' : m.endToEndPassRate >= 2 ? 'warn' : 'bad';
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Scorecard label="Exported products" value={fmtNum(m.exportedAfterDedupe)} tone="good" />
        <Scorecard
          label="End-to-end pass rate"
          value={fmtPct(m.endToEndPassRate)}
          tone={passTone}
          hint={`${m.finalValidated} / ${m.rawCandidates} raw`}
        />
        <Scorecard
          label="Manual QA approval"
          value={m.latestManualQaApprovalRate === null ? '—' : fmtPct(m.latestManualQaApprovalRate)}
          tone={approvalTone}
          hint="Threshold to scale: ≥ 70%"
        />
        <Scorecard
          label="Duplicate ASINs removed"
          value={fmtNum(m.duplicateAsinsRemoved)}
          tone={m.duplicateAsinsRemoved > 0 ? 'warn' : 'default'}
        />
        <Scorecard
          label="Shipping review required"
          value={fmtNum(m.shippingReviewRequired)}
          tone={m.shippingReviewRequired > 0 ? 'warn' : 'default'}
        />
        <Scorecard label="Top rejection reason" value={<span className="text-base">{m.topRejectionReason ?? '—'}</span>} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Latest run</CardTitle>
            <CardSubtitle>Discovery run + export batch identifiers.</CardSubtitle>
          </CardHeader>
          <CardBody>
            <div className="grid grid-cols-1 gap-3 text-sm">
              <KvRow label="discovery_run_id" value={data.runId} />
              <KvRow label="export_batch_id" value={data.exportBatchId ?? '—'} />
              <KvRow label="CSV export path" value={data.csvPath ?? '—'} copyable />
              <KvRow label="manual QA CSV path" value={data.manualQaCsvPath ?? '—'} copyable />
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Stage counts</CardTitle>
            <CardSubtitle>Latest discovery_run window.</CardSubtitle>
          </CardHeader>
          <CardBody>
            <div className="grid grid-cols-2 gap-y-2 text-sm">
              <KvRow label="raw candidates" value={fmtNum(m.rawCandidates)} />
              <KvRow label="ASIN resolved" value={fmtNum(m.asinResolved)} />
              <KvRow label="ASIN failed" value={fmtNum(m.asinFailed)} />
              <KvRow label="Amazon source valid" value={fmtNum(m.amazonSourceValid)} />
              <KvRow label="Amazon source failed" value={fmtNum(m.amazonSourceFailed)} />
              <KvRow label="demand passed" value={fmtNum(m.demandPassed)} />
              <KvRow label="demand failed" value={fmtNum(m.demandFailed)} />
              <KvRow label="compliance passed" value={fmtNum(m.compliancePassed)} />
              <KvRow label="compliance failed" value={fmtNum(m.complianceFailed)} />
              <KvRow label="business fit passed" value={fmtNum(m.businessFitPassed)} />
              <KvRow label="business fit failed" value={fmtNum(m.businessFitFailed)} />
              <KvRow label="final validated (pre-dedupe)" value={fmtNum(m.finalValidatedBeforeDedupe)} />
              <KvRow label="duplicate ASINs removed" value={fmtNum(m.duplicateAsinsRemoved)} />
              <KvRow label="exported after dedupe" value={fmtNum(m.exportedAfterDedupe)} />
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function KvRow({ label, value, copyable }: { label: string; value: string; copyable?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/60 pb-1.5 last:border-0 last:pb-0">
      <span className="text-xs text-muted">{label}</span>
      <div className="flex items-center gap-2 min-w-0">
        <code className="text-xs font-mono truncate max-w-[28ch]">{value}</code>
        {copyable && value && value !== '—' && <CopyButton value={value} />}
      </div>
    </div>
  );
}
