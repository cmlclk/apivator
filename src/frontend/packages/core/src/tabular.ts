import { msg } from './i18n';
/**
 * Yanıttan tablo: JSON (ya da JSON'a çevrilmiş XML/CSV) içindeki bir dizi satır olur, iç içe alanlar nokta ile
 * düzleşir (`adres.sehir`). Saf fonksiyonlar; web'de Web Worker'da, CLI'da doğrudan çalışır.
 */

export type CellValue = string | number | boolean | null;
export type ColumnType = 'number' | 'date' | 'datetime' | 'boolean' | 'text';

export interface TableColumn {
  key: string;
  type: ColumnType;
}

export interface Table {
  name: string;
  columns: TableColumn[];
  rows: CellValue[][];
}

/** İç içe diziler: hücrede JSON metni olarak ya da ayrı sayfada (satır numarasıyla bağlı). */
export type ArrayMode = 'json' | 'sheet';

export interface ArrayCandidate {
  /** Nokta ile ayrılmış yol; kök için boş metin. */
  path: string;
  length: number;
}

export interface TableOptions {
  path?: string;
  arrays?: ArrayMode;
}

/** Ayrı sayfalarda üst satıra bağlanan kolon. */
export const parentRowColumn = () => msg('core.tabular.parentRowColumn', '#satır');
/** Nesne olmayan dizi elemanlarının kolonu. */
export const valueColumn = () => msg('core.tabular.valueColumn', 'değer');

export class TableError extends Error {}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function splitPath(path: string): string[] {
  return path
    .split('.')
    .map((p) => p.trim())
    .filter(Boolean);
}

/** `data.items` ya da `data.0.items` yolundaki değer; yoksa undefined. */
export function valueAtPath(value: unknown, path: string): unknown {
  let current = value;
  for (const segment of splitPath(path)) {
    if (Array.isArray(current) && /^\d+$/.test(segment)) current = current[Number(segment)];
    else if (isObject(current)) current = current[segment];
    else return undefined;
  }
  return current;
}

/**
 * Tabloya çevrilebilecek diziler (en uzun önce). Kök dizi ya da `data.items` gibi bir alt yol olabilir;
 * dizilerin ilk elemanının içine de bakılır (`data.0.lines`).
 */
export function findArrays(value: unknown, maxDepth = 5): ArrayCandidate[] {
  const found: ArrayCandidate[] = [];
  const visit = (current: unknown, path: string[], depth: number) => {
    if (depth > maxDepth) return;
    if (Array.isArray(current)) {
      found.push({ path: path.join('.'), length: current.length });
      const first = current.find(isObject);
      if (first) visit(first, [...path, String(current.indexOf(first))], depth + 1);
      return;
    }
    if (isObject(current)) {
      for (const [key, child] of Object.entries(current)) visit(child, [...path, key], depth + 1);
    }
  };
  visit(value, [], 0);
  return found.sort((a, b) => b.length - a.length || a.path.length - b.path.length);
}

/** Tablo için en olası yol: kök dizi, yoksa en uzun dizi; dizi yoksa kökün kendisi (tek satır). */
export function defaultPath(value: unknown): string {
  if (Array.isArray(value)) return '';
  const best = findArrays(value).find((c) => !/(^|\.)\d+(\.|$)/.test(c.path));
  return best?.path ?? '';
}

function flatten(
  value: unknown,
  prefix: string,
  out: Map<string, CellValue>,
  nested: Map<string, unknown[]> | null,
): void {
  if (isObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0 && prefix) out.set(prefix, null);
    for (const [key, child] of entries) flatten(child, prefix ? `${prefix}.${key}` : key, out, nested);
    return;
  }
  if (Array.isArray(value)) {
    if (nested) {
      // Ayrı sayfa modunda boş dizi satır üretmez; kolon da açılmaz.
      if (value.length > 0) nested.set(prefix || valueColumn(), value);
      return;
    }
    out.set(prefix || valueColumn(), JSON.stringify(value));
    return;
  }
  out.set(prefix || valueColumn(), toCell(value));
}

