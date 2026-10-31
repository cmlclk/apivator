import { msg } from '../i18n';
import { ToolError } from './errors';

/** Dize kaçışı yapılabilen diller; `csharp-verbatim` C#'ın `@"..."` biçimidir. */
export type EscapeLanguage = 'json' | 'javascript' | 'java' | 'csharp' | 'csharp-verbatim' | 'sql' | 'regex';

export interface EscapeOptions {
  /**
   * Kaçışta: sonuç dilin tırnaklarıyla sarılır (`"..."`, `@"..."`, `'...'`).
   * Çözmede: metin bu tırnaklarla sarılıysa önce soyulur.
   */
  quote?: boolean;
}

const QUOTES: Record<EscapeLanguage, [string, string]> = {
  json: ['"', '"'],
  javascript: ['"', '"'],
  java: ['"', '"'],
  csharp: ['"', '"'],
  'csharp-verbatim': ['@"', '"'],
  sql: ["'", "'"],
  regex: ['', ''],
};

const u4 = (code: number) => `\\u${code.toString(16).padStart(4, '0')}`;

/** C ailesi dillerde ortak: verilen tablo dışındaki kontrol karakterleri `\uXXXX` olur. */
function escapeWith(text: string, table: Record<string, string>, control: (code: number) => string): string {
  let out = '';
  for (const char of text) {
    const mapped = table[char];
    if (mapped !== undefined) out += mapped;
    else {
      const code = char.charCodeAt(0);
      out += code < 0x20 || code === 0x7f ? control(code) : char;
    }
  }
  return out;
}

const C_COMMON: Record<string, string> = {
  '\\': '\\\\',
  '"': '\\"',
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
  '\b': '\\b',
  '\f': '\\f',
};

