/**
 * CSV / Excel hücrelerinden SQL INSERT (isteğe bağlı CREATE TABLE ve işlem bloğu) üretimi.
 *
 * Desteklenen lehçeler: PostgreSQL, MySQL, SQL Server, SQLite, Oracle. Tanımlayıcılar ve metin değerleri lehçeye
 * göre kaçışlanır; hücre içeriği hiçbir zaman SQL'e karışmaz (`'); DROP TABLE x; --` metin olarak kalır).
 *
 * Kararlar:
 * - Kolon tipi tüm dolu hücrelere bakılarak çıkarılır: sayı (Excel sayı hücresi ya da CSV metni), true/false ya da metin.
 *   Başında sıfır olan sayılar (`0532…`, `00123`) ve binlik noktalı değerler (`1.000`, virgüllü ondalıkta) metin kalır.
 *   Sayı yazılırken hücrenin rakam dizisi aynen kullanılır; 2^53 üstü tamsayılar hassasiyet kaybetmez.
 *   Duyarlılığı 38 haneyi aşan ya da ondalığı 30 haneyi aşan sayı kolonları metin sayılır.
 * - Boş hücre `NULL` olur; "boş metin" seçeneği yalnızca metin kolonlarında geçerlidir (sayı/mantıksalda `NULL`).
 *   Oracle boş metni zaten `NULL` sayar.
 * - SQL Server'da metin `N'…'` yazılır ve bir INSERT en fazla 1000 satır alır.
 * - Oracle'da çok satırlı VALUES yoktur: birden çok satır `INSERT ALL INTO … INTO … SELECT 1 FROM DUAL;` ile yazılır.
 *   Oracle bir `INSERT ALL`'da en fazla 999 hedef kolona izin verdiğinden satır sayısı `⌊999 / kolon⌋` ile sınırlanır.
 *   1000 karakterden uzun metinler SQL değişmez uzunluk sınırı yüzünden `TO_CLOB('…') || TO_CLOB('…')` parçalarıyla yazılır.
 * - MySQL'de ters bölü de kaçışlanır (`NO_BACKSLASH_ESCAPES` kipi desteklenmez).
 * - Tablo adındaki noktalar şema/veritabanı ayırıcısıdır; her parça ayrı tırnaklanır (en çok 4 parça).
 * - CREATE TABLE işlem bloğunun dışında yazılır (MySQL ve Oracle'da DDL işlemi zaten bitirir).
 */
import { msg } from '../i18n';
import type { CellValue } from '../tabular';
import { ToolError } from './errors';

export type SqlDialect = 'postgres' | 'mysql' | 'sqlserver' | 'sqlite' | 'oracle';
export const SQL_DIALECTS: readonly SqlDialect[] = ['postgres', 'mysql', 'sqlserver', 'sqlite', 'oracle'];

export type SqlColumnKind = 'integer' | 'decimal' | 'boolean' | 'text';

export const SQL_MAX_ROWS = 200_000;
export const SQL_MAX_COLUMNS = 1000;
export const SQL_MAX_CELLS = 5_000_000;
const SQLSERVER_MAX_ROWS_PER_INSERT = 1000;
const ORACLE_MAX_INSERT_ALL_COLUMNS = 999;
const ORACLE_CLOB_CHUNK = 1000;
const MAX_TABLE_PARTS = 4;
const MAX_PRECISION = 38;
const MAX_SCALE = 30;
/** Bu kadar haneye kadar tamsayı BIGINT'e sığar. */
const MAX_BIGINT_DIGITS = 18;

export interface SqlInsertOptions {
  /** Tablo adı; şema önekli olabilir (`dbo.users`). */
  table: string;
  dialect: SqlDialect;
  /** İlk dolu satır kolon adlarıdır (varsayılan true); değilse `column_1…`. */
  header?: boolean;
  /** 1 = satır başına INSERT; >1 çok satırlı INSERT (SQL Server'da en çok 1000). */
  rowsPerStatement?: number;
  /** Kolon tiplerini çıkar (varsayılan true); kapalıyken her şey metin. */
  inferTypes?: boolean;
  /** Metin hücrelerdeki ondalık ayırıcı (varsayılan '.'); sayı hücrelerini etkilemez. */
  decimal?: ',' | '.';
  /** Boş hücre: NULL (varsayılan) ya da boş metin. */
  emptyAs?: 'null' | 'empty';
  createTable?: boolean;
  transaction?: boolean;
}

export interface SqlColumn {
  name: string;
  kind: SqlColumnKind;
  /** Lehçedeki kolon tipi (CREATE TABLE'da kullanılan). */
  sqlType: string;
}