function toCell(value: unknown): CellValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    // Kesinliği kaybolan büyük tam sayılar (kimlikler) metin olarak kalır; Excel 15 haneden sonrasını sıfırlar.
    return Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value))
      ? value
      : String(value);
  }
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  return JSON.stringify(value);
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;

function inferType(rows: CellValue[][], index: number): ColumnType {
  let type: ColumnType | null = null;
  for (const row of rows) {
    const value = row[index];
    if (value === null || value === undefined || value === '') continue;
    const current: ColumnType =
      typeof value === 'number'
        ? 'number'
        : typeof value === 'boolean'
          ? 'boolean'
          : DATE.test(value)
            ? 'date'
            : DATETIME.test(value)
              ? 'datetime'
              : 'text';
    if (type === null) type = current;
    else if (type !== current) {
      if ((type === 'date' && current === 'datetime') || (type === 'datetime' && current === 'date'))
        type = 'datetime';
      else return 'text';
    }
  }
  return type ?? 'text';
}

function build(name: string, records: Map<string, CellValue>[]): Table {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    for (const key of record.keys()) {
      if (!seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
    }
  }
  const rows = records.map((record) => keys.map((key) => (record.has(key) ? record.get(key)! : null)));
  return { name, columns: keys.map((key, i) => ({ key, type: inferType(rows, i) })), rows };
}

/**
 * Seçilen yoldaki diziyi tablolara çevirir. `arrays: 'sheet'` ise iç içe diziler ayrı tablolara gider; her
 * satırda üst tablodaki satır numarası (`#satır`, 1'den başlar) bulunur. Daha derindeki diziler JSON metnidir.
 */
export function toTables(value: unknown, options: TableOptions = {}): Table[] {
  const path = options.path ?? '';
  const selected = path ? valueAtPath(value, path) : value;
  if (selected === undefined)
    throw new TableError(msg('core.tabular.noValueAtPath', '"{path}" yolunda değer yok.', { path }));
  const items = Array.isArray(selected) ? selected : [selected];
  const sheetMode = options.arrays === 'sheet';

  const records: Map<string, CellValue>[] = [];
  const children = new Map<string, Map<string, CellValue>[]>();
  items.forEach((item, index) => {
    const record = new Map<string, CellValue>();
    const nested = sheetMode ? new Map<string, unknown[]>() : null;
    flatten(item, '', record, nested);
    records.push(record);
    for (const [key, list] of nested ?? []) {
      const childRows = children.get(key) ?? [];
      for (const element of list) {
        const childRecord = new Map<string, CellValue>([[parentRowColumn(), index + 1]]);
        flatten(element, '', childRecord, null);
        childRows.push(childRecord);
      }
      children.set(key, childRows);
    }
  });

  const rootName =
    splitPath(path)
      .filter((s) => !/^\d+$/.test(s))
      .at(-1) ?? 'Veri';
  return [build(rootName, records), ...[...children].map(([key, rows]) => build(key, rows))];
}

/** Kolonları seçer ve sıralar (önizlemedeki seçim). */
export function selectColumns(table: Table, keys: string[]): Table {
  const indexes = keys.map((key) => table.columns.findIndex((c) => c.key === key)).filter((i) => i >= 0);
  return {
    name: table.name,
    columns: indexes.map((i) => table.columns[i]!),
    rows: table.rows.map((row) => indexes.map((i) => row[i] ?? null)),
  };
}

/**
 * XML ya da CSV'den gelen metinler için: sayıya benzeyen metinleri sayıya çevirir. Baştaki sıfırlı değerler
 * (posta kodu, telefon) ve 15 haneden uzun sayılar metin kalır.
 */
