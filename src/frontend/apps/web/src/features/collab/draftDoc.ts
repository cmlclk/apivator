import * as Y from 'yjs';
import { normalizeDefinition, type RequestDefinition } from '@apivator/core';
import { diffRange } from './diffRange';

/** Belgenin kök haritası: isteğin tanımı (RequestDefinition) burada yaşar. */
export const DEFINITION_KEY = 'def';

/**
 * Metin gibi birleştirilmeyen dizgeler: aynı anda iki kişi "GET" ve "POST" seçerse karakterleri karışmasın,
 * biri kazansın. Bunun dışındaki tüm dizgeler Y.Text'tir (aynı alanda eşzamanlı yazım birleşir).
 */
const ATOMIC_STRING_KEYS = new Set([
  'method',
  'kind',
  'mode',
  'rawLanguage',
  'type',
  'apiKeyIn',
  'oAuth2GrantType',
  'oAuth2ClientAuthentication',
]);

type Json = string | number | boolean | null | Json[] | { [key: string]: Json | undefined };
type JsonObject = { [key: string]: Json | undefined };

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Belgenin içeriğini düz JSON'a çevirir (Y.Text → dizge). */
export function toJson(value: unknown): Json {
  if (value instanceof Y.Text) return value.toString();
  if (value instanceof Y.Map) {
    const result: JsonObject = {};
    value.forEach((v, k) => (result[k] = toJson(v)));
    return result;
  }
  if (value instanceof Y.Array) return value.toArray().map(toJson);
  return value as Json;
}

function deepEqual(a: Json | undefined, b: Json | undefined): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  if (isObject(a) && isObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) if (!deepEqual(a[key], b[key])) return false;
    return true;
  }
  return false;
}

/** Yeni değeri Y türüne çevirir (henüz belgeye eklenmemiş, "prelim" hâlde). */
function toYValue(key: string, value: Json | undefined): unknown {
  if (typeof value === 'string' && !ATOMIC_STRING_KEYS.has(key)) return new Y.Text(value);
  if (Array.isArray(value)) return Y.Array.from(value.map((v) => toYValue('', v)) as never[]);
  if (isObject(value)) {
    const map = new Y.Map<unknown>();
    for (const [k, v] of Object.entries(value)) if (v !== undefined) map.set(k, toYValue(k, v));
    return map;
  }
  return value ?? null;
}

/** Metni, yalnızca değişen aralığı silip ekleyerek günceller. */
export function setText(target: Y.Text, next: string) {
  const current = target.toString();
  if (current === next) return;
  const { from, to, insert } = diffRange(current, next);
  if (to > from) target.delete(from, to - from);
  if (insert) target.insert(from, insert);
}

function syncMap(map: Y.Map<unknown>, value: JsonObject) {
  for (const [key, next] of Object.entries(value)) {
    if (next !== undefined) syncEntry(map, key, next);
  }
  for (const key of [...map.keys()]) if (value[key] === undefined) map.delete(key);
}

function syncEntry(map: Y.Map<unknown>, key: string, next: Json) {
  const current = map.get(key);
  if (typeof next === 'string' && !ATOMIC_STRING_KEYS.has(key)) {
    if (current instanceof Y.Text) setText(current, next);
    else map.set(key, new Y.Text(next));
  } else if (Array.isArray(next)) {
    if (current instanceof Y.Array) syncArray(current, next);
    else map.set(key, toYValue(key, next));
  } else if (isObject(next)) {
    if (current instanceof Y.Map) syncMap(current, next);
    else map.set(key, toYValue(key, next));
  } else if (current !== next) {
    map.set(key, next);
  }
}

/**
 * Satır dizisi: ortak baş ve sondaki satırlar korunur; ortadaki aralık yerinde güncellenir, fazlalık silinir,
 * eksik eklenir. Tek satır ekleme/silme diğer satırlara dokunmaz; böylece başkasının başka satırdaki yazımı bozulmaz.
 */
function syncArray(target: Y.Array<unknown>, next: Json[]) {
  const current = target.toArray().map(toJson);
  let head = 0;
  while (head < current.length && head < next.length && deepEqual(current[head], next[head])) head++;
  let tail = 0;
  while (
    tail < current.length - head &&
    tail < next.length - head &&
    deepEqual(current[current.length - 1 - tail], next[next.length - 1 - tail])
  ) {
    tail++;
  }
  const oldMiddle = current.length - head - tail;
  const newMiddle = next.length - head - tail;
  const common = Math.min(oldMiddle, newMiddle);
  for (let i = 0; i < common; i++) syncItem(target, head + i, next[head + i]!);
  if (oldMiddle > common) target.delete(head + common, oldMiddle - common);
  if (newMiddle > common) {
    target.insert(
      head + common,
      next.slice(head + common, head + newMiddle).map((v) => toYValue('', v)),
    );
  }
}

function syncItem(target: Y.Array<unknown>, index: number, next: Json) {
  const current = target.get(index);
  if (current instanceof Y.Map && isObject(next)) {
    syncMap(current, next);
    return;
  }
  target.delete(index, 1);
  target.insert(index, [toYValue('', next)]);
}

/** Yerel taslağı belgeye yansıtır: yalnızca farklar yazılır. */
export function applyDraft(doc: Y.Doc, draft: RequestDefinition, origin?: unknown) {
  doc.transact(() => syncMap(doc.getMap(DEFINITION_KEY), draft as unknown as JsonObject), origin);
}

/** Belgedeki ortak taslak (eksik alanlar varsayılanlarla tamamlanır). */
export function readDraft(doc: Y.Doc): RequestDefinition {
  return normalizeDefinition(toJson(doc.getMap(DEFINITION_KEY)) as Partial<RequestDefinition>);
}

/** Belge henüz tohumlanmadı mı? */
export function isEmpty(doc: Y.Doc): boolean {
  return doc.getMap(DEFINITION_KEY).size === 0;
}

/** Noktalı yola ("body.raw") karşılık gelen Y.Text; yoksa ya da metin değilse null. */
export function textAt(doc: Y.Doc, path: string): Y.Text | null {
  let node: unknown = doc.getMap(DEFINITION_KEY);
  for (const part of path.split('.')) {
    if (!(node instanceof Y.Map)) return null;
    node = node.get(part);
  }
  return node instanceof Y.Text ? node : null;
}

export function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
