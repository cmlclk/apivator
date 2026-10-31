import { msg } from '../i18n';
import { ToolError } from './errors';

export interface Base64Options {
  /** `+/` yerine `-_`, dolgu (`=`) olmadan. */
  urlSafe?: boolean;
  /** Bu kadar karakterde bir satır kırılır (MIME için 76); 0 ya da yoksa kırılmaz. */
  lineLength?: number;
}

export function utf8Encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** Geçersiz UTF-8'de `fatal` ise ToolError fırlatır, değilse yerine � koyar. */
export function utf8Decode(bytes: Uint8Array, fatal = false): string {
  try {
    return new TextDecoder('utf-8', { fatal }).decode(bytes);
  } catch {
    throw new ToolError(msg('toolsSecurity.enc.notUtf8', 'Veri geçerli bir UTF-8 metni değil.'));
  }
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const DECODE_TABLE = (() => {
  const table = new Int16Array(128).fill(-1);
  for (let i = 0; i < ALPHABET.length; i++) table[ALPHABET.charCodeAt(i)] = i;
  // URL-safe karakterler de kabul edilir.
  table['-'.charCodeAt(0)] = 62;
  table['_'.charCodeAt(0)] = 63;
  return table;
})();

export function base64Encode(bytes: Uint8Array, options: Base64Options = {}): string {
  let out = '';
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i]!;
    const b1 = i + 1 < len ? bytes[i + 1]! : 0;
    const b2 = i + 2 < len ? bytes[i + 2]! : 0;
    out += ALPHABET[b0 >> 2]! + ALPHABET[((b0 & 3) << 4) | (b1 >> 4)]!;
    out += i + 1 < len ? ALPHABET[((b1 & 15) << 2) | (b2 >> 6)]! : '=';
    out += i + 2 < len ? ALPHABET[b2 & 63]! : '=';
  }
  if (options.urlSafe) out = out.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const lineLength = options.lineLength ?? 0;
  if (lineLength > 0 && out.length > lineLength) {
    const lines: string[] = [];
    for (let i = 0; i < out.length; i += lineLength) lines.push(out.slice(i, i + lineLength));
    out = lines.join('\n');
  }
  return out;
}

/** Standart ve URL-safe biçimi, boşlukları/satır sonlarını ve eksik dolguyu kabul eder; geçersizse ToolError. */
export function base64Decode(text: string): Uint8Array {
  const clean = text.replace(/\s+/g, '');
  const body = clean.replace(/=+$/, '');
  if (clean.length - body.length > 2)
    throw new ToolError(msg('toolsSecurity.enc.b64Padding', 'Geçersiz Base64: fazla dolgu (=).'));
  if (body.length % 4 === 1)
    throw new ToolError(msg('toolsSecurity.enc.b64Length', 'Geçersiz Base64: uzunluk hatalı.'));
  const out = new Uint8Array(Math.floor((body.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let pos = 0;
  for (let i = 0; i < body.length; i++) {
    const code = body.charCodeAt(i);
    const value = code < 128 ? DECODE_TABLE[code]! : -1;
    if (value < 0)
      throw new ToolError(
        msg('toolsSecurity.enc.b64Char', 'Geçersiz Base64 karakteri: "{char}" (konum {position}).', {
          char: body[i],
          position: i + 1,
        }),
      );
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[pos++] = (buffer >> bits) & 0xff;
    }
  }
  return out;
}

export type UrlMode = 'component' | 'full';

/** `component`: encodeURIComponent; `full`: encodeURI (adres yapısını bozmaz). */
export function urlEncode(text: string, mode: UrlMode = 'component'): string {
  try {
    return mode === 'full' ? encodeURI(text) : encodeURIComponent(text);
  } catch {
    throw new ToolError(
      msg('toolsSecurity.enc.loneSurrogate', 'Metin eşlenmemiş bir vekil (surrogate) karakter içeriyor.'),
    );
  }
}

/** `+` boşluk olarak çözülür (`full` modda yalnızca `?` sonrasında); bozuk `%` dizisinde ToolError. */
export function urlDecode(text: string, mode: UrlMode = 'component'): string {
  const queryStart = mode === 'full' ? text.indexOf('?') : 0;
  const spaced =
    queryStart < 0 ? text : text.slice(0, queryStart) + text.slice(queryStart).replace(/\+/g, ' ');
  try {
    return mode === 'full' ? decodeURI(spaced) : decodeURIComponent(spaced);
  } catch {
    const bad = /%(?![0-9a-fA-F]{2})/.exec(spaced);
    throw new ToolError(
      bad
        ? msg('toolsSecurity.enc.badPercent', 'Bozuk % dizisi (konum {position}).', {
            position: bad.index + 1,
          })
        : msg('toolsSecurity.enc.badPercentUtf8', 'Bozuk % dizisi: geçerli bir UTF-8 karakteri değil.'),
    );
  }
}

const SIGNATURES: [string, number[]][] = [
  ['image/png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  ['image/jpeg', [0xff, 0xd8, 0xff]],
  ['image/gif', [0x47, 0x49, 0x46, 0x38]],
  ['image/bmp', [0x42, 0x4d]],
  ['image/x-icon', [0x00, 0x00, 0x01, 0x00]],
  ['application/pdf', [0x25, 0x50, 0x44, 0x46]],
  ['application/zip', [0x50, 0x4b, 0x03, 0x04]],
  ['application/gzip', [0x1f, 0x8b]],
];

function startsWith(bytes: Uint8Array, sig: number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  return sig.every((b, i) => bytes[offset + i] === b);
}

/** Dosya imzasından MIME tipi (png, jpeg, gif, webp, bmp, ico, svg, pdf, zip, gzip); bilinmiyorsa null. */
export function sniffMime(bytes: Uint8Array): string | null {
  // WEBP: "RIFF" .... "WEBP"
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return 'image/webp';
  }
  for (const [mime, sig] of SIGNATURES) if (startsWith(bytes, sig)) return mime;
  // SVG metindir: başındaki kısımda <svg etiketi aranır.
  const head = new TextDecoder('utf-8').decode(bytes.subarray(0, 1024)).trimStart();
  if (
    (head.startsWith('<?xml') || head.startsWith('<svg') || head.startsWith('<!--')) &&
    /<svg[\s>]/i.test(head)
  ) {
    return 'image/svg+xml';
  }
  return null;
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
