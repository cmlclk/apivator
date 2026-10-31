import { ToolError } from './errors';
import { msg } from '../i18n';
import { parseJmesPath, type CmpOp, type JmesNode } from './jmespathParse';

export { JmesPathSyntaxError } from './jmespathParse';

/** Bir sorguda yapılabilecek en fazla işlem; büyük belgede iç içe izdüşümler arayüzü dondurmasın. */
const MAX_STEPS = 2_000_000;
/** Sonuçta (ve `to_string` girdilerinde) toplam en fazla bu kadar değer düğümü; büyük belgenin tamamı sığar. */
const MAX_RESULT_NODES = 10_000_000;

type JmesType = 'number' | 'string' | 'boolean' | 'array' | 'object' | 'null' | 'expref';

/** Fonksiyona `&ifade` ile geçen ifade başvurusu. */
class ExpRef {
  constructor(readonly node: JmesNode) {}
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof ExpRef);

function typeOf(value: unknown): JmesType {
  if (value === null || value === undefined) return 'null';
  if (value instanceof ExpRef) return 'expref';
  if (Array.isArray(value)) return 'array';
  const type = typeof value;
  if (type === 'number' || type === 'string' || type === 'boolean') return type;
  return 'object';
}

/** JMESPath doğruluğu: boş dizi/nesne/metin, false ve null yanlıştır; 0 doğrudur. */
function truthy(value: unknown): boolean {
  if (value === null || value === undefined || value === false || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (isObject(value)) return Object.keys(value).length > 0;
  return true;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  if (isObject(a) && isObject(b)) {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]))
    );
  }
  return false;
}

/** Anahtarı her zaman kendi özelliği olarak yazar: `__proto__` prototipi değiştirmez. */
function setOwn(target: Record<string, unknown>, key: string, value: unknown) {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

function compare(op: CmpOp, a: unknown, b: unknown): boolean | null {
  if (op === '==') return deepEqual(a, b);
  if (op === '!=') return !deepEqual(a, b);
  if (typeof a !== 'number' || typeof b !== 'number') return null;
  return op === '<' ? a < b : op === '<=' ? a <= b : op === '>' ? a > b : a >= b;
}

function sliceArray<T>(items: T[], start: number | null, stop: number | null, step: number | null): T[] {
  const len = items.length;
  const s = step ?? 1;
  const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);
  const norm = (n: number) => (n < 0 ? n + len : n);
  const out: T[] = [];
  if (s > 0) {
    const lower = clamp(start === null ? 0 : norm(start), 0, len);
    const upper = clamp(stop === null ? len : norm(stop), 0, len);
    for (let i = lower; i < upper; i += s) out.push(items[i]!);
  } else {
    const upper = clamp(start === null ? len - 1 : norm(start), -1, len - 1);
    const lower = clamp(stop === null ? -1 : norm(stop), -1, len - 1);
    for (let i = upper; i > lower; i += s) out.push(items[i]!);
  }
  return out;
}

/** Bağımsız değişken türü: `number`, `array-number` gibi; `|` ile birleşim. */
type ArgSpec = string;
interface FnDef {
  args: ArgSpec[];
  /** Son bağımsız değişken tekrarlanabilir (en az bir kez). */
  variadic?: boolean;
  run: (args: unknown[], ev: Evaluator) => unknown;
}

function matches(value: unknown, spec: ArgSpec): boolean {
  return spec.split('|').some((part) => {
    if (part === 'any') return !(value instanceof ExpRef);
    const [base, inner] = part.split('-') as [string, string | undefined];
    if (typeOf(value) !== base) return false;
    return !inner || (value as unknown[]).every((item) => typeOf(item) === inner);
  });
}

const codePoints = (text: string) => Array.from(text);

const numbers = (values: unknown[]) => values as number[];

/** Sayı ya da metin dizisinin en küçüğü/en büyüğü; boşsa null. */
function extreme(items: unknown[], pick: 1 | -1): unknown {
  if (items.length === 0) return null;
  return (items as number[]).reduce((best, item) => ((pick === 1 ? item > best : item < best) ? item : best));
}

