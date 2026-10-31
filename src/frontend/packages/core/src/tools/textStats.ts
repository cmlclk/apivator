/** Dakikada okunan ortalama sözcük (okuma süresi tahmini). */
export const READING_WPM = 200;

export interface TextStats {
  /** UTF-16 kod birimi sayısı (JavaScript `length`). */
  utf16Length: number;
  codePoints: number;
  /** Kullanıcının gördüğü karakter sayısı (grapheme; emoji ve birleşik harfler tek sayılır). */
  graphemes: number;
  /** Boşluk karakterleri (boşluk, sekme, satır sonu, NBSP…) hariç kod noktası sayısı. */
  charsNoSpaces: number;
  words: number;
  lines: number;
  paragraphs: number;
  sentences: number;
  utf8Bytes: number;
  utf16Bytes: number;
  /** Kod noktası olarak ortalama sözcük uzunluğu. */
  avgWordLength: number;
  /** En uzun satır (1'den başlar) ve kod noktası uzunluğu. */
  longestLine: { line: number; length: number };
  readingMinutes: number;
  topWords: { word: string; count: number }[];
}

export interface TextStatsOptions {
  locale?: 'tr' | 'en';
  topCount?: number;
}

/** JavaScript `\s` kümesi (boşluk, sekme, satır sonları, NBSP, U+2000–200A, BOM…). */
function isSpace(code: number): boolean {
  return (
    code === 0x20 ||
    (code >= 0x09 && code <= 0x0d) ||
    code === 0xa0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000 ||
    code === 0xfeff
  );
}

const WORD_FALLBACK = /[\p{L}\p{N}\p{M}]+(?:['’.\-_][\p{L}\p{N}\p{M}]+)*/gu;
const HAS_LETTER = /\p{L}/u;

function segmenter(locale: string, granularity: 'grapheme' | 'word'): Intl.Segmenter | null {
  return typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(locale, { granularity }) : null;
}

/** Sözcükleri `Intl.Segmenter` ile (yoksa düzenli ifadeyle) bulur ve her biri için `visit` çağırır. */
function forEachWord(text: string, locale: string, visit: (word: string) => void): void {
  const words = segmenter(locale, 'word');
  if (words) {
    for (const part of words.segment(text)) if (part.isWordLike) visit(part.segment);
  } else {
    for (const match of text.matchAll(WORD_FALLBACK)) visit(match[0]);
  }
}

function countGraphemes(text: string, codePoints: number, crlf: number, simple: boolean): number {
  // U+0300 altındaki karakterlerde (Türkçe harfler dahil) birleşme yalnızca CRLF'te olur.
  if (simple) return codePoints - crlf;
  const graphemes = segmenter('und', 'grapheme');
  if (!graphemes) return codePoints - crlf;
  let count = 0;
  const parts = graphemes.segment(text)[Symbol.iterator]();
  while (!parts.next().done) count++;
  return count;
}

/** Kod noktası sayısı (vekil çiftleri tek sayılır). */
function codePointLength(text: string): number {
  let count = text.length;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const previous = text.charCodeAt(i - 1);
    if (code >= 0xdc00 && code <= 0xdfff && previous >= 0xd800 && previous <= 0xdbff) count--;
  }
  return count;
}

/** Cümle sonu: ardından boşluk ya da metin sonu gelen `.`, `!`, `?`, `…` (3.14 bölünmez) ya da boş satır. */
const SENTENCE_END = /[.!?…]+(?=\s|$)|\n[^\S\n]*\n/u;

function countSentences(text: string): number {
  let count = 0;
  for (const part of text.split(SENTENCE_END)) if (/[\p{L}\p{N}]/u.test(part)) count++;
  return count;
}

/**
 * Metin istatistikleri. Kod noktası, bayt, satır ve paragraf sayıları tek geçişte hesaplanır; sözcükler
 * `Intl.Segmenter` (Türkçe yerel ayar) ile bulunur. 5 MB metinde birkaç yüz milisaniye sürer.
 */
export function textStats(text: string, options: TextStatsOptions = {}): TextStats {
  const { locale = 'tr', topCount = 10 } = options;
  let codePoints = 0;
  let spaces = 0;
  let utf8Bytes = 0;
  let crlf = 0;
  let simple = true;
  let lines = text ? 1 : 0;
  let paragraphs = 0;
  let lineHasText = false;
  let inParagraph = false;
  let lineLength = 0;
  let longestLine = { line: text ? 1 : 0, length: 0 };

  const endLine = () => {
    if (lineLength > longestLine.length) longestLine = { line: lines, length: lineLength };
    if (lineHasText && !inParagraph) paragraphs++;
    inParagraph = lineHasText;
    lineHasText = false;
    lineLength = 0;
  };

  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 0x0a) {
      if (text.charCodeAt(i - 1) === 0x0d) {
        crlf++;
        lineLength--;
      }
      codePoints++;
      spaces++;
      utf8Bytes++;
      endLine();
      lines++;
      continue;
    }
    codePoints++;
    lineLength++;
    if (code < 0x80) utf8Bytes++;
    else if (code < 0x800) utf8Bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        i++;
        utf8Bytes += 4;
      } else {
        // Eşsiz vekil TextEncoder'da U+FFFD (3 bayt) olur.
        utf8Bytes += 3;
      }
    } else utf8Bytes += 3;
    if (code >= 0x300) simple = false;
    if (isSpace(code)) spaces++;
    else lineHasText = true;
  }
  if (text) endLine();

  let words = 0;
  let wordChars = 0;
  const frequency = new Map<string, number>();
  forEachWord(text, locale, (word) => {
    words++;
    wordChars += codePointLength(word);
    if (HAS_LETTER.test(word)) {
      const key = word.toLocaleLowerCase(locale);
      frequency.set(key, (frequency.get(key) ?? 0) + 1);
    }
  });
  const collator = new Intl.Collator(locale);
  const topWords = [...frequency]
    .sort((a, b) => b[1] - a[1] || collator.compare(a[0], b[0]))
    .slice(0, topCount)
    .map(([word, count]) => ({ word, count }));

  return {
    utf16Length: text.length,
    codePoints,
    graphemes: countGraphemes(text, codePoints, crlf, simple),
    charsNoSpaces: codePoints - spaces,
    words,
    lines,
    paragraphs,
    sentences: countSentences(text),
    utf8Bytes,
    utf16Bytes: text.length * 2,
    avgWordLength: words ? wordChars / words : 0,
    longestLine,
    readingMinutes: words / READING_WPM,
    topWords,
  };
}
