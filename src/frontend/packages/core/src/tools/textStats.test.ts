import { describe, expect, it } from 'vitest';
import { textStats } from './textStats';

describe('textStats', () => {
  it('boş metin', () => {
    const s = textStats('');
    expect(s).toMatchObject({
      utf16Length: 0,
      words: 0,
      lines: 0,
      paragraphs: 0,
      sentences: 0,
      utf8Bytes: 0,
    });
    expect(s.topWords).toEqual([]);
  });

  it('karakter, kod noktası, grapheme ve bayt sayıları', () => {
    const s = textStats('Çay 😀 é');
    expect(s.utf16Length).toBe(9);
    expect(s.codePoints).toBe(8);
    expect(s.graphemes).toBe(7);
    expect(s.charsNoSpaces).toBe(6);
    expect(s.utf8Bytes).toBe(new TextEncoder().encode('Çay 😀 é').length);
    expect(s.utf16Bytes).toBe(18);
    // Türkçe harfler hızlı yoldan sayılır; CRLF tek grapheme.
    expect(textStats('ğüşİ\r\nı').graphemes).toBe(6);
    // Eşsiz vekil U+FFFD olarak 3 bayt.
    expect(textStats('\ud800').utf8Bytes).toBe(3);
  });

  it('sözcük, satır, paragraf ve cümle', () => {
    const text = "Ankara'da hava güzel. Pi 3.14 eder!\nYeni satır\n\n\nİkinci paragraf mı?";
    const s = textStats(text);
    expect(s.words).toBe(11);
    expect(s.lines).toBe(5);
    expect(s.paragraphs).toBe(2);
    expect(s.sentences).toBe(4);
    expect(s.longestLine).toEqual({ line: 1, length: 35 });
    expect(s.avgWordLength).toBeCloseTo(53 / 11);
  });

  it('CRLF satır uzunluğuna sayılmaz; okuma süresi', () => {
    expect(textStats('ab\r\nabc').longestLine).toEqual({ line: 2, length: 3 });
    expect(textStats('söz '.repeat(400)).readingMinutes).toBe(2);
  });

  it('en sık sözcükler Türkçe küçük harfe çevrilir; sayılar dahil edilmez', () => {
    const s = textStats('IŞIK ışık Işık kapı 42 42 42 kapı elma', { topCount: 2 });
    expect(s.topWords).toEqual([
      { word: 'ışık', count: 3 },
      { word: 'kapı', count: 2 },
    ]);
  });

  it('5 MB metinde makul sürede biter', () => {
    const text = 'Merhaba dünya, bu bir deneme cümlesidir. '.repeat(125_000);
    const started = performance.now();
    const s = textStats(text);
    expect(s.words).toBe(750_000);
    expect(performance.now() - started).toBeLessThan(5000);
  });
});
