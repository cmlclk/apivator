// Yjs'ye bağlı değildir; editör ve değişken alanı bunu Yjs'i ana pakete çekmeden kullanır.

/** UTF-16 vekil çiftini ortadan bölmemek için sınırı bir karakter geri çeker. */
const splitsPair = (text: string, index: number) =>
  index > 0 &&
  index < text.length &&
  /[\uD800-\uDBFF]/.test(text[index - 1]!) &&
  /[\uDC00-\uDFFF]/.test(text[index]!);

/**
 * İki metin arasındaki en küçük değişiklik aralığı: ortak baş ve son korunur. Vekil çiftini (emoji) ortadan
 * bölmemek için sınırlar bir karakter geri çekilir.
 */
export function diffRange(before: string, after: string): { from: number; to: number; insert: string } {
  let start = 0;
  const max = Math.min(before.length, after.length);
  while (start < max && before[start] === after[start]) start++;
  while (splitsPair(before, start)) start--;
  let end = 0;
  while (end < max - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++;
  while (splitsPair(before, before.length - end)) end--;
  return { from: start, to: before.length - end, insert: after.slice(start, after.length - end) };
}
