import { msg } from './i18n';
/**
 * Yanıtı tabloya çevirip dosya üreten oturum: kaynak bir kez çözülür, önizleme ve dışa aktarma aynı değeri
 * kullanır. Web'de Web Worker içinde çalışır (büyük yanıtta arayüz donmasın), worker yoksa doğrudan.
 */
import { parseCsv } from './dataFile';
import {
  coerceDeep,
  defaultPath,
  findArrays,
  selectColumns,
  TableError,
  toCsv,
  toTables,
  type ArrayCandidate,
  type ArrayMode,
  type CellValue,
  type CsvOptions,
  type Table,
  type TableColumn,
} from './tabular';
import { toXlsx, XLSX_MIME } from './xlsx';

export type ExportSource =
  | { kind: 'json'; text: string }
  | { kind: 'csv'; text: string }
  /** XML gibi çağıran tarafta çözülmüş değer. */
  | { kind: 'value'; value: unknown };

export type ExportFormat = 'xlsx' | 'csv';

export interface AnalyzeRequest {
  /** Verilmezse en olası dizi seçilir. */
  path?: string;
  arrays: ArrayMode;
}

export interface TablePreview {
  name: string;
  columns: TableColumn[];
  rowCount: number;
  rows: CellValue[][];
}

export interface AnalyzeResult {
  path: string;
  candidates: ArrayCandidate[];
  tables: TablePreview[];
}

export interface ExportRequest {
  path: string;
  arrays: ArrayMode;
  /** Ana tablonun kolonları, istenen sırayla; verilmezse hepsi. */
  columns?: string[];
  format: ExportFormat;
  csv?: CsvOptions;
}

export interface ExportedFile {
  data: Uint8Array;
  mime: string;
  extension: string;
}

export const PREVIEW_ROWS = 100;

function parseSource(source: ExportSource): unknown {
  if (source.kind === 'value') return source.value;
  if (source.kind === 'csv') return coerceDeep(parseCsv(source.text).rows);
  try {
    return JSON.parse(source.text);
  } catch {
    throw new TableError(
      msg('core.tableExport.invalidJson', 'Yanıt geçerli bir JSON değil (kırpılmış olabilir).'),
    );
  }
}

export function createTableSession(source: ExportSource) {
  const value = parseSource(source);
  const candidates = findArrays(value);
  let cache: { key: string; tables: Table[] } | null = null;

  const tablesFor = (path: string, arrays: ArrayMode) => {
    const key = `${arrays}\u0000${path}`;
    if (cache?.key !== key) cache = { key, tables: toTables(value, { path, arrays }) };
    return cache.tables;
  };

  return {
    analyze(request: AnalyzeRequest): AnalyzeResult {
      const path = request.path ?? defaultPath(value);
      const tables = tablesFor(path, request.arrays);
      return {
        path,
        candidates,
        tables: tables.map((t) => ({
          name: t.name,
          columns: t.columns,
          rowCount: t.rows.length,
          rows: t.rows.slice(0, PREVIEW_ROWS),
        })),
      };
    },

    async export(request: ExportRequest): Promise<ExportedFile> {
      // CSV tek tablodur: iç içe diziler hücrede JSON olarak kalır.
      const arrays = request.format === 'csv' ? 'json' : request.arrays;
      const [main, ...children] = tablesFor(request.path, arrays);
      const first = request.columns ? selectColumns(main!, request.columns) : main!;
      if (request.format === 'csv') {
        return {
          data: new TextEncoder().encode(toCsv(first, request.csv)),
          mime: 'text/csv;charset=utf-8',
          extension: 'csv',
        };
      }
      return { data: await toXlsx([first, ...children]), mime: XLSX_MIME, extension: 'xlsx' };
    },
  };
}

export type TableSession = ReturnType<typeof createTableSession>;

/** Hazır tabloları (runner, geçmiş) dosyaya yazar. */
export async function exportTables(
  tables: Table[],
  format: ExportFormat,
  csv?: CsvOptions,
): Promise<ExportedFile> {
  if (format === 'csv') {
    return {
      data: new TextEncoder().encode(toCsv(tables[0]!, csv)),
      mime: 'text/csv;charset=utf-8',
      extension: 'csv',
    };
  }
  return { data: await toXlsx(tables), mime: XLSX_MIME, extension: 'xlsx' };
}
export { createZip } from './zip';
