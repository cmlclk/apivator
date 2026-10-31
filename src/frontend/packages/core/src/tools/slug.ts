/**
 * URL dostu kısa ad (slug) üretimi: Türkçe harf çevirisi, Latin aksanlarının atılması, ayırıcı, uzunluk sınırı
 * (kelime sınırında kesilir) ve isteğe bağlı dolgu kelimelerinin çıkarılması.
 */

const TURKISH: Record<string, string> = {
  ç: 'c',
  Ç: 'C',
  ğ: 'g',
  Ğ: 'G',
  ı: 'i',
  İ: 'I',
  ö: 'o',
  Ö: 'O',
  ş: 's',
  Ş: 'S',
  ü: 'u',
  Ü: 'U',
};

/** NFKD ile ayrışmayan Latin harfleri. */
const LATIN_EXTRA: Record<string, string> = {
  ß: 'ss',
  ẞ: 'SS',
  æ: 'ae',
  Æ: 'AE',
  œ: 'oe',
  Œ: 'OE',
  ø: 'o',
  Ø: 'O',
  ł: 'l',
  Ł: 'L',
  đ: 'd',
  Đ: 'D',
  ð: 'd',
  Ð: 'D',
  þ: 'th',
  Þ: 'TH',
};

/**
 * Harfleri büyük/küçük hâlini koruyarak ASCII'ye çevirir (ç → c, İ → I, é → e, ß → ss); karşılığı olmayan
 * ASCII dışı karakterler atılır.
 */
export function transliterate(text: string): string {
  return text
    .replace(/[çÇğĞıİöÖşŞüÜ]/g, (c) => TURKISH[c]!)
    .replace(/[ßẞæÆœŒøØłŁđĐðÐþÞ]/g, (c) => LATIN_EXTRA[c]!)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{ASCII}]/gu, '');
}

export type SlugLocale = 'tr' | 'en';

/** Slug'dan çıkarılabilecek dolgu kelimeleri (ASCII'ye çevrilmiş, küçük harf). */
export const SLUG_STOP_WORDS: Record<SlugLocale, ReadonlySet<string>> = {
  tr: new Set(
    've ile veya ya da de ki mi mu bir bu su o icin gibi ama fakat ancak cok daha en her hem ise yani'.split(
      ' ',
    ),
  ),
  en: new Set(
    'a an the and or but nor of in on at to for by with from as is are was were be into than that this'.split(
      ' ',
    ),
  ),
};

export interface SlugOptions {
  /** Kelime ayırıcı; varsayılan `-`. */
  separator?: '-' | '_';
  /** Küçük harfe çevir; varsayılan açık. */
  lowercase?: boolean;
  /** En fazla karakter (0 ya da verilmezse sınırsız); kelime sınırında kesilir. */
  maxLength?: number;
  /** Dolgu kelimelerini (ve, ile, the, of …) çıkar; tüm kelimeler dolguysa hiçbiri çıkarılmaz. */
  removeStopWords?: boolean;
  /** Dolgu kelimesi listesi; varsayılan `tr`. */
  locale?: SlugLocale;
}

/** Metni slug'a çevirir: "Çılgın Şehir & Ötesi!" → `cilgin-sehir-otesi`. */
export function slugify(text: string, options: SlugOptions = {}): string {
  const {
    separator = '-',
    lowercase = true,
    maxLength = 0,
    removeStopWords = false,
    locale = 'tr',
  } = options;
  // Kesme işaretleri kelimeyi bölmez: "Türkiye'nin" → turkiyenin, "don't" → dont.
  let ascii = transliterate(text.normalize('NFC').replace(/['’`]/g, ''));
  if (lowercase) ascii = ascii.toLowerCase();
  let words = ascii.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (removeStopWords) {
    const stop = SLUG_STOP_WORDS[locale];
    const kept = words.filter((w) => !stop.has(w.toLowerCase()));
    if (kept.length > 0) words = kept;
  }
  let slug = words.join(separator);
  const limit = Math.floor(maxLength);
  if (limit > 0 && slug.length > limit) {
    while (words.length > 1 && words.join(separator).length > limit) words = words.slice(0, -1);
    slug = words.join(separator).slice(0, limit);
  }
  return slug;
}

/** Her satır için ayrı slug; boş satırlar boş kalır, satır sonları (LF/CRLF) korunur. */
export function slugifyLines(text: string, options: SlugOptions = {}): string {
  return text
    .split(/(\r?\n)/)
    .map((part, i) => (i % 2 ? part : slugify(part, options)))
    .join('');
}
