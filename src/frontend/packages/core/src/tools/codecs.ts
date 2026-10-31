import { msg } from '../i18n';
import { ToolError } from './errors';

// ---------------------------------------------------------------- Unicode kaçış

/**
 * `utf16`: `ç`, BMP dışı karakterler vekil çiftiyle (`😀`; JSON, Java, C#, JS);
 * `codepoint`: `\u{1F600}` (ES2015, Rust, Swift); `python`: BMP dışı `\U0001F600`.
 */
export type UnicodeEscapeStyle = 'utf16' | 'codepoint' | 'python';

export interface UnicodeEscapeOptions {
  style?: UnicodeEscapeStyle;
  /** ASCII karakterler de kaçışlanır. */
  all?: boolean;
  upper?: boolean;
}

function hex(code: number, width: number, upper: boolean): string {
  const digits = code.toString(16).padStart(width, '0');
  return upper ? digits.toUpperCase() : digits;
}

/** ASCII dışındaki (istenirse tüm) karakterleri `\uXXXX` biçiminde yazar. */
export function unicodeEscape(text: string, options: UnicodeEscapeOptions = {}): string {
  const { style = 'utf16', all = false, upper = false } = options;
  let out = '';
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (!all && code < 0x80) {
      out += char;
    } else if (style === 'codepoint') {
      out += `\\u{${hex(code, 1, upper)}}`;
    } else if (style === 'python' && code > 0xffff) {
      out += `\\U${hex(code, 8, upper)}`;
    } else {
      for (let i = 0; i < char.length; i++) out += `\\u${hex(char.charCodeAt(i), 4, upper)}`;
    }
  }
  return out;
}

const UNICODE_ESCAPE =
  /\\\\|\\u\{([0-9a-fA-F]{1,6})\}|\\u([0-9a-fA-F]{4})|\\U([0-9a-fA-F]{8})|\\x([0-9a-fA-F]{2})|\\[uUx]|U\+([0-9a-fA-F]{4,6})(?![0-9a-fA-F])/g;

export interface UnicodeUnescapeOptions {
  /** Eksik ya da hatalı dizide (`\u12`, aralık dışı kod noktası) ToolError fırlatılır. */
  strict?: boolean;
}

/**
 * `\uXXXX`, `\u{...}`, `\UXXXXXXXX`, `\xXX` ve `U+XXXX` dizilerini çözer; vekil çiftleri birleşir.
 * `\\` kaçışlı ters bölü sayılır ve olduğu gibi kalır; diğer kaçışlara (`\n` gibi) dokunulmaz.
 * Hatalı diziler (ör. `C:\Users` içindeki `\U`) varsayılan olarak olduğu gibi bırakılır;
 * `strict` ile konumlu ToolError fırlatılır.
 */
export function unicodeUnescape(text: string, options: UnicodeUnescapeOptions = {}): string {
  const invalid = (match: string, index: number, reason: string): string => {
    if (!options.strict) return match;
    throw new ToolError(
      msg('toolsSecurity.codec.reasonAt', '{reason}: "{snippet}" (konum {position}).', {
        reason,
        snippet: text.slice(index, index + 6),
        position: index + 1,
      }),
    );
  };
  const codePoint = (match: string, value: string, index: number): string => {
    const code = parseInt(value, 16);
    return code > 0x10ffff
      ? invalid(match, index, msg('toolsSecurity.codec.badCodePoint', 'Geçersiz kod noktası'))
      : String.fromCodePoint(code);
  };
  return text.replace(
    UNICODE_ESCAPE,
    (match, brace?: string, u4?: string, u8?: string, x2?: string, plus?: string, index = 0) => {
      if (match === '\\\\') return match;
      if (brace !== undefined) return codePoint(match, brace, index);
      if (u4 !== undefined) return String.fromCharCode(parseInt(u4, 16));
      if (u8 !== undefined) return codePoint(match, u8, index);
      if (x2 !== undefined) return String.fromCharCode(parseInt(x2, 16));
      if (plus !== undefined) return codePoint(match, plus, index);
      return invalid(match, index, msg('toolsSecurity.codec.badEscape', 'Hatalı kaçış dizisi'));
    },
  );
}

// ---------------------------------------------------------------- Hex

/** `none`: `48656c`; `space`: `48 65 6c`; `colon`: `48:65:6c`; `0x`: `0x48 0x65`; `\x`: `\x48\x65`. */
export type HexSeparator = 'none' | 'space' | 'colon' | '0x' | '\\x';

export interface HexFormatOptions {
  separator?: HexSeparator;
  upper?: boolean;
}

