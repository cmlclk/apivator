// XML güzelleştirme ve küçültme: DOM'suz, kendi ayrıştırıcısıyla (tarayıcı, masaüstü ve CLI'da aynı çalışır).
// Yorum, CDATA, işlem talimatı ve DOCTYPE olduğu gibi korunur; karışık içerik (metin + öğe) ve
// xml:space="preserve" öğelerin içi hiç değiştirilmez.
import { FormatError, indentText, type FormatIndent } from './formatError';
import { msg } from '../i18n';

export interface XmlFormatOptions {
  /** Girinti; varsayılan 2 boşluk. */
  indent?: FormatIndent;
  /** Küçült: öğeler arasındaki boşluğu at, tek satır. */
  minify?: boolean;
  /** Yorumları çıkar (yalnızca öğeler arasındakiler; karışık içeriğe dokunulmaz). */
  removeComments?: boolean;
}

interface XmlElement {
  kind: 'element';
  name: string;
  /** `ad="değer"` biçiminde, özgün tırnakla. */
  attrs: string[];
  selfClosing: boolean;
  children: XmlNode[];
  /** İçeriğin kaynaktaki aralığı (açılış etiketinin sonundan kapanışın başına). */
  innerStart: number;
  innerEnd: number;
  preserve: boolean;
}
type XmlNode =
  XmlElement | { kind: 'text'; text: string } | { kind: 'comment' | 'cdata' | 'pi' | 'doctype'; raw: string };

