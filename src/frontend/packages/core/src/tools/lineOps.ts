import { msg } from '../i18n';
import { ToolError } from './errors';

/** Satır işlemlerinde karşılaştırma kuralı: Türkçe ya da İngilizce harmanlama, `raw` kod birimi sırası. */
export type LineLocale = 'tr' | 'en' | 'raw';
export type LineSortMode = 'alpha' | 'natural' | 'length';

/** Zincirdeki tek bir satır işlemi; `applyLineOps` sırayla uygular. */
export type LineOp =
  | { kind: 'sort'; mode: LineSortMode; descending: boolean; locale: LineLocale; ignoreCase: boolean }
  | { kind: 'unique'; ignoreCase: boolean; ignoreWhitespace: boolean; locale: LineLocale }
  | { kind: 'remove-empty'; whitespaceOnly: boolean }
  | { kind: 'trim' }
  | { kind: 'reverse' }
  | { kind: 'shuffle' }
  | { kind: 'affix'; prefix: string; suffix: string }
  | { kind: 'number'; start: number; separator: string; pad: boolean }
  | { kind: 'join'; separator: string }
  | { kind: 'split'; separator: string }
  | { kind: 'filter'; text: string; keep: boolean; ignoreCase: boolean; locale: LineLocale }
  | { kind: 'wrap'; width: number }
  | { kind: 'unwrap' };

export type LineOpKind = LineOp['kind'];

/** Her işlem türünün varsayılan seçenekleri (arayüzde yeni adım eklerken kullanılır). */
export const LINE_OP_DEFAULTS: { [K in LineOpKind]: Extract<LineOp, { kind: K }> } = {
  sort: { kind: 'sort', mode: 'alpha', descending: false, locale: 'tr', ignoreCase: false },
  unique: { kind: 'unique', ignoreCase: false, ignoreWhitespace: false, locale: 'tr' },
  'remove-empty': { kind: 'remove-empty', whitespaceOnly: true },
  trim: { kind: 'trim' },
  reverse: { kind: 'reverse' },
  shuffle: { kind: 'shuffle' },
  affix: { kind: 'affix', prefix: '', suffix: '' },
  number: { kind: 'number', start: 1, separator: '. ', pad: false },
  join: { kind: 'join', separator: ', ' },
  split: { kind: 'split', separator: ',' },
  filter: { kind: 'filter', text: '', keep: true, ignoreCase: true, locale: 'tr' },
  wrap: { kind: 'wrap', width: 80 },
  unwrap: { kind: 'unwrap' },
};

export const LINE_WRAP_MAX = 10_000;

export interface SplitText {
  lines: string[];
  /** Girdinin satır sonu biçimi (çoğunluk); çıktı aynı biçimle birleştirilir. */
  eol: '\n' | '\r\n';
  /** Metin satır sonuyla bitiyorsa çıktı da öyle biter. */
  trailingNewline: boolean;
}

/** Metni satırlara böler; CRLF çoğunluktaysa satır sonu `\r\n` sayılır. */
export function splitLines(text: string): SplitText {
  if (!text) return { lines: [], eol: '\n', trailingNewline: false };
  const total = countOf(text, '\n');
  const crlf = countOf(text, '\r\n');
  const eol = crlf > 0 && crlf * 2 >= total ? '\r\n' : '\n';
  const trailingNewline = text.endsWith('\n');
  const body = trailingNewline ? text.slice(0, text.endsWith('\r\n') ? -2 : -1) : text;
  return { lines: body.split(/\r?\n/), eol, trailingNewline };
}

export function joinLines({ lines, eol, trailingNewline }: SplitText): string {
  const body = lines.join(eol);
  return trailingNewline && lines.length > 0 ? body + eol : body;
}

function countOf(text: string, needle: string): number {
  let count = 0;
  for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + needle.length)) count++;
  return count;
}

/** Ayraçtaki `\n`, `\t`, `\r` ve `\\` kaçışlarını çözer (arayüzde satır sonu yazılabilsin). */
export function unescapeSeparator(text: string): string {
  return text.replace(/\\([ntr\\])/g, (_, c: string) =>
    c === 'n' ? '\n' : c === 't' ? '\t' : c === 'r' ? '\r' : '\\',
  );
}

function lower(text: string, locale: LineLocale): string {
  return locale === 'tr' ? text.toLocaleLowerCase('tr') : text.toLowerCase();
}

function comparator(op: Extract<LineOp, { kind: 'sort' }>): (a: string, b: string) => number {
  let base: (a: string, b: string) => number;
  if (op.locale === 'raw') {
    const key = (s: string) => (op.ignoreCase ? s.toLowerCase() : s);
    base = (a, b) => {
      const x = key(a);
      const y = key(b);
      return x < y ? -1 : x > y ? 1 : 0;
    };
  } else {
    // 'accent': büyük/küçük harf yok sayılır ama ç ile c ayrı kalır.
    base = new Intl.Collator(op.locale, {
      numeric: op.mode === 'natural',
      sensitivity: op.ignoreCase ? 'accent' : 'variant',
      caseFirst: 'upper',
    }).compare;
  }
  const compare = op.mode === 'length' ? (a: string, b: string) => a.length - b.length || base(a, b) : base;
  return op.descending ? (a, b) => compare(b, a) : compare;
}

