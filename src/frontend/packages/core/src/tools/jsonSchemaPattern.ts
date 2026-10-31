/**
 * Basit düzenli ifadelerden (`pattern`) eşleşen örnek metin üretir: sabit karakterler, \d \w \s, karakter sınıfları,
 * gruplar, `|` ve niceleyiciler (? * + {n} {n,m}). Geri başvuru, ileri/geri bakma gibi yapılar desteklenmez;
 * üretilen metin desene uymazsa null döner (çağıran düz örneğe düşer).
 */

/** [0, 1) aralığında sayı üretir; verilmezse belirlenimci (hep ilk seçenek, en kısa tekrar). */
export type Random = (() => number) | null;

type Node =
  | { k: 'lit'; ch: string }
  | { k: 'set'; ranges: [number, number][]; negate: boolean }
  | { k: 'any' }
  | { k: 'alt'; options: Node[][] }
  | { k: 'rep'; node: Node; min: number; max: number };

class Unsupported extends Error {}

const DIGIT: [number, number][] = [[48, 57]];
const WORD: [number, number][] = [
  [97, 122],
  [65, 90],
  [48, 57],
  [95, 95],
];
const SPACE: [number, number][] = [[32, 32]];
/** Olumsuz sınıflar için aday karakterler. */
const PRINTABLE: [number, number][] = [
  [97, 122],
  [65, 90],
  [48, 57],
];
const MAX_REPEAT_EXTRA = 3;
const MAX_LENGTH = 1000;
/** Boş eşleşen tekrarlar (`(|a){1000000}`) çıktıyı uzatmadan döner; toplam adım sınırı. */
const MAX_STEPS = 100_000;

function parse(source: string): Node[][] {
  let i = 0;

  const escapeSet = (ch: string): [number, number][] | null => {
    switch (ch) {
      case 'd':
        return DIGIT;
      case 'w':
        return WORD;
      case 's':
        return SPACE;
      case 'D':
      case 'W':
      case 'S':
      case 'b':
      case 'B':
        throw new Unsupported();
      default:
        return null;
    }
  };

  const literalEscape = (ch: string): string => {
    if (/[1-9kpPux]/.test(ch)) throw new Unsupported();
    return { n: '\n', t: '\t', r: '\r', f: '\f', v: '\v', '0': '\0' }[ch] ?? ch;
  };

  const parseClass = (): Node => {
    i++; // [
    const negate = source[i] === '^';
    if (negate) i++;
    const ranges: [number, number][] = [];
    let first = true;
    while (i < source.length && (source[i] !== ']' || first)) {
      first = false;
      let ch = source[i++]!;
      if (ch === '\\') {
        const next = source[i++] ?? '';
        const set = escapeSet(next);
        if (set) {
          ranges.push(...set);
          continue;
        }
        ch = literalEscape(next);
      }
      if (source[i] === '-' && source[i + 1] !== undefined && source[i + 1] !== ']') {
        i++;
        let end = source[i++]!;
        if (end === '\\') end = literalEscape(source[i++] ?? '');
        ranges.push([ch.codePointAt(0)!, end.codePointAt(0)!]);
      } else {
        ranges.push([ch.codePointAt(0)!, ch.codePointAt(0)!]);
      }
    }
    if (source[i] !== ']') throw new Unsupported();
    i++;
    return { k: 'set', ranges, negate };
  };

  const parseAtom = (): Node | null => {
    const ch = source[i]!;
    if (ch === '(') {
      i++;
      if (source[i] === '?') {
        if (source[i + 1] !== ':') throw new Unsupported();
        i += 2;
      }
      const options = parseAlt();
      if (source[i] !== ')') throw new Unsupported();
      i++;
      return { k: 'alt', options };
    }
    if (ch === '[') return parseClass();
    i++;
    if (ch === '.') return { k: 'any' };
    if (ch === '^' || ch === '$') return null;
    if (ch === '\\') {
      const next = source[i++] ?? '';
      const set = escapeSet(next);
      return set ? { k: 'set', ranges: set, negate: false } : { k: 'lit', ch: literalEscape(next) };
    }
    return { k: 'lit', ch };
  };

  const parseQuantifier = (node: Node): Node => {
    const ch = source[i];
    let min: number;
    let max: number;
    if (ch === '?') [min, max] = [0, 1];
    else if (ch === '*') [min, max] = [0, Infinity];
    else if (ch === '+') [min, max] = [1, Infinity];
    else if (ch === '{') {
      const match = /^\{(\d+)(,(\d*))?\}/.exec(source.slice(i));
      if (!match) return node;
      min = Number(match[1]);
      max = match[2] === undefined ? min : match[3] ? Number(match[3]) : Infinity;
      i += match[0].length - 1;
    } else return node;
    i++;
    if (source[i] === '?') i++; // tembel niceleyici
    return { k: 'rep', node, min, max };
  };

  function parseAlt(): Node[][] {
    const options: Node[][] = [[]];
    while (i < source.length && source[i] !== ')') {
      if (source[i] === '|') {
        i++;
        options.push([]);
        continue;
      }
      const atom = parseAtom();
      if (atom) options[options.length - 1]!.push(parseQuantifier(atom));
    }
    return options;
  }

  const result = parseAlt();
  if (i < source.length) throw new Unsupported();
  return result;
}

