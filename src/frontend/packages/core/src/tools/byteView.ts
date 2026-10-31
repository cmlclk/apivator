import { bytesToHex, hexToBytes } from './codecs';
import { utf8Decode, utf8Encode } from './encoding';
import { catalogMessage, msg } from '../i18n';
import { ToolError } from './errors';

export type ByteEncoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'latin1';

export interface EncodedText {
  bytes: Uint8Array;
  /** Latin-1'de karşılığı olmayan (U+00FF üstü) ve `?` yazılan karakter sayısı. */
  unmappable: number;
}

/** Metni seçilen kodlamada baytlara çevirir. */
export function encodeText(text: string, encoding: ByteEncoding): EncodedText {
  if (encoding === 'utf-8') return { bytes: utf8Encode(text), unmappable: 0 };
  if (encoding === 'latin1') {
    const bytes = new Uint8Array(text.length);
    let unmappable = 0;
    let length = 0;
    for (const char of text) {
      const code = char.codePointAt(0)!;
      if (code > 0xff) unmappable++;
      bytes[length++] = code > 0xff ? 0x3f : code;
    }
    return { bytes: bytes.slice(0, length), unmappable };
  }
  const bytes = new Uint8Array(text.length * 2);
  const little = encoding === 'utf-16le';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    bytes[2 * i + (little ? 0 : 1)] = code & 0xff;
    bytes[2 * i + (little ? 1 : 0)] = code >> 8;
  }
  return { bytes, unmappable: 0 };
}

