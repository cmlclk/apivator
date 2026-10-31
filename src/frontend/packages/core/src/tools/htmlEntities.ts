/** HTML varlık (entity) kodlama ve çözme; DOM kullanmaz (CLI'da da çalışır). */

/** U+00A0 … U+00FF (Latin-1) adları, kod sırasıyla. */
const LATIN1 =
  'nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 ' +
  'acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde ' +
  'Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute ' +
  'Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde ' +
  'auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ' +
  'ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml';

/** Yunan harfleri: büyükler U+0391'den (U+03A2 boş), küçükler U+03B1'den. */
const GREEK_UPPER =
  'Alpha Beta Gamma Delta Epsilon Zeta Eta Theta Iota Kappa Lambda Mu Nu Xi Omicron Pi Rho _ Sigma Tau ' +
  'Upsilon Phi Chi Psi Omega';
const GREEK_LOWER =
  'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigmaf sigma ' +
  'tau upsilon phi chi psi omega';

/** Türkçe harfler, tipografi, ok, matematik ve sık kullanılan diğer adlar. */
const OTHERS: Record<string, number> = {
  quot: 0x22,
  amp: 0x26,
  apos: 0x27,
  lt: 0x3c,
  gt: 0x3e,
  Gbreve: 0x11e,
  gbreve: 0x11f,
  Idot: 0x130,
  imath: 0x131,
  inodot: 0x131,
  OElig: 0x152,
  oelig: 0x153,
  Scedil: 0x15e,
  scedil: 0x15f,
  Scaron: 0x160,
  scaron: 0x161,
  Yuml: 0x178,
  fnof: 0x192,
  circ: 0x2c6,
  tilde: 0x2dc,
  ensp: 0x2002,
  emsp: 0x2003,
  thinsp: 0x2009,
  zwnj: 0x200c,
  zwj: 0x200d,
  lrm: 0x200e,
  rlm: 0x200f,
  ndash: 0x2013,
  mdash: 0x2014,
  lsquo: 0x2018,
  rsquo: 0x2019,
  sbquo: 0x201a,
  ldquo: 0x201c,
  rdquo: 0x201d,
  bdquo: 0x201e,
  dagger: 0x2020,
  Dagger: 0x2021,
  bull: 0x2022,
  hellip: 0x2026,
  permil: 0x2030,
  prime: 0x2032,
  Prime: 0x2033,
  lsaquo: 0x2039,
  rsaquo: 0x203a,
  oline: 0x203e,
  frasl: 0x2044,
  euro: 0x20ac,
  image: 0x2111,
  weierp: 0x2118,
  real: 0x211c,
  trade: 0x2122,
  alefsym: 0x2135,
  larr: 0x2190,
  uarr: 0x2191,
  rarr: 0x2192,
  darr: 0x2193,
  harr: 0x2194,
  crarr: 0x21b5,
  lArr: 0x21d0,
  uArr: 0x21d1,
  rArr: 0x21d2,
  dArr: 0x21d3,
  hArr: 0x21d4,
  forall: 0x2200,
  part: 0x2202,
  exist: 0x2203,
  empty: 0x2205,
  nabla: 0x2207,
  isin: 0x2208,
  notin: 0x2209,
  ni: 0x220b,
  prod: 0x220f,
  sum: 0x2211,
  minus: 0x2212,
  lowast: 0x2217,
  radic: 0x221a,
  prop: 0x221d,
  infin: 0x221e,
  ang: 0x2220,
  and: 0x2227,
  or: 0x2228,
  cap: 0x2229,
  cup: 0x222a,
  int: 0x222b,
  there4: 0x2234,
  sim: 0x223c,
  cong: 0x2245,
  asymp: 0x2248,
  ne: 0x2260,
  equiv: 0x2261,
  le: 0x2264,
  ge: 0x2265,
  sub: 0x2282,
  sup: 0x2283,
  nsub: 0x2284,
  sube: 0x2286,
  supe: 0x2287,
  oplus: 0x2295,
  otimes: 0x2297,
  perp: 0x22a5,
  sdot: 0x22c5,
  lceil: 0x2308,
  rceil: 0x2309,
  lfloor: 0x230a,
  rfloor: 0x230b,
  lang: 0x27e8,
  rang: 0x27e9,
  loz: 0x25ca,
  spades: 0x2660,
  clubs: 0x2663,
  hearts: 0x2665,
  diams: 0x2666,
  check: 0x2713,
  cross: 0x2717,
  star: 0x2606,
  starf: 0x2605,
};

function buildTable(): Map<string, number> {
  const table = new Map<string, number>();
  LATIN1.split(' ').forEach((name, i) => table.set(name, 0xa0 + i));
  GREEK_UPPER.split(' ').forEach((name, i) => name !== '_' && table.set(name, 0x391 + i));
  GREEK_LOWER.split(' ').forEach((name, i) => table.set(name, 0x3b1 + i));
  for (const [name, code] of Object.entries(OTHERS)) table.set(name, code);
  return table;
}

// İlk kullanımda kurulur: modül yan etkisiz kalır.
let byName: Map<string, number> | null = null;
let byCode: Map<number, string> | null = null;

/** Ad → kod noktası tablosu (yaklaşık 260 ad). */
export function htmlEntityTable(): ReadonlyMap<string, number> {
  byName ??= buildTable();
  return byName;
}

function nameFor(code: number): string | undefined {
  if (!byCode) {
    byCode = new Map();
    // Aynı karakterin birden çok adı varsa ilki kullanılır.
    for (const [name, value] of htmlEntityTable()) if (!byCode.has(value)) byCode.set(value, name);
  }
  return byCode.get(code);
}

export interface HtmlEncodeOptions {
  /** ASCII dışındaki her karakter de kodlanır (`&#xE7;`). */
  nonAscii?: boolean;
  /** `nonAscii` ile: adı bilinen karakterlerde sayısal yerine ad kullanılır (`&ccedil;`). */
  named?: boolean;
}

const MINIMAL: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** `& < > " '` her zaman kodlanır; istenirse ASCII dışı karakterler de. */
export function htmlEncode(text: string, options: HtmlEncodeOptions = {}): string {
  let out = '';
  for (const char of text) {
    const minimal = MINIMAL[char];
    if (minimal) {
      out += minimal;
      continue;
    }
    const code = char.codePointAt(0)!;
    if (!options.nonAscii || code < 0x7f) {
      out += char;
      continue;
    }
    const name = options.named ? nameFor(code) : undefined;
    out += name ? `&${name};` : `&#x${code.toString(16).toUpperCase()};`;
  }
  return out;
}

const ENTITY = /&(?:#[xX]([0-9a-fA-F]+)|#([0-9]+)|([A-Za-z][A-Za-z0-9]*));/g;

/** Geçersiz sayısal referans (0, vekil, aralık dışı) HTML kuralı gibi U+FFFD olur. */
function fromNumeric(code: number): string {
  if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '�';
  return String.fromCodePoint(code);
}

/** Sayısal (`&#231;`, `&#xE7;`) ve adlandırılmış varlıkları çözer; bilinmeyen adlar olduğu gibi kalır. */
export function htmlDecode(text: string): string {
  const table = htmlEntityTable();
  return text.replace(ENTITY, (match, hex: string | undefined, dec: string | undefined, name?: string) => {
    if (hex !== undefined) return fromNumeric(hex.length > 8 ? Infinity : parseInt(hex, 16));
    if (dec !== undefined) return fromNumeric(dec.length > 8 ? Infinity : parseInt(dec, 10));
    const code = table.get(name!);
    return code === undefined ? match : String.fromCodePoint(code);
  });
}
