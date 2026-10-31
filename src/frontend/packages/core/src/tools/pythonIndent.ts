/**
 * Python girinti düzenleyici: sekme ↔ boşluk, girinti genişliği (mantıksal seviyeler yeniden girintilenir), karışık
 * sekme-boşluk ve tutarsız seviye uyarıları (satır numarasıyla), satır sonu boşlukları, fazla boş satırlar ve satır
 * sonu biçimi. Yalnızca boşluklar değişir: üç tırnaklı metinlerin içi olduğu gibi kalır, devam satırları (ters
 * eğik çizgi, açık parantez) sahip oldukları satırla birlikte kayar ve göreli hizalarını korur.
 */

import { msg } from '../i18n';

export type IndentStyle = 'spaces' | 'tabs';
export type LineEnding = 'keep' | 'lf' | 'crlf';

export interface PythonIndentOptions {
  /** Çıktı girintisi (varsayılan boşluk). */
  style?: IndentStyle;
  /** Bir seviyedeki boşluk sayısı (varsayılan 4). */
  width?: number;
  /** Girdideki sekmenin sütun genişliği (varsayılan 8, Python'daki gibi). */
  tabSize?: number;
  /** Satır sonu boşlukları silinsin (varsayılan açık). */
  trimTrailing?: boolean;
  /** Fazla boş satırlar PEP 8'e göre azaltılsın: üst düzeyde en fazla 2, blok içinde 1 (varsayılan açık). */
  collapseBlankLines?: boolean;
  lineEnding?: LineEnding;
}

export type PythonIndentIssueKind =
  'tab-error' | 'mixed' | 'dedent' | 'unexpected-indent' | 'expected-indent' | 'unterminated-string';

export interface PythonIndentIssue {
  /** 1'den başlayan satır numarası (girdide). */
  line: number;
  kind: PythonIndentIssueKind;
  message: string;
  /** Çıktıda düzeltildi mi. */
  fixed: boolean;
}

export interface PythonIndentResult {
  output: string;
  issues: PythonIndentIssue[];
  /** Girintili kod satırlarının dağılımı. */
  stats: { tabLines: number; spaceLines: number; mixedLines: number };
}

type Kind = 'code' | 'comment' | 'blank' | 'cont' | 'string';

interface Line {
  text: string;
  eol: string;
  kind: Kind;
  /** Satır bir metnin (string) içinde bitiyor: sondaki boşluklar metne ait. */
  endsInString: boolean;
  /** Satır sonu ters eğik çizgi ile devam ediyor (yorum dışı). */
  backslash: boolean;
  /** Önceki mantıksal satır `:` ile bitti (blok açıyor). */
  opensBlock: boolean;
}

const LEADING = /^[ \t\f]*/;

/** Girintinin görsel sütunu; form feed Python'daki gibi sütunu sıfırlar. */
function column(ws: string, tabSize: number): number {
  let col = 0;
  for (const ch of ws) {
    if (ch === '\t') col = (Math.floor(col / tabSize) + 1) * tabSize;
    else if (ch === ' ') col++;
    else col = 0;
  }
  return col;
}

/** Satırları sınıflandırır: üç tırnaklı metin içi, devam satırı, boş, yorum ya da kod. */
function scan(text: string): { lines: Line[]; finalNewline: boolean; unterminated: number | null } {
  const parts = text.split(/(\r\n|\r|\n)/);
  const raw: { text: string; eol: string }[] = [];
  for (let i = 0; i < parts.length; i += 2) raw.push({ text: parts[i]!, eol: parts[i + 1] ?? '' });
  const finalNewline = raw.length > 1 && raw.at(-1)!.text === '';
  if (finalNewline) raw.pop();

  let str: { quote: string; start: number } | null = null;
  let depth = 0;
  let backslash = false;
  let lastSig = '';
  const lines = raw.map(({ text: line, eol }, index): Line => {
    const blank = line.trim() === '';
    let kind: Kind;
    if (str) kind = 'string';
    else if (depth > 0 || backslash) kind = blank ? 'blank' : 'cont';
    else kind = blank ? 'blank' : line.trimStart().startsWith('#') ? 'comment' : 'code';
    const opensBlock = lastSig === ':';
    let comment = false;
    let i = 0;
    while (i < line.length) {
      const ch = line[i]!;
      if (str) {
        if (ch === '\\') i += 2;
        else if (line.startsWith(str.quote, i)) {
          i += str.quote.length;
          str = null;
          lastSig = '"';
        } else i++;
        continue;
      }
      if (ch === '#') {
        comment = true;
        break;
      }
      if (ch === '"' || ch === "'") {
        const quote = line.startsWith(ch.repeat(3), i) ? ch.repeat(3) : ch;
        str = { quote, start: index };
        i += quote.length;
        continue;
      }
      if ('([{'.includes(ch)) depth++;
      else if (')]}'.includes(ch)) depth = Math.max(0, depth - 1);
      if (ch !== ' ' && ch !== '\t' && ch !== '\f') lastSig = ch;
      i++;
    }
    // Tek tırnaklı metin yalnızca satır sonu ters eğik çizgiyle sürer; yoksa kapanmamış sayılıp bırakılır.
    if (str && str.quote.length === 1 && i <= line.length) str = null;
    const endsInString = str !== null;
    backslash = !str && !comment && line.endsWith('\\');
    return { text: line, eol, kind, endsInString, backslash, opensBlock };
  });
  const unterminated: number | null = (str as { start: number } | null)?.start ?? null;
  return { lines, finalNewline, unterminated };
}