function escapeBody(text: string, language: EscapeLanguage): string {
  switch (language) {
    case 'json':
      // JSON.stringify yalnızca gerekenleri kaçışlar; U+007F JSON'da serbesttir.
      return JSON.stringify(text).slice(1, -1);
    case 'javascript':
      return escapeWith(
        text,
        { ...C_COMMON, "'": "\\'", '\v': '\\v', '\0': '\\0', ' ': '\\u2028', ' ': '\\u2029' },
        (code) => `\\x${code.toString(16).padStart(2, '0')}`,
        // Ardından rakam gelen \0 sekizli kaçış olur (\01); orada \x00 yazılır.
      ).replace(/(?<!\\)((?:\\\\)*)\\0(?=[0-9])/g, '$1\\x00');
    case 'java':
      return escapeWith(text, C_COMMON, u4);
    case 'csharp':
      return escapeWith(text, { ...C_COMMON, '\0': '\\0', '\u0007': '\\a', '\v': '\\v' }, u4);
    case 'csharp-verbatim':
      return text.replace(/"/g, '""');
    case 'sql':
      return text.replace(/'/g, "''");
    case 'regex':
      return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

/** Metni seçilen dilin dize sabiti (ya da regex deseni) içinde güvenle kullanılacak biçime getirir. */
export function escapeString(text: string, language: EscapeLanguage, options: EscapeOptions = {}): string {
  const body = escapeBody(text, language);
  if (!options.quote) return body;
  const [open, close] = QUOTES[language];
  return open + body + close;
}

// ---------------------------------------------------------------- çözme

const SIMPLE: Record<string, string> = {
  n: '\n',
  r: '\r',
  t: '\t',
  b: '\b',
  f: '\f',
  v: '\v',
  a: '\u0007',
  '0': '\0',
  s: ' ',
  '"': '"',
  "'": "'",
  '\\': '\\',
  '/': '/',
  '`': '`',
};

/** Her dilin tanıdığı tek karakterlik kaçışlar. */
const ALLOWED: Record<'json' | 'javascript' | 'java' | 'csharp', string> = {
  json: 'nrtbf"\\/',
  javascript: 'nrtbfv0"\'\\`',
  java: 'nrtbfs"\'\\',
  csharp: 'nrtbfva0"\'\\',
};

const HEX = /^[0-9a-fA-F]+$/;

function fail(
  text: string,
  index: number,
  reason = msg('toolsSecurity.escape.invalid', 'Geçersiz kaçış dizisi'),
): never {
  throw new ToolError(
    msg('toolsSecurity.escape.reasonAt', '{reason}: "{snippet}" (konum {position}).', {
      reason,
      snippet: text.slice(index, index + 6),
      position: index + 1,
    }),
  );
}

function readHex(text: string, index: number, start: number, length: number): number {
  const digits = text.slice(start, start + length);
  if (digits.length !== length || !HEX.test(digits)) fail(text, index);
  return parseInt(digits, 16);
}

/** `\` kaçışlı C ailesi dizeleri (JSON, JavaScript, Java, C#). */
function unescapeC(text: string, language: keyof typeof ALLOWED): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (char !== '\\') {
      out += char;
      continue;
    }
    const start = i;
    const next = text[i + 1];
    if (next === undefined)
      fail(text, start, msg('toolsSecurity.escape.trailingBackslash', 'Metin tek bir ters bölüyle bitiyor'));
    i++;
    if (next === 'u') {
      if (language === 'javascript' && text[i + 1] === '{') {
        const end = text.indexOf('}', i);
        const digits = end < 0 ? '' : text.slice(i + 2, end);
        const code = HEX.test(digits) ? parseInt(digits, 16) : NaN;
        if (!(code <= 0x10ffff)) fail(text, start);
        out += String.fromCodePoint(code);
        i = end;
      } else {
        // Java'da \uuuu0041 gibi birden çok u geçerlidir.
        if (language === 'java') while (text[i + 1] === 'u') i++;
        out += String.fromCharCode(readHex(text, start, i + 1, 4));
        i += 4;
      }
    } else if (next === 'U' && language === 'csharp') {
      const code = readHex(text, start, i + 1, 8);
      if (code > 0x10ffff)
        fail(text, start, msg('toolsSecurity.escape.badCodePoint', 'Geçersiz kod noktası'));
      out += String.fromCodePoint(code);
      i += 8;
    } else if (next === 'x' && language === 'javascript') {
      out += String.fromCharCode(readHex(text, start, i + 1, 2));
      i += 2;
    } else if (next === 'x' && language === 'csharp') {
      // C#'ta \x 1–4 hane alır.
      const digits = /^[0-9a-fA-F]{1,4}/.exec(text.slice(i + 1))?.[0];
      if (!digits) fail(text, start);
      out += String.fromCharCode(parseInt(digits, 16));
      i += digits.length;
    } else if (language === 'java' && /[0-7]/.test(next)) {
      // Sekizli: \0 … \377
      const digits = /^(?:[0-3][0-7]{0,2}|[4-7][0-7]?)/.exec(text.slice(i))![0];
      out += String.fromCharCode(parseInt(digits, 8));
      i += digits.length - 1;
    } else if (next === '0' && language === 'javascript' && /[0-9]/.test(text[i + 1] ?? '')) {
      fail(text, start, msg('toolsSecurity.escape.octal', 'Sekizli kaçış desteklenmiyor'));
    } else if (ALLOWED[language].includes(next)) {
      out += SIMPLE[next]!;
    } else if (language === 'javascript' && (next === '\n' || next === '\r')) {
      // Satır devamı: ters bölü + satır sonu hiçbir şey üretmez.
      if (next === '\r' && text[i + 1] === '\n') i++;
    } else if (language === 'javascript' && !/[1-9]/.test(next)) {
      // JS diğer karakterlerde ters bölüyü yok sayar (\q → q).
      out += next;
    } else {
      fail(text, start);
    }
  }
  return out;
}

/** Tırnağı ikilenerek kaçışlanan dizeler: SQL `''`, C# verbatim `""`. */
function undouble(text: string, quote: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (char === quote) {
      if (text[i + 1] !== quote)
        fail(
          text,
          i,
          msg('toolsSecurity.escape.loneQuote', 'Tek başına {quote} (iki kez yazılmalı)', { quote }),
        );
      i++;
    }
    out += char;
  }
  return out;
}

/** Regex deseni: ters bölüler kaldırılır; `\n`, `\r`, `\t` karşılık geldiği karaktere döner. */
function unescapeRegex(text: string): string {
  return text.replace(/\\([\s\S]?)/g, (_, next: string, index: number) => {
    if (!next)
      fail(text, index, msg('toolsSecurity.escape.trailingBackslash', 'Metin tek bir ters bölüyle bitiyor'));
    return next === 'n' ? '\n' : next === 'r' ? '\r' : next === 't' ? '\t' : next;
  });
}

/** Kaçışlanmış dize gövdesini çözer; dile göre geçersiz kaçışta ToolError (konumla). */
export function unescapeString(text: string, language: EscapeLanguage, options: EscapeOptions = {}): string {
  let body = text;
  const [open, close] = QUOTES[language];
  if (options.quote && open) {
    const trimmed = text.trim();
    if (trimmed.length >= open.length + close.length && trimmed.startsWith(open) && trimmed.endsWith(close))
      body = trimmed.slice(open.length, -close.length);
  }
  switch (language) {
    case 'csharp-verbatim':
      return undouble(body, '"');
    case 'sql':
      return undouble(body, "'");
    case 'regex':
      return unescapeRegex(body);
    default:
      return unescapeC(body, language);
  }
}
