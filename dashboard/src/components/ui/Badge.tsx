import { cn } from '@/lib/utils';
import type { HTMLAttributes } from 'react';

type Tone = 'default' | 'good' | 'warn' | 'bad' | 'info' | 'muted';

interface Props extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
}

const TONE: Record<Tone, string> = {
  default: 'bg-panel2 text-text border-border',
  good: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  warn: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  bad: 'bg-red-500/15 text-red-300 border-red-500/30',
  info: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  muted: 'bg-panel2 text-muted border-border',
};

export function Badge({ tone = 'default', className, ...props }: Props) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
        TONE[tone],
        className,
      )}
      {...props}
    />
  );
}