/** Python 3 belirteçleyicisinin girinti denetimi (sekme 8 ve 1 sütunla karşılaştırma): TabError ve uyumsuz girinti. */
function pythonCheck(lines: Line[], issues: PythonIndentIssue[]) {
  const stack: [number, number][] = [[0, 0]];
  lines.forEach((line, index) => {
    if (line.kind !== 'code') return;
    const ws = LEADING.exec(line.text)![0];
    const col = column(ws, 8);
    const alt = column(ws, 1);
    let top = stack.at(-1)!;
    const tabError = () =>
      issues.push({
        line: index + 1,
        kind: 'tab-error',
        message: msg(
          'toolsData.python.tabError',
          'Sekme ve boşluklar tutarsız karışık; Python burada TabError verir.',
        ),
        fixed: true,
      });
    if (col === top[0]) {
      if (alt !== top[1]) tabError();
    } else if (col > top[0]) {
      if (alt <= top[1]) tabError();
      stack.push([col, alt]);
    } else {
      while (stack.length > 1 && col < stack.at(-1)![0]) stack.pop();
      top = stack.at(-1)!;
      if (col !== top[0])
        issues.push({
          line: index + 1,
          kind: 'dedent',
          message: msg(
            'toolsData.python.dedentError',
            'Girinti dış seviyelerin hiçbiriyle eşleşmiyor; Python burada IndentationError verir.',
          ),
          fixed: true,
        });
      else if (alt !== top[1]) tabError();
    }
  });
}

