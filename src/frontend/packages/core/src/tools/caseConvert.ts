/**
 * Ad dönüşümü (camelCase, snake_case, kebab-case, Title Case …). Kelimeler Unicode harflerle bölünür, Türkçe
 * karakterler korunur; büyük/küçük harf dönüşümü Türkçe ya da İngilizce kurallarla yapılır. Model üretecinin
 * tanımlayıcı adlarından (models/naming) farkı: ASCII'ye çevirme isteğe bağlıdır ve tüm biçimler desteklenir.
 */

import { transliterate } from './slug';

export type CaseStyle =
  | 'camel'
  | 'pascal'
  | 'snake'
  | 'constant'
  | 'kebab'
  | 'cobol'
  | 'train'
  | 'dot'
  | 'path'
  | 'title'
  | 'sentence'
  | 'lower'
  | 'upper'
  | 'toggle';

export type CaseLocale = 'tr' | 'en';

export interface CaseOptions {
  /** Büyük/küçük harf kuralları: `tr` (i ↔ İ, ı ↔ I) ya da `en`; varsayılan `tr`. */
  locale?: CaseLocale;
  /** Sonucu ASCII'ye çevir (ç → c, ı → i …); birçok dil tanımlayıcıda ASCII dışını kabul etmez. */
  ascii?: boolean;
  /** Title Case'te bağlaç ve edatları (ve, ile, the, of …) ilk kelime dışında küçük bırak. */
  smallWords?: boolean;
  /** Her satırı ayrı dönüştür; kapalıysa satır sonları da ayırıcı sayılır. Varsayılan açık. */
  perLine?: boolean;
}

/** Biçimler; sıra araçta görünen sıradır. */
export const CASE_STYLES: readonly { id: CaseStyle; label: string }[] = [
  { id: 'camel', label: 'camelCase' },
  { id: 'pascal', label: 'PascalCase' },
  { id: 'snake', label: 'snake_case' },
  { id: 'constant', label: 'CONSTANT_CASE' },
  { id: 'kebab', label: 'kebab-case' },
  { id: 'cobol', label: 'COBOL-CASE' },
  { id: 'train', label: 'Train-Case' },
  { id: 'dot', label: 'dot.case' },
  { id: 'path', label: 'path/case' },
  { id: 'title', label: 'Title Case' },
  { id: 'sentence', label: 'Sentence case' },
  { id: 'lower', label: 'küçük harf' },
  { id: 'upper', label: 'BÜYÜK HARF' },
  { id: 'toggle', label: 'tERS hARF' },
];

/** Title Case'te küçük kalan kelimeler. */
export const TITLE_SMALL_WORDS: Record<CaseLocale, ReadonlySet<string>> = {
  tr: new Set('ve ile de da ki ya veya mi mı mu mü ama için gibi'.split(' ')),
  en: new Set('a an the and or but nor of in on at to for by as via vs'.split(' ')),
};

/**
 * Kelimelere böler: `XMLHttpRequest` → [XML, Http, Request], `user2Id` → [user2, Id], `şehir_adı` →
 * [şehir, adı]. Harf ve rakam dışındaki her karakter (`_ - . /` boşluk …) ayırıcıdır; yalnızca harfler
 * arasındaki kesme işareti kelimede kalır (`Türkiye'nin`, `don't`).
 */
