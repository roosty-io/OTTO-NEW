import { cn } from '@/lib/utils';
import type { InputHTMLAttributes } from 'react';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        'h-8 w-full rounded-md border border-border bg-panel px-2.5 text-sm placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-brand',
        className,
      )}
    />
  );
}
