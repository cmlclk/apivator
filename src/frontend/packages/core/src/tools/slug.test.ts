import { describe, expect, it } from 'vitest';
import { slugify, slugifyLines, transliterate } from './slug';

describe('transliterate', () => {
  it('Türkçe ve Latin harfleri, büyük/küçük korunur', () => {
    expect(transliterate('Çağrı İŞIK Ötüken')).toBe('Cagri ISIK Otuken');
    expect(transliterate('Crème brûlée Straße Øre Łódź')).toBe('Creme brulee Strasse Ore Lodz');
    expect(transliterate('日本 ok')).toBe(' ok');
  });
});

describe('slugify', () => {
  it('Türkçe başlık', () => {
    expect(slugify('Çılgın Şehir & Ötesi!')).toBe('cilgin-sehir-otesi');
    expect(slugify('İSTANBUL’un IŞIKLARI')).toBe('istanbulun-isiklari');
    expect(slugify("Türkiye'nin 81 ili")).toBe('turkiyenin-81-ili');
  });

  it('ayırıcı, tekrarlar ve kenarlar', () => {
    expect(slugify('  --Merhaba   Dünya--  ', { separator: '_' })).toBe('merhaba_dunya');
    expect(slugify('a -- b __ c')).toBe('a-b-c');
    expect(slugify('Merhaba Dünya', { lowercase: false })).toBe('Merhaba-Dunya');
  });

  it('en fazla uzunluk kelime sınırında keser', () => {
    expect(slugify('bir iki üç dört beş', { maxLength: 12 })).toBe('bir-iki-uc');
    expect(slugify('bir iki üç', { maxLength: 10 })).toBe('bir-iki-uc');
    expect(slugify('çokuzunbirkelime', { maxLength: 5 })).toBe('cokuz');
    expect(slugify('a b', { maxLength: 0 })).toBe('a-b');
  });

  it('dolgu kelimeleri', () => {
    expect(slugify('Ali ve Veli için bir hikaye', { removeStopWords: true })).toBe('ali-veli-hikaye');
    expect(slugify('The Lord of the Rings', { removeStopWords: true, locale: 'en' })).toBe('lord-rings');
    // Hepsi dolguysa korunur.
    expect(slugify('ve ile', { removeStopWords: true })).toBe('ve-ile');
  });

  it('satır satır', () => {
    expect(slugifyLines('Birinci Başlık\n\nİkinci Başlık')).toBe('birinci-baslik\n\nikinci-baslik');
    expect(slugifyLines('Bir Başlık\r\nİki\r\n')).toBe('bir-baslik\r\niki\r\n');
  });
});