function sortKeyed(ev: Evaluator, name: string, items: unknown[], ref: ExpRef) {
  const keyed = items.map((item, index) => ({ item, index, key: ev.evaluate(ref.node, item) }));
  const kind = keyed.length ? typeOf(keyed[0]!.key) : 'number';
  for (const { key } of keyed)
    if (typeOf(key) !== kind || (kind !== 'number' && kind !== 'string'))
      throw new ToolError(
        msg(
          'toolsData.jmespath.sortKeyTypes',
          '{name}(): ifade tüm öğeler için yalnızca sayı ya da yalnızca metin döndürmeli.',
          { name },
        ),
      );
  return keyed;
}

const byKey = (a: { key: unknown; index: number }, b: { key: unknown; index: number }) =>
  (a.key as number) < (b.key as number) ? -1 : (a.key as number) > (b.key as number) ? 1 : a.index - b.index;

const FUNCTIONS: Record<string, FnDef> = {
  abs: { args: ['number'], run: ([n]) => Math.abs(n as number) },
  avg: {
    args: ['array-number'],
    run: ([a]) => {
      const items = numbers(a as unknown[]);
      return items.length ? items.reduce((x, y) => x + y, 0) / items.length : null;
    },
  },
  ceil: { args: ['number'], run: ([n]) => Math.ceil(n as number) },
  contains: {
    args: ['array|string', 'any'],
    run: ([subject, search]) =>
      typeof subject === 'string'
        ? typeof search === 'string' && subject.includes(search)
        : (subject as unknown[]).some((item) => deepEqual(item, search)),
  },
  ends_with: { args: ['string', 'string'], run: ([s, x]) => (s as string).endsWith(x as string) },
  floor: { args: ['number'], run: ([n]) => Math.floor(n as number) },
  join: {
    args: ['string', 'array-string'],
    run: ([glue, items]) => (items as string[]).join(glue as string),
  },
  keys: { args: ['object'], run: ([o]) => Object.keys(o as object) },
  length: {
    args: ['string|array|object'],
    run: ([v]) =>
      typeof v === 'string'
        ? codePoints(v).length
        : Array.isArray(v)
          ? v.length
          : Object.keys(v as object).length,
  },
  map: {
    args: ['expref', 'array'],
    run: ([ref, items], ev) => (items as unknown[]).map((item) => ev.evaluate((ref as ExpRef).node, item)),
  },
  max: { args: ['array-number|array-string'], run: ([a]) => extreme(a as unknown[], 1) },
  min: { args: ['array-number|array-string'], run: ([a]) => extreme(a as unknown[], -1) },
  max_by: {
    args: ['array', 'expref'],
    run: ([items, ref], ev) => {
      const keyed = sortKeyed(ev, 'max_by', items as unknown[], ref as ExpRef);
      return keyed.length
        ? keyed.reduce((best, k) => ((k.key as number) > (best.key as number) ? k : best)).item
        : null;
    },
  },
  min_by: {
    args: ['array', 'expref'],
    run: ([items, ref], ev) => {
      const keyed = sortKeyed(ev, 'min_by', items as unknown[], ref as ExpRef);
      return keyed.length
        ? keyed.reduce((best, k) => ((k.key as number) < (best.key as number) ? k : best)).item
        : null;
    },
  },
  merge: {
    args: ['object'],
    variadic: true,
    run: (objects) => {
      const out: Record<string, unknown> = {};
      for (const o of objects) for (const [k, v] of Object.entries(o as object)) setOwn(out, k, v);
      return out;
    },
  },
  not_null: { args: ['any'], variadic: true, run: (values) => values.find((v) => v !== null) ?? null },
  reverse: {
    args: ['string|array'],
    run: ([v]) =>
      typeof v === 'string' ? codePoints(v).reverse().join('') : [...(v as unknown[])].reverse(),
  },
  sort: {
    args: ['array-number|array-string'],
    run: ([a]) => [...(a as (number | string)[])].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0)),
  },
  sort_by: {
    args: ['array', 'expref'],
    run: ([items, ref], ev) =>
      sortKeyed(ev, 'sort_by', items as unknown[], ref as ExpRef)
        .sort(byKey)
        .map((k) => k.item),
  },
  starts_with: { args: ['string', 'string'], run: ([s, x]) => (s as string).startsWith(x as string) },
  sum: { args: ['array-number'], run: ([a]) => numbers(a as unknown[]).reduce((x, y) => x + y, 0) },
  to_array: { args: ['any'], run: ([v]) => (Array.isArray(v) ? v : [v]) },
  to_number: {
    args: ['any'],
    run: ([v]) => {
      if (typeof v === 'number') return v;
      if (typeof v !== 'string' || !/^\s*-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?\s*$/.test(v)) return null;
      return Number(v);
    },
  },
  to_string: {
    args: ['any'],
    run: ([v], ev) => {
      if (typeof v === 'string') return v;
      ev.chargeSize(v);
      return JSON.stringify(v);
    },
  },
  type: { args: ['any'], run: ([v]) => typeOf(v) },
  values: { args: ['object'], run: ([o]) => Object.values(o as object) },
};

