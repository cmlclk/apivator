import { diffLines, type DiffLine } from '../../lib/diff';

export interface NumberedLine extends DiffLine {
  /** Eski / yeni metindeki satır numarası (1'den). */
  left?: number;
  right?: number;
}

const normalize = (line: string) => line.trim().replace(/\s+/g, ' ');

/** Satır farkı; `ignoreWhitespace` ise boşluk farkları yok sayılır ama satırlar özgün haliyle gösterilir. */
export function textDiff(before: string, after: string, ignoreWhitespace: boolean): NumberedLine[] {
  const a = before === '' ? [] : before.replace(/\r\n/g, '\n').split('\n');
  const b = after === '' ? [] : after.replace(/\r\n/g, '\n').split('\n');
  // Önek, tek boş satırın diffLines'ta "boş metin" sayılıp satır kaybolmasını önler; metin a/b'den alınır.
  const key = (line: string) => `|${ignoreWhitespace ? normalize(line) : line}`;
  const raw = diffLines(a.map(key).join('\n'), b.map(key).join('\n'));
  let i = 0;
  let j = 0;
  return raw.map((line): NumberedLine => {
    if (line.kind === 'same') return { kind: 'same', text: b[j]!, left: ++i, right: ++j };
    if (line.kind === 'removed') return { kind: 'removed', text: a[i]!, left: ++i };
    return { kind: 'added', text: b[j]!, right: ++j };
  });
}
