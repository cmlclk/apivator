import { msg } from './i18n';
/** Runner veri dosyası: her satır bir iterasyondur, sütun adları pm.iterationData anahtarlarıdır. */
export interface DataFile {
  rows: Record<string, string>[];
  columns: string[];
}

export class DataFileError extends Error {}

/** RFC 4180 CSV: tırnaklı alanlar, alan içinde "" kaçışı ve satır sonu; ilk satır başlıktır. */
export function parseCsv(text: string): DataFile {
  const source = text.replace(/^\uFEFF/, '');
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let quoted = false;
  let i = 0;
  // Ayırıcı: başlık satırında noktalı virgül virgülden fazlaysa (Excel'in Türkçe ayarı) ';'.
  const firstLine = source.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';

  while (i < source.length) {
    const ch = source[i]!;
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else {
        field += ch;
      }
      i++;
      continue;
    }
    if (ch === '"' && field === '') {
      quoted = true;
    } else if (ch === delimiter) {
      record.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      record.push(field);
      records.push(record);
      record = [];
      field = '';
      if (ch === '\r' && source[i + 1] === '\n') i++;
    } else {
      field += ch;
    }
    i++;
  }
  if (quoted) throw new DataFileError(msg('core.dataFile.csvUnterminatedQuote', 'CSV: kapanmamış tırnak.'));
  if (field !== '' || record.length) {
    record.push(field);
    records.push(record);
  }

  const nonEmpty = records.filter((r) => r.some((value) => value.trim() !== ''));
  if (!nonEmpty.length) throw new DataFileError(msg('core.dataFile.csvEmpty', 'CSV dosyası boş.'));
  const columns = nonEmpty[0]!.map((c) => c.trim());
  if (columns.some((c) => !c))
    throw new DataFileError(msg('core.dataFile.csvEmptyHeader', 'CSV başlık satırında boş sütun adı var.'));
  const rows = nonEmpty.slice(1).map((values) => {
    const row: Record<string, string> = {};
    // defineProperty: "__proto__" adlı kolon da sıradan bir alan olarak kalır, prototipe yazılmaz.
    columns.forEach((column, index) =>
      Object.defineProperty(row, column, {
        value: values[index] ?? '',
        enumerable: true,
        writable: true,
        configurable: true,
      }),
    );
    return row;
  });
  return { rows, columns };
}

/** JSON: nesne dizisi. Metin olmayan değerler JSON metnine çevrilir (Postman'deki gibi değişken değeri metindir). */
export function parseJsonData(text: string): DataFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (e) {
    throw new DataFileError(
      msg('core.dataFile.jsonUnreadable', 'JSON okunamadı: {reason}', { reason: (e as Error).message }),
    );
  }
  if (
    !Array.isArray(parsed) ||
    parsed.some((item) => typeof item !== 'object' || item === null || Array.isArray(item))
  ) {
    throw new DataFileError(
      msg('core.dataFile.jsonNotArray', 'JSON veri dosyası nesnelerden oluşan bir dizi olmalı: {example}', {
        // Örnekteki anahtar ve değer de dile göre (İngilizcede "name": "Ann").
        example: msg('core.dataFile.jsonArrayExample', '[\'{\' "ad": "Ayşe" \'}\', ...]'),
      }),
    );
  }
  const columns: string[] = [];
  const rows = (parsed as Record<string, unknown>[]).map((item) => {
    const row: Record<string, string> = {};
    for (const [key, value] of Object.entries(item)) {
      if (!columns.includes(key)) columns.push(key);
      row[key] =
        typeof value === 'string'
          ? value
          : value === null || value === undefined
            ? ''
            : JSON.stringify(value);
    }
    return row;
  });
  return { rows, columns };
}

export function parseDataFile(fileName: string, text: string): DataFile {
  const trimmed = text.trimStart();
  return fileName.toLowerCase().endsWith('.json') || trimmed.startsWith('[')
    ? parseJsonData(text)
    : parseCsv(text);
}
