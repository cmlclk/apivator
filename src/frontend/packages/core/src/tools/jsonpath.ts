import { ToolError } from './errors';
import { msg } from '../i18n';

export interface JsonPathMatch {
  /** Normalleştirilmiş yol: `$['store']['book'][0]`. */
  path: string;
  value: unknown;
}

/** Sözdizimi hatası; `position` ifadedeki 0 tabanlı konum (arayüz işaretlemek için). */
export class JsonPathSyntaxError extends ToolError {
  constructor(
    message: string,
    readonly position: number,
  ) {
    super(msg('toolsData.atChar', '{pos}. karakterde: {message}', { pos: String(position + 1), message }));
  }
}

type Selector =
  | { kind: 'name'; name: string }
  | { kind: 'wildcard' }
  | { kind: 'index'; index: number }
  | { kind: 'slice'; start?: number; end?: number; step?: number }
  | { kind: 'filter'; expr: Expr };

interface Segment {
  descendant: boolean;
  selectors: Selector[];
}

type CmpOp = '==' | '!=' | '<' | '<=' | '>' | '>=';

type Operand = { type: 'lit'; value: unknown } | { type: 'path'; root: '@' | '$'; segments: Segment[] };

type Expr =
  | { type: 'or' | 'and'; left: Expr; right: Expr }
  | { type: 'not'; expr: Expr }
  | { type: 'cmp'; op: CmpOp; left: Operand; right: Operand }
  | { type: 'test'; operand: Operand };

const NAME_CHAR = /[\p{L}\p{N}_$-]/u;

class Parser {
  pos = 0;
  constructor(readonly src: string) {}

  fail(message: string, at = this.pos): never {
    throw new JsonPathSyntaxError(message, at);
  }
  ws() {
    while (/\s/.test(this.src[this.pos] ?? '')) this.pos++;
  }
  peek(text: string) {
    return this.src.startsWith(text, this.pos);
  }
  eat(text: string) {
    if (!this.peek(text)) return false;
    this.pos += text.length;
    return true;
  }
  expect(text: string) {
    this.ws();
    if (!this.eat(text)) this.fail(msg('toolsData.jsonpath.expected', '"{text}" bekleniyor.', { text }));
  }

  query(): Segment[] {
    this.ws();
    if (!this.eat('$')) this.fail(msg('toolsData.jsonpath.mustStartWithDollar', 'İfade $ ile başlamalı.'));
    const segments = this.segments(false);
    this.ws();
    if (this.pos < this.src.length)
      this.fail(msg('toolsData.unexpectedChar', 'Beklenmeyen karakter: "{ch}".', { ch: this.src[this.pos] }));
    return segments;
  }

  /** `.ad`, `..ad`, `[...]` dizisi; filtre içinde boşluktan sonra durur. */
  segments(inFilter: boolean): Segment[] {
    const segments: Segment[] = [];
    for (;;) {
      if (!inFilter) this.ws();
      if (this.eat('..')) {
        if (this.peek('[')) segments.push({ descendant: true, selectors: this.bracket() });
        else segments.push({ descendant: true, selectors: [this.dotSelector()] });
      } else if (this.eat('.')) {
        segments.push({ descendant: false, selectors: [this.dotSelector()] });
      } else if (this.peek('[')) {
        segments.push({ descendant: false, selectors: this.bracket() });
      } else return segments;
    }
  }

  dotSelector(): Selector {
    if (this.eat('*')) return { kind: 'wildcard' };
    const start = this.pos;
    while (NAME_CHAR.test(this.src[this.pos] ?? '')) this.pos++;
    if (this.pos === start) this.fail(msg('toolsData.jsonpath.expectedName', 'Alan adı ya da * bekleniyor.'));
    return { kind: 'name', name: this.src.slice(start, this.pos) };
  }

  bracket(): Selector[] {
    this.eat('[');
    const selectors: Selector[] = [];
    for (;;) {
      this.ws();
      selectors.push(this.bracketSelector());
      this.ws();
      if (this.eat(',')) continue;
      if (this.eat(']')) return selectors;
      this.fail(
        this.pos >= this.src.length
          ? msg('toolsData.jsonpath.unclosedBracket', 'Kapanmamış köşeli parantez: "]" bekleniyor.')
          : msg('toolsData.jsonpath.expectedCommaOrBracket', '"," ya da "]" bekleniyor.'),
      );
    }
  }