export function coerceScalar(value: string): CellValue {
  const trimmed = value.trim();
  if (/^-?(0|[1-9]\d{0,14})(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed === 'true' || trimmed === 'false') return trimmed === 'true';
  return value;
}

/** Bir değerin içindeki tüm metin yapraklarını {@link coerceScalar} ile çevirir. */
export function coerceDeep(value: unknown): unknown {
  if (typeof value === 'string') return coerceScalar(value);
  if (Array.isArray(value)) return value.map(coerceDeep);
  if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, coerceDeep(v)]));
  return value;
}

/** DOM'a bağlı kalmamak için XML düğümünün ihtiyaç duyulan kısmı (DOMParser sonucu buna uyar). */
export interface XmlElementLike {
  nodeType: number;
  nodeName: string;
  textContent: string | null;
  attributes?: ArrayLike<{ name: string; value: string }>;
  childNodes: ArrayLike<XmlElementLike>;
}

/**
 * XML öğesini JSON benzeri değere çevirir: öznitelikler `@ad`, aynı adlı tekrarlanan öğeler dizi, yalnızca metin
 * içeren öğe metin olur. Ad alanı önekleri atılır (`soap:Body` → `Body`).
 */
export function xmlToValue(element: XmlElementLike): unknown {
  const localName = (name: string) => name.slice(name.indexOf(':') + 1);
  const children = Array.from(element.childNodes).filter((n) => n.nodeType === 1);
  const attributes = Array.from(element.attributes ?? []).filter((a) => !a.name.startsWith('xmlns'));
  if (children.length === 0 && attributes.length === 0) return (element.textContent ?? '').trim();

  const result: Record<string, unknown> = {};
  for (const attribute of attributes) result[`@${localName(attribute.name)}`] = attribute.value;
  const groups = new Map<string, unknown[]>();
  for (const child of children) {
    const key = localName(child.nodeName);
    groups.set(key, [...(groups.get(key) ?? []), xmlToValue(child)]);
  }
  // Tek kez geçen öğe nesne, tekrarlanan öğe dizi olur.
  for (const [key, values] of groups) result[key] = values.length === 1 ? values[0] : values;
  if (children.length === 0) result['#text'] = (element.textContent ?? '').trim();
  return result;
}

// ---- CSV ----

export interface CsvOptions {
  /** Türkçe Excel için ';' (varsayılan), uluslararası ',' ya da sekme. */
  delimiter?: ';' | ',' | '\t';
  /** Ondalık ayırıcı; ';' ayırıcıyla Türkçe Excel ',' bekler. Verilmezse ayırıcıya göre seçilir. */
  decimal?: ',' | '.';
  /** Excel UTF-8'i tanısın diye dosya başına BOM (varsayılan açık). */
  bom?: boolean;
  /**
   * `=`, `+`, `-`, `@` ile başlayan metinlerin başına `'` eklenir; Excel'de formül olarak çalışmazlar
   * (CSV enjeksiyonu). Varsayılan açık; sayılar etkilenmez.
   */
  escapeFormulas?: boolean;
}

function formatNumber(value: number, decimal: ',' | '.') {
  const text = String(value);
  return decimal === ',' ? text.replace('.', ',') : text;
}

export function toCsv(table: Table, options: CsvOptions = {}): string {
  const delimiter = options.delimiter ?? ';';
  const decimal = options.decimal ?? (delimiter === ',' ? '.' : ',');
  const escapeFormulas = options.escapeFormulas ?? true;

  const quote = (text: string) =>
    text.includes(delimiter) || /["\r\n]/.test(text) || text !== text.trim()
      ? `"${text.replace(/"/g, '""')}"`
      : text;

  const cell = (value: CellValue): string => {
    if (value === null) return '';
    if (typeof value === 'number') return quote(formatNumber(value, decimal));
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    const safe = escapeFormulas && /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
    return quote(safe);
  };

  const lines = [
    table.columns.map((c) => quote(c.key)).join(delimiter),
    ...table.rows.map((row) => row.map(cell).join(delimiter)),
  ];
  return (options.bom === false ? '' : '﻿') + lines.join('\r\n') + '\r\n';
}
