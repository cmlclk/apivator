import { sortKeysDeep } from './json';

export interface JsonChange {
  /** JSONPath benzeri yol: `$.user.tags[2]`; özel karakterli anahtarlar `$['a.b']`. */
  path: string;
  kind: 'added' | 'removed' | 'changed';
  before?: unknown;
  after?: unknown;
}

export interface JsonDiffOptions {
  /** Dizileri sırasız karşılaştır (çoklu küme gibi); varsayılan false: indeks indeks. */
  ignoreArrayOrder?: boolean;
}

const IDENTIFIER = /^[\p{L}_$][\p{L}\p{N}_$]*$/u;

function keyPath(parent: string, key: string): string {
  return IDENTIFIER.test(key)
    ? `${parent}.${key}`
    : `${parent}['${key.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}']`;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Anahtar sırasından bağımsız karşılaştırma için kanonik metin. */
function canonical(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value)) ?? 'undefined';
}

/** Yapısal fark: nesne anahtar sırası önemsiz; tip değişimi `changed`. Sonuç belge sırasında. */
export function diffJson(before: unknown, after: unknown, options: JsonDiffOptions = {}): JsonChange[] {
  const changes: JsonChange[] = [];

  const visit = (a: unknown, b: unknown, path: string): void => {
    if (isObject(a) && isObject(b)) {
      for (const key of Object.keys(a)) {
        if (!Object.prototype.hasOwnProperty.call(b, key))
          changes.push({ path: keyPath(path, key), kind: 'removed', before: a[key] });
        else visit(a[key], b[key], keyPath(path, key));
      }
      for (const key of Object.keys(b)) {
        if (!Object.prototype.hasOwnProperty.call(a, key))
          changes.push({ path: keyPath(path, key), kind: 'added', after: b[key] });
      }
      return;
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      if (options.ignoreArrayOrder) return unordered(a, b, path);
      const common = Math.min(a.length, b.length);
      for (let i = 0; i < common; i++) visit(a[i], b[i], `${path}[${i}]`);
      for (let i = common; i < a.length; i++)
        changes.push({ path: `${path}[${i}]`, kind: 'removed', before: a[i] });
      for (let i = common; i < b.length; i++)
        changes.push({ path: `${path}[${i}]`, kind: 'added', after: b[i] });
      return;
    }
    // Tip değişimi (ör. nesne → dizi) ya da farklı ilkel değer.
    if (a !== b) changes.push({ path, kind: 'changed', before: a, after: b });
  };

  // Sırasız: eşit elemanlar eşleşir; kalanlar eski dizideki indeksiyle silinmiş, yenidekiyle eklenmiş sayılır.
  const unordered = (a: unknown[], b: unknown[], path: string) => {
    const pool = new Map<string, number[]>();
    b.forEach((item, j) => {
      const key = canonical(item);
      pool.set(key, [...(pool.get(key) ?? []), j]);
    });
    const matched = new Set<number>();
    a.forEach((item, i) => {
      const j = pool.get(canonical(item))?.shift();
      if (j === undefined) changes.push({ path: `${path}[${i}]`, kind: 'removed', before: item });
      else matched.add(j);
    });
    b.forEach((item, j) => {
      if (!matched.has(j)) changes.push({ path: `${path}[${j}]`, kind: 'added', after: item });
    });
  };

  visit(before, after, '$');
  return changes;
}