function pickChar(ranges: [number, number][], random: Random): string {
  if (!random) return String.fromCodePoint(ranges[0]![0]);
  const total = ranges.reduce((sum, [a, b]) => sum + Math.max(0, b - a + 1), 0);
  let index = Math.floor(random() * total);
  for (const [a, b] of ranges) {
    const size = Math.max(0, b - a + 1);
    if (index < size) return String.fromCodePoint(a + index);
    index -= size;
  }
  return String.fromCodePoint(ranges[0]![0]);
}

function generate(sequence: Node[], random: Random, out: string[], budget: { steps: number }) {
  for (const node of sequence) {
    if (out.length > MAX_LENGTH || ++budget.steps > MAX_STEPS) throw new Unsupported();
    switch (node.k) {
      case 'lit':
        out.push(node.ch);
        break;
      case 'any':
        out.push(pickChar(PRINTABLE, random));
        break;
      case 'set': {
        if (!node.negate) {
          out.push(pickChar(node.ranges, random));
          break;
        }
        const allowed = PRINTABLE.flatMap(([a, b]) =>
          Array.from({ length: b - a + 1 }, (_, n) => a + n).filter(
            (code) => !node.ranges.some(([x, y]) => code >= x && code <= y),
          ),
        );
        if (!allowed.length) throw new Unsupported();
        out.push(String.fromCodePoint(allowed[random ? Math.floor(random() * allowed.length) : 0]!));
        break;
      }
      case 'alt': {
        const index = random ? Math.floor(random() * node.options.length) : 0;
        generate(node.options[index]!, random, out, budget);
        break;
      }
      case 'rep': {
        // Belirlenimci: ? * + için bir kez (örnek boş kalmasın), {n,m} için n kez.
        const base = node.min === 0 && node.max >= 1 ? 1 : node.min;
        const extra = random ? Math.floor(random() * (MAX_REPEAT_EXTRA + 1)) : 0;
        const count = Math.min(base + extra, node.max, base + MAX_REPEAT_EXTRA);
        for (let n = 0; n < count; n++) generate([node.node], random, out, budget);
        break;
      }
    }
  }
}

/** Desene uyan bir örnek; desen geçersiz, desteklenmeyen ya da sonuç uymuyorsa null. */
export function sampleFromPattern(pattern: string, random: Random = null): string | null {
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, 'u');
  } catch {
    return null;
  }
  try {
    const options = parse(pattern);
    const out: string[] = [];
    generate(options[random ? Math.floor(random() * options.length) : 0]!, random, out, { steps: 0 });
    const text = out.join('');
    return regex.test(text) ? text : null;
  } catch (e) {
    // Çok derin iç içe gruplar yığını taşırabilir: desteklenmeyen desen sayılır.
    if (e instanceof Unsupported || e instanceof RangeError) return null;
    throw e;
  }
}
