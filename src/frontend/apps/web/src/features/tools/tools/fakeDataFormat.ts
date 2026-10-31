// Sahte veri aracının şema ayrıştırma, parça parça üretim ve çıktı biçimleri (JSON / CSV / SQL INSERT).
import { toCsv, type Table } from '@apivator/core';
import { translate } from '../../../i18n';
import {
  fakeRecord,
  isFakeGenerator,
  type FakeContext,
  type FakeField,
  type FakeValue,
} from '@apivator/core/tools';

export type FakeOutputFormat = 'json' | 'csv' | 'sql';
export type FakeRecord = Record<string, FakeValue>;

export const FAKE_MAX_COUNT = 10_000;
/** Bir seferde üretilen kayıt; aradaki boşlukta arayüz yanıt verir. */
export const FAKE_CHUNK = 500;

export const DEFAULT_SCHEMA = [
  'ad_soyad: fullName',
  'eposta: email',
  'telefon: phone',
  'tckn: tckn',
  'dogum_tarihi: birthDate',
  'adres: address',
  'il: city',
  'sirket: company',
  'iban: iban',
].join('\n');

export interface SchemaParse {
  fields: FakeField[];
  errors: string[];
}

/** Her satır `alan: üreteç`; boş satırlar ve `#` ile başlayanlar atlanır. */
export function parseSchema(text: string): SchemaParse {
  const fields: FakeField[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const colon = line.lastIndexOf(':');
    const name = colon < 0 ? '' : line.slice(0, colon).trim();
    const generator = colon < 0 ? line : line.slice(colon + 1).trim();
    if (!name) errors.push(translate('toolsSecurity', 'fakeData.errors.missingName', { line: index + 1 }));
    else if (!isFakeGenerator(generator))
      errors.push(
        translate('toolsSecurity', 'fakeData.errors.unknownGenerator', { line: index + 1, generator }),
      );
    else if (seen.has(name))
      errors.push(translate('toolsSecurity', 'fakeData.errors.duplicateField', { line: index + 1, name }));
    else {
      seen.add(name);
      fields.push({ name, generator });
    }
  });
  return { fields, errors };
}

export function schemaText(fields: readonly FakeField[]): string {
  return fields.map((f) => `${f.name}: ${f.generator}`).join('\n');
}

/**
 * Kayıtları `FAKE_CHUNK`'lık parçalarla üretir, parçalar arasında olay döngüsüne döner (10 000 kayıtta
 * arayüz donmaz). `signal` iptal edilirse yarıda bırakır ve null döner.
 */
export async function generateRecords(
  fields: readonly FakeField[],
  count: number,
  ctx: FakeContext,
  { signal, onProgress }: { signal?: AbortSignal; onProgress?: (done: number) => void } = {},
): Promise<FakeRecord[] | null> {
  const records: FakeRecord[] = [];
  while (records.length < count) {
    if (signal?.aborted) return null;
    const end = Math.min(count, records.length + FAKE_CHUNK);
    while (records.length < end) records.push(fakeRecord(fields, ctx));
    onProgress?.(records.length);
    if (records.length < count) await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return signal?.aborted ? null : records;
}

const sqlIdentifier = (name: string) =>
  name
    .split('.')
    .map((part) => `"${part.replace(/"/g, '""')}"`)
    .join('.');

function sqlValue(value: FakeValue): string {
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return `'${value.replace(/'/g, "''")}'`;
}

export function formatRecords(
  records: readonly FakeRecord[],
  fields: readonly FakeField[],
  format: FakeOutputFormat,
  tableName = 'test_verisi',
): string {
  if (format === 'json') return JSON.stringify(records, null, 2);
  if (format === 'csv') {
    const table: Table = {
      name: 'veri',
      columns: fields.map((f) => ({ key: f.name, type: 'text' })),
      rows: records.map((r) => fields.map((f) => r[f.name] ?? null)),
    };
    // Ekranda BOM gösterilmez; indirirken eklenir.
    return toCsv(table, { delimiter: ';', bom: false });
  }
  const table = sqlIdentifier(tableName.trim() || 'test_verisi');
  const columns = fields.map((f) => sqlIdentifier(f.name)).join(', ');
  return records
    .map(
      (r) =>
        `INSERT INTO ${table} (${columns}) VALUES (${fields.map((f) => sqlValue(r[f.name]!)).join(', ')});`,
    )
    .join('\n');
}

export const FORMAT_FILES: Record<FakeOutputFormat, { ext: string; mime: string }> = {
  json: { ext: 'json', mime: 'application/json' },
  csv: { ext: 'csv', mime: 'text/csv' },
  sql: { ext: 'sql', mime: 'application/sql' },
};