/** `[0, n)` aralığında, modülo yanlılığı olmadan kriptografik rastgele tamsayı. */
export function secureRandomInt(n: number): number {
  if (n <= 1) return 0;
  const limit = Math.floor(0x1_0000_0000 / n) * n;
  const buffer = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buffer);
    if (buffer[0]! < limit) return buffer[0]! % n;
  }
}

/** Satırları en fazla `width` karakterde sözcük sınırından böler; daha uzun sözcükler bölünmez. */
function wrapLine(line: string, width: number): string[] {
  if (line.length <= width) return [line];
  const indent = /^\s*/.exec(line)![0];
  const words = line.slice(indent.length).split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let current = indent;
  for (const word of words) {
    if (current.length > indent.length && current.length + 1 + word.length > width) {
      out.push(current);
      current = indent + word;
    } else {
      current += current.length > indent.length ? ` ${word}` : word;
    }
  }
  out.push(current);
  return out;
}

/** Boş satırla ayrılmış paragrafların satırlarını tek satırda birleştirir. */
function unwrapLines(lines: string[]): string[] {
  const out: string[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) out.push(paragraph.join(' '));
    paragraph = [];
  };
  for (const line of lines) {
    if (line.trim()) {
      paragraph.push(paragraph.length ? line.trim() : line.trimEnd());
    } else {
      flush();
      out.push(line);
    }
  }
  flush();
  return out;
}

export interface LineOpResult {
  lines: string[];
  /** Tekilleştirme, boş satır silme ve filtrede çıkarılan satır sayısı. */
  removed?: number;
}

/** Tek bir işlemi satır listesine uygular. `random` karıştırmada kullanılır (varsayılan: crypto). */
export function applyLineOp(
  lines: string[],
  op: LineOp,
  random: (n: number) => number = secureRandomInt,
): LineOpResult {
  switch (op.kind) {
    case 'sort':
      return { lines: [...lines].sort(comparator(op)) };
    case 'unique': {
      const seen = new Set<string>();
      const out = lines.filter((line) => {
        let key = op.ignoreWhitespace ? line.trim().replace(/\s+/g, ' ') : line;
        if (op.ignoreCase) key = lower(key, op.locale);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      return { lines: out, removed: lines.length - out.length };
    }
    case 'remove-empty': {
      const out = lines.filter((line) => (op.whitespaceOnly ? line.trim() !== '' : line !== ''));
      return { lines: out, removed: lines.length - out.length };
    }
    case 'trim':
      return { lines: lines.map((line) => line.trim()) };
    case 'reverse':
      return { lines: [...lines].reverse() };
    case 'shuffle': {
      // Fisher–Yates.
      const out = [...lines];
      for (let i = out.length - 1; i > 0; i--) {
        const j = random(i + 1);
        [out[i], out[j]] = [out[j]!, out[i]!];
      }
      return { lines: out };
    }
    case 'affix': {
      const prefix = unescapeSeparator(op.prefix);
      const suffix = unescapeSeparator(op.suffix);
      return { lines: lines.map((line) => prefix + line + suffix) };
    }
    case 'number': {
      const start = Number.isFinite(op.start) ? Math.trunc(op.start) : 1;
      const width = op.pad ? String(start + lines.length - 1).length : 0;
      const separator = unescapeSeparator(op.separator);
      return { lines: lines.map((line, i) => String(start + i).padStart(width, '0') + separator + line) };
    }
    case 'join':
      return { lines: lines.length ? [lines.join(unescapeSeparator(op.separator))] : [] };
    case 'split': {
      const separator = unescapeSeparator(op.separator);
      if (!separator)
        throw new ToolError(msg('toolsMisc.lineOps.separatorRequired', 'Bölmek için bir ayraç girin.'));
      return { lines: lines.flatMap((line) => line.split(separator)) };
    }
    case 'filter': {
      if (!op.text) return { lines };
      const needle = op.ignoreCase ? lower(op.text, op.locale) : op.text;
      const out = lines.filter(
        (line) => (op.ignoreCase ? lower(line, op.locale) : line).includes(needle) === op.keep,
      );
      return { lines: out, removed: lines.length - out.length };
    }
    case 'wrap': {
      const width = Math.trunc(op.width);
      if (!(width >= 1 && width <= LINE_WRAP_MAX)) {
        throw new ToolError(
          msg('toolsMisc.lineOps.wrapWidth', 'Satır genişliği 1 ile {max} arasında olmalı.', {
            max: String(LINE_WRAP_MAX),
          }),
        );
      }
      return { lines: lines.flatMap((line) => wrapLine(line, width)) };
    }
    case 'unwrap':
      return { lines: unwrapLines(lines) };
  }
}

export interface LineOpsResult {
  text: string;
  /** Her adımın sonucu (çıkarılan satır sayısı ve adımdan sonraki satır sayısı). */
  steps: { removed?: number; lineCount: number }[];
}

/** İşlemleri sırayla uygular; satır sonu biçimi (LF/CRLF) ve sondaki satır sonu korunur. */
export function applyLineOps(
  text: string,
  ops: LineOp[],
  random: (n: number) => number = secureRandomInt,
): LineOpsResult {
  const split = splitLines(text);
  let lines = split.lines;
  const steps: LineOpsResult['steps'] = [];
  for (const op of ops) {
    const result = applyLineOp(lines, op, random);
    lines = result.lines;
    steps.push({ removed: result.removed, lineCount: lines.length });
  }
  return { text: joinLines({ ...split, lines }), steps };
}