export interface SqlInsertResult {
  sql: string;
  columns: SqlColumn[];
  /** Yazılan veri satırı sayısı (başlık ve boş satırlar hariç). */
  rowCount: number;
  /** Uygulanan INSERT başına satır (lehçe sınırlarıyla kısıtlanmış). */
  rowsPerStatement: number;
}

// ---- Tanımlayıcı ve değişmez değer kaçışı ----

export function sqlQuoteIdentifier(dialect: SqlDialect, name: string): string {
  if (dialect === 'mysql') return '`' + name.replace(/`/g, '``') + '`';
  if (dialect === 'sqlserver') return '[' + name.replace(/\]/g, ']]') + ']';
  return '"' + name.replace(/"/g, '""') + '"';
}

/** Metni lehçenin değişmez değer biçimine çevirir. */
export function sqlQuoteText(dialect: SqlDialect, text: string): string {
  if (dialect === 'mysql') return "'" + text.replace(/\\/g, '\\\\').replace(/'/g, "''") + "'";
  const quoted = "'" + text.replace(/'/g, "''") + "'";
  if (dialect === 'sqlserver') return 'N' + quoted;
  if (dialect === 'oracle' && text.length > ORACLE_CLOB_CHUNK) {
    const parts: string[] = [];
    for (let i = 0; i < text.length;) {
      let end = Math.min(i + ORACLE_CLOB_CHUNK, text.length);
      // Vekil çiftini ortadan bölmez.
      const last = text.charCodeAt(end - 1);
      if (end < text.length && last >= 0xd800 && last <= 0xdbff) end--;
      parts.push(`TO_CLOB(${"'" + text.slice(i, end).replace(/'/g, "''") + "'"})`);
      i = end;
    }
    return parts.join(' || ');
  }
  return quoted;
}

function tableName(dialect: SqlDialect, table: string): string {
  const parts = table.split('.').map((p) => p.trim());
  if (parts.length === 1 && parts[0] === '')
    throw new ToolError(msg('toolsData.sqlInsert.noTable', 'Tablo adı gerekli.'));
  if (parts.length > MAX_TABLE_PARTS || parts.some((p) => p === ''))
    throw new ToolError(
      msg(
        'toolsData.sqlInsert.badTable',
        'Geçersiz tablo adı: {table}. Biçim: sema.tablo (en çok 4 parça).',
        {
          table,
        },
      ),
    );
  return parts.map((p) => sqlQuoteIdentifier(dialect, p)).join('.');
}

// ---- Hücre ayrıştırma ----

const NUMBER = {
  '.': /^-?(0|[1-9]\d*)(?:\.(\d+))?$/,
  ',': /^-?(0|[1-9]\d*)(?:,(\d+))?$/,
} as const;

/** Üstel gösterimi (1e-7, 1e21) düz rakam dizisine çevirir; çevrilemezse null. */
function plainNumber(n: number): string | null {
  if (!Number.isFinite(n)) return null;
  const text = String(n);
  if (!/e/i.test(text)) return text;
  if (Number.isInteger(n)) return BigInt(n).toString();
  const [mantissa = '', exp = '0'] = text.toLowerCase().split('e');
  const digits = (mantissa.split('.')[1]?.length ?? 0) - Number(exp);
  return digits <= 100 ? n.toFixed(digits) : null;
}

interface ParsedNumber {
  /** SQL'e yazılacak rakam dizisi (ondalık nokta). */
  literal: string;
  intDigits: number;
  scale: number;
}

function parseNumber(cell: CellValue, decimal: ',' | '.'): ParsedNumber | null {
  let text: string;
  let pattern: RegExp = NUMBER[decimal];
  if (typeof cell === 'number') {
    const plain = plainNumber(cell);
    if (plain === null) return null;
    text = plain;
    pattern = NUMBER['.'];
  } else if (typeof cell === 'string') text = cell.trim();
  else return null;
  const match = pattern.exec(text);
  if (!match) return null;
  return { literal: text.replace(',', '.'), intDigits: match[1]!.length, scale: match[2]?.length ?? 0 };
}

function parseBoolean(cell: CellValue): boolean | null {
  if (typeof cell === 'boolean') return cell;
  if (typeof cell !== 'string') return null;
  const text = cell.trim().toLowerCase();
  return text === 'true' ? true : text === 'false' ? false : null;
}

const isEmpty = (cell: CellValue | undefined): cell is null | undefined | '' =>
  cell === null || cell === undefined || cell === '';

const textOf = (cell: CellValue): string =>
  typeof cell === 'number' ? (plainNumber(cell) ?? String(cell)) : String(cell);

// ---- Kolon tipi çıkarımı ----

interface Probe {
  seen: number;
  numeric: boolean;
  boolean: boolean;
  intDigits: number;
  scale: number;
  maxLength: number;
}

function inferColumns(
  names: string[],
  rows: CellValue[][],
  dialect: SqlDialect,
  infer: boolean,
  decimal: ',' | '.',
): SqlColumn[] {
  const probes: Probe[] = names.map(() => ({
    seen: 0,
    numeric: true,
    boolean: true,
    intDigits: 0,
    scale: 0,
    maxLength: 0,
  }));
  for (const row of rows) {
    for (let i = 0; i < names.length; i++) {
      const cell = row[i];
      if (isEmpty(cell)) continue;
      const probe = probes[i]!;
      probe.seen++;
      probe.maxLength = Math.max(probe.maxLength, textOf(cell).length);
      if (!infer) continue;
      const number = probe.numeric ? parseNumber(cell, decimal) : null;
      if (number) {
        probe.intDigits = Math.max(probe.intDigits, number.intDigits);
        probe.scale = Math.max(probe.scale, number.scale);
      } else probe.numeric = false;
      if (probe.boolean && parseBoolean(cell) === null) probe.boolean = false;
    }
  }
  return names.map((name, i) => {
    const probe = probes[i]!;
    const kind = columnKind(probe, infer);
    return { name, kind, sqlType: sqlType(dialect, kind, probe) };
  });
}

function columnKind(probe: Probe, infer: boolean): SqlColumnKind {
  if (!infer || probe.seen === 0) return 'text';
  if (probe.boolean) return 'boolean';
  if (!probe.numeric) return 'text';
  if (probe.scale === 0 && probe.intDigits <= MAX_BIGINT_DIGITS) return 'integer';
  return probe.intDigits + probe.scale <= MAX_PRECISION && probe.scale <= MAX_SCALE ? 'decimal' : 'text';
}

function sqlType(dialect: SqlDialect, kind: SqlColumnKind, probe: Probe): string {
  const precision = `${probe.intDigits + probe.scale}, ${probe.scale}`;
  const small = probe.intDigits <= 9;
  switch (kind) {
    case 'integer':
      if (dialect === 'oracle') return small ? 'NUMBER(10)' : 'NUMBER(19)';
      if (dialect === 'sqlite') return 'INTEGER';
      if (dialect === 'postgres') return small ? 'integer' : 'bigint';
      return small ? 'INT' : 'BIGINT';
    case 'decimal':
      if (dialect === 'postgres') return `numeric(${precision})`;
      if (dialect === 'sqlite') return 'NUMERIC';
      return `${dialect === 'oracle' ? 'NUMBER' : 'DECIMAL'}(${precision})`;
    case 'boolean':
      return {
        postgres: 'boolean',
        mysql: 'TINYINT(1)',
        sqlserver: 'BIT',
        sqlite: 'INTEGER',
        oracle: 'NUMBER(1)',
      }[dialect];
    default:
      if (dialect === 'oracle')
        return probe.maxLength <= ORACLE_CLOB_CHUNK ? `NVARCHAR2(${Math.max(probe.maxLength, 1)})` : 'CLOB';
      return { postgres: 'text', mysql: 'TEXT', sqlserver: 'NVARCHAR(MAX)', sqlite: 'TEXT' }[dialect];
  }
}

// ---- Çıktı ----

function cellSql(
  cell: CellValue | undefined,
  column: SqlColumn,
  options: Required<SqlInsertOptions>,
): string {
  const { dialect, decimal } = options;
  if (isEmpty(cell))
    return column.kind === 'text' && options.emptyAs === 'empty' ? sqlQuoteText(dialect, '') : 'NULL';
  if (column.kind === 'integer' || column.kind === 'decimal') return parseNumber(cell, decimal)!.literal;
  if (column.kind === 'boolean') {
    const value = parseBoolean(cell);
    return dialect === 'postgres' ? (value ? 'TRUE' : 'FALSE') : value ? '1' : '0';
  }
  return sqlQuoteText(dialect, textOf(cell));
}

/** Başlık satırından benzersiz (büyük/küçük harf duyarsız) kolon adları: boş → column_N, yineleme → _2, _3. */
function columnNames(width: number, header: CellValue[] | null): string[] {
  const used = new Set<string>();
  return Array.from({ length: width }, (_, i) => {
    const cell = header?.[i];
    const base = isEmpty(cell) || String(cell).trim() === '' ? `column_${i + 1}` : String(cell).trim();
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base}_${n}`;
    used.add(name.toLowerCase());
    return name;
  });
}

function insertStatements(
  options: Required<SqlInsertOptions>,
  table: string,
  columnList: string,
  rows: string[][],
  perStatement: number,
): string[] {
  const out: string[] = [];
  const values = (row: string[]) => `(${row.join(', ')})`;
  for (let i = 0; i < rows.length; i += perStatement) {
    const group = rows.slice(i, i + perStatement);
    if (group.length === 1) out.push(`INSERT INTO ${table} (${columnList}) VALUES ${values(group[0]!)};`);
    else if (options.dialect === 'oracle')
      out.push(
        'INSERT ALL',
        ...group.map((row) => `  INTO ${table} (${columnList}) VALUES ${values(row)}`),
        'SELECT 1 FROM DUAL;',
      );
    else
      out.push(
        `INSERT INTO ${table} (${columnList}) VALUES`,
        group.map((row) => `  ${values(row)}`).join(',\n') + ';',
      );
  }
  return out;
}

const BEGIN = {
  postgres: 'BEGIN;',
  mysql: 'START TRANSACTION;',
  sqlserver: 'BEGIN TRANSACTION;',
  sqlite: 'BEGIN;',
  // Oracle'da işlem ilk DML ile başlar; açık bir başlangıç deyimi yoktur (BEGIN PL/SQL bloğu açar).
  oracle: null,
} as const;

/** Hücre matrisinden SQL metni üretir. Girdi çok büyükse ya da tablo adı geçersizse ToolError fırlatır. */
export function buildSqlInsert(input: CellValue[][], opts: SqlInsertOptions): SqlInsertResult {
  const options: Required<SqlInsertOptions> = {
    header: true,
    rowsPerStatement: 1,
    inferTypes: true,
    decimal: '.',
    emptyAs: 'null',
    createTable: false,
    transaction: false,
    ...opts,
  };
  const { dialect } = options;
  const table = tableName(dialect, options.table);
  if (input.length > SQL_MAX_ROWS + 1)
    throw new ToolError(
      msg('toolsData.sqlInsert.tooManyRows', 'En fazla {max} satır işlenebilir (bulunan: {count}).', {
        max: SQL_MAX_ROWS,
        count: input.length,
      }),
    );

  const filled = input.filter((row) => row.some((cell) => !isEmpty(cell)));
  if (!filled.length) throw new ToolError(msg('toolsData.sqlInsert.noData', 'Çevrilecek veri yok.'));
  const headerRow = options.header ? filled[0]! : null;
  const data = options.header ? filled.slice(1) : filled;
  if (!data.length && !options.createTable)
    throw new ToolError(msg('toolsData.sqlInsert.noRows', 'Başlık satırından sonra veri satırı yok.'));

  // Yayma (...) çok satırda yığını taşırır; döngüyle.
  let width = headerRow?.length ?? 0;
  for (const row of data) width = Math.max(width, row.length);
  if (width > SQL_MAX_COLUMNS)
    throw new ToolError(
      msg('toolsData.sqlInsert.tooManyColumns', 'En fazla {max} kolon desteklenir (bulunan: {count}).', {
        max: SQL_MAX_COLUMNS,
        count: width,
      }),
    );
  if (data.length * width > SQL_MAX_CELLS)
    throw new ToolError(
      msg('toolsData.sqlInsert.tooManyCells', 'Veri çok büyük: en fazla {max} hücre işlenebilir.', {
        max: SQL_MAX_CELLS,
      }),
    );

  const columns = inferColumns(
    columnNames(width, headerRow),
    data,
    dialect,
    options.inferTypes,
    options.decimal,
  );
  const columnList = columns.map((c) => sqlQuoteIdentifier(dialect, c.name)).join(', ');

  let perStatement = Math.max(1, Math.floor(options.rowsPerStatement) || 1);
  if (dialect === 'sqlserver') perStatement = Math.min(perStatement, SQLSERVER_MAX_ROWS_PER_INSERT);
  if (dialect === 'oracle')
    perStatement = Math.min(perStatement, Math.max(1, Math.floor(ORACLE_MAX_INSERT_ALL_COLUMNS / width)));

  const rows = data.map((row) => columns.map((column, i) => cellSql(row[i], column, options)));
  const out: string[] = [];
  if (options.createTable) {
    out.push(
      `CREATE TABLE ${table} (`,
      columns.map((c) => `  ${sqlQuoteIdentifier(dialect, c.name)} ${c.sqlType}`).join(',\n'),
      ');',
    );
    if (rows.length) out.push('');
  }
  const begin = BEGIN[dialect];
  if (options.transaction && begin && rows.length) out.push(begin);
  out.push(...insertStatements(options, table, columnList, rows, perStatement));
  if (options.transaction && rows.length) out.push('COMMIT;');
  return { sql: out.join('\n') + '\n', columns, rowCount: rows.length, rowsPerStatement: perStatement };
}