  bracketSelector(): Selector {
    const ch = this.src[this.pos];
    if (ch === "'" || ch === '"') return { kind: 'name', name: this.string() };
    if (this.eat('*')) return { kind: 'wildcard' };
    if (this.eat('?')) return { kind: 'filter', expr: this.or() };
    if (ch === ':' || ch === '-' || /[0-9]/.test(ch ?? '')) {
      const start = this.integer();
      this.ws();
      if (!this.peek(':')) {
        if (start === undefined) this.fail(msg('toolsData.jsonpath.expectedNumber', 'Sayı bekleniyor.'));
        return { kind: 'index', index: start };
      }
      this.eat(':');
      this.ws();
      const end = this.integer();
      this.ws();
      let step: number | undefined;
      if (this.eat(':')) {
        this.ws();
        step = this.integer();
      }
      return { kind: 'slice', start, end, step };
    }
    return this.fail(
      ch === undefined
        ? msg('toolsData.truncatedExpr', 'İfade yarıda kalmış.')
        : msg('toolsData.jsonpath.invalidSelector', 'Geçersiz seçici: "{ch}".', { ch }),
    );
  }

  integer(): number | undefined {
    const match = /^-?\d+/.exec(this.src.slice(this.pos));
    if (!match) return undefined;
    this.pos += match[0].length;
    return Number(match[0]);
  }

  string(): string {
    const quote = this.src[this.pos]!;
    const start = this.pos;
    this.pos++;
    let out = '';
    while (this.pos < this.src.length) {
      const ch = this.src[this.pos]!;
      if (ch === quote) {
        this.pos++;
        return out;
      }
      if (ch === '\\') {
        const next = this.src[this.pos + 1];
        const map: Record<string, string> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', '/': '/' };
        if (next === 'u' && /^[0-9a-fA-F]{4}$/.test(this.src.slice(this.pos + 2, this.pos + 6))) {
          out += String.fromCharCode(parseInt(this.src.slice(this.pos + 2, this.pos + 6), 16));
          this.pos += 6;
          continue;
        }
        if (next === undefined) break;
        out += map[next] ?? next;
        this.pos += 2;
        continue;
      }
      out += ch;
      this.pos++;
    }
    return this.fail(msg('toolsData.jsonpath.unclosedString', 'Kapanmamış metin.'), start);
  }

  or(): Expr {
    let left = this.and();
    for (;;) {
      this.ws();
      if (!this.eat('||')) return left;
      left = { type: 'or', left, right: this.and() };
    }
  }

  and(): Expr {
    let left = this.unary();
    for (;;) {
      this.ws();
      if (!this.eat('&&')) return left;
      left = { type: 'and', left, right: this.unary() };
    }
  }

  unary(): Expr {
    this.ws();
    if (this.peek('!') && !this.peek('!=')) {
      this.pos++;
      return { type: 'not', expr: this.unary() };
    }
    if (this.eat('(')) {
      const expr = this.or();
      this.expect(')');
      return expr;
    }
    const left = this.operand();
    this.ws();
    const op = (['==', '!=', '<=', '>=', '<', '>'] as const).find((o) => this.peek(o));
    if (!op) {
      if (this.peek('=')) this.fail(msg('toolsData.useDoubleEquals', 'Eşitlik için "==" kullanın.'));
      return { type: 'test', operand: left };
    }
    this.pos += op.length;
    this.ws();
    return { type: 'cmp', op, left, right: this.operand() };
  }

  operand(): Operand {
    const ch = this.src[this.pos];
    if (ch === '@' || ch === '$') {
      this.pos++;
      return { type: 'path', root: ch, segments: this.segments(true) };
    }
    if (ch === "'" || ch === '"') return { type: 'lit', value: this.string() };
    const number = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(this.src.slice(this.pos));
    if (number) {
      this.pos += number[0].length;
      return { type: 'lit', value: Number(number[0]) };
    }
    for (const [word, value] of [
      ['true', true],
      ['false', false],
      ['null', null],
    ] as const) {
      if (this.peek(word) && !NAME_CHAR.test(this.src[this.pos + word.length] ?? '')) {
        this.pos += word.length;
        return { type: 'lit', value };
      }
    }
    return this.fail(
      ch === undefined
        ? msg('toolsData.truncatedExpr', 'İfade yarıda kalmış.')
        : msg('toolsData.unexpectedChar', 'Beklenmeyen karakter: "{ch}".', { ch }),
    );
  }
}