export function splitWords(text: string): string[] {
  return (
    text
      .normalize('NFC')
      // küçük harf ya da rakamdan sonra büyük harf: fooBar, user2Id
      .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')
      // kısaltmadan sonra yeni kelime: XMLHttp → XML Http
      .replace(/(\p{Lu}+)(\p{Lu}\p{Ll})/gu, '$1 $2')
      .split(/[^\p{L}\p{N}\p{M}'’]+/u)
      .flatMap((word) => (/['’]/.test(word) ? word.split(/(?<![\p{L}\p{M}])['’]+|['’]+(?!\p{L})/u) : word))
      .filter(Boolean)
  );
}

// toLocale*Case('tr-TR') her çağrıda ICU yerel ayarını çözer (kelime başına ~2 µs; 5 MB metinde onlarca
// saniye). Türkçe kuralın farkı yalnızca I/İ/i'de olduğundan bunlar önce çevrilir, kalanı yerel ayarsız yapılır.
const lower = (text: string, locale: CaseLocale) =>
  locale === 'tr'
    ? text.replace(/İ|[Iİ]/g, (c) => (c === 'I' ? 'ı' : 'i')).toLowerCase()
    : // İngilizce kuralında İ → "i̇" (i + birleşik nokta) olurdu; düz i daha kullanışlı.
      text.replace(/İ/g, 'i').toLowerCase();

const upper = (text: string, locale: CaseLocale) =>
  locale === 'tr' ? text.replace(/i/g, 'İ').toUpperCase() : text.toUpperCase();

function capitalize(word: string, locale: CaseLocale): string {
  const [first = '', ...rest] = Array.from(word);
  return upper(first, locale) + lower(rest.join(''), locale);
}

function toggle(text: string, locale: CaseLocale): string {
  // Aynı karakterler çok tekrarlandığından her karakterin karşılığı bir kez hesaplanır.
  const cache = new Map<string, string>();
  let out = '';
  for (const ch of text) {
    let mapped = cache.get(ch);
    if (mapped === undefined) {
      const up = upper(ch, locale);
      mapped = ch === up ? lower(ch, locale) : up;
      cache.set(ch, mapped);
    }
    out += mapped;
  }
  return out;
}

function convertOne(text: string, style: CaseStyle, locale: CaseLocale, smallWords: boolean): string {
  // Bu üçü metnin kendisine uygulanır; ayırıcılar korunur.
  if (style === 'lower') return lower(text, locale);
  if (style === 'upper') return upper(text, locale);
  if (style === 'toggle') return toggle(text, locale);

  // Kesme işareti yalnızca Title/Sentence case'te kalır; tanımlayıcılarda atılır (slug gibi: türkiyenin).
  const prose = style === 'title' || style === 'sentence';
  const words = splitWords(text).map((w) => (prose ? w : w.replace(/['’]/g, '')));
  const low = words.map((w) => lower(w, locale));
  const cap = words.map((w) => capitalize(w, locale));
  const up = words.map((w) => upper(w, locale));
  switch (style) {
    case 'camel':
      return low.slice(0, 1).concat(cap.slice(1)).join('');
    case 'pascal':
      return cap.join('');
    case 'snake':
      return low.join('_');
    case 'constant':
      return up.join('_');
    case 'kebab':
      return low.join('-');
    case 'cobol':
      return up.join('-');
    case 'train':
      return cap.join('-');
    case 'dot':
      return low.join('.');
    case 'path':
      return low.join('/');
    case 'title': {
      const small = TITLE_SMALL_WORDS[locale];
      return cap.map((w, i) => (i > 0 && smallWords && small.has(low[i]!) ? low[i] : w)).join(' ');
    }
    case 'sentence':
      return cap.slice(0, 1).concat(low.slice(1)).join(' ');
  }
}

/**
 * Metni seçilen biçime çevirir; çok satırlı girdide (varsayılan) her satır ayrı dönüştürülür ve satır sonları
 * (LF/CRLF) korunur.
 */
export function convertCase(text: string, style: CaseStyle, options: CaseOptions = {}): string {
  const { locale = 'tr', ascii = false, smallWords = true, perLine = true } = options;
  const run = (part: string) => {
    const result = convertOne(part, style, locale, smallWords);
    // ASCII'ye çevirme en sonda: önce yapılsaydı Türkçe kuralı I'yı yeniden ı'ya çevirirdi.
    return ascii ? transliterate(result) : result;
  };
  return perLine
    ? text
        .split(/(\r?\n)/)
        .map((part, i) => (i % 2 ? part : run(part)))
        .join('')
    : run(text);
}
