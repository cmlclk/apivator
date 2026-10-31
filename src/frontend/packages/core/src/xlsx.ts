import { msg } from './i18n';
/**
 * Office Open XML (.xlsx) yazıcı: başlık satırı kalın ve sabit, kolon tipleri (sayı, tarih, mantıksal, metin),
 * otomatik süzgeç ve içeriğe göre kolon genişliği. Formül yazılmaz; tüm metinler hücreye değer olarak gider.
 */
import type { CellValue, ColumnType, Table } from './tabular';
import { createZip } from './zip';

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const XLSX_MAX_ROWS = 1_048_576;
const MAX_CELL_TEXT = 32_767;

const STYLE = { header: 1, date: 2, datetime: 3 } as const;

function escapeXml(text: string): string {
  return (
    text
      // XML 1.0'da geçersiz kontrol karakterleri atılır (sekme, satır sonu kalır).
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  );
}

/** Kolon numarasından harf: 0 → A, 26 → AA. */
export function columnName(index: number): string {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

/**
 * ISO tarihten Excel seri numarası. Saat dilimi bilgisi atılır; API'nin yazdığı tarih ve saat olduğu gibi görünür
 * (`2026-10-23T10:00:00+03:00` → 23.10.2026 10:00).
 */
export function excelDate(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?)?/.exec(iso);
  if (!m) return null;
  const [, y, mo, d, h = '0', mi = '0', s = '0', frac = '0'] = m;
  const ms = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s),
    Number(`0.${frac}`) * 1000,
  );
  if (Number.isNaN(ms)) return null;
  return ms / 86_400_000 + 25_569;
}

function cellXml(ref: string, value: CellValue, type: ColumnType): string {
  if (value === null || value === '') return '';
  if (typeof value === 'number') return `<c r="${ref}"><v>${value}</v></c>`;
  if (typeof value === 'boolean') return `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`;
  if (type === 'date' || type === 'datetime') {
    const serial = excelDate(value);
    if (serial !== null) return `<c r="${ref}" s="${STYLE[type]}"><v>${serial}</v></c>`;
  }
  const text = value.length > MAX_CELL_TEXT ? value.slice(0, MAX_CELL_TEXT) : value;
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;
}

function displayLength(value: CellValue, type: ColumnType): number {
  if (value === null) return 0;
  if (type === 'date') return 10;
  if (type === 'datetime') return 16;
  return String(value).split('\n')[0]!.length;
}

function sheetXml(table: Table): string {
  const columns = table.columns;
  const widths = columns.map((column, i) => {
    let max = column.key.length + 2; // süzgeç oku için pay
    for (let r = 0; r < table.rows.length && r < 1000; r++)
      max = Math.max(max, displayLength(table.rows[r]![i] ?? null, column.type));
    return Math.min(60, Math.max(8, Math.ceil(max * 1.1) + 1));
  });
  const last = columnName(Math.max(columns.length - 1, 0));
  const header = columns
    .map(
      (c, i) =>
        `<c r="${columnName(i)}1" s="${STYLE.header}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(c.key)}</t></is></c>`,
    )
    .join('');

  const parts: string[] = [];
  parts.push(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    `<dimension ref="A1:${last}${table.rows.length + 1}"/>`,
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>',
    '<sheetFormatPr defaultRowHeight="15"/>',
  );
  if (columns.length) {
    parts.push(
      `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`,
    );
  }
  parts.push('<sheetData>', `<row r="1">${header}</row>`);
  table.rows.forEach((row, r) => {
    const n = r + 2;
    parts.push(
      `<row r="${n}">${row.map((value, i) => cellXml(`${columnName(i)}${n}`, value, columns[i]!.type)).join('')}</row>`,
    );
  });
  parts.push('</sheetData>');
  if (columns.length && table.rows.length)
    parts.push(`<autoFilter ref="A1:${last}${table.rows.length + 1}"/>`);
  parts.push('</worksheet>');
  return parts.join('');
}

/** Excel sayfa adı kuralları: en fazla 31 karakter, `[]:*?/\` yok, benzersiz. */
export function sheetNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((raw) => {
    const base =
      raw
        .replace(/[[\]:*?/\\]/g, '_')
        .replace(/^'+|'+$/g, '')
        .trim()
        .slice(0, 31) || 'Sayfa';
    let name = base;
    for (let i = 2; used.has(name.toLowerCase()); i++)
      name = `${base.slice(0, 31 - String(i).length - 3)} (${i})`;
    used.add(name.toLowerCase());
    return name;
  });
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="dd.mm.yyyy"/><numFmt numFmtId="165" formatCode="dd.mm.yyyy hh:mm:ss"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF0EFEC"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/** Süzgeç aralıkları (Excel'in kendi yazdığı gizli adlar; tek `definedNames` öğesinde). */
function definedNames(tables: Table[], names: string[]): string {
  const items = tables
    .map((t, i) =>
      t.columns.length && t.rows.length
        ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${escapeXml(names[i]!.replace(/'/g, "''"))}'!$A$1:$${columnName(t.columns.length - 1)}$${t.rows.length + 1}</definedName>`
        : '',
    )
    .join('');
  return items ? `<definedNames>${items}</definedNames>` : '';
}

/** Tabloları (her biri bir sayfa) .xlsx dosyasına yazar. */
export async function toXlsx(tables: Table[]): Promise<Uint8Array> {
  if (tables.length === 0) throw new Error(msg('core.xlsx.tableRequired', 'En az bir tablo gerekli.'));
  for (const table of tables) {
    if (table.rows.length + 1 > XLSX_MAX_ROWS) {
      throw new Error(
        msg(
          'core.xlsx.tooManyRows',
          '"{name}" {rows} satır; Excel bir sayfada en fazla {max} veri satırı açabilir. CSV olarak kaydedin.',
          { name: table.name, rows: table.rows.length, max: XLSX_MAX_ROWS - 1 },
        ),
      );
    }
  }
  const names = sheetNames(tables.map((t) => t.name));
  const encoder = new TextEncoder();
  const file = (name: string, text: string) => ({ name, data: encoder.encode(text) });

  const entries = [
    file(
      '[Content_Types].xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${tables
        .map(
          (_, i) =>
            `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
        )
        .join('')}</Types>`,
    ),
    file(
      '_rels/.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    ),
    file(
      'xl/workbook.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names
        .map((name, i) => `<sheet name="${escapeXml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join('')}</sheets>${definedNames(tables, names)}</workbook>`,
    ),
    file(
      'xl/_rels/workbook.xml.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${tables
        .map(
          (_, i) =>
            `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
        )
        .join(
          '',
        )}<Relationship Id="rId${tables.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ),
    file('xl/styles.xml', STYLES),
    ...tables.map((table, i) => file(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(table))),
  ];
  return createZip(entries);
}
