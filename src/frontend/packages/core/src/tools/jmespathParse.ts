import { ToolError } from './errors';
import { msg } from '../i18n';

/** JMESPath sözdizimi hatası; `position` ifadedeki 0 tabanlı konum (arayüz işaretlemek için). */
export class JmesPathSyntaxError extends ToolError {
  constructor(
    message: string,
    readonly position: number,
  ) {
    super(msg('toolsData.atChar', '{pos}. karakterde: {message}', { pos: String(position + 1), message }));
  }
}

export type CmpOp = '==' | '!=' | '<' | '<=' | '>' | '>=';

export type JmesNode =
  | { type: 'identity' }
  | { type: 'field'; name: string }
  | { type: 'literal'; value: unknown }
  | { type: 'sub'; left: JmesNode; right: JmesNode }
  | { type: 'index'; index: number }
  | { type: 'slice'; start: number | null; stop: number | null; step: number | null }
  | { type: 'indexExpr'; left: JmesNode; right: JmesNode }
  | { type: 'projection'; left: JmesNode; right: JmesNode }
  | { type: 'valueProjection'; left: JmesNode; right: JmesNode }
  | { type: 'filterProjection'; left: JmesNode; right: JmesNode; condition: JmesNode }
  | { type: 'flatten'; child: JmesNode }
  | { type: 'pipe' | 'or' | 'and'; left: JmesNode; right: JmesNode }
  | { type: 'not'; child: JmesNode }
  | { type: 'cmp'; op: CmpOp; left: JmesNode; right: JmesNode }
  | { type: 'list'; items: JmesNode[] }
  | { type: 'hash'; entries: [string, JmesNode][] }
  | { type: 'fn'; name: string; args: JmesNode[]; position: number }
  | { type: 'expref'; child: JmesNode };

type TokenType =
  | 'dot'
  | 'star'
  | 'at'
  | 'lbracket'
  | 'rbracket'
  | 'lbrace'
  | 'rbrace'
  | 'lparen'
  | 'rparen'
  | 'comma'
  | 'colon'
  | 'pipe'
  | 'or'
  | 'and'
  | 'not'
  | 'filter'
  | 'flatten'
  | 'expref'
  | 'number'
  | 'unquoted'
  | 'quoted'
  | 'literal'
  | 'eof'
  | CmpOp;

interface Token {
  type: TokenType;
  value?: unknown;
  pos: number;
}

const SIMPLE: Record<string, TokenType> = {
  '.': 'dot',
  '*': 'star',
  '@': 'at',
  ']': 'rbracket',
  '{': 'lbrace',
  '}': 'rbrace',
  '(': 'lparen',
  ')': 'rparen',
  ',': 'comma',
  ':': 'colon',
};

