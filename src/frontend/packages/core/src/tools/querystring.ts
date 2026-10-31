// JSON ↔ query string / application/x-www-form-urlencoded: iç içe nesneler köşeli parantezle (`a[b]=1`).
import { msg } from '../i18n';
import { ToolError } from './errors';

/** Dizilerin yazımı: `a[]=1&a[]=2`, `a=1&a=2` ya da `a[0]=1&a[1]=2`. */
export type QueryArrayFormat = 'brackets' | 'repeat' | 'indices';

export interface StringifyQueryOptions {
  arrays?: QueryArrayFormat;
  /** Boşluk `+` yazılır (form-urlencoded); değilse `%20`. */
  plusSpaces?: boolean;
}

export interface ParseQueryOptions {
  /** Sayıya ve true/false'a benzeyen değerler çevrilir; değilse hepsi metin kalır. */
  coerce?: boolean;
}

/** `a[999999]` gibi bir anahtar dev bir dizi açmasın; bu sınırın üstündeki sıra numaraları nesne anahtarıdır. */
const MAX_INDEX = 1000;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasOwn = (target: object, key: string) => Object.prototype.hasOwnProperty.call(target, key);

/** Anahtarı her zaman kendi özelliği olarak yazar: `__proto__` prototipi değiştirmez. */
function setOwn(target: Record<string, unknown>, key: string, value: unknown) {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

// ---- JSON → query ----

function encode(text: string, plusSpaces: boolean): string {
  const encoded = encodeURIComponent(text);
  return plusSpaces ? encoded.replace(/%20/g, '+') : encoded;
}

/**
 * Nesneyi query string'e çevirir. Nesne ya da dizi içeren dizilerin elemanları, geri okunabilmeleri için
 * seçimden bağımsız olarak sıra numarasıyla yazılır (`a[0][b]=1`). `null` boş değer olur, boş dizi ve
 * nesneler yazılmaz.
 */
export function stringifyQuery(value: unknown, options: StringifyQueryOptions = {}): string {
  if (!isObject(value))
    throw new ToolError(
      msg(
        'toolsNet.query.needObject',
        'Query string için JSON bir nesne olmalı: \'{\' "ad": "Ayşe", "sayfa": 2 \'}\'',
      ),
    );
  const arrays = options.arrays ?? 'brackets';
  const plus = options.plusSpaces ?? false;
  const pairs: string[] = [];
  const walk = (key: string, item: unknown) => {
    if (Array.isArray(item)) {
      const indexed = arrays === 'indices' || item.some((v) => typeof v === 'object' && v !== null);
      item.forEach((v, i) => walk(indexed ? `${key}[${i}]` : arrays === 'brackets' ? `${key}[]` : key, v));
    } else if (isObject(item)) {
      for (const [k, v] of Object.entries(item)) walk(`${key}[${encode(k, plus)}]`, v);
    } else if (item !== undefined) {
      pairs.push(`${key}=${item === null ? '' : encode(String(item), plus)}`);
    }
  };
  for (const [k, v] of Object.entries(value)) walk(encode(k, plus), v);
  return pairs.join('&');
}

// ---- query → JSON ----

/** Tam URL'den ya da `?` ile başlayan metinden sorgu kısmını alır; `#` sonrası atılır. */
export function queryPart(text: string): string {
  let query = text.trim();
  const hash = query.indexOf('#');
  if (hash >= 0) query = query.slice(0, hash);
  const question = query.indexOf('?');
  if (question >= 0) return query.slice(question + 1);
  // Soru işareti olmayan tam URL'nin sorgusu yoktur.
  return /^[a-z][a-z\d+.-]*:\/\//i.test(query) ? '' : query;
}

function decode(text: string): string {
  const spaced = text.replace(/\+/g, ' ');
  try {
    return decodeURIComponent(spaced);
  } catch {
    throw new ToolError(msg('toolsNet.query.badPercent', 'Geçersiz yüzde kodlaması: "{text}"', { text }));
  }
}

/** `a[b][]` → ['a', 'b', '']; parantezleri düzgün olmayan anahtar (`a[b`, `a[b]x`) tek parçadır. */
function splitKey(key: string): string[] {
  const match = /^([^[\]]+)((?:\[[^[\]]*\])+)$/.exec(key);
  if (!match) return [key];
  return [match[1]!, ...Array.from(match[2]!.matchAll(/\[([^[\]]*)\]/g), (m) => m[1]!)];
}

const isIndex = (segment: string) => /^\d+$/.test(segment) && Number(segment) <= MAX_INDEX;

type Container = Record<string, unknown> | unknown[];

function coerceValue(value: string): unknown {
  const trimmed = value.trim();
  if (/^-?(0|[1-9]\d{0,14})(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed === 'true' || trimmed === 'false') return trimmed === 'true';
  return value;
}

/** Diziyi aynı sıra numaralı anahtarlarla nesneye çevirir (`a[0]=x&a[b]=y`). */
function toObject(array: unknown[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  array.forEach((v, i) => {
    if (v !== undefined) setOwn(result, String(i), v);
  });
  return result;
}

/** Sıra numarasıyla açılan dizilerdeki boşlukları kapatır (`a[0]=x&a[5]=y` → iki eleman). */
function compact(value: unknown): unknown {
  if (Array.isArray(value)) return value.filter((v) => v !== undefined).map(compact);
  if (isObject(value)) {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) setOwn(result, k, compact(v));
    return result;
  }
  return value;
}

/**
 * Query string'i (ya da tam URL'yi) nesneye çevirir: `a[b]=1` iç içe nesne, `a[]=1`, `a[0]=1` ve tekrarlanan
 * `a=1&a=2` dizi olur; `+` boşluktur.
 */
export function parseQuery(text: string, options: ParseQueryOptions = {}): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const pair of queryPart(text).split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const key = decode(eq >= 0 ? pair.slice(0, eq) : pair);
    if (!key) continue;
    const raw = eq >= 0 ? decode(pair.slice(eq + 1)) : '';
    const value = options.coerce ? coerceValue(raw) : raw;
    const parts = splitKey(key);
    let parent: Container = root;
    let parentKey: string | number | null = null;
    let target: Container = root;
    for (let i = 0; i < parts.length; i++) {
      const segment = parts[i]!;
      const last = i === parts.length - 1;
      // Dizi olarak açılmış bir yere sıra numarası olmayan anahtar gelirse nesneye çevrilir.
      if (Array.isArray(target) && segment !== '' && !isIndex(segment)) {
        const converted = toObject(target);
        if (parentKey === null)
          throw new ToolError(msg('toolsNet.query.badKey', '"{key}" anahtarı okunamadı.', { key }));
        if (Array.isArray(parent)) parent[parentKey as number] = converted;
        else setOwn(parent, String(parentKey), converted);
        target = converted;
      }
      const slot: string | number = Array.isArray(target)
        ? segment === ''
          ? target.length
          : Number(segment)
        : segment;
      const existing = Array.isArray(target)
        ? target[slot as number]
        : hasOwn(target, String(slot))
          ? target[String(slot)]
          : undefined;
      if (last) {
        if (isObject(existing))
          throw new ToolError(
            msg(
              'toolsNet.query.objectAndValue',
              '"{key}": "{path}" hem nesne hem değer olarak kullanılmış.',
              {
                key,
                path: parts.join('.'),
              },
            ),
          );
        // Tekrarlanan düz anahtar diziye dönüşür.
        const next =
          existing === undefined ? value : Array.isArray(existing) ? [...existing, value] : [existing, value];
        if (Array.isArray(target)) target[slot as number] = next;
        else setOwn(target, String(slot), next);
        break;
      }
      let child = existing;
      if (child === undefined) {
        const nextSegment = parts[i + 1]!;
        child = nextSegment === '' || isIndex(nextSegment) ? [] : {};
        if (Array.isArray(target)) target[slot as number] = child;
        else setOwn(target, String(slot), child);
      } else if (typeof child !== 'object' || child === null) {
        throw new ToolError(
          msg('toolsNet.query.valueAndObject', '"{key}": "{path}" hem değer hem nesne olarak kullanılmış.', {
            key,
            path: parts.slice(0, i + 1).join('.'),
          }),
        );
      }
      parent = target;
      parentKey = slot;
      target = child as Container;
    }
  }
  return compact(root) as Record<string, unknown>;
}
