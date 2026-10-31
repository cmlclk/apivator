// JSON dönüştürücünün web'e özgü çevirileri (YAML kütüphanesi ve DOMParser burada; tablo motoru core'dan).
import { parse as parseYaml, stringify as stringifyYaml, YAMLParseError } from 'yaml';
import { parse as parseToml, stringify as stringifyToml, TomlError } from 'smol-toml';
import {
  coerceDeep,
  coerceScalar,
  parseCsv,
  toCsv,
  toTables,
  toXlsx,
  xmlToValue,
  type ArrayMode,
  type CellValue,
  type CsvOptions,
  type Table,
} from '@apivator/core';
import {
  parseJsonDetailed,
  parseQuery,
  stringifyQuery,
  ToolError,
  type QueryArrayFormat,
  type ReadSheet,
} from '@apivator/core/tools';
import { translate } from '../../i18n';

/** JSON metnini çözer; hatada satır/sütunlu ToolError. */
export function parseJsonInput(text: string): unknown {
  const parsed = parseJsonDetailed(text);
  if (!parsed.ok)
    throw new ToolError(
      translate('tools', 'errors.jsonAt', {
        line: parsed.line,
        column: parsed.column,
        message: parsed.message,
      }),
    );
  return parsed.value;
}

const stringify = (value: unknown) => JSON.stringify(value, null, 2);

// ---- YAML ----

export function jsonToYaml(text: string): string {
  return stringifyYaml(parseJsonInput(text), { lineWidth: 0 });
}

export function yamlToJson(text: string): string {
  try {
    return stringify(parseYaml(text) ?? null);
  } catch (error) {
    if (error instanceof YAMLParseError) {
      const at = error.linePos?.[0];
      const message = error.message.split('\n')[0] ?? error.message;
      throw new ToolError(
        at
          ? translate('tools', 'errors.yamlAt', { line: at.line, column: at.col, message })
          : `YAML: ${message}`,
      );
    }
    throw error;
  }
}

// ---- XML ----

function escapeXml(text: string): string {
  return (
    text
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  );
}

/** XML öğe adı olamayan karakterler `_` olur; rakamla başlayan ada `_` eklenir. */
function elementName(key: string): string {
  const name = key.replace(/[^\p{L}\p{N}_.:-]/gu, '_');
  return /^[\p{L}_]/u.test(name) ? name : `_${name}`;
}

function scalarText(value: unknown): string {
  return value === null || value === undefined
    ? ''
    : typeof value === 'object'
      ? JSON.stringify(value)
      : String(value);
}

