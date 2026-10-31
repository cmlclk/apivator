// HTML güzelleştirme ve küçültme: kendi hoşgörülü ayrıştırıcısıyla; HTML hiçbir zaman çalıştırılmaz ya da çizilmez.
// <pre>, <textarea>, <script>, <style> ve <title> içeriği olduğu gibi korunur; öznitelikler kaynaktaki yazımıyla kalır.
import { FormatError, indentText, type FormatIndent } from './formatError';
import { msg } from '../i18n';

export interface HtmlFormatOptions {
  indent?: FormatIndent;
  /** Küçült: satır sonu ve girinti yok, boşluk dizileri tek boşluk. */
  minify?: boolean;
  /** Yorumları çıkar (korunan öğelerin içi hariç). */
  removeComments?: boolean;
}

interface HtmlElement {
  kind: 'element';
  name: string;
  lower: string;
  /** Kaynaktaki yazımıyla (`ad`, `ad=değer`, `ad="değer"`). */
  attrs: string[];
  selfClosing: boolean;
  children: HtmlNode[];
  /** Kapanış etiketinin adı; kaynakta kapanış yoksa (örtük kapanma) `null`. */
  endName: string | null;
  /** İçeriği olduğu gibi korunan öğelerde ham içerik. */
  raw?: string;
}
type HtmlNode =
  | HtmlElement
  | { kind: 'text'; text: string }
  /** Yorum, DOCTYPE, `<?...>` ve eşleşmeyen kapanış etiketi: olduğu gibi yazılır. */
  | { kind: 'verbatim'; raw: string; comment: boolean };

const VOID = new Set(
  'area base br col embed hr img input keygen link meta param source track wbr'.split(' '),
);
const RAW = new Set(['script', 'style', 'textarea', 'title', 'pre', 'xmp', 'plaintext']);
const INLINE = new Set(
  (
    'a abbr acronym b bdi bdo big br button cite code data del dfn em font i img input ins kbd label ' +
    'mark meter output progress q ruby rt rp s samp small span strike strong sub sup time tt u var wbr'
  ).split(' '),
);
const BLOCK_CLOSES_P =
  'address article aside blockquote details div dl fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 ' +
  'header hgroup hr main menu nav ol p pre section table ul';
/** Açılan öğe → üstteki hangi açık öğeyi örtük olarak kapatır. */
const CLOSES: Record<string, Set<string>> = {
  li: new Set(['li']),
  dt: new Set(['dt', 'dd']),
  dd: new Set(['dt', 'dd']),
  option: new Set(['option']),
  optgroup: new Set(['option', 'optgroup']),
  tr: new Set(['tr', 'td', 'th']),
  td: new Set(['td', 'th']),
  th: new Set(['td', 'th']),
  thead: new Set(['tbody', 'thead', 'tfoot', 'tr', 'td', 'th']),
  tbody: new Set(['tbody', 'thead', 'tfoot', 'tr', 'td', 'th']),
  tfoot: new Set(['tbody', 'thead', 'tfoot', 'tr', 'td', 'th']),
  rt: new Set(['rt', 'rp']),
  rp: new Set(['rt', 'rp']),
};
for (const tag of BLOCK_CLOSES_P.split(' ')) CLOSES[tag] = new Set([...(CLOSES[tag] ?? []), 'p']);

const isSpace = (c: string | undefined) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';
const isLetter = (c: string | undefined) => c !== undefined && /[A-Za-z]/.test(c);

/** HTML metnini biçimlendirir; kapanmamış yorum/etiket/tırnakta satır/sütunlu FormatError fırlatır. */
export function formatHtml(text: string, options: HtmlFormatOptions = {}): string {
  const printer = new HtmlPrinter(options);
  printer.children(parseHtml(text), 0, null);
  return printer.result();
}

/** Tek satıra küçültür. */
export function minifyHtml(text: string, options: Omit<HtmlFormatOptions, 'minify' | 'indent'> = {}): string {
  return formatHtml(text, { ...options, minify: true });
}

// ---- Ayrıştırma ----