const NAME = /[A-Za-z_:À-￿][\w.:\-·À-￿]*/y;
const ENTITY = /&(?:#[0-9]+|#x[0-9A-Fa-f]+|[A-Za-z_:][\w.:-]*);/y;
const isSpace = (c: string | undefined) => c === ' ' || c === '\t' || c === '\n' || c === '\r';

/** XML metnini biçimlendirir; sözdizimi hatasında satır/sütunlu FormatError fırlatır. */
export function formatXml(text: string, options: XmlFormatOptions = {}): string {
  const nodes = parseXml(text);
  const printer = new XmlPrinter(text, options);
  printer.block(nodes, 0);
  return printer.result();
}

/** Tek satıra küçültür. */
export function minifyXml(text: string, options: Omit<XmlFormatOptions, 'minify' | 'indent'> = {}): string {
  return formatXml(text, { ...options, minify: true });
}

// ---- Ayrıştırma ----

function parseXml(text: string): XmlNode[] {
  const root: XmlNode[] = [];
  const stack: { element: XmlElement; start: number }[] = [];
  const children = () => stack.at(-1)?.element.children ?? root;
  const fail = (reason: string, at: number): never => {
    throw new FormatError(reason, at, text);
  };
  /** `end` dizisinin bitişi; yoksa `reason` hatası. */
  const until = (from: number, end: string, reason: () => string, at: number) => {
    const found = text.indexOf(end, from);
    if (found < 0) fail(reason(), at);
    return found + end.length;
  };

  let i = 0;
  while (i < text.length) {
    if (text[i] !== '<') {
      const next = text.indexOf('<', i);
      const end = next < 0 ? text.length : next;
      checkText(text, i, end, fail);
      children().push({ kind: 'text', text: text.slice(i, end) });
      i = end;
      continue;
    }
    const start = i;
    if (text.startsWith('<!--', i)) {
      i = until(
        i + 4,
        '-->',
        () => msg('toolsData.format.unclosedComment', 'Yorum kapanmamış (--> bekleniyordu)'),
        start,
      );
      children().push({ kind: 'comment', raw: text.slice(start, i) });
    } else if (text.startsWith('<![CDATA[', i)) {
      i = until(
        i + 9,
        ']]>',
        () => msg('toolsData.format.unclosedCdata', 'CDATA bölümü kapanmamış (]]> bekleniyordu)'),
        start,
      );
      children().push({ kind: 'cdata', raw: text.slice(start, i) });
    } else if (text.startsWith('<?', i)) {
      i = until(
        i + 2,
        '?>',
        () => msg('toolsData.format.unclosedPi', 'İşlem talimatı kapanmamış (?> bekleniyordu)'),
        start,
      );
      children().push({ kind: 'pi', raw: text.slice(start, i) });
    } else if (/^<!DOCTYPE/i.test(text.slice(i, i + 9))) {
      i = doctypeEnd(text, i + 9, fail);
      children().push({ kind: 'doctype', raw: text.slice(start, i) });
    } else if (text[i + 1] === '/') {
      NAME.lastIndex = i + 2;
      const name = NAME.exec(text)?.[0];
      if (!name) fail(msg('toolsData.format.closeTagName', 'Kapanış etiketinde öğe adı bekleniyordu'), i + 2);
      let j = i + 2 + name!.length;
      while (isSpace(text[j])) j++;
      if (text[j] !== '>')
        fail(
          msg('toolsData.format.unclosedTag', "</{name}> etiketi kapanmamış ('>' bekleniyordu)", { name }),
          j,
        );
      const open = stack.pop();
      if (!open)
        fail(
          msg(
            'toolsData.format.unexpectedCloseNoOpen',
            'Beklenmeyen kapanış etiketi </{name}>; açık öğe yok',
            { name },
          ),
          start,
        );
      if (open!.element.name !== name)
        fail(
          msg(
            'toolsData.format.unexpectedClose',
            'Beklenmeyen kapanış etiketi </{name}>; </{expected}> bekleniyordu',
            { name, expected: open!.element.name },
          ),
          start,
        );
      open!.element.innerEnd = start;
      i = j + 1;
    } else {
      i = parseStartTag(text, i, stack.at(-1)?.element.preserve ?? false, fail, (element) => {
        children().push(element);
        if (!element.selfClosing) stack.push({ element, start });
      });
    }
  }
  const open = stack.at(-1);
  if (open)
    fail(
      msg('toolsData.format.unclosedElement', '<{name}> öğesi kapanmamış', { name: open.element.name }),
      open.start,
    );
  return root;
}

function parseStartTag(
  text: string,
  start: number,
  inheritedPreserve: boolean,
  fail: (reason: string, at: number) => never,
  push: (element: XmlElement) => void,
): number {
  NAME.lastIndex = start + 1;
  const name = NAME.exec(text)?.[0];
  if (!name)
    fail(
      msg('toolsData.format.elementName', "Öğe adı bekleniyordu ('<' metinde &lt; olarak yazılmalı)"),
      start + 1,
    );
  let i = start + 1 + name!.length;
  const attrs: string[] = [];
  const seen = new Set<string>();
  let preserve = inheritedPreserve;
  for (;;) {
    const spaced = isSpace(text[i]);
    while (isSpace(text[i])) i++;
    if (i >= text.length)
      fail(
        msg('toolsData.format.unclosedOpenTag', "<{name}> etiketi kapanmamış ('>' bekleniyordu)", { name }),
        start,
      );
    if (text[i] === '>' || text.startsWith('/>', i)) break;
    if (!spaced) fail(msg('toolsData.format.attrSpace', 'Öznitelikler arasında boşluk olmalı'), i);
    NAME.lastIndex = i;
    const attr = NAME.exec(text)?.[0];
    if (!attr)
      fail(
        msg('toolsData.format.attrName', "Öznitelik adı bekleniyordu, ''{ch}'' bulundu", { ch: text[i] }),
        i,
      );
    if (seen.has(attr!)) fail(msg('toolsData.format.dupAttr', 'Yinelenen öznitelik: {attr}', { attr }), i);
    seen.add(attr!);
    i += attr!.length;
    while (isSpace(text[i])) i++;
    if (text[i] !== '=')
      fail(msg('toolsData.format.attrEquals', "''{attr}'' özniteliğinde '=' bekleniyordu", { attr }), i);
    i++;
    while (isSpace(text[i])) i++;
    const quote = text[i];
    if (quote !== '"' && quote !== "'")
      fail(msg('toolsData.format.attrQuoted', 'Öznitelik değeri tırnak içinde olmalı'), i);
    const close = text.indexOf(quote!, i + 1);
    if (close < 0)
      fail(msg('toolsData.format.attrQuoteUnclosed', 'Öznitelik değerinin tırnağı kapanmamış'), i);
    const value = text.slice(i + 1, close);
    const lt = value.indexOf('<');
    if (lt >= 0) fail(msg('toolsData.format.attrNoLt', "Öznitelik değerinde '<' olamaz"), i + 1 + lt);
    if (attr === 'xml:space') preserve = value === 'preserve';
    attrs.push(`${attr}=${quote}${value}${quote}`);
    i = close + 1;
  }
  const selfClosing = text[i] === '/';
  const end = i + (selfClosing ? 2 : 1);
  push({
    kind: 'element',
    name: name!,
    attrs,
    selfClosing,
    children: [],
    innerStart: end,
    innerEnd: end,
    preserve,
  });
  return end;
}

/** DOCTYPE sonu: tırnak ve iç alt küme ([...]) içindeki '>' sayılmaz. */
function doctypeEnd(text: string, from: number, fail: (reason: string, at: number) => never): number {
  let bracket = 0;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'") {
      const close = text.indexOf(c, i + 1);
      if (close < 0) break;
      i = close;
    } else if (c === '[') bracket++;
    else if (c === ']') bracket--;
    else if (c === '>' && bracket <= 0) return i + 1;
  }
  return fail(msg('toolsData.format.unclosedDoctype', 'DOCTYPE kapanmamış'), from - 9);
}