class Evaluator {
  private steps = 0;
  private nodes = 0;

  charge(count: number) {
    this.steps += count;
    if (this.steps > MAX_STEPS)
      throw new ToolError(
        msg('toolsData.jmespath.tooManySteps', 'Sorgu çok fazla işlem yaptı; ifadeyi daraltın.'),
      );
  }

  /**
   * Değerin JSON metnine çevrilecek düğümlerini sayar: `{a: @, b: @}` gibi ifadeler paylaşılan alt değerlerle
   * ucuzca üstel büyüklükte sonuç kurabilir; serileştirmek arayüzü dondurmasın. Derin veride yığın taşmasın diye
   * özyinelemesiz.
   */
  chargeSize(value: unknown) {
    const pending = [value];
    while (pending.length > 0) {
      if (++this.nodes > MAX_RESULT_NODES)
        throw new ToolError(
          msg('toolsData.jmespath.resultTooBig', 'Sorgu sonucu çok büyük; ifadeyi daraltın.'),
        );
      const item = pending.pop();
      // Büyük dizide `push(...item)` bağımsız değişken sınırını aşar; tek tek eklenir.
      const children = Array.isArray(item) ? item : isObject(item) ? Object.values(item) : [];
      for (const child of children) pending.push(child);
    }
  }

  evaluate(node: JmesNode, value: unknown): unknown {
    this.charge(1);
    switch (node.type) {
      case 'identity':
        return value;
      case 'field':
        return isObject(value) && Object.prototype.hasOwnProperty.call(value, node.name)
          ? value[node.name]
          : null;
      case 'literal':
        return node.value;
      case 'sub':
        return this.evaluate(node.right, this.evaluate(node.left, value));
      case 'index': {
        if (!Array.isArray(value)) return null;
        const i = node.index < 0 ? value.length + node.index : node.index;
        return value[i] ?? null;
      }
      case 'slice':
        return Array.isArray(value) ? sliceArray(value, node.start, node.stop, node.step) : null;
      case 'indexExpr':
        return this.evaluate(node.right, this.evaluate(node.left, value));
      case 'projection': {
        const base = this.evaluate(node.left, value);
        return Array.isArray(base) ? this.project(base, node.right) : null;
      }
      case 'valueProjection': {
        const base = this.evaluate(node.left, value);
        return isObject(base) ? this.project(Object.values(base), node.right) : null;
      }
      case 'filterProjection': {
        const base = this.evaluate(node.left, value);
        if (!Array.isArray(base)) return null;
        this.charge(base.length);
        return this.project(
          base.filter((item) => truthy(this.evaluate(node.condition, item))),
          node.right,
        );
      }
      case 'flatten': {
        const base = this.evaluate(node.child, value);
        if (!Array.isArray(base)) return null;
        this.charge(base.length);
        return base.flatMap((item) => (Array.isArray(item) ? item : [item]));
      }
      case 'pipe':
        return this.evaluate(node.right, this.evaluate(node.left, value));
      case 'or': {
        const left = this.evaluate(node.left, value);
        return truthy(left) ? left : this.evaluate(node.right, value);
      }
      case 'and': {
        const left = this.evaluate(node.left, value);
        return truthy(left) ? this.evaluate(node.right, value) : left;
      }
      case 'not':
        return !truthy(this.evaluate(node.child, value));
      case 'cmp':
        return compare(node.op, this.evaluate(node.left, value), this.evaluate(node.right, value));
      case 'list':
        return value === null ? null : node.items.map((item) => this.evaluate(item, value));
      case 'hash': {
        if (value === null) return null;
        const out: Record<string, unknown> = {};
        for (const [key, item] of node.entries) setOwn(out, key, this.evaluate(item, value));
        return out;
      }
      case 'expref':
        return new ExpRef(node.child);
      case 'fn':
        return this.call(node, value);
    }
  }