/** Python kaynağının girintisini ve boşluklarını düzenler; anlamı değiştirmez. */
export function reindentPython(text: string, options: PythonIndentOptions = {}): PythonIndentResult {
  const style = options.style ?? 'spaces';
  const width = Math.min(Math.max(Math.trunc(options.width ?? 4), 1), 16);
  const tabSize = Math.min(Math.max(Math.trunc(options.tabSize ?? 8), 1), 16);
  const trim = options.trimTrailing ?? true;
  const collapse = options.collapseBlankLines ?? true;
  const { lines, finalNewline, unterminated } = scan(text);
  const issues: PythonIndentIssue[] = [];
  pythonCheck(lines, issues);
  const flagged = new Set(issues.map((issue) => issue.line));
  const stats = { tabLines: 0, spaceLines: 0, mixedLines: 0 };

  const indent = (level: number) => (style === 'tabs' ? '\t'.repeat(level) : ' '.repeat(level * width));
  const stack = [0];
  /** Satırların yeni metni (null: satır silinir) ve düzeltilmiş seviyeleri (boş satır sınırı için). */
  const out: (string | null)[] = [];
  const levels: number[] = [];
  let owner = { oldWs: '', newWs: '' };

  lines.forEach((line, index) => {
    const ws = LEADING.exec(line.text)![0];
    const body = line.text.slice(ws.length);
    if (line.kind === 'string') {
      out.push(line.text);
      levels.push(-1);
      return;
    }
    if (line.kind === 'blank') {
      out.push(trim && !line.endsInString ? '' : line.text);
      levels.push(-1);
      return;
    }
    if (line.kind === 'cont') {
      out.push(continuation(ws, owner, tabSize, width, style) + body);
      levels.push(-1);
      return;
    }
    const col = column(ws, tabSize);
    let level: number;
    if (line.kind === 'comment') {
      // Yorumlar girintiyi etkilemez: en yakın seviyeye (blok açılıyorsa bir içeri) yerleştirilir.
      if (col > stack.at(-1)! && line.opensBlock) level = stack.length;
      else {
        level = stack.length - 1;
        while (level > 0 && stack[level]! > col) level--;
      }
    } else {
      if (ws.includes('\t') && ws.includes(' ')) stats.mixedLines++;
      else if (ws.includes('\t')) stats.tabLines++;
      else if (ws) stats.spaceLines++;
      const report = (kind: PythonIndentIssueKind, message: string, fixed = true) => {
        if (!flagged.has(index + 1)) issues.push({ line: index + 1, kind, message, fixed });
        flagged.add(index + 1);
      };
      if (ws.includes('\t') && ws.includes(' '))
        report('mixed', msg('toolsData.python.mixed', 'Girintide sekme ve boşluk karışık.'));
      const top = stack.at(-1)!;
      if (col > top) {
        if (line.opensBlock) stack.push(col);
        else
          report(
            'unexpected-indent',
            msg('toolsData.python.unexpectedIndent', 'Beklenmeyen girinti; önceki seviyeye hizalandı.'),
          );
      } else if (col < top) {
        let popped = top;
        while (stack.length > 1 && col < stack.at(-1)!) popped = stack.pop()!;
        const outer = stack.at(-1)!;
        if (col !== outer) {
          // Uyumsuz geri girinti en yakın seviyeye çekilir.
          if (popped - col <= col - outer) stack.push(popped);
          report(
            'dedent',
            msg(
              'toolsData.python.dedentFixed',
              'Girinti dış seviyelerin hiçbiriyle eşleşmiyor; en yakın seviyeye hizalandı.',
            ),
          );
        }
      }
      if (line.opensBlock && col <= top)
        report(
          'expected-indent',
          msg(
            'toolsData.python.expectedIndent',
            'Blok açan satırdan (":") sonra girintili satır bekleniyordu.',
          ),
          false,
        );
      level = stack.length - 1;
    }
    const newWs = indent(level);
    if (line.kind === 'code') owner = { oldWs: ws, newWs };
    out.push(newWs + body);
    levels.push(level);
  });

  if (unterminated !== null)
    issues.push({
      line: unterminated + 1,
      kind: 'unterminated-string',
      message: msg(
        'toolsData.python.unterminated',
        'Üç tırnaklı metin kapanmıyor; sonraki satırlara dokunulmadı.',
      ),
      fixed: false,
    });

  // Satır sonu boşlukları: metnin içinde biten satırlarda boşluk metne aittir. Ters eğik çizgiyle biten satır
  // kırpılırsa devam satırına dönüşür; onlara da dokunulmaz.
  if (trim) {
    out.forEach((value, i) => {
      if (value === null || lines[i]!.endsInString) return;
      const trimmed = value.replace(/[ \t\f]+$/, '');
      if (trimmed !== value && !(trimmed.endsWith('\\') && lines[i]!.kind !== 'comment')) out[i] = trimmed;
    });
  }
  if (collapse) collapseBlank(lines, out, levels);

  const eol = (i: number) =>
    options.lineEnding === 'lf' ? '\n' : options.lineEnding === 'crlf' ? '\r\n' : lines[i]!.eol || '\n';
  let output = '';
  let last = -1;
  out.forEach((value, i) => {
    if (value === null) return;
    if (last >= 0) output += eol(last);
    output += value;
    last = i;
  });
  if (finalNewline && last >= 0) output += eol(last);
  issues.sort((a, b) => a.line - b.line);
  return { output, issues, stats };
}

/** Devam satırı sahibinin girinti değişimini izler; sahibine göre göreli konumu korunur. */
function continuation(
  ws: string,
  owner: { oldWs: string; newWs: string },
  tabSize: number,
  width: number,
  style: IndentStyle,
): string {
  const onlyTabs = (s: string) => /^\t*$/.test(s);
  if (ws && onlyTabs(ws) && onlyTabs(owner.oldWs) && ws.length >= owner.oldWs.length) {
    const extra = ws.length - owner.oldWs.length;
    return owner.newWs + (style === 'tabs' ? '\t'.repeat(extra) : ' '.repeat(extra * width));
  }
  const rel = column(ws, tabSize) - column(owner.oldWs, tabSize);
  if (rel >= 0) return owner.newWs + ' '.repeat(rel);
  return ' '.repeat(Math.max(0, column(owner.newWs, tabSize) + rel));
}

/** Ardışık boş satırları azaltır: üst düzey koddan önce en fazla 2, blok içinde 1; baştaki ve sondakiler silinir. */
function collapseBlank(lines: Line[], out: (string | null)[], levels: number[]) {
  let i = 0;
  while (i < lines.length) {
    if (lines[i]!.kind !== 'blank') {
      i++;
      continue;
    }
    let end = i;
    while (end < lines.length && lines[end]!.kind === 'blank') end++;
    const next = end < lines.length ? levels[end]! : null;
    const max = i === 0 || next === null ? 0 : next === 0 ? 2 : 1;
    for (let k = i + max; k < end; k++) out[k] = null;
    i = end;
  }
}
