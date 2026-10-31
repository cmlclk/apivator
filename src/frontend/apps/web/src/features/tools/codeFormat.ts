// Kod biçimlendiricinin web'e özgü kısmı: YAML (`yaml` paketi) ve SQL (`sql-formatter`); XML/HTML/GraphQL core'da.
import { isMap, isScalar, parseAllDocuments, visit, YAMLParseError, type Document } from 'yaml';
import {
  formatDialect,
  plsql,
  postgresql,
  sql,
  sqlite,
  transactsql,
  mysql,
  type DialectOptions,
  type KeywordCase,
} from 'sql-formatter';
import { FormatError, type FormatIndent } from '@apivator/core/tools';

/** 1 tabanlı satır/sütunun ofseti. */
function offsetAt(text: string, line: number, column: number): number {
  let offset = 0;
  for (let l = 1; l < line; l++) {
    const next = text.indexOf('\n', offset);
    if (next < 0) return text.length;
    offset = next + 1;
  }
  return Math.min(text.length, offset + Math.max(0, column - 1));
}

// ---- YAML ----

export interface YamlFormatOptions {
  indent?: number;
  /** Uzun satırların katlanacağı genişlik; 0 katlamaz. */
  lineWidth?: number;
  sortKeys?: boolean;
}

/** YAML'ı yeniden yazar; yorumlar kütüphanenin izin verdiği ölçüde korunur, çok belgeli akış desteklenir. */
export function formatYaml(text: string, options: YamlFormatOptions = {}): string {
  const docs = parseAllDocuments(text) as Document[];
  if (!Array.isArray(docs)) return '';
  for (const doc of docs) {
    const error = doc.errors[0];
    if (error) throw yamlError(text, error);
  }
  return docs
    .map((doc) => {
      if (options.sortKeys) sortYamlKeys(doc);
      return doc.toString({ indent: options.indent ?? 2, lineWidth: options.lineWidth ?? 80 });
    })
    .join('')
    .trimEnd();
}

function yamlError(text: string, error: YAMLParseError): FormatError {
  // Kütüphane mesajı konumu ve kod alıntısını da içerir; yalnızca ilk cümle kalır.
  const message = (error.message.split('\n')[0] ?? error.message).replace(/ at line \d+, column \d+:?$/, '');
  return new FormatError(`YAML: ${message}`, Math.min(error.pos[0], text.length), text);
}

function sortYamlKeys(doc: Document) {
  const keyText = (key: unknown) => (isScalar(key) ? String(key.value) : String(key));
  visit(doc, {
    Map(_, map) {
      if (isMap(map)) map.items.sort((a, b) => keyText(a.key).localeCompare(keyText(b.key), 'en'));
    },
  });
}

// ---- SQL ----

export type SqlDialect = 'sql' | 'postgresql' | 'mysql' | 'tsql' | 'sqlite' | 'plsql';

export const SQL_DIALECTS: { value: SqlDialect; label: string }[] = [
  { value: 'sql', label: 'Standart SQL' },
  { value: 'postgresql', label: 'PostgreSQL' },
  { value: 'mysql', label: 'MySQL' },
  { value: 'tsql', label: 'T-SQL (SQL Server)' },
  { value: 'sqlite', label: 'SQLite' },
  { value: 'plsql', label: 'PL/SQL (Oracle)' },
];

const DIALECTS: Record<SqlDialect, DialectOptions> = {
  sql,
  postgresql,
  mysql,
  tsql: transactsql,
  sqlite,
  plsql,
};

export interface SqlFormatOptions {
  dialect?: SqlDialect;
  keywordCase?: KeywordCase;
  indent?: FormatIndent;
}

