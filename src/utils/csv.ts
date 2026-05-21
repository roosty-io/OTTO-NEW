import { stringify } from 'csv-stringify/sync';
import * as fs from 'fs';
import * as path from 'path';

export interface CsvWriteResult {
  filePath: string;
  rowCount: number;
}

export function writeCsv(
  outputDir: string,
  filename: string,
  columns: string[],
  rows: Record<string, unknown>[],
): CsvWriteResult {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  const filePath = path.join(outputDir, filename);
  const records = rows.map((r) => columns.map((c) => formatValue(r[c])));
  const csv = stringify([columns, ...records]);
  fs.writeFileSync(filePath, csv, 'utf8');
  return { filePath, rowCount: rows.length };
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.join('|');
  if (typeof v === 'object') return JSON.stringify(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v);
}
