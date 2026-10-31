import { toHex } from './encoding';
import { msg } from '../i18n';
import { ToolError } from './errors';

function formatUuid(bytes: Uint8Array): string {
  const hex = toHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Sürüm ve varyant (RFC 9562: 10xx) bitlerini yazar. */
function stamp(bytes: Uint8Array, version: number): Uint8Array {
  bytes[6] = (bytes[6]! & 0x0f) | (version << 4);
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  return bytes;
}

/** Rastgele (v4) UUID; crypto.getRandomValues kullanır. */
export function uuidV4(): string {
  return formatUuid(stamp(crypto.getRandomValues(new Uint8Array(16)), 4));
}

/** Zamana göre sıralanabilir (v7, RFC 9562) UUID: ilk 48 bit milisaniye cinsinden zaman. */
export function uuidV7(now: number = Date.now()): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let ms = Math.max(0, Math.floor(now));
  for (let i = 5; i >= 0; i--) {
    bytes[i] = ms % 256;
    ms = Math.floor(ms / 256);
  }
  return formatUuid(stamp(bytes, 7));
}

const UUID_RE = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

/** Geçerli bir UUID ise sürüm numarası ve (v7 için) içindeki zaman; değilse null. */
export function inspectUuid(text: string): { version: number; time?: Date } | null {
  const trimmed = text
    .trim()
    .replace(/^\{(.*)\}$/, '$1')
    .replace(/^urn:uuid:/i, '');
  if (!UUID_RE.test(trimmed)) return null;
  const hex = trimmed.replace(/-/g, '');
  const version = parseInt(hex[12]!, 16);
  if (version === 7) return { version, time: new Date(parseInt(hex.slice(0, 12), 16)) };
  return { version };
}

/* ---------------------------------------------------------------- ULID */

/** Crockford Base32 (I, L, O, U yok). */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ULID_MAX_TIME = 2 ** 48 - 1;
const ULID_RE = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/i;

function ulidTime(now: number): number {
  const time = Math.floor(now);
  if (!Number.isFinite(time) || time < 0 || time > ULID_MAX_TIME) {
    throw new ToolError(
      msg('toolsMisc.ids.ulidTime', 'ULID zamanı 0 ile 2^48 − 1 milisaniye arasında olmalı.'),
    );
  }
  return time;
}

function encodeUlid(time: number, random: number[]): string {
  let head = '';
  for (let i = 0, t = time; i < 10; i++, t = Math.floor(t / 32)) head = CROCKFORD[t % 32]! + head;
  return head + random.map((d) => CROCKFORD[d]).join('');
}

/** 80 bitlik rastgele kısım: 16 adet 5 bitlik basamak (256, 32'ye bölündüğünden & 31 yansızdır). */
function ulidRandom(): number[] {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b & 31);
}

/** ULID: 48 bit milisaniye zamanı + 80 bit rastgele, 26 karakter Crockford Base32; sözlük sırası = zaman sırası. */
export function ulid(now: number = Date.now()): string {
  return encodeUlid(ulidTime(now), ulidRandom());
}

/**
 * Monoton ULID üreteci: aynı (ya da geri giden) milisaniyede rastgele kısım bir artırılır, böylece aynı
 * üreteçten çıkan değerler hep artan sıradadır. 80 bitlik kısım taşarsa hata verir.
 */
export function monotonicUlidFactory(): (now?: number) => string {
  let lastTime = -1;
  let last: number[] = [];
  return (now = Date.now()) => {
    const time = ulidTime(now);
    if (time > lastTime) {
      lastTime = time;
      last = ulidRandom();
      return encodeUlid(time, last);
    }
    let i = last.length - 1;
    while (i >= 0 && last[i] === 31) last[i--] = 0;
    if (i < 0)
      throw new ToolError(msg('toolsMisc.ids.ulidOverflow', 'Aynı milisaniyede ULID rastgele kısmı taştı.'));
    last[i]!++;
    return encodeUlid(lastTime, last);
  };
}

