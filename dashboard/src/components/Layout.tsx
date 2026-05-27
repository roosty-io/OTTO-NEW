import type { ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { MOCK, SUPABASE_CONFIGURED } from '@/lib/supabase';

interface Props {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}

export function Layout({ title, subtitle, actions, children }: Props) {
  return (
    <div className="flex h-full min-h-screen">
      <Sidebar />
      <main className="flex-1 flex flex-col min-w-0">
        <header className="px-6 py-4 border-b border-border bg-bg sticky top-0 z-20 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-base font-semibold">{title}</h1>
            {subtitle && <p className="text-xs text-muted mt-0.5">{subtitle}</p>}
          </div>
          <div className="flex items-center gap-2">
            {MOCK && (
              <span className="inline-flex items-center rounded border border-amber-500/30 bg-amber-500/15 text-amber-300 px-2 py-0.5 text-[10px] uppercase tracking-wide">
                Mock data
              </span>
            )}
            {!MOCK && !SUPABASE_CONFIGURED && (
              <span className="inline-flex items-center rounded border border-red-500/30 bg-red-500/15 text-red-300 px-2 py-0.5 text-[10px] uppercase tracking-wide">
                Supabase not configured
              </span>
            )}
            {actions}
          </div>
        </header>
        <div className="p-6 flex-1 min-w-0">{children}</div>
      </main>
    </div>
  );
}
