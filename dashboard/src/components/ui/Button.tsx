import { cn } from '@/lib/utils';
import type { ButtonHTMLAttributes } from 'react';

type Variant = 'default' | 'ghost' | 'outline';
type Size = 'sm' | 'md';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export function Button({ variant = 'default', size = 'md', className, ...props }: Props) {
  const base = 'inline-flex items-center gap-1.5 rounded-md font-medium transition disabled:opacity-50 disabled:pointer-events-none';
  const variants: Record<Variant, string> = {
    default: 'bg-panel2 text-text border border-border hover:bg-[#1d222a]',
    ghost: 'text-muted hover:text-text hover:bg-panel2',
    outline: 'border border-border text-text hover:bg-panel2',
  };
  const sizes: Record<Size, string> = {
    sm: 'h-7 px-2 text-xs',
    md: 'h-8 px-3 text-sm',
  };
  return <button className={cn(base, variants[variant], sizes[size], className)} {...props} />;
}
