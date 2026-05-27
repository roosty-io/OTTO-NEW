import { AlertCircle, Loader2, Inbox } from 'lucide-react';
import type { ReactNode } from 'react';

export function LoadingState({ label = 'Loading...' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-muted text-sm">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label}
    </div>
  );
}

export function ErrorState({ error }: { error: unknown }) {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div className="rounded-md border border-red-500/30 bg-red-500/10 text-red-300 p-4 text-sm">
      <div className="flex items-center gap-2 font-medium">
        <AlertCircle className="h-4 w-4" />
        Failed to load
      </div>
      <pre className="whitespace-pre-wrap mt-2 text-xs text-red-200/90">{msg}</pre>
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted text-sm">
      <Inbox className="h-5 w-5" />
      {children}
    </div>
  );
}