function writeElement(name: string, value: unknown, depth: number, out: string[]) {
  const pad = '  '.repeat(depth);
  const tag = elementName(name);
  if (Array.isArray(value)) {
    // Dizi: aynı adla tekrarlanan öğeler (xmlToValue'nun tersi).
    for (const item of value) writeElement(name, item, depth, out);
    return;
  }
  if (typeof value !== 'object' || value === null) {
    const text = scalarText(value);
    out.push(text ? `${pad}<${tag}>${escapeXml(text)}</${tag}>` : `${pad}<${tag}/>`);
    return;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  const attrs = entries
    .filter(([k]) => k.startsWith('@'))
    .map(([k, v]) => ` ${elementName(k.slice(1))}="${escapeXml(scalarText(v))}"`)
    .join('');
  const text = entries.find(([k]) => k === '#text')?.[1];
  const children = entries.filter(([k]) => !k.startsWith('@') && k !== '#text');
  if (!children.length) {
    const body = scalarText(text);
    out.push(body ? `${pad}<${tag}${attrs}>${escapeXml(body)}</${tag}>` : `${pad}<${tag}${attrs}/>`);
    return;
  }
  out.push(`${pad}<${tag}${attrs}>`);
  if (text !== undefined && text !== '') out.push(`${pad}  ${escapeXml(scalarText(text))}`);
  for (const [key, child] of children) writeElement(key, child, depth + 1, out);
  out.push(`${pad}</${tag}>`);
}

/**
 * JSON → XML: `@ad` öznitelik, `#text` metin, diziler tekrarlanan öğe olur. Tek anahtarlı nesnenin anahtarı kök
 * öğe olur; değilse `rootName` ile sarılır, kök dizinin elemanları `item` öğesidir.
 */
export function jsonToXml(text: string, rootName = 'root'): string {
  const value = parseJsonInput(text);
  const out = ['<?xml version="1.0" encoding="UTF-8"?>'];
  const keys = typeof value === 'object' && value !== null && !Array.isArray(value) ? Object.keys(value) : [];
  const single = keys.length === 1 ? (value as Record<string, unknown>)[keys[0]!] : undefined;
  if (keys.length === 1 && !keys[0]!.startsWith('@') && !Array.isArray(single))
    writeElement(keys[0]!, single, 0, out);
  else if (Array.isArray(value)) writeElement(rootName, { item: value }, 0, out);
  else writeElement(rootName, value, 0, out);
  return out.join('\n') + '\n';
}

/** XML → JSON: kök öğe adıyla tek anahtarlı nesne; `coerce` ise sayıya/mantıksala benzeyen metinler çevrilir. */
export function xmlToJson(text: string, coerce = true): string {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const error = doc.getElementsByTagName('parsererror')[0];
  if (error || !doc.documentElement) {
    const detail = error?.textContent?.split('\n').find((line) => line.trim()) ?? '';
    throw new ToolError(
      detail
        ? translate('tools', 'errors.invalidXmlDetail', { detail: detail.trim() })
        : translate('tools', 'errors.invalidXml'),
    );
  }
  const root = doc.documentElement;
  const value = xmlToValue(root);
  const name = root.nodeName.slice(root.nodeName.indexOf(':') + 1);
  return stringify({ [name]: coerce ? coerceDeep(value) : value });
}

// ---- CSV / Excel ----

export interface TableConvertOptions {
  /** Satır olacak dizinin yolu (`data.items`); boşsa kök. */
  path?: string;
  arrays?: ArrayMode;
}

export function jsonToCsv(text: string, options: TableConvertOptions & CsvOptions = {}): string {
  const [table] = toTables(parseJsonInput(text), { path: options.path, arrays: 'json' });
  // Ekranda BOM gösterilmez; indirirken eklenir.
  return toCsv(table!, { delimiter: options.delimiter, decimal: options.decimal, bom: false });
}

export async function jsonToXlsx(text: string, options: TableConvertOptions = {}): Promise<Uint8Array> {
  return toXlsx(toTables(parseJsonInput(text), options));
}

/**
 * Anahtarı her zaman kendi özelliği olarak yazar: `__proto__` gibi adlar prototipi değiştirmez
 * (güvenilmeyen CSV/Excel başlıkları).
 */
function setOwn(target: Record<string, unknown>, key: string, value: unknown) {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

const hasOwn = (target: object, key: string) => Object.prototype.hasOwnProperty.call(target, key);
const UNSAFE_PARTS = new Set(['__proto__', 'constructor', 'prototype']);

/** `adres.sehir` gibi noktalı anahtarları iç içe nesneye çevirir (düzleştirmenin tersi). */
export function unflattenRecord(record: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    const parts = key.split('.');
    let target = result;
    let ok = !parts.some((part) => UNSAFE_PARTS.has(part));
    for (const part of ok ? parts.slice(0, -1) : []) {
      const next = hasOwn(target, part) ? target[part] : undefined;
      if (next === undefined) {
        const child: Record<string, unknown> = {};
        setOwn(target, part, child);
        target = child;
      } else if (typeof next === 'object' && next !== null && !Array.isArray(next))
        target = next as Record<string, unknown>;
      else {
        ok = false;
        break;
      }
    }
    if (ok) setOwn(target, parts.at(-1)!, value);
    else setOwn(result, key, value);
  }
  return result;
}

export interface RowsToJsonOptions {
  /** Noktalı başlıklar iç içe nesne olur. */
  unflatten?: boolean;
}

function rowsToRecords(header: string[], rows: CellValue[][], options: RowsToJsonOptions): unknown[] {
  return rows.map((row) => {
    const record: Record<string, unknown> = {};
    header.forEach((key, i) => setOwn(record, key, row[i] ?? null));
    return options.unflatten ? unflattenRecord(record) : record;
  });
}

export interface CsvToJsonOptions extends RowsToJsonOptions {
  /** Sayıya ve true/false'a benzeyen metinler çevrilir; `;` ayırıcılı dosyada `1,5` ondalık sayılır. */
  coerce?: boolean;
}

export function csvToJson(text: string, options: CsvToJsonOptions = {}): string {
  const { columns, rows } = parseCsv(text);
  const firstLine = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).split(/\r?\n/, 1)[0] ?? '';
  const decimalComma = firstLine.includes(';');
  const cell = (value: string): CellValue => {
    if (!options.coerce) return value;
    if (value === '') return null;
    if (decimalComma && /^-?(0|[1-9]\d{0,14}),\d+$/.test(value.trim()))
      return Number(value.trim().replace(',', '.'));
    return coerceScalar(value);
  };
  // Yalnızca kendi özellikleri: `__proto__` başlığında Object.prototype okunmasın.
  const cells = rows.map((row) => columns.map((column) => cell((hasOwn(row, column) && row[column]) || '')));
  return stringify(rowsToRecords(columns, cells, options));
}