/** Kapanış karakterine kadar okur; `\x` kaçışları atlanır. Kapanış bulunmazsa -1. */
function findClose(src: string, from: number, close: string): number {
  for (let i = from; i < src.length; i++) {
    if (src[i] === '\\') i++;
    else if (src[i] === close) return i;
  }
  return -1;
}

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  const fail = (message: string, at: number): never => {
    throw new JmesPathSyntaxError(message, at);
  };
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    const pos = i;
    const two = src.slice(i, i + 2);
    if (/\s/.test(ch)) {
      i++;
    } else if (/[A-Za-z_]/.test(ch)) {
      const match = /^[A-Za-z0-9_]+/.exec(src.slice(i))![0];
      tokens.push({ type: 'unquoted', value: match, pos });
      i += match.length;
    } else if (/[0-9-]/.test(ch)) {
      const match = /^-?\d+/.exec(src.slice(i));
      if (!match)
        fail(msg('toolsData.jmespath.numberAfterMinus', '"-" işaretinden sonra sayı bekleniyor.'), pos);
      tokens.push({ type: 'number', value: Number(match![0]), pos });
      i += match![0].length;
    } else if (ch === '"') {
      const end = findClose(src, i + 1, '"');
      if (end < 0) fail(msg('toolsData.jmespath.unclosedQuotedName', 'Kapanmamış tırnaklı alan adı.'), pos);
      try {
        tokens.push({ type: 'quoted', value: JSON.parse(src.slice(i, end + 1)) as string, pos });
      } catch {
        fail(msg('toolsData.jmespath.badQuotedEscape', 'Tırnaklı alan adında geçersiz kaçış dizisi.'), pos);
      }
      i = end + 1;
    } else if (ch === "'") {
      const end = findClose(src, i + 1, "'");
      if (end < 0) fail(msg('toolsData.jmespath.unclosedRawString', "Kapanmamış ham metin ('...')."), pos);
      tokens.push({ type: 'literal', value: src.slice(i + 1, end).replace(/\\'/g, "'"), pos });
      i = end + 1;
    } else if (ch === '`') {
      const end = findClose(src, i + 1, '`');
      if (end < 0)
        fail(msg('toolsData.jmespath.unclosedJsonLiteral', 'Kapanmamış JSON değişmezi (`...`).'), pos);
      const json = src.slice(i + 1, end).replace(/\\`/g, '`');
      try {
        tokens.push({ type: 'literal', value: JSON.parse(json) as unknown, pos });
      } catch {
        fail(msg('toolsData.jmespath.invalidJsonLiteral', 'JSON değişmezi geçerli JSON değil.'), pos);
      }
      i = end + 1;
    } else if (two === '[?' || two === '[]') {
      tokens.push({ type: two === '[?' ? 'filter' : 'flatten', pos });
      i += 2;
    } else if (ch === '[') {
      tokens.push({ type: 'lbracket', pos });
      i++;
    } else if (two === '||' || two === '&&') {
      tokens.push({ type: two === '||' ? 'or' : 'and', pos });
      i += 2;
    } else if (two === '==' || two === '!=' || two === '<=' || two === '>=') {
      tokens.push({ type: two as CmpOp, pos });
      i += 2;
    } else if (ch === '<' || ch === '>') {
      tokens.push({ type: ch, pos });
      i++;
    } else if (ch === '|' || ch === '&' || ch === '!') {
      tokens.push({ type: ch === '|' ? 'pipe' : ch === '&' ? 'expref' : 'not', pos });
      i++;
    } else if (ch === '=') {
      fail(msg('toolsData.useDoubleEquals', 'Eşitlik için "==" kullanın.'), pos);
    } else if (SIMPLE[ch]) {
      tokens.push({ type: SIMPLE[ch], pos });
      i++;
    } else {
      fail(msg('toolsData.unexpectedChar', 'Beklenmeyen karakter: "{ch}".', { ch }), pos);
    }
  }
  tokens.push({ type: 'eof', pos: src.length });
  return tokens;
}

/** Pratt ayrıştırıcının bağlama güçleri (jmespath.py ile aynı). */
const BP: Partial<Record<TokenType, number>> = {
  pipe: 1,
  or: 2,
  and: 3,
  '==': 5,
  '!=': 5,
  '<': 5,
  '<=': 5,
  '>': 5,
  '>=': 5,
  flatten: 9,
  star: 20,
  filter: 21,
  dot: 40,
  not: 45,
  lbrace: 50,
  lbracket: 55,
  lparen: 60,
};
const bp = (type: TokenType) => BP[type] ?? 0;

const IDENTITY: JmesNode = { type: 'identity' };

const TOKEN_TEXT: Partial<Record<TokenType, string>> = {
  rbracket: ']',
  rbrace: '}',
  rparen: ')',
  colon: ':',
  comma: ',',
  star: '*',
  dot: '.',
};

class Parser {
  private index = 0;
  constructor(private readonly tokens: Token[]) {}

  private cur(): Token {
    return this.tokens[this.index]!;
  }
  private lookahead(n: number): TokenType {
    return this.tokens[Math.min(this.index + n, this.tokens.length - 1)]!.type;
  }
  private advance() {
    if (this.index < this.tokens.length - 1) this.index++;
  }
  private fail(message?: string, token = this.cur()): never {
    throw new JmesPathSyntaxError(
      message ??
        (token.type === 'eof'
          ? msg('toolsData.truncatedExpr', 'İfade yarıda kalmış.')
          : msg('toolsData.jmespath.unexpectedToken', 'Beklenmeyen simge.')),
      token.pos,
    );
  }
  private match(type: TokenType) {
    if (this.cur().type !== type)
      this.fail(
        this.cur().type === 'eof'
          ? msg('toolsData.jmespath.truncatedExpecting', 'İfade yarıda kalmış: "{token}" bekleniyor.', {
              token: TOKEN_TEXT[type] ?? type,
            })
          : msg('toolsData.jmespath.expectedToken', '"{token}" bekleniyor.', {
              token: TOKEN_TEXT[type] ?? type,
            }),
      );
    this.advance();
  }

  parse(): JmesNode {
    const node = this.expression(0);
    if (this.cur().type !== 'eof') this.fail();
    return node;
  }

  expression(power: number): JmesNode {
    const token = this.cur();
    this.advance();
    let left = this.nud(token);
    while (power < bp(this.cur().type)) {
      const op = this.cur();
      this.advance();
      left = this.led(op, left);
    }
    return left;
  }

  private nud(token: Token): JmesNode {
    switch (token.type) {
      case 'literal':
        return { type: 'literal', value: token.value };
      case 'unquoted':
        return { type: 'field', name: token.value as string };
      case 'quoted':
        if (this.cur().type === 'lparen')
          this.fail(msg('toolsData.jmespath.quotedFunctionName', 'Fonksiyon adı tırnaklı olamaz.'), token);
        return { type: 'field', name: token.value as string };
      case 'star':
        return {
          type: 'valueProjection',
          left: IDENTITY,
          right: this.cur().type === 'rbracket' ? IDENTITY : this.projectionRhs(bp('star')),
        };
      case 'filter':
        return this.filter(IDENTITY);
      case 'lbrace':
        return this.multiselectHash();
      case 'lparen': {
        const node = this.expression(0);
        this.match('rparen');
        return node;
      }
      case 'flatten':
        return {
          type: 'projection',
          left: { type: 'flatten', child: IDENTITY },
          right: this.projectionRhs(bp('flatten')),
        };
      case 'not':
        return { type: 'not', child: this.expression(bp('not')) };
      case 'lbracket':
        if (this.cur().type === 'number' || this.cur().type === 'colon')
          return this.projectIfSlice(IDENTITY, this.indexExpression());
        if (this.cur().type === 'star' && this.lookahead(1) === 'rbracket') {
          this.advance();
          this.advance();
          return { type: 'projection', left: IDENTITY, right: this.projectionRhs(bp('star')) };
        }
        return this.multiselectList();
      case 'at':
        return IDENTITY;
      case 'expref':
        return { type: 'expref', child: this.expression(bp('expref')) };
      default:
        return this.fail(undefined, token);
    }
  }

  private led(token: Token, left: JmesNode): JmesNode {
    switch (token.type) {
      case 'dot':
        if (this.cur().type === 'star') {
          this.advance();
          return { type: 'valueProjection', left, right: this.projectionRhs(bp('dot')) };
        }
        return { type: 'sub', left, right: this.dotRhs(bp('dot')) };
      case 'pipe':
      case 'or':
      case 'and':
        return { type: token.type, left, right: this.expression(bp(token.type)) };
      case '==':
      case '!=':
      case '<':
      case '<=':
      case '>':
      case '>=':
        return { type: 'cmp', op: token.type, left, right: this.expression(bp(token.type)) };
      case 'lparen': {
        if (left.type !== 'field')
          this.fail(msg('toolsData.jmespath.expectedFunctionName', 'Fonksiyon adı bekleniyor.'), token);
        const args: JmesNode[] = [];
        while (this.cur().type !== 'rparen') {
          args.push(this.expression(0));
          if (this.cur().type !== 'rparen') this.match('comma');
        }
        this.match('rparen');
        return { type: 'fn', name: left.name, args, position: token.pos };
      }
      case 'filter':
        return this.filter(left);
      case 'flatten':
        return {
          type: 'projection',
          left: { type: 'flatten', child: left },
          right: this.projectionRhs(bp('flatten')),
        };
      case 'lbracket':
        if (this.cur().type === 'number' || this.cur().type === 'colon')
          return this.projectIfSlice(left, this.indexExpression());
        this.match('star');
        this.match('rbracket');
        return { type: 'projection', left, right: this.projectionRhs(bp('star')) };
      default:
        return this.fail(undefined, token);
    }
  }

  private filter(left: JmesNode): JmesNode {
    const condition = this.expression(0);
    this.match('rbracket');
    const right = this.cur().type === 'flatten' ? IDENTITY : this.projectionRhs(bp('filter'));
    return { type: 'filterProjection', left, right, condition };
  }

  private projectIfSlice(left: JmesNode, right: JmesNode): JmesNode {
    const node: JmesNode = { type: 'indexExpr', left, right };
    return right.type === 'slice'
      ? { type: 'projection', left: node, right: this.projectionRhs(bp('star')) }
      : node;
  }

  /** `[` sonrası: `0]` ya da `1:3:2]`. */
  private indexExpression(): JmesNode {
    if (this.lookahead(0) === 'colon' || this.lookahead(1) === 'colon') return this.slice();
    const value = this.cur().value as number;
    this.advance();
    this.match('rbracket');
    return { type: 'index', index: value };
  }

  private slice(): JmesNode {
    const parts: (number | null)[] = [null, null, null];
    let part = 0;
    while (this.cur().type !== 'rbracket') {
      if (this.cur().type === 'colon') {
        part++;
        if (part === 3)
          this.fail(msg('toolsData.jmespath.sliceColons', 'Dilimde en fazla iki ":" olabilir.'));
      } else if (this.cur().type === 'number') {
        if (parts[part] !== null) this.fail(msg('toolsData.jmespath.expectedColon', '":" bekleniyor.'));
        parts[part] = this.cur().value as number;
      } else this.fail(msg('toolsData.jmespath.sliceExpected', 'Dilimde sayı ya da ":" bekleniyor.'));
      this.advance();
    }
    if (parts[2] === 0) this.fail(msg('toolsData.jmespath.sliceStepZero', 'Dilim adımı 0 olamaz.'));
    this.match('rbracket');
    return { type: 'slice', start: parts[0]!, stop: parts[1]!, step: parts[2]! };
  }

  private projectionRhs(power: number): JmesNode {
    const type = this.cur().type;
    if (bp(type) < 10) return IDENTITY;
    if (type === 'lbracket' || type === 'filter') return this.expression(power);
    if (type === 'dot') {
      this.advance();
      return this.dotRhs(power);
    }
    return this.fail();
  }

  private dotRhs(power: number): JmesNode {
    const type = this.cur().type;
    if (type === 'quoted' || type === 'unquoted' || type === 'star') return this.expression(power);
    if (type === 'lbracket') {
      this.advance();
      return this.multiselectList();
    }
    if (type === 'lbrace') {
      this.advance();
      return this.multiselectHash();
    }
    return this.fail(
      msg('toolsData.jmespath.afterDot', '"." sonrası alan adı, "*", "[" ya da "\'{\'" bekleniyor.'),
    );
  }

  private multiselectList(): JmesNode {
    const items: JmesNode[] = [];
    for (;;) {
      items.push(this.expression(0));
      if (this.cur().type === 'rbracket') break;
      this.match('comma');
    }
    this.match('rbracket');
    return { type: 'list', items };
  }

  private multiselectHash(): JmesNode {
    const entries: [string, JmesNode][] = [];
    for (;;) {
      const key = this.cur();
      if (key.type !== 'quoted' && key.type !== 'unquoted')
        this.fail(msg('toolsData.jmespath.expectedKeyName', 'Anahtar adı bekleniyor.'));
      this.advance();
      this.match('colon');
      entries.push([key.value as string, this.expression(0)]);
      if (this.cur().type === 'rbrace') break;
      this.match('comma');
    }
    this.match('rbrace');
    return { type: 'hash', entries };
  }
}

/** JMESPath ifadesini sözdizimi ağacına çevirir; hatada konumlu JmesPathSyntaxError. */
export function parseJmesPath(expression: string): JmesNode {
  if (!expression.trim()) throw new JmesPathSyntaxError(msg('toolsData.jmespath.emptyExpr', 'İfade boş.'), 0);
  return new Parser(tokenize(expression)).parse();
}
