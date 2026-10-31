// Kod biçimlendiricilerin (XML, HTML, GraphQL) ortak hata türü ve yardımcıları.
import { ToolError } from './errors';
import { msg } from '../i18n';

/** Girinti: boşluk sayısı ya da sekme. */
export type FormatIndent = number | '\t';

/** Sözdizimi hatası; konumu (1 tabanlı satır/sütun ve 0 tabanlı ofset) ile. */
export class FormatError extends ToolError {
  readonly line: number;
  readonly column: number;

  constructor(
    readonly reason: string,
    readonly offset: number,
    text: string,
  ) {
    const { line, column } = lineColumn(text, offset);
    super(
      msg('toolsData.lineColumn', '{line}. satır, {column}. sütun: {reason}', {
        line: String(line),
        column: String(column),
        reason,
      }),
    );
    this.line = line;
    this.column = column;
  }
}

/** Ofsetin 1 tabanlı satır ve sütunu (CRLF'de `\r` sütun sayılır, satır sayılmaz). */
export function lineColumn(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let start = 0;
  const end = Math.min(offset, text.length);
  for (let i = 0; i < end; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      start = i + 1;
    }
  }
  return { line, column: end - start + 1 };
}

/** Bir girinti düzeyinin metni. */
export function indentText(indent: FormatIndent | undefined): string {
  if (indent === '\t') return '\t';
  const size = indent ?? 2;
  return ' '.repeat(Math.max(0, Math.min(8, Math.floor(size))));
}