export interface SheetToJsonOptions extends RowsToJsonOptions {
  /** İlk satır başlık; değilse her satır bir dizi. */
  header?: boolean;
}

const nonEmptyRows = <T extends CellValue>(rows: T[][]) =>
  rows.filter((row) => row.some((cell) => cell !== null && cell !== ''));

/** Başlık satırı; boş ya da tekrarlanan başlıklar benzersiz yapılır (Sütun3, ad_2), eksikler eklenir. */
function uniqueHeader(first: CellValue[], rest: CellValue[][]): string[] {
  const seen = new Map<string, number>();
  const header = first.map((cell, i) => {
    const base =
      cell === null || cell === ''
        ? translate('tools', 'convert.columnName', { n: String(i + 1) })
        : String(cell);
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base}_${count}`;
  });
  // Yayma (...) çok satırda yığını taşırır; döngüyle.
  const width = rest.reduce((max, r) => Math.max(max, r.length), header.length);
  for (let i = header.length; i < width; i++)
    header.push(translate('tools', 'convert.columnName', { n: String(i + 1) }));
  return header;
}

export function sheetToJson(sheet: ReadSheet, options: SheetToJsonOptions = {}): string {
  const rows = nonEmptyRows(sheet.rows);
  if (!options.header) return stringify(rows);
  const [first = [], ...rest] = rows;
  return stringify(rowsToRecords(uniqueHeader(first, rest), rest, options));
}

// ---- CSV ↔ Excel ----

export type CsvDelimiter = ';' | ',' | '\t';

/**
 * RFC 4180 CSV'yi verilen ayırıcıyla satırlara böler: tırnaklı alan, `""` kaçışı, alan içinde satır sonu.
 * (core'daki parseCsv ayırıcıyı kendisi seçer ve sekmeyi tanımaz.)
 */
export function parseDelimited(text: string, delimiter: CsvDelimiter): string[][] {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!;
    if (quoted) {
      if (ch !== '"') field += ch;
      else if (source[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = false;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === delimiter) {
      record.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      record.push(field);
      records.push(record);
      record = [];
      field = '';
      if (ch === '\r' && source[i + 1] === '\n') i++;
    } else field += ch;
  }
  if (quoted) throw new ToolError(translate('tools', 'errors.csvUnclosedQuote'));
  if (field !== '' || record.length) {
    record.push(field);
    records.push(record);
  }
  return records;
}

export interface CsvTableOptions {
  delimiter?: CsvDelimiter;
  /** Sayı biçimindeki ondalık ayırıcı; Türkçe Excel ','. */
  decimal?: ',' | '.';
  /** Sayı ve true/false metinleri Excel'de sayı/mantıksal hücre olur; ISO tarihler tarih hücresi. */
  coerce?: boolean;
}

/** CSV → Excel sayfası: ilk satır başlık; tipler 6.1 motorundaki gibi kolon başına çıkarılır. */
export function csvToTables(text: string, options: CsvTableOptions = {}): Table[] {
  const delimiter = options.delimiter ?? ';';
  const decimal = options.decimal ?? (delimiter === ',' ? '.' : ',');
  const rows = nonEmptyRows(parseDelimited(text, delimiter));
  if (!rows.length) throw new ToolError(translate('tools', 'errors.csvEmpty'));
  const [first = [], ...rest] = rows;
  const header = uniqueHeader(first, rest);
  if (!rest.length)
    return [{ name: 'Veri', columns: header.map((key) => ({ key, type: 'text' })), rows: [] }];
  const cell = (value: string): CellValue => {
    if (value === '') return null;
    if (!options.coerce) return value;
    if (decimal === ',') {
      // Virgüllü ondalıkta noktalı sayı (1.000) binlik olabilir; metin kalır.
      if (/^-?(0|[1-9]\d{0,14})(,\d+)?$/.test(value.trim())) return Number(value.trim().replace(',', '.'));
      return value.trim() === 'true' || value.trim() === 'false' ? value.trim() === 'true' : value;
    }
    return coerceScalar(value);
  };
  const records = rest.map((row) => {
    const record: Record<string, unknown> = {};
    header.forEach((key, i) => setOwn(record, key, cell(row[i] ?? '')));
    return record;
  });
  return toTables(records, { arrays: 'json' });
}

/** Excel sayfası → CSV (ekranda BOM yok). Satırlar olduğu gibi yazılır; boş satırlar atlanır. */
export function sheetToCsv(sheet: ReadSheet, options: Omit<CsvOptions, 'bom'> = {}): string {
  const rows = nonEmptyRows(sheet.rows);
  if (!rows.length) return '';
  const width = rows.reduce((max, r) => Math.max(max, r.length), 0);
  // toCsv her zaman başlık satırı yazar: yer tutucu başlıkla yazılır ve o satır atılır.
  const table: Table = {
    name: sheet.name,
    columns: Array.from({ length: width }, (_, i) => ({ key: `k${i}`, type: 'text' as const })),
    rows: rows.map((row) => Array.from({ length: width }, (_, i) => row[i] ?? null)),
  };
  const csv = toCsv(table, { ...options, bom: false });
  return csv.slice(csv.indexOf('\r\n') + 2);
}

// ---- Query string ----

export interface JsonToQueryOptions {
  arrays?: QueryArrayFormat;
  plusSpaces?: boolean;
}

export function jsonToQuery(text: string, options: JsonToQueryOptions = {}): string {
  return stringifyQuery(parseJsonInput(text), options);
}

export function queryToJson(text: string, coerce = false): string {
  return stringify(parseQuery(text, { coerce }));
}

// ---- TOML ----

/** TOML'da karşılığı olmayan ilk `null` değerin yolu. */
function findNull(value: unknown, path: string): string | null {
  if (value === null) return path || translate('tools', 'convert.rootPath');
  if (typeof value !== 'object') return null;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const found = findNull(child, Array.isArray(value) ? `${path}[${key}]` : path ? `${path}.${key}` : key);
    if (found !== null) return found;
  }
  return null;
}

export function jsonToToml(text: string): string {
  const value = parseJsonInput(text);
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new ToolError(translate('tools', 'errors.tomlRootTable'));
  const nullPath = findNull(value, '');
  if (nullPath !== null) throw new ToolError(translate('tools', 'errors.tomlNull', { path: nullPath }));
  try {
    return stringifyToml(value);
  } catch (error) {
    throw new ToolError(
      translate('tools', 'errors.tomlWrite', {
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

/** TOML → JSON: tarih/saat değerleri ISO metni olur; `inf`/`nan` JSON'da null'dır. */
export function tomlToJson(text: string): string {
  try {
    return stringify(parseToml(text));
  } catch (error) {
    if (error instanceof TomlError) {
      const message = (error.message.split('\n')[0] ?? '').replace(/^Invalid TOML document: /, '');
      throw new ToolError(
        translate('tools', 'errors.tomlAt', { line: error.line, column: error.column, message }),
      );
    }
    throw error;
  }
}
