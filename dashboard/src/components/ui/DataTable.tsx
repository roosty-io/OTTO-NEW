import { useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from './Input';

export interface DataColumn<T> {
  key: string;
  header: string;
  sortable?: boolean;
  cell: (row: T) => ReactNode;
  // accessor returns a sortable primitive (string | number | null).
  sortValue?: (row: T) => string | number | null | undefined;
  className?: string;
  width?: string;
}

interface Props<T> {
  rows: T[];
  columns: DataColumn<T>[];
  searchKeys?: (keyof T | ((row: T) => string | null | undefined))[];
  searchPlaceholder?: string;
  emptyMessage?: string;
  initialSort?: { key: string; ascending: boolean };
  pageSize?: number;
}

function getSearchText<T>(row: T, key: keyof T | ((row: T) => string | null | undefined)): string {
  if (typeof key === 'function') return key(row) ?? '';
  const v = row[key];
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.join(' ');
  return String(v);
}

export function DataTable<T>({
  rows,
  columns,
  searchKeys,
  searchPlaceholder = 'Search...',
  emptyMessage = 'No rows.',
  initialSort,
  pageSize = 100,
}: Props<T>) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState(initialSort);
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    if (!query || !searchKeys || searchKeys.length === 0) return rows;
    const lc = query.toLowerCase();
    return rows.filter((r) => searchKeys.some((k) => getSearchText(r, k).toLowerCase().includes(lc)));
  }, [rows, query, searchKeys]);

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const col = columns.find((c) => c.key === sort.key);
    if (!col || !col.sortValue) return filtered;
    const sortValue = col.sortValue;
    return filtered.slice().sort((a, b) => {
      const va = sortValue(a);
      const vb = sortValue(b);
      if (va === vb) return 0;
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return sort.ascending ? va - vb : vb - va;
      return sort.ascending ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
    });
  }, [filtered, sort, columns]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const start = page * pageSize;
  const pageRows = sorted.slice(start, start + pageSize);

  const toggleSort = (key: string) => {
    setSort((cur) => {
      if (!cur || cur.key !== key) return { key, ascending: false };
      if (!cur.ascending) return { key, ascending: true };
      return undefined;
    });
  };

  return (
    <div className="flex flex-col gap-2">
      {searchKeys && searchKeys.length > 0 && (
        <div className="flex items-center justify-between gap-2">
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
            placeholder={searchPlaceholder}
            className="max-w-sm"
          />
          <div className="text-xs text-muted">
            {sorted.length === 0 ? '0 rows' : `${sorted.length} row${sorted.length === 1 ? '' : 's'}`}
          </div>
        </div>
      )}
      <div className="relative overflow-auto rounded-md border border-border scrollbar-thin">
        <table className="w-full text-sm">
          <thead className="bg-panel2 text-muted text-xs sticky top-0 z-10">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  style={{ width: c.width }}
                  className={cn(
                    'text-left font-medium px-3 py-2 whitespace-nowrap',
                    c.sortable && 'cursor-pointer select-none hover:text-text',
                    c.className,
                  )}
                  onClick={c.sortable ? () => toggleSort(c.key) : undefined}
                >
                  <span className="inline-flex items-center gap-1">
                    {c.header}
                    {c.sortable && sort?.key === c.key && (
                      sort.ascending ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="text-center text-muted py-8">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              pageRows.map((r, i) => (
                <tr key={i} className="border-t border-border hover:bg-panel2/60">
                  {columns.map((c) => (
                    <td key={c.key} className={cn('px-3 py-2 align-top whitespace-nowrap', c.className)}>
                      {c.cell(r)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2 text-xs text-muted">
          <button
            className="px-2 py-1 rounded border border-border hover:bg-panel2 disabled:opacity-40"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
          >
            ← Prev
          </button>
          <span>
            Page {page + 1} / {totalPages}
          </span>
          <button
            className="px-2 py-1 rounded border border-border hover:bg-panel2 disabled:opacity-40"
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