function parseHtml(text: string): HtmlNode[] {
  const root: HtmlNode[] = [];
  const stack: HtmlElement[] = [];
  const fail = (reason: string, at: number): never => {
    throw new FormatError(reason, at, text);
  };
  const add = (node: HtmlNode) => (stack.at(-1)?.children ?? root).push(node);
  const until = (from: number, end: string, reason: () => string, at: number) => {
    const found = text.indexOf(end, from);
    if (found < 0) fail(reason(), at);
    return found + end.length;
  };

  let i = 0;
  let textStart = 0;
  const flushText = (end: number) => {
    if (end > textStart) add({ kind: 'text', text: text.slice(textStart, end) });
  };
  while (i < text.length) {
    const next = text[i + 1];
    const tagLike =
      text[i] === '<' &&
      (isLetter(next) || next === '!' || next === '?' || (next === '/' && isLetter(text[i + 2])));
    if (!tagLike) {
      i++;
      continue;
    }
    flushText(i);
    const start = i;
    if (text.startsWith('<!--', i)) {
      i = until(
        i + 4,
        '-->',
        () => msg('toolsData.format.unclosedComment', 'Yorum kapanmamış (--> bekleniyordu)'),
        start,
      );
      add({ kind: 'verbatim', raw: text.slice(start, i), comment: true });
    } else if (next === '!' || next === '?') {
      i = until(
        i + 2,
        '>',
        () => msg('toolsData.format.unclosedDeclaration', "Bildirim kapanmamış ('>' bekleniyordu)"),
        start,
      );
      add({ kind: 'verbatim', raw: text.slice(start, i), comment: false });
    } else if (next === '/') {
      const name = /^[^\s/>]+/.exec(text.slice(i + 2))![0];
      i = until(
        i + 2,
        '>',
        () =>
          msg('toolsData.format.unclosedTag', "</{name}> etiketi kapanmamış ('>' bekleniyordu)", { name }),
        start,
      );
      const lower = name.toLowerCase();
      let at = stack.length - 1;
      while (at >= 0 && stack[at]!.lower !== lower) at--;
      if (at < 0) add({ kind: 'verbatim', raw: text.slice(start, i), comment: false });
      else {
        stack[at]!.endName = name;
        stack.length = at;
      }
    } else {
      const element = parseStartTag(text, i, fail);
      i = element.end;
      const node = element.node;
      const closes = CLOSES[node.lower];
      while (closes && stack.length > 0 && closes.has(stack.at(-1)!.lower)) stack.pop();
      add(node);
      if (!node.selfClosing && !VOID.has(node.lower)) {
        if (RAW.has(node.lower)) {
          const close = new RegExp(`</${node.lower}(?=[\\s/>])`, 'gi');
          close.lastIndex = i;
          const found = close.exec(text);
          const end = found ? found.index : text.length;
          node.raw = text.slice(i, end);
          i = end;
          if (found) {
            const name = text.slice(end + 2, end + 2 + node.lower.length);
            i = until(
              end,
              '>',
              () =>
                msg('toolsData.format.unclosedTag', "</{name}> etiketi kapanmamış ('>' bekleniyordu)", {
                  name,
                }),
              end,
            );
            node.endName = name;
          }
        } else stack.push(node);
      }
    }
    textStart = i;
  }
  flushText(text.length);
  return root;
}

function parseStartTag(
  text: string,
  start: number,
  fail: (reason: string, at: number) => never,
): { node: HtmlElement; end: number } {
  const name = /^[^\s/>]+/.exec(text.slice(start + 1))![0];
  let i = start + 1 + name.length;
  const attrs: string[] = [];
  const unclosed = () =>
    fail(
      msg('toolsData.format.unclosedOpenTag', "<{name}> etiketi kapanmamış ('>' bekleniyordu)", { name }),
      start,
    );
  for (;;) {
    while (isSpace(text[i]) || (text[i] === '/' && text[i + 1] !== '>')) i++;
    if (i >= text.length) unclosed();
    if (text[i] === '>' || text.startsWith('/>', i)) break;
    const attrStart = i;
    i++;
    while (i < text.length && !isSpace(text[i]) && !'/>='.includes(text[i]!)) i++;
    let j = i;
    while (isSpace(text[j])) j++;
    if (text[j] === '=') {
      j++;
      while (isSpace(text[j])) j++;
      const quote = text[j];
      if (quote === '"' || quote === "'") {
        const close = text.indexOf(quote, j + 1);
        if (close < 0)
          fail(msg('toolsData.format.attrQuoteUnclosed', 'Öznitelik değerinin tırnağı kapanmamış'), j);
        j = close + 1;
      } else while (j < text.length && !isSpace(text[j]) && text[j] !== '>') j++;
      const raw = text.slice(attrStart, j);
      attrs.push(raw.replace(/\s*=\s*/, '='));
      i = j;
    } else attrs.push(text.slice(attrStart, i));
  }
  const selfClosing = text[i] === '/';
  const node: HtmlElement = {
    kind: 'element',
    name,
    lower: name.toLowerCase(),
    attrs,
    selfClosing,
    children: [],
    endName: null,
  };
  return { node, end: i + (selfClosing ? 2 : 1) };
}

