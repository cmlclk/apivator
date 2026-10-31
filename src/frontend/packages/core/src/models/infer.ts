/**
 * JSON örneklerinden model çıkarımı. Birden çok örnek (dizi elemanları, kayıtlı örnek yanıtlar) birleştirilir:
 * bazı örneklerde olmayan alan opsiyonel, `null` görülen alan nullable olur. Tam sayı/ondalık, tarih, tarih-saat ve
 * GUID ayrılır.
 */
import {
  primitive,
  type ModelClass,
  type ModelSet,
  type ModelType,
  type PrimitiveType,
  type TypeRef,
} from './ir';
import { pascalCase, singular, typeName, uniqueName } from './naming';

type Format = 'date' | 'datetime' | 'uuid' | null;

type Shape =
  | { k: 'bool' }
  | { k: 'int'; big: boolean }
  | { k: 'num' }
  | { k: 'str'; fmt: Format }
  | { k: 'arr'; items: Slot }
  | { k: 'obj'; fields: Map<string, Slot>; count: number }
  | { k: 'any' };

/** Bir konumda görülen değerler: tipi (yalnızca null görüldüyse yok), null görüldü mü, kaç kez görüldü. */
interface Slot {
  shape: Shape | null;
  nullable: boolean;
  count: number;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INT32 = 2_147_483_647;

function shapeOf(value: unknown): Shape | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return { k: 'bool' };
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { k: 'int', big: Math.abs(value) > INT32 } : { k: 'num' };
  }
  if (typeof value === 'string') {
    return {
      k: 'str',
      fmt: DATE.test(value) ? 'date' : DATETIME.test(value) ? 'datetime' : UUID.test(value) ? 'uuid' : null,
    };
  }
  if (Array.isArray(value)) {
    const items: Slot = { shape: null, nullable: false, count: 0 };
    for (const item of value) add(items, item);
    return { k: 'arr', items };
  }
  if (typeof value === 'object') {
    const fields = new Map<string, Slot>();
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const slot: Slot = { shape: null, nullable: false, count: 0 };
      add(slot, child);
      fields.set(key, slot);
    }
    return { k: 'obj', fields, count: 1 };
  }
  return { k: 'any' };
}

function add(slot: Slot, value: unknown) {
  slot.count++;
  const shape = shapeOf(value);
  if (shape === null) slot.nullable = true;
  else slot.shape = slot.shape ? merge(slot.shape, shape) : shape;
}

function mergeSlots(a: Slot, b: Slot): Slot {
  return {
    shape: a.shape && b.shape ? merge(a.shape, b.shape) : (a.shape ?? b.shape),
    nullable: a.nullable || b.nullable,
    count: a.count + b.count,
  };
}

function merge(a: Shape, b: Shape): Shape {
  if (a.k === 'int' && b.k === 'int') return { k: 'int', big: a.big || b.big };
  if ((a.k === 'int' || a.k === 'num') && (b.k === 'int' || b.k === 'num')) return { k: 'num' };
  if (a.k === 'str' && b.k === 'str') {
    // Biçimler karışıksa (ör. kimi örnekte yalnız tarih, kiminde tarih-saat) düz metin: Go'nun time.Time'ı ve
    // Java'nın OffsetDateTime'ı yalnız tarihi okuyamaz.
    return a.fmt === b.fmt ? a : { k: 'str', fmt: null };
  }
  if (a.k === 'bool' && b.k === 'bool') return a;
  if (a.k === 'arr' && b.k === 'arr') return { k: 'arr', items: mergeSlots(a.items, b.items) };
  if (a.k === 'obj' && b.k === 'obj') {
    const fields = new Map(a.fields);
    for (const [key, slot] of b.fields)
      fields.set(key, fields.has(key) ? mergeSlots(fields.get(key)!, slot) : slot);
    return { k: 'obj', fields, count: a.count + b.count };
  }
  return { k: 'any' };
}

export interface InferOptions {
  /** Kök sınıfın adı (varsayılan "Root"). */
  rootName?: string;
}

/** Bir ya da birden çok JSON örneğinden model çıkarır. */
export function inferModel(samples: unknown[], options: InferOptions = {}): ModelSet {
  const root: Slot = { shape: null, nullable: false, count: 0 };
  for (const sample of samples) add(root, sample);

  const rootName = typeName(options.rootName ?? 'Root', 'Root');
  const used = new Set<string>();
  const bySignature = new Map<string, string>();
  const types = new Map<string, ModelType>();

  const toType = (shape: Shape | null, nameHint: string): TypeRef => {
    if (shape === null) return primitive('any');
    switch (shape.k) {
      case 'bool':
        return primitive('boolean');
      case 'int':
        return primitive(shape.big ? 'long' : 'integer');
      case 'num':
        return primitive('number');
      case 'str':
        return primitive((shape.fmt ?? 'string') as PrimitiveType);
      case 'any':
        return primitive('any');
      case 'arr':
        return { kind: 'array', items: toType(shape.items.shape, singular(nameHint) || nameHint) };
      case 'obj': {
        if (shape.fields.size === 0) return { kind: 'map', values: primitive('any') };
        const fields = [...shape.fields].map(([key, slot]) => ({
          name: key,
          type: toType(slot.shape, pascalCase(key, 'Item')),
          nullable: slot.nullable,
          optional: slot.count < shape.count,
        }));
        // Aynı yapıdaki nesneler (ör. iki yerde geçen adres) tek sınıf olur.
        const signature = JSON.stringify(fields);
        const existing = bySignature.get(signature);
        if (existing) return { kind: 'class', name: existing };
        const name = uniqueName(typeName(nameHint, 'Item'), used, true);
        bySignature.set(signature, name);
        types.set(name, { kind: 'class', name, fields } satisfies ModelClass);
        return { kind: 'class', name };
      }
    }
  };

  // Kök dizi ise eleman sınıfı kök adını alır.
  const rootType =
    root.shape?.k === 'arr'
      ? { kind: 'array' as const, items: toType(root.shape.items.shape, rootName) }
      : toType(root.shape, rootName);

  return { root: rootType, rootNullable: root.nullable, types: orderTypes(rootType, types) };
}

/** Kökten başlayarak kullanım sırasıyla (genişlik öncelikli) sıralar; ulaşılamayanlar sona. */
export function orderTypes(root: TypeRef, types: Map<string, ModelType>): ModelType[] {
  const ordered: ModelType[] = [];
  const seen = new Set<string>();
  const queue: TypeRef[] = [root];
  const names = (t: TypeRef): string[] =>
    t.kind === 'array'
      ? names(t.items)
      : t.kind === 'map'
        ? names(t.values)
        : t.kind === 'class' || t.kind === 'enum'
          ? [t.name]
          : [];
  while (queue.length) {
    for (const name of names(queue.shift()!)) {
      if (seen.has(name) || !types.has(name)) continue;
      seen.add(name);
      const type = types.get(name)!;
      ordered.push(type);
      if (type.kind === 'class') queue.push(...type.fields.map((f) => f.type));
    }
  }
  for (const [name, type] of types) if (!seen.has(name)) ordered.push(type);
  return ordered;
}
