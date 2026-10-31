// GraphQL sorgu ve şema (SDL) güzelleştirme / küçültme: büyük `graphql` paketi olmadan, kendi sözcük çözümleyicisiyle.
// Dizgiler ve """blok dizgiler""" olduğu gibi korunur; virgüller anlamsız olduğu için yeniden üretilir.
import { FormatError, indentText, type FormatIndent } from './formatError';
import { msg } from '../i18n';

export interface GraphqlFormatOptions {
  indent?: FormatIndent;
}

type TokenKind = 'punct' | 'name' | 'number' | 'string' | 'comment';
interface Token {
  kind: TokenKind;
  value: string;
  start: number;
  /** Önceki belirteçle arasında satır sonu (ya da boş satır) var mı. */
  lines: 0 | 1 | 2;
}
type Context = 'block' | 'paren' | 'list' | 'object';

const PUNCT = '!$&():=@[]{|}';
const NAME = /[_A-Za-z][_0-9A-Za-z]*/y;
const NUMBER = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
const DEFINITIONS = new Set([
  'query',
  'mutation',
  'subscription',
  'fragment',
  'type',
  'interface',
  'union',
  'enum',
  'input',
  'scalar',
  'directive',
  'schema',
  'extend',
]);
const CLOSERS: Record<string, string> = { '}': '{', ')': '(', ']': '[' };

/** Belgeyi belirteçlere ayırır; kapanmamış dizgi ve eşleşmeyen parantezde FormatError. */
function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const open: Token[] = [];
  const fail = (reason: string, at: number): never => {
    throw new FormatError(reason, at, text);
  };
  let newlines = 0;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const push = (kind: TokenKind, value: string, start: number) => {
    tokens.push({ kind, value, start, lines: newlines >= 2 ? 2 : newlines === 1 ? 1 : 0 });
    newlines = 0;
  };
  while (i < text.length) {
    const c = text[i]!;
    if (c === '\n') {
      newlines++;
      i++;
    } else if (c === ' ' || c === '\t' || c === '\r' || c === ',') i++;
    else if (c === '#') {
      const end = text.indexOf('\n', i);
      const stop = end < 0 ? text.length : end;
      push('comment', text.slice(i, stop).trimEnd(), i);
      i = stop;
    } else if (text.startsWith('"""', i)) {
      let j = i + 3;
      for (;;) {
        const close = text.indexOf('"""', j);
        if (close < 0)
          fail(msg('toolsData.format.unclosedBlockString', 'Blok dizgi kapanmamış (""" bekleniyordu)'), i);
        if (text[close - 1] === '\\') j = close + 3;
        else {
          j = close + 3;
          break;
        }
      }
      push('string', text.slice(i, j), i);
      i = j;
    } else if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') {
        if (text[j] === '\n' || text[j] === '\r') break;
        j += text[j] === '\\' ? 2 : 1;
      }
      if (text[j] !== '"')
        fail(msg('toolsData.format.unclosedString', 'Dizgi kapanmamış (" bekleniyordu)'), i);
      push('string', text.slice(i, j + 1), i);
      i = j + 1;
    } else if (text.startsWith('...', i)) {
      push('punct', '...', i);
      i += 3;
    } else if (PUNCT.includes(c)) {
      push('punct', c, i);
      const token = tokens.at(-1)!;
      if (c === '{' || c === '(' || c === '[') open.push(token);
      else if (CLOSERS[c]) {
        const opener = open.pop();
        if (!opener)
          fail(msg('toolsData.format.unmatched', "Eşleşmeyen ''{ch}'': açık parantez yok", { ch: c }), i);
        const expected = { '{': '}', '(': ')', '[': ']' }[opener!.value];
        if (opener!.value !== CLOSERS[c])
          fail(
            msg('toolsData.format.expectedFound', "''{expected}'' bekleniyordu, ''{found}'' bulundu", {
              expected,
              found: c,
            }),
            i,
          );
      }
      i++;
    } else {
      NUMBER.lastIndex = i;
      NAME.lastIndex = i;
      const number = /[-0-9]/.test(c) ? NUMBER.exec(text)?.[0] : undefined;
      const name = number ? undefined : NAME.exec(text)?.[0];
      if (number) push('number', number, i);
      else if (name) push('name', name, i);
      else fail(msg('toolsData.format.unexpectedChar', "Beklenmeyen karakter ''{ch}''", { ch: c }), i);
      i += (number ?? name)!.length;
    }
  }
  const unclosed = open.at(-1);
  if (unclosed)
    fail(
      msg('toolsData.format.unclosedBracket', "Kapanmamış ''{ch}''", { ch: unclosed.value }),
      unclosed.start,
    );
  return tokens;
}

const isValue = (t: Token | undefined) =>
  t !== undefined && (t.kind === 'name' || t.kind === 'number' || t.kind === 'string');
/** Bu belirteçten sonra öğe (alan, argüman, değer) bitmiş olabilir. */
const endsItem = (t: Token | undefined, before: Token | undefined) =>
  t !== undefined &&
  (isValue(t) || ['!', ')', ']', '}'].includes(t.value)) &&
  !(t.value === 'on' && before?.value === '...');

