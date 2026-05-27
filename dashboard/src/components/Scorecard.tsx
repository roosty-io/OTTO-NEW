import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Card, CardBody } from './ui/Card';

interface Props {
  label: string;
  value: ReactNode;
  delta?: ReactNode;
  tone?: 'default' | 'good' | 'warn' | 'bad';
  hint?: string;
}

const TONE: Record<NonNullable<Props['tone']>, string> = {
  default: 'text-text',
  good: 'text-emerald-300',
  warn: 'text-amber-300',
  bad: 'text-red-300',
};

export function Scorecard({ label, value, delta, tone = 'default', hint }: Props) {
  return (
    <Card>
      <CardBody>
        <div className="text-[11px] uppercase tracking-wider text-muted">{label}</div>
        <div className={cn('mt-1 text-2xl font-semibold tabular-nums', TONE[tone])}>{value}</div>
        {delta && <div className="mt-1 text-xs text-muted">{delta}</div>}
        {hint && <div className="mt-1 text-[11px] text-muted">{hint}</div>}
      </CardBody>
    </Card>
  );
}