  private project(items: unknown[], right: JmesNode): unknown[] {
    this.charge(items.length);
    const out: unknown[] = [];
    for (const item of items) {
      const result = this.evaluate(right, item);
      if (result !== null) out.push(result);
    }
    return out;
  }

  private call(node: Extract<JmesNode, { type: 'fn' }>, value: unknown): unknown {
    const fn = Object.prototype.hasOwnProperty.call(FUNCTIONS, node.name) ? FUNCTIONS[node.name] : undefined;
    if (!fn)
      throw new ToolError(
        msg('toolsData.jmespath.unknownFunction', '{pos}. karakterde: Bilinmeyen fonksiyon: {name}().', {
          pos: String(node.position + 1),
          name: node.name,
        }),
      );
    const args = node.args.map((arg) => this.evaluate(arg, value));
    const count = fn.args.length;
    if (fn.variadic ? args.length < count : args.length !== count)
      throw new ToolError(
        msg(
          'toolsData.jmespath.argCount',
          '{name}() {variadic, select, true {en az {count}} other {{count}}} bağımsız değişken alır, {given} verildi.',
          {
            name: node.name,
            variadic: String(!!fn.variadic),
            count: String(count),
            given: String(args.length),
          },
        ),
      );
    args.forEach((arg, i) => {
      const spec = fn.args[Math.min(i, count - 1)]!;
      if (!matches(arg, spec))
        throw new ToolError(
          msg(
            'toolsData.jmespath.argType',
            '{name}(): {pos}. bağımsız değişken {expected} olmalı, {actual} verildi.',
            {
              name: node.name,
              pos: String(i + 1),
              expected: spec.replace(/\|/g, ' ya da '),
              actual: typeOf(arg),
            },
          ),
        );
      if (Array.isArray(arg)) this.charge(arg.length);
    });
    return fn.run(args, this);
  }
}

/**
 * JMESPath (jmespath.org) ifadesini JSON değeri üzerinde çalıştırır: alanlar, alt ifadeler, indeks/dilim,
 * izdüşümler (`[*]`, `.*`, `[]`, `[?...]`), boru `|`, çoklu seçim `[a, b]` / `{a: a}`, `||` `&&` `!`,
 * karşılaştırmalar, değişmezler (`` `json` `` ve `'ham'`), `@` ve yerleşik fonksiyonlar (`&` başvurularıyla).
 * Sözdizimi hatasında konumlu JmesPathSyntaxError, çalışma hatasında ToolError. `eval` kullanılmaz.
 */
export function queryJmesPath(value: unknown, expression: string): unknown {
  try {
    const evaluator = new Evaluator();
    const result = evaluator.evaluate(parseJmesPath(expression), value);
    if (result instanceof ExpRef)
      throw new ToolError(
        msg(
          'toolsData.jmespath.refOnlyInFunction',
          'İfade başvurusu (&) yalnızca fonksiyon içinde kullanılabilir.',
        ),
      );
    // Sonuç arayüzde JSON metni olarak gösterilir; boyutu da bütçeye dahil.
    evaluator.chargeSize(result);
    return result ?? null;
  } catch (error) {
    if (error instanceof RangeError)
      throw new ToolError(msg('toolsData.jmespath.tooDeep', 'İfade çok derin iç içe; sadeleştirin.'));
    throw error;
  }
}