/** GraphQL sorgusunu ya da şemasını biçimlendirir. */
export function formatGraphql(text: string, options: GraphqlFormatOptions = {}): string {
  const tokens = tokenize(text);
  const unit = indentText(options.indent);
  const stack: Context[] = [];
  let depth = 0;
  // Parçalar dizide birikir: uzun metinde her satır sonunda tüm çıktıyı kopyalamamak (O(n²)) için.
  const parts: string[] = [];
  const write = (chunk: string) => {
    if (chunk) parts.push(chunk);
  };
  /** Çıktının sonundaki boşlukları atar. */
  const trimTail = () => {
    while (parts.length > 0) {
      const last = parts.at(-1)!.trimEnd();
      if (last) {
        parts[parts.length - 1] = last;
        return;
      }
      parts.pop();
    }
  };
  let prev: Token | undefined;
  let prev2: Token | undefined;
  let afterComment = false;

  const newline = (blank: boolean, level: number) => {
    trimTail();
    parts.push((blank ? '\n\n' : '\n') + unit.repeat(level));
  };
  const inner = () => (stack.length > 0 && stack.at(-1) !== 'block' ? depth + 1 : depth);

  for (const t of tokens) {
    const context = stack.at(-1);
    if (t.kind === 'comment') {
      if (parts.length === 0) write(t.value);
      else if (t.lines > 0 || !prev) {
        // Tanımlar arasındaki yorum, sonraki tanımla birlikte boş satırla ayrılır.
        const between =
          !afterComment && stack.length === 0 && endsItem(prev, prev2) && prev?.kind !== 'string';
        newline(between || (t.lines === 2 && prev?.value !== '{' && prev?.value !== '('), inner());
        write(t.value);
      } else write(` ${t.value}`);
      afterComment = true;
      continue;
    }
    const closer = t.value === '}' || t.value === ')' || t.value === ']';
    if (closer && stack.pop() === 'block') depth--;

    if (parts.length === 0) {
      // İlk belirteç.
    } else if (afterComment) {
      const blank = t.lines === 2 && !closer && (context === 'block' || !context);
      newline(blank, closer ? (stack.length > 0 && stack.at(-1) !== 'block' ? depth + 1 : depth) : inner());
    } else if (!prev) {
      // Tür daraltma: önceki belirteç yoksa yalnızca yorum yazılmıştır (yukarıda işlendi).
    } else if (closer) {
      if (t.value === '}' && context === 'block') newline(false, depth);
      else if (t.value === '}' && prev.value !== '{') write(' ');
    } else if (!context) {
      const starts =
        endsItem(prev, prev2) &&
        prev.value !== 'extend' &&
        ((t.kind === 'name' && DEFINITIONS.has(t.value)) ||
          t.kind === 'string' ||
          (t.value === '{' && prev.value === '}'));
      if (starts) newline(prev.kind !== 'string', 0);
      else if (prev.kind === 'string' && (t.kind === 'name' || t.value === '{')) newline(false, 0);
      else write(spacing(prev, t));
    } else if (context === 'block') {
      const starts = t.kind === 'name' || t.kind === 'string' || t.value === '...';
      if (prev.value === '{') newline(false, depth);
      else if (starts && endsItem(prev, prev2)) newline(t.lines === 2, depth);
      else write(spacing(prev, t));
    } else {
      const starts = isValue(t) || ['$', '[', '{'].includes(t.value);
      // Argüman tanımındaki açıklama dizgisi ("açıklama" ad: Tip) değer değildir; ardından virgül gelmez.
      const description =
        prev.kind === 'string' && context === 'paren' && prev2?.value !== ':' && prev2?.value !== '=';
      if (prev.value === '(' || prev.value === '[') {
        // Açılıştan hemen sonra boşluk yok.
      } else if (prev.value === '{') write(' ');
      else if (starts && endsItem(prev, prev2) && !description) write(', ');
      else write(spacing(prev, t));
    }

    write(t.value);
    afterComment = false;
    if (t.value === '{') {
      const object = (context && context !== 'block') || prev?.value === '=' || prev?.value === ':';
      stack.push(object ? 'object' : 'block');
      if (!object) depth++;
    } else if (t.value === '(') stack.push('paren');
    else if (t.value === '[') stack.push('list');
    prev2 = prev;
    prev = t;
  }
  trimTail();
  return parts.join('');
}

/** Aynı öğe içindeki iki belirteç arasındaki boşluk. */
function spacing(prev: Token, t: Token): string {
  if (t.value === ':' || t.value === '!' || t.value === ')' || t.value === ']') return '';
  if (t.value === '(' && prev.kind === 'name') return '';
  if (['$', '@', '(', '['].includes(prev.value)) return '';
  if (prev.value === '...' && t.kind === 'name' && t.value !== 'on') return '';
  return ' ';
}

/** Tek satıra küçültür; yorumlar atılır. */
export function minifyGraphql(text: string): string {
  let out = '';
  let prev: Token | undefined;
  for (const t of tokenize(text)) {
    if (t.kind === 'comment') continue;
    const wordy = (x: Token) => x.kind === 'name' || x.kind === 'number';
    if (prev && ((wordy(prev) && wordy(t)) || (prev.kind === 'string' && t.kind === 'string'))) out += ' ';
    out += t.value;
    prev = t;
  }
  return out;
}
