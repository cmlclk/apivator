import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import en from '../locales/en/toolsMisc.json';
import { registerCoreMessages, setCoreLanguage } from '../i18n';
import { ToolError } from './errors';
import { generateLorem, TR_VERBS, TR_WORDS } from './lorem';

describe('generateLorem', () => {
  it('klasik başlangıç ve kelime sayısı', () => {
    const text = generateLorem({ unit: 'words', count: 12, classicStart: true });
    expect(text.startsWith('Lorem ipsum dolor sit amet consectetur adipiscing elit ')).toBe(true);
    expect(text.split(' ')).toHaveLength(12);
    expect(generateLorem({ unit: 'words', count: 2, classicStart: true })).toBe('Lorem ipsum');
  });

  it('klasik başlangıç cümle içinde virgülle bölünmez', () => {
    for (let seed = 0; seed < 300; seed++) {
      const text = generateLorem({ unit: 'paragraphs', count: 1, classicStart: true, seed });
      expect(text, String(seed)).toMatch(/^Lorem ipsum dolor sit amet/);
    }
  });

  it('cümleler büyük harfle başlar, noktayla biter', () => {
    const text = generateLorem({ unit: 'sentences', count: 5, seed: 7 });
    const sentences = text.split(/(?<=\.) /);
    expect(sentences).toHaveLength(5);
    for (const s of sentences) expect(s).toMatch(/^[A-Z][a-z, ]+\.$/);
  });

  it('paragraflar düz metinde boş satırla, HTML içinde <p> ile ayrılır', () => {
    expect(generateLorem({ unit: 'paragraphs', count: 3, seed: 1 }).split('\n\n')).toHaveLength(3);
    const html = generateLorem({ unit: 'paragraphs', count: 3, seed: 1, html: true });
    expect(html.split('\n')).toHaveLength(3);
    for (const line of html.split('\n')) expect(line).toMatch(/^<p>[^<>]+<\/p>$/);
    expect(generateLorem({ unit: 'words', count: 3, html: true })).toMatch(/^<p>\S+ \S+ \S+<\/p>$/);
  });

  it('aynı tohum aynı metni, farklı tohum farklı metni verir', () => {
    const a = generateLorem({ unit: 'paragraphs', count: 2, seed: 42 });
    expect(generateLorem({ unit: 'paragraphs', count: 2, seed: 42 })).toBe(a);
    expect(generateLorem({ unit: 'paragraphs', count: 2, seed: 43 })).not.toBe(a);
  });

  it('Türkçe metin gerçek kelimelerden oluşur, cümleler fiille biter', () => {
    const text = generateLorem({ unit: 'words', count: 300, language: 'tr', seed: 3 });
    expect(text).toMatch(/[çğıöşü]/);
    expect(text).not.toMatch(/\b(lorem|ipsum)\b/i);
    const vocabulary = new Set([...TR_WORDS, ...TR_VERBS]);
    const sentences = generateLorem({ unit: 'sentences', count: 30, language: 'tr', seed: 5 });
    for (const w of sentences
      .toLocaleLowerCase('tr-TR')
      .split(/[ .,]+/)
      .filter(Boolean)) {
      expect(vocabulary.has(w), w).toBe(true);
    }
    for (const s of sentences.split(/(?<=\.) /)) {
      expect(TR_VERBS, s).toContain(s.slice(s.lastIndexOf(' ') + 1, -1));
    }
    // Cümle başı büyük harf Türkçe kurala göre (i → İ, ı → I).
    expect(generateLorem({ unit: 'sentences', count: 50, language: 'tr', seed: 9 })).not.toMatch(
      /(^|\. )[ıi]/,
    );
  });

  it('adet sınırları', () => {
    expect(() => generateLorem({ unit: 'words', count: 0 })).toThrow(ToolError);
    expect(() => generateLorem({ unit: 'paragraphs', count: 501 })).toThrow(/1–500/);
    expect(() => generateLorem({ unit: 'words', count: 1.5 })).toThrow(ToolError);
  });
});

describe('İngilizce iletiler', () => {
  beforeAll(() => registerCoreMessages('en', { toolsMisc: en }));
  beforeEach(() => setCoreLanguage('en'));
  afterEach(() => setCoreLanguage('tr'));

  it('hata iletisi İngilizce', () => {
    expect(() => generateLorem({ unit: 'words', count: 0 })).toThrow('Count must be between 1 and');
  });
});