export function formatSql(text: string, options: SqlFormatOptions = {}): string {
  const indent = options.indent ?? 2;
  try {
    return formatDialect(text, {
      dialect: DIALECTS[options.dialect ?? 'sql'],
      keywordCase: options.keywordCase ?? 'upper',
      useTabs: indent === '\t',
      tabWidth: indent === '\t' ? 4 : indent,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const at = /line (\d+) column (\d+)/.exec(message);
    const reason = (message.split('\n')[0] ?? message)
      .replace(/^Parse error:\s*/, '')
      .replace(/ at line .*$/, '');
    if (!at) throw new FormatError(`SQL: ${reason}`, 0, text);
    throw new FormatError(`SQL: ${reason}`, offsetAt(text, Number(at[1]), Number(at[2])), text);
  }
}

/**
 * SQL'i tek satıra indirir: dizgi, tırnaklı ad ve `$etiket$` gövdeleri olduğu gibi kalır.
 * Yorumlar istenirse atılır; tutulursa `--` yorumu sonrasında satır sonu korunur (yoksa sorgu bozulur).
 */
export function minifySql(
  text: string,
  { removeComments = false, dialect = 'sql' as SqlDialect } = {},
): string {
  // Parçalar dizide, son karakter ayrı tutulur: büyüyen metnin sonunu okumak her seferinde onu kopyalar (O(n²)).
  const parts: string[] = [];
  let last = '';
  let space = false;
  const emit = (chunk: string) => {
    if (space && last && !'(,\n'.includes(last) && !'),;'.includes(chunk[0]!)) parts.push(' ');
    parts.push(chunk);
    last = chunk.at(-1) ?? last;
    space = false;
  };
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    const rest = text.slice(i, i + 2);
    if (/\s/.test(c)) {
      space = true;
      i++;
    } else if (rest === '--' || (c === '#' && dialect === 'mysql')) {
      const end = text.indexOf('\n', i);
      const stop = end < 0 ? text.length : end;
      if (!removeComments) {
        emit(text.slice(i, stop).trimEnd());
        if (end >= 0) {
          parts.push('\n');
          last = '\n';
        }
      } else space = true;
      i = stop;
    } else if (rest === '/*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end < 0 ? text.length : end + 2;
      if (!removeComments) emit(text.slice(i, stop));
      else space = true;
      i = stop;
    } else if (c === "'" || c === '"' || c === '`' || (c === '[' && dialect === 'tsql')) {
      const close = c === '[' ? ']' : c;
      // Ters eğik çizgi kaçışı: MySQL dizgileri ve PostgreSQL E'...' dizgileri.
      const escapes =
        c === "'" &&
        (dialect === 'mysql' ||
          (dialect === 'postgresql' && /[eE]/.test(text[i - 1] ?? '') && !/[\w$]/.test(text[i - 2] ?? '')));
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === '\\' && escapes) j += 2;
        else if (text[j] === close && text[j + 1] === close) j += 2;
        else if (text[j] === close) break;
        else j++;
      }
      emit(text.slice(i, j + 1));
      i = j + 1;
    } else if (c === '$' && dialect === 'postgresql' && /^\$[A-Za-z_]*\$/.test(text.slice(i))) {
      const tag = /^\$[A-Za-z_]*\$/.exec(text.slice(i))![0];
      const end = text.indexOf(tag, i + tag.length);
      const stop = end < 0 ? text.length : end + tag.length;
      emit(text.slice(i, stop));
      i = stop;
    } else if ('(),;'.includes(c)) {
      emit(c);
      i++;
    } else {
      const stops = dialect === 'tsql' ? /[\s'"`(),;[]/ : /[\s'"`(),;]/;
      let j = i + 1;
      while (j < text.length && !stops.test(text[j]!) && !/^(--|\/\*)/.test(text.slice(j, j + 2))) j++;
      emit(text.slice(i, j));
      i = j;
    }
  }
  return parts.join('').trim();
}

// ---- Dil tahmini ----

export type CodeLanguage = 'xml' | 'html' | 'yaml' | 'sql' | 'graphql' | 'json';

const SQL_START =
  /^(select|insert|update|delete|create|alter|drop|with|merge|truncate|grant|revoke|begin|declare|exec|execute|explain|set|use|call|replace)\b/i;
const GRAPHQL_START =
  /^(query|mutation|subscription|fragment)\b|^(type|interface|enum|input|union|scalar|directive|schema|extend)\s+[@_A-Za-z]/;

/** Girdinin hangi dile benzediğini tahmin eder; emin değilse `null`. */
export function detectCodeLanguage(text: string): CodeLanguage | null {
  const trimmed = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).trimStart();
  if (!trimmed) return null;
  if (trimmed.startsWith('<')) {
    if (/^<\?xml/i.test(trimmed)) return 'xml';
    if (/^<!doctype html/i.test(trimmed)) return 'html';
    if (
      /<(html|head|body|div|span|p|a|ul|li|table|script|style|meta|link|br|img|form|input)\b/i.test(trimmed)
    )
      return 'html';
    return 'xml';
  }
  if (/^[[{]/.test(trimmed)) {
    try {
      JSON.parse(trimmed);
      return 'json';
    } catch {
      return /^\{\s*[_A-Za-z]/.test(trimmed) ? 'graphql' : null;
    }
  }
  const code = trimmed.replace(/^(--[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)+/, '');
  if (SQL_START.test(code)) return 'sql';
  const graphql = trimmed.replace(/^(#[^\n]*\n\s*)+/, '');
  if (GRAPHQL_START.test(graphql) || /^"""/.test(graphql)) return 'graphql';
  if (/^(---|%YAML)/.test(trimmed) || /^[\w"'-][^:\n{}]*:(\s|$)/m.test(trimmed)) return 'yaml';
  return null;
}