/** Metindeki `&` geçerli bir varlık başlatmalı; `]]>` metinde olamaz. */
function checkText(text: string, from: number, to: number, fail: (reason: string, at: number) => never) {
  // Arama yalnızca bu metin parçasında: tüm belgede aramak çok sayıda metin düğümünde O(n²) olur.
  const segment = text.slice(from, to);
  for (let i = segment.indexOf('&'); i >= 0; i = segment.indexOf('&', i + 1)) {
    ENTITY.lastIndex = i;
    const match = ENTITY.exec(segment);
    if (!match)
      fail(
        msg('toolsData.format.invalidEntity', "Geçersiz varlık: '&' metinde &amp; olarak yazılmalı"),
        from + i,
      );
  }
  const cdataEnd = segment.indexOf(']]>');
  if (cdataEnd >= 0) fail(msg('toolsData.format.noCdataEnd', "Metinde ']]>' olamaz"), from + cdataEnd);
}

// ---- Yazdırma ----

const isBlank = (node: XmlNode) => node.kind === 'text' && node.text.trim() === '';

class XmlPrinter {
  private readonly lines: string[] = [];
  private readonly unit: string;

  constructor(
    private readonly source: string,
    private readonly options: XmlFormatOptions,
  ) {
    this.unit = indentText(options.indent);
  }

  result(): string {
    return this.lines.join(this.options.minify ? '' : '\n');
  }

  private line(depth: number, content: string) {
    this.lines.push(this.options.minify ? content : this.unit.repeat(depth) + content);
  }

  /** Düğümleri alt alta yazar; yalnızca boşluk olan metinler atılır. */
  block(nodes: XmlNode[], depth: number) {
    for (const node of nodes) {
      if (node.kind === 'text') {
        const trimmed = node.text.trim();
        if (trimmed) this.line(depth, trimmed);
      } else if (node.kind === 'element') this.element(node, depth);
      else if (!(node.kind === 'comment' && this.options.removeComments)) this.line(depth, node.raw);
    }
  }

  private element(node: XmlElement, depth: number) {
    const open = `<${node.name}${node.attrs.map((a) => ` ${a}`).join('')}`;
    const close = `</${node.name}>`;
    if (node.selfClosing) return this.line(depth, `${open}/>`);
    const children = node.children;
    const inline = children.every((c) => c.kind === 'text' || c.kind === 'cdata');
    const mixed = children.some((c) => c.kind === 'text' && !isBlank(c));
    // Yalnızca metin, karışık içerik ya da xml:space="preserve": iç kısım kaynaktaki gibi kalır.
    if (inline || mixed || node.preserve) {
      const inner = this.source.slice(node.innerStart, node.innerEnd);
      return this.line(depth, `${open}>${inner}${close}`);
    }
    const kept = children.filter(
      (c) => !isBlank(c) && !(c.kind === 'comment' && this.options.removeComments),
    );
    if (kept.length === 0) return this.line(depth, `${open}>${close}`);
    this.line(depth, `${open}>`);
    this.block(kept, depth + 1);
    this.line(depth, close);
  }
}