export function bytesToHex(bytes: Uint8Array, options: HexFormatOptions = {}): string {
  const { separator = 'none', upper = false } = options;
  const parts = Array.from(bytes, (b) => hex(b, 2, upper));
  switch (separator) {
    case 'space':
      return parts.join(' ');
    case 'colon':
      return parts.join(':');
    case '0x':
      return parts.map((p) => `0x${p}`).join(' ');
    case '\\x':
      return parts.map((p) => `\\x${p}`).join('');
    default:
      return parts.join('');
  }
}

const HEX_DIGIT = /[0-9a-fA-F]/;
const HEX_SEPARATOR = /[\s,:;-]/;

/**
 * Boşluk, `,` `:` `;` `-` ayraçlarını ve bayt önündeki `0x` / `\x` öneklerini kabul eder.
 * Geçersiz karakter ya da tek sayıda hane ToolError fırlatır.
 */
export function hexToBytes(text: string): Uint8Array {
  const digits: string[] = [];
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    const next = text[i + 1];
    // Önek yalnızca bayt sınırında anlamlı: "a0x1" içindeki 0 bir hanedir.
    if ((char === '\\' || (char === '0' && digits.length % 2 === 0)) && (next === 'x' || next === 'X')) {
      i++;
      continue;
    }
    if (HEX_SEPARATOR.test(char)) continue;
    if (!HEX_DIGIT.test(char))
      throw new ToolError(
        msg('toolsSecurity.codec.hexChar', 'Geçersiz hex karakteri: "{char}" (konum {position}).', {
          char,
          position: i + 1,
        }),
      );
    digits.push(char);
  }
  if (digits.length % 2 === 1) {
    throw new ToolError(
      msg('toolsSecurity.codec.hexOdd', 'Tek sayıda hex hanesi ({count}): her bayt iki haneyle yazılmalı.', {
        count: digits.length,
      }),
    );
  }
  const out = new Uint8Array(digits.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(digits[2 * i]! + digits[2 * i + 1]!, 16);
  return out;
}

// ---------------------------------------------------------------- Base32

/** `standard`: RFC 4648 (A–Z, 2–7); `hex`: Base32hex (0–9, A–V; sıralamayı korur). */
export type Base32Variant = 'standard' | 'hex';

const BASE32_ALPHABETS: Record<Base32Variant, string> = {
  standard: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567',
  hex: '0123456789ABCDEFGHIJKLMNOPQRSTUV',
};

export interface Base32Options {
  variant?: Base32Variant;
  /** `=` dolgusu (varsayılan açık). */
  padding?: boolean;
}

export function base32Encode(bytes: Uint8Array, options: Base32Options = {}): string {
  const alphabet = BASE32_ALPHABETS[options.variant ?? 'standard'];
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = ((buffer << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += alphabet[(buffer >> bits) & 31];
    }
  }
  if (bits > 0) out += alphabet[(buffer << (5 - bits)) & 31];
  if (options.padding !== false) out += '='.repeat((8 - (out.length % 8)) % 8);
  return out;
}

/** Büyük/küçük harf duyarsız; boşluk ve satır sonları yok sayılır, dolgu isteğe bağlıdır. */
export function base32Decode(text: string, variant: Base32Variant = 'standard'): Uint8Array {
  const alphabet = BASE32_ALPHABETS[variant];
  const clean = text.replace(/\s+/g, '').toUpperCase();
  const body = clean.replace(/=+$/, '');
  if (clean.length - body.length > 6)
    throw new ToolError(msg('toolsSecurity.codec.b32Padding', 'Geçersiz Base32: fazla dolgu (=).'));
  // 1, 3 ya da 6 karakterlik son grup tam bayt oluşturmaz.
  if ([1, 3, 6].includes(body.length % 8))
    throw new ToolError(msg('toolsSecurity.codec.b32Length', 'Geçersiz Base32: uzunluk hatalı.'));
  const out = new Uint8Array(Math.floor((body.length * 5) / 8));
  let buffer = 0;
  let bits = 0;
  let pos = 0;
  for (let i = 0; i < body.length; i++) {
    const value = alphabet.indexOf(body[i]!);
    if (value < 0)
      throw new ToolError(
        msg('toolsSecurity.codec.b32Char', 'Geçersiz Base32 karakteri: "{char}" (konum {position}).', {
          char: body[i],
          position: i + 1,
        }),
      );
    buffer = ((buffer << 5) | value) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out[pos++] = (buffer >> bits) & 0xff;
    }
  }
  return out;
}