interface Node {
  path: string;
  value: unknown;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const quoteName = (name: string) => `['${name.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}']`;

function children(node: Node): Node[] {
  if (Array.isArray(node.value)) return node.value.map((value, i) => ({ path: `${node.path}[${i}]`, value }));
  if (isObject(node.value))
    return Object.entries(node.value).map(([key, value]) => ({ path: node.path + quoteName(key), value }));
  return [];
}

function descendants(node: Node, out: Node[]) {
  out.push(node);
  for (const child of children(node)) descendants(child, out);
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

/** Bir sorguda işlenebilecek en fazla düğüm; `$..[?($..id)]` gibi karesel ifadeler arayüzü dondurmasın. */
const MAX_STEPS = 2_000_000;

class Evaluator {
  private steps = 0;
  constructor(readonly root: unknown) {}

  private charge(count: number) {
    this.steps += count;
    if (this.steps > MAX_STEPS)
      throw new ToolError(
        msg('toolsData.jsonpath.tooManyNodes', 'Sorgu çok fazla düğüm işledi; ifadeyi daraltın.'),
      );
  }

  run(segments: Segment[], start: Node[], inFilter = false): Node[] {
    let nodes = start;
    for (const segment of segments) {
      const next: Node[] = [];
      for (const node of nodes) {
        const targets: Node[] = [];
        if (segment.descendant) descendants(node, targets);
        else targets.push(node);
        this.charge(targets.length);
        const before = next.length;
        for (const target of targets)
          for (const selector of segment.selectors) this.select(target, selector, next, inFilter);
        this.charge(next.length - before);
      }
      nodes = next;
    }
    return nodes;
  }

  select(node: Node, selector: Selector, out: Node[], inFilter: boolean) {
    const value = node.value;
    switch (selector.kind) {
      case 'name':
        if (isObject(value) && Object.prototype.hasOwnProperty.call(value, selector.name))
          out.push({ path: node.path + quoteName(selector.name), value: value[selector.name] });
        else if (
          inFilter &&
          selector.name === 'length' &&
          (Array.isArray(value) || typeof value === 'string')
        )
          out.push({ path: `${node.path}.length`, value: value.length });
        return;
      case 'wildcard':
        out.push(...children(node));
        return;
      case 'index': {
        if (!Array.isArray(value)) return;
        const i = selector.index < 0 ? value.length + selector.index : selector.index;
        if (i >= 0 && i < value.length) out.push({ path: `${node.path}[${i}]`, value: value[i] });
        return;
      }
      case 'slice': {
        if (!Array.isArray(value)) return;
        const step = selector.step ?? 1;
        if (step === 0) return;
        const len = value.length;
        const norm = (n: number) => (n < 0 ? len + n : n);
        if (step > 0) {
          const lower = Math.min(Math.max(norm(selector.start ?? 0), 0), len);
          const upper = Math.min(Math.max(norm(selector.end ?? len), 0), len);
          for (let i = lower; i < upper; i += step) out.push({ path: `${node.path}[${i}]`, value: value[i] });
        } else {
          const upper = Math.min(Math.max(norm(selector.start ?? len - 1), -1), len - 1);
          const lower = Math.min(Math.max(selector.end === undefined ? -1 : norm(selector.end), -1), len - 1);
          for (let i = upper; i > lower; i += step) out.push({ path: `${node.path}[${i}]`, value: value[i] });
        }
        return;
      }
      case 'filter':
        for (const child of children(node)) if (this.test(selector.expr, child)) out.push(child);
        return;
    }
  }

  nodes(operand: Operand, current: Node): Node[] | null {
    if (operand.type === 'lit') return null;
    const start = operand.root === '@' ? current : { path: '$', value: this.root };
    return this.run(operand.segments, [start], true);
  }

  /** Karşılaştırmada tek değer; sonuç yoksa ya da birden çoksa undefined ("hiçbir şey"). */
  single(operand: Operand, current: Node): unknown {
    if (operand.type === 'lit') return operand.value;
    const found = this.nodes(operand, current)!;
    return found.length === 1 ? found[0]!.value : undefined;
  }

  test(expr: Expr, current: Node): boolean {
    switch (expr.type) {
      case 'or':
        return this.test(expr.left, current) || this.test(expr.right, current);
      case 'and':
        return this.test(expr.left, current) && this.test(expr.right, current);
      case 'not':
        return !this.test(expr.expr, current);
      case 'test': {
        const found = this.nodes(expr.operand, current);
        return found ? found.length > 0 : Boolean((expr.operand as { value: unknown }).value);
      }
      case 'cmp':
        return compare(expr.op, this.single(expr.left, current), this.single(expr.right, current));
    }
  }
}

function compare(op: CmpOp, a: unknown, b: unknown): boolean {
  if (op === '==') return deepEqual(a, b);
  if (op === '!=') return !deepEqual(a, b);
  const comparable =
    (typeof a === 'number' && typeof b === 'number') || (typeof a === 'string' && typeof b === 'string');
  if (!comparable) return (op === '<=' || op === '>=') && deepEqual(a, b);
  const x = a as number | string;
  const y = b as number | string;
  return op === '<' ? x < y : op === '<=' ? x <= y : op === '>' ? x > y : x >= y;
}

/**
 * RFC 9535 JSONPath'in pratik alt kümesi: `$`, `.ad`, `['ad']`, `[0]`, `[-1]`, `[0:3]`, `[*]`, `.*`, `..`,
 * birleşim `[0,2]` / `['a','b']`, filtre `[?(@.fiyat < 10 && @.ad)]` (karşılaştırma, `&&`, `||`, `!`,
 * varlık, `@.length`). Sözdizimi hatasında konumlu ToolError. `eval` kullanılmaz.
 */
export function queryJsonPath(value: unknown, expression: string): JsonPathMatch[] {
  const segments = new Parser(expression).query();
  return new Evaluator(value).run(segments, [{ path: '$', value }]);
}