/** Geçerli bir ULID ise içindeki zaman; değilse null (büyük/küçük harf duyarsız). */
export function inspectUlid(text: string): { time: Date } | null {
  const trimmed = text.trim().toUpperCase();
  if (!ULID_RE.test(trimmed)) return null;
  let time = 0;
  for (const ch of trimmed.slice(0, 10)) time = time * 32 + CROCKFORD.indexOf(ch);
  return { time: new Date(time) };
}

export type InspectedId = { kind: 'uuid'; version: number; time?: Date } | { kind: 'ulid'; time: Date };

/** Yapıştırılan değerin UUID mi ULID mi olduğunu bulur; ikisi de değilse null. */
export function inspectId(text: string): InspectedId | null {
  const uuid = inspectUuid(text);
  if (uuid) return { kind: 'uuid', ...uuid };
  const parsed = inspectUlid(text);
  return parsed && { kind: 'ulid', ...parsed };
}

/* ---------------------------------------------------------------- nanoid */

/** nanoid'in URL güvenli varsayılan alfabesi (64 karakter). */
export const NANOID_ALPHABET = 'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict';
export const NANOID_DEFAULT_SIZE = 21;
export const NANOID_MAX_SIZE = 256;

/** Alfabeyi kod noktalarına ayırır; 2–256 benzersiz karakter olmalı. */
export function nanoidAlphabet(alphabet: string): string[] {
  const chars = [...alphabet];
  if (chars.length < 2 || chars.length > 256)
    throw new ToolError(msg('toolsMisc.ids.alphabetSize', 'Alfabe 2–256 karakter olmalı.'));
  if (new Set(chars).size !== chars.length)
    throw new ToolError(msg('toolsMisc.ids.alphabetDuplicate', 'Alfabede tekrar eden karakter var.'));
  return chars;
}

/**
 * nanoid: alfabeden `size` karakter. Baytlar alfabe boyunu kapsayan en küçük 2^k maskesiyle kırpılır,
 * alfabe dışına düşenler atılır (reddetmeli örnekleme; modülo yanlılığı yok). Rastgele baytlar toplu alınır.
 */
export function nanoid(size: number = NANOID_DEFAULT_SIZE, alphabet: string = NANOID_ALPHABET): string {
  if (!Number.isInteger(size) || size < 1 || size > NANOID_MAX_SIZE) {
    throw new ToolError(
      msg('toolsMisc.ids.nanoidSize', 'nanoid uzunluğu 1–{max} olmalı.', { max: String(NANOID_MAX_SIZE) }),
    );
  }
  const chars = nanoidAlphabet(alphabet);
  const mask = 2 ** Math.ceil(Math.log2(chars.length)) - 1;
  const batch = Math.ceil((1.6 * mask * size) / chars.length);
  let id = '';
  for (let n = 0; ;) {
    for (const byte of crypto.getRandomValues(new Uint8Array(batch))) {
      const index = byte & mask;
      if (index >= chars.length) continue;
      id += chars[index];
      if (++n === size) return id;
    }
  }
}

/** Kimlik uzayının bit cinsinden büyüklüğü ve %1 çakışma olasılığına ulaşmak için gereken yaklaşık kimlik sayısı. */
export function nanoidCollisionHint(
  size: number,
  alphabetLength: number,
): { bits: number; idsForOnePercent: number } {
  const bits = size * Math.log2(alphabetLength);
  // Doğum günü yaklaşımı: n ≈ √(2·N·ln(1/(1−p))).
  return { bits, idsForOnePercent: Math.sqrt(2 * Math.log(1 / 0.99)) * 2 ** (bits / 2) };
}

/* ---------------------------------------------------------------- Toplu çıktı */

export type IdListFormat = 'lines' | 'json' | 'csv';

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Kimlik listesini satır satır, JSON dizisi ya da başlıklı CSV olarak yazar. */
export function formatIdList(ids: readonly string[], format: IdListFormat, header = 'id'): string {
  if (format === 'json') return JSON.stringify(ids, null, 2);
  if (format === 'csv') return [header, ...ids].map(csvCell).join('\n');
  return ids.join('\n');
}