// ---- Yazdırma ----

/** Tek satırda, metin akışı içinde yazılabilir mi (satır içi öğe ve torunları da öyle). */
function isInline(node: HtmlNode): boolean {
  if (node.kind === 'text') return true;
  if (node.kind === 'verbatim') return false;
  return INLINE.has(node.lower) && node.raw === undefined && node.children.every(isInline);
}

/** Bu kenarda boşluk görünür etki yapmaz (blok öğe, yorum ya da blok ebeveynin sınırı). */
function isBlockEdge(node: HtmlNode | undefined, parent: HtmlElement | null): boolean {
  if (!node) return !parent || !INLINE.has(parent.lower);
  return node.kind === 'verbatim' || (node.kind === 'element' && !INLINE.has(node.lower));
}

class HtmlPrinter {
  private readonly parts: string[] = [];
  private readonly unit: string;

  constructor(private readonly options: HtmlFormatOptions) {
    this.unit = indentText(options.indent);
  }

  result(): string {
    return this.parts.join(this.options.minify ? '' : '\n');
  }

  private line(depth: number, content: string) {
    this.parts.push(this.options.minify ? content : this.unit.repeat(depth) + content);
  }

  /** Çocukları yazar: ardışık satır içi düğümler tek satır, diğerleri kendi satırında. */
  children(nodes: HtmlNode[], depth: number, parent: HtmlElement | null) {
    const kept = nodes.filter((n) => !(n.kind === 'verbatim' && n.comment && this.options.removeComments));
    let run: HtmlNode[] = [];
    let before: HtmlNode | undefined;
    const flush = (after: HtmlNode | undefined) => {
      if (run.length === 0) return;
      const content = this.edges(this.inline(run), isBlockEdge(before, parent), isBlockEdge(after, parent));
      if (content.trim()) this.line(depth, content);
      run = [];
    };
    for (const [index, node] of kept.entries()) {
      if (isInline(node)) {
        if (run.length === 0) before = kept[index - 1];
        run.push(node);
        continue;
      }
      flush(node);
      if (node.kind === 'verbatim') this.line(depth, node.raw);
      else if (node.kind === 'element') this.element(node, depth);
    }
    flush(undefined);
  }

  /** Satırın başındaki/sonundaki boşluk: güzelleştirmede hep, küçültmede yalnızca blok kenarında atılır. */
  private edges(content: string, blockBefore: boolean, blockAfter: boolean): string {
    if (!this.options.minify) return content.trim();
    let result = content;
    if (blockBefore) result = result.trimStart();
    if (blockAfter) result = result.trimEnd();
    return result;
  }

  private open(node: HtmlElement): string {
    const attrs = node.attrs.map((a) => ` ${a}`).join('');
    return `<${node.name}${attrs}${node.selfClosing ? ' />' : '>'}`;
  }

  private close(node: HtmlElement): string {
    return node.endName === null ? '' : `</${node.endName}>`;
  }

  /** Satır içi düğümler; metindeki boşluk dizileri tek boşluk olur. */
  private inline(nodes: HtmlNode[]): string {
    return nodes
      .map((node) => {
        if (node.kind === 'text') return node.text.replace(/[ \t\n\r\f]+/g, ' ');
        if (node.kind === 'verbatim') return node.raw;
        return this.open(node) + this.inline(node.children) + this.close(node);
      })
      .join('');
  }

  private element(node: HtmlElement, depth: number) {
    const open = this.open(node);
    const close = this.close(node);
    if (node.raw !== undefined) return this.line(depth, open + node.raw + close);
    const children = node.children.filter(
      (n) => !(n.kind === 'verbatim' && n.comment && this.options.removeComments),
    );
    if (children.every(isInline)) {
      const content = this.edges(this.inline(children), !INLINE.has(node.lower), !INLINE.has(node.lower));
      return this.line(depth, open + content + close);
    }
    this.line(depth, open);
    this.children(children, depth + 1, node);
    if (close) this.line(depth, close);
  }
}
