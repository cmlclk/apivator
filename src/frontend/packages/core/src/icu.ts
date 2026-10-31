/**
 * ICU MessageFormat'ın arayüzde kullanılan alt kümesi (dış kütüphanesiz):
 * `{ad}`, `{n, number}`, `{n, plural, =0 {…} one {# öğe} other {# öğe}}`, `{x, select, a {…} other {…}}`.
 * Kesme işareti yalnızca `{`/`}`/`'` önünde kaçış başlatır (`'{'`, `''`); "workspace'e" gibi yazımlar olduğu gibi kalır.
 * Ayrıştırılan metinler önbelleğe alınır.
 */

export type MessageValue = string | number | Date | null | undefined;
export type MessageParams = Record<string, MessageValue>;

type Node =
  | string
  | { kind: 'arg'; name: string; format?: string }
  | { kind: 'pound' }
  | { kind: 'plural'; name: string; offset: number; options: Record<string, Node[]> }
  | { kind: 'select'; name: string; options: Record<string, Node[]> };

const cache = new Map<string, Node[]>();

export function formatMessage(message: string, locale: string, params?: MessageParams): string {
  let nodes = cache.get(message);
  if (!nodes) {
    nodes = parse(message);
    cache.set(message, nodes);
  }
  return render(nodes, locale, params ?? {}, undefined);
}

/** Metnin kullandığı değişken adları (dil dosyalarında diller arası eşitlik denetimi için). */
export function messageArguments(message: string): Set<string> {
  const names = new Set<string>();
  const walk = (nodes: Node[]) => {
    for (const node of nodes) {
      if (typeof node === 'string' || node.kind === 'pound') continue;
      names.add(node.name);
      if (node.kind !== 'arg') Object.values(node.options).forEach(walk);
    }
  };
  walk(parse(message));
  return names;
}

function render(nodes: Node[], locale: string, params: MessageParams, pound: number | undefined): string {
  let out = '';
  for (const node of nodes) {
    if (typeof node === 'string') out += node;
    else if (node.kind === 'pound') out += pound === undefined ? '#' : numberFormat(locale).format(pound);
    else if (node.kind === 'arg') out += formatValue(params[node.name], node.format, locale);
    else if (node.kind === 'plural') {
      const raw = Number(params[node.name] ?? 0);
      const value = raw - node.offset;
      const exact = node.options[`=${raw}`];
      const branch = exact ?? node.options[pluralRules(locale).select(value)] ?? node.options.other ?? [];
      out += render(branch, locale, params, value);
    } else {
      const branch = node.options[String(params[node.name] ?? 'other')] ?? node.options.other ?? [];
      out += render(branch, locale, params, pound);
    }
  }
  return out;
}

function formatValue(value: MessageValue, format: string | undefined, locale: string): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toLocaleString(locale);
  if (typeof value === 'number' || format === 'number') return numberFormat(locale).format(Number(value));
  return value;
}

const numberFormats = new Map<string, Intl.NumberFormat>();
function numberFormat(locale: string) {
  let f = numberFormats.get(locale);
  if (!f) numberFormats.set(locale, (f = new Intl.NumberFormat(locale)));
  return f;
}

const plurals = new Map<string, Intl.PluralRules>();
function pluralRules(locale: string) {
  let p = plurals.get(locale);
  if (!p) plurals.set(locale, (p = new Intl.PluralRules(locale)));
  return p;
}

function parse(message: string): Node[] {
  let i = 0;

  function fail(reason: string): never {
    throw new Error(`ICU metni ayrıştırılamadı (${reason}, konum ${i}): ${message}`);
  }

  function skipSpace() {
    while (i < message.length && /\s/.test(message[i]!)) i++;
  }

  function word(): string {
    skipSpace();
    const start = i;
    while (i < message.length && !/[\s,{}]/.test(message[i]!)) i++;
    if (start === i) fail('ad bekleniyor');
    return message.slice(start, i);
  }

  function expect(ch: string) {
    skipSpace();
    if (message[i] !== ch) fail(`"${ch}" bekleniyor`);
    i++;
  }

  /** `inPlural` iken `#` sayının yerini tutar. Kapanış `}` görülünce durur (tüketmez). */
  function nodes(inPlural: boolean): Node[] {
    const out: Node[] = [];
    let text = '';
    const flush = () => {
      if (text) out.push(text);
      text = '';
    };
    while (i < message.length) {
      const ch = message[i]!;
      if (ch === '}') break;
      if (ch === '{') {
        flush();
        out.push(argument(inPlural));
        continue;
      }
      if (ch === '#' && inPlural) {
        flush();
        out.push({ kind: 'pound' });
        i++;
        continue;
      }
      if (ch === "'") {
        const next = message[i + 1];
        if (next === "'") {
          text += "'";
          i += 2;
          continue;
        }
        if (next === '{' || next === '}' || (next === '#' && inPlural)) {
          const end = message.indexOf("'", i + 1);
          if (end < 0) fail('kapanmayan kesme işareti');
          text += message.slice(i + 1, end);
          i = end + 1;
          continue;
        }
      }
      text += ch;
      i++;
    }
    flush();
    return out;
  }

  function argument(inPlural: boolean): Node {
    i++; // {
    const name = word();
    skipSpace();
    if (message[i] === '}') {
      i++;
      return { kind: 'arg', name };
    }
    expect(',');
    const type = word();
    skipSpace();
    if (type === 'number' || type === 'date' || type === 'time') {
      if (message[i] === ',') {
        i++;
        word();
      }
      expect('}');
      return { kind: 'arg', name, format: type };
    }
    if (type !== 'plural' && type !== 'select') fail(`bilinmeyen tür "${type}"`);
    expect(',');
    let offset = 0;
    const options: Record<string, Node[]> = {};
    for (;;) {
      skipSpace();
      if (message[i] === '}') {
        i++;
        break;
      }
      const key = word();
      if (key.startsWith('offset:')) {
        offset = Number(key.slice(7));
        continue;
      }
      expect('{');
      options[key] = nodes(inPlural || type === 'plural');
      expect('}');
    }
    if (!options.other) fail('"other" seçeneği yok');
    return type === 'plural' ? { kind: 'plural', name, offset, options } : { kind: 'select', name, options };
  }

  const result = nodes(false);
  if (i < message.length) fail('fazla "}"');
  return result;
}