/** Baytları seçilen kodlamada metne çevirir; `fatal` ile geçersiz UTF-8/UTF-16 hata verir. */
export function decodeBytes(bytes: Uint8Array, encoding: ByteEncoding, fatal = false): string {
  if (encoding === 'utf-8') return utf8Decode(bytes, fatal);
  if (encoding === 'latin1') {
    let out = '';
    for (let i = 0; i < bytes.length; i += 8192) {
      out += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    return out;
  }
  if (fatal && bytes.length % 2 === 1) {
    throw new ToolError(
      msg('toolsNet.byte.utf16Odd', 'UTF-16 için bayt sayısı çift olmalı ({count}).', {
        count: String(bytes.length),
      }),
    );
  }
  const little = encoding === 'utf-16le';
  const units = new Uint16Array(bytes.length >> 1);
  for (let i = 0; i < units.length; i++) {
    units[i] = little ? bytes[2 * i]! | (bytes[2 * i + 1]! << 8) : (bytes[2 * i]! << 8) | bytes[2 * i + 1]!;
  }
  let out = '';
  for (let i = 0; i < units.length; i += 8192) out += String.fromCharCode(...units.subarray(i, i + 8192));
  if (fatal && LONE_SURROGATE.test(out)) {
    throw new ToolError(
      msg('toolsNet.byte.loneSurrogate', 'Geçersiz UTF-16: eşi olmayan vekil (surrogate) kod birimi.'),
    );
  }
  // Eksik son bayt ve eşsiz vekiller TextDecoder gibi U+FFFD olur.
  return (bytes.length % 2 === 1 ? out + '�' : out).replace(LONE_SURROGATE_ALL, '�');
}

const LONE_SURROGATE_SOURCE =
  '[\\ud800-\\udbff](?![\\udc00-\\udfff])|(?<![\\ud800-\\udbff])[\\udc00-\\udfff]';
const LONE_SURROGATE = new RegExp(LONE_SURROGATE_SOURCE);
const LONE_SURROGATE_ALL = new RegExp(LONE_SURROGATE_SOURCE, 'g');

/** Boşluk, `,` `_` ayraçlı ve isteğe bağlı `0b` önekli 0/1 dizisini baytlara çevirir (8 bitlik gruplar). */
export function binaryToBytes(text: string): Uint8Array {
  const bits = text.replace(/0b(?=[01])/gi, '').replace(/[\s,_]/g, '');
  const bad = /[^01]/.exec(bits);
  if (bad)
    throw new ToolError(
      msg('toolsNet.byte.badBinary', 'Geçersiz ikili karakter: "{char}".', { char: bad[0] }),
    );
  if (bits.length % 8 !== 0) {
    throw new ToolError(
      msg('toolsNet.byte.bitCount', "Bit sayısı ({count}) 8'in katı değil: her bayt 8 bitle yazılmalı.", {
        count: String(bits.length),
      }),
    );
  }
  const out = new Uint8Array(bits.length / 8);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(bits.slice(8 * i, 8 * i + 8), 2);
  return out;
}

/** Baytları boşlukla ayrılmış 8 bitlik gruplar olarak yazar; her `perLine` baytta satır başı. */
export function bytesToBinary(bytes: Uint8Array, perLine = 8): string {
  const groups = Array.from(bytes, (b) => b.toString(2).padStart(8, '0'));
  const rows: string[] = [];
  for (let i = 0; i < groups.length; i += perLine) rows.push(groups.slice(i, i + perLine).join(' '));
  return rows.join('\n');
}

/** `xxd`/`hexdump -C` biçimi: ofset, 16 bayt hex (8'de bir ek boşluk) ve yazdırılabilir ASCII sütunu. */
export function hexdump(bytes: Uint8Array, width = 16): string {
  const rows: string[] = [];
  const half = width / 2;
  for (let offset = 0; offset < bytes.length; offset += width) {
    const chunk = bytes.subarray(offset, offset + width);
    const hex =
      bytesToHex(chunk.subarray(0, half), { separator: 'space' }) +
      (chunk.length > half ? '  ' + bytesToHex(chunk.subarray(half), { separator: 'space' }) : '');
    const ascii = Array.from(chunk, (b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('');
    rows.push(`${offset.toString(16).padStart(8, '0')}  ${hex.padEnd(width * 3)}  |${ascii}|`);
  }
  return rows.join('\n');
}

/**
 * `hexdump` çıktısını (ya da `hexdump -C` dökümünü) geri okur: satır başındaki ofset (8 hane ya da `:` ile
 * biten) ve sondaki `|ASCII|` sütunu atlanır.
 */
export function hexdumpToBytes(text: string): Uint8Array {
  const hex = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\|.*\|\s*$/, '').replace(/^\s*(?:[0-9a-f]{8}|[0-9a-f]+:)(?:\s+|$)/i, ''))
    .join(' ');
  return hexToBytes(hex);
}

const C0_NAMES = [
  'NUL', 'SOH', 'STX', 'ETX', 'EOT', 'ENQ', 'ACK', 'BEL', 'BS', 'TAB', 'LF', 'VT', 'FF', 'CR', 'SO', 'SI',
  'DLE', 'DC1', 'DC2', 'DC3', 'DC4', 'NAK', 'SYN', 'ETB', 'CAN', 'EM', 'SUB', 'ESC', 'FS', 'GS', 'RS', 'US',
]; // prettier-ignore

/** Görünmeyen ya da karıştırılabilen karakterlerin adları (parantezli Türkçe açıklamaların İngilizcesi katalogda). */
const SPECIAL_NAMES: Record<number, string> = {
  0x20: 'SPACE (boşluk)',
  0x7f: 'DEL',
  0x85: 'NEL (sonraki satır)',
  0xa0: 'NBSP (bölünmez boşluk)',
  0xad: 'SHY (yumuşak tire)',
  0x34f: 'CGJ (birleştirici grafem bağlayıcı)',
  0x61c: 'ALM (Arapça harf işareti)',
  0x1680: 'OGHAM SPACE',
  0x180e: 'MVS (Moğolca ünlü ayırıcı)',
  0x2000: 'EN QUAD',
  0x2001: 'EM QUAD',
  0x2002: 'EN SPACE',
  0x2003: 'EM SPACE',
  0x2004: 'THREE-PER-EM SPACE',
  0x2005: 'FOUR-PER-EM SPACE',
  0x2006: 'SIX-PER-EM SPACE',
  0x2007: 'FIGURE SPACE',
  0x2008: 'PUNCTUATION SPACE',
  0x2009: 'THIN SPACE (ince boşluk)',
  0x200a: 'HAIR SPACE',
  0x200b: 'ZWSP (sıfır genişlikte boşluk)',
  0x200c: 'ZWNJ (sıfır genişlikte birleştirmeyen)',
  0x200d: 'ZWJ (sıfır genişlikte birleştirici)',
  0x200e: 'LRM (soldan sağa işareti)',
  0x200f: 'RLM (sağdan sola işareti)',
  0x2028: 'LS (satır ayırıcı)',
  0x2029: 'PS (paragraf ayırıcı)',
  0x202a: 'LRE',
  0x202b: 'RLE',
  0x202c: 'PDF (yön biçimi sonu)',
  0x202d: 'LRO',
  0x202e: 'RLO (sağdan sola zorlama)',
  0x202f: 'NNBSP (dar bölünmez boşluk)',
  0x205f: 'MMSP (orta matematik boşluğu)',
  0x2060: 'WJ (sözcük birleştirici)',
  0x2061: 'FUNCTION APPLICATION',
  0x2062: 'INVISIBLE TIMES',
  0x2063: 'INVISIBLE SEPARATOR',
  0x2064: 'INVISIBLE PLUS',
  0x2066: 'LRI',
  0x2067: 'RLI',
  0x2068: 'FSI',
  0x2069: 'PDI',
  0x3000: 'IDEOGRAPHIC SPACE',
  0x3164: 'HANGUL FILLER',
  0xfeff: 'BOM / ZWNBSP (bayt sırası işareti)',
  0xfffd: 'REPLACEMENT CHARACTER (bozuk bayt)',
};

/** Sıradan biçimlendirme karakterleri; adları gösterilir ama şüpheli sayılmaz. */
const ORDINARY = new Set([0x09, 0x0a, 0x20]);

/** Kontrol ve görünmez karakterlerin adı; sıradan harflerde `undefined`. */
export function charName(codePoint: number): string | undefined {
  if (codePoint < 0x20) return C0_NAMES[codePoint];
  if (codePoint >= 0x80 && codePoint < 0xa0 && codePoint !== 0x85)
    return msg('toolsNet.byte.c1', 'C1 kontrol karakteri');
  if (codePoint >= 0xfe00 && codePoint <= 0xfe0f)
    return msg('toolsNet.byte.variationSelector', 'VS{n} (varyasyon seçici)', {
      n: String(codePoint - 0xfdff),
    });
  if (codePoint >= 0xe0000 && codePoint <= 0xe007f) return msg('toolsNet.byte.tag', 'TAG karakteri');
  const name = SPECIAL_NAMES[codePoint];
  return name === undefined
    ? undefined
    : (catalogMessage(`toolsNet.charName.${codePoint.toString(16)}`) ?? name);
}

/** Görünmeyen, kontrol ya da sıradan boşlukla karıştırılabilen karakter mi (sekme, LF ve boşluk hariç). */
export function isSuspiciousChar(codePoint: number): boolean {
  return !ORDINARY.has(codePoint) && charName(codePoint) !== undefined;
}

export function formatCodePoint(codePoint: number): string {
  return `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;
}

export interface CharInfo {
  char: string;
  codePoint: number;
  /** Seçilen kodlamadaki baytlar (hex, boşluklu). */
  bytes: string;
  /** Baytın metindeki ofseti. */
  offset: number;
  name?: string;
  suspicious: boolean;
}

/** Karakter karakter döküm; en fazla `limit` karakter. */
export function charBreakdown(text: string, encoding: ByteEncoding, limit = 2000): CharInfo[] {
  const out: CharInfo[] = [];
  let offset = 0;
  for (const char of text) {
    if (out.length >= limit) break;
    const codePoint = char.codePointAt(0)!;
    const { bytes } = encodeText(char, encoding);
    out.push({
      char,
      codePoint,
      bytes: bytesToHex(bytes, { separator: 'space', upper: true }),
      offset,
      name: charName(codePoint),
      suspicious: isSuspiciousChar(codePoint),
    });
    offset += bytes.length;
  }
  return out;
}

export interface SuspiciousSummary {
  codePoint: number;
  name: string;
  count: number;
  /** İlk görüldüğü satır ve sütun (1'den başlar). */
  line: number;
  column: number;
}

/** Tüm metindeki görünmez/kontrol karakterlerini (BOM, ZWSP, NBSP, CR…) sayar. */
export function findSuspiciousChars(text: string): SuspiciousSummary[] {
  const found = new Map<number, SuspiciousSummary>();
  let line = 1;
  let column = 1;
  for (const char of text) {
    const codePoint = char.codePointAt(0)!;
    if (isSuspiciousChar(codePoint)) {
      const entry = found.get(codePoint);
      if (entry) entry.count++;
      else found.set(codePoint, { codePoint, name: charName(codePoint)!, count: 1, line, column });
    }
    if (codePoint === 0x0a) {
      line++;
      column = 1;
    } else column++;
  }
  return [...found.values()].sort((a, b) => b.count - a.count || a.codePoint - b.codePoint);
}
