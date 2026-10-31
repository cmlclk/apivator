import { afterEach, describe, expect, it } from 'vitest';
import { formatMessage } from './icu';
import {
  compareText,
  formatBytes,
  formatList,
  formatNumber,
  formatPercent,
  formatRelativeTime,
  initI18n,
  setLanguage,
  toLower,
  toUpper,
  translate,
  translateRich,
} from '.';
import { lookupMessage } from './messages';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

afterEach(async () => {
  await initI18n('tr');
});

describe('formatMessage (ICU alt kümesi)', () => {
  it('değişken, sayı ve kesme işareti', () => {
    expect(formatMessage("{name} workspace'e eklendi", 'tr-TR', { name: 'Ayşe' })).toBe(
      "Ayşe workspace'e eklendi",
    );
    expect(formatMessage('{n} istek', 'tr-TR', { n: 12345 })).toBe('12.345 istek');
    expect(formatMessage("'{'kaçış'}' ve ''", 'en-US')).toBe("{kaçış} ve '");
  });

  it('çoğul: dil kuralı, tam eşleşme ve #', () => {
    const m = '{count, plural, =0 {No items} one {# item} other {# items}}';
    expect(formatMessage(m, 'en-US', { count: 0 })).toBe('No items');
    expect(formatMessage(m, 'en-US', { count: 1 })).toBe('1 item');
    expect(formatMessage(m, 'en-US', { count: 1500 })).toBe('1,500 items');
    expect(formatMessage('{count, plural, other {# öğe}}', 'tr-TR', { count: 1500 })).toBe('1.500 öğe');
  });

  it('select ve iç içe yapı', () => {
    const m = '{role, select, admin {Yönetici ({n, plural, other {# kişi}})} other {Üye}}';
    expect(formatMessage(m, 'tr-TR', { role: 'admin', n: 3 })).toBe('Yönetici (3 kişi)');
    expect(formatMessage(m, 'tr-TR', { role: 'x' })).toBe('Üye');
    // Çoğul içindeki select'te de # sayıyı gösterir.
    const nested = '{n, plural, other {{g, select, a {# kişi} other {#}}}}';
    expect(formatMessage(nested, 'tr-TR', { n: 2, g: 'a' })).toBe('2 kişi');
  });

  it('hatalı metinde açıklayıcı hata', () => {
    expect(() => formatMessage('{n, plural, one {a}}', 'en-US', { n: 1 })).toThrow(/other/);
    expect(() => formatMessage('{a', 'en-US')).toThrow(/ayrıştırılamadı/);
  });
});

describe('dil değiştirme', () => {
  it('çeviri dili izler; html lang güncellenir', async () => {
    expect(translate('common', 'unexpectedError')).toBe('Beklenmeyen bir hata oluştu.');
    await setLanguage('en', { explicit: false });
    expect(translate('common', 'unexpectedError')).toBe('An unexpected error occurred.');
    expect(document.documentElement.lang).toBe('en');
  });

  it('eksik anahtar ad alanıyla birlikte döner', () => {
    expect(translate('common', 'yok' as never)).toBe('common:yok');
  });

  it('zengin metin: etiketler öğeye dönüşür, kullanıcı verisindeki < etiket sayılmaz', () => {
    const node = translateRich('auth', 'layout.headline', {
      br: () => createElement('br'),
      accent: (c) => createElement('em', null, c),
    });
    expect(renderToStaticMarkup(createElement('p', null, node))).toBe(
      '<p>API&#x27;lerinizi ekibinizle<br/><em>birlikte</em> test edin.</p>',
    );
  });
});

describe('biçimler', () => {
  it('etkin dile göre sayı, yüzde, bayt, liste ve göreli zaman', async () => {
    expect(formatNumber(1234.5)).toBe('1.234,5');
    expect(formatPercent(99.5)).toBe('%99,5');
    expect(formatBytes(1536)).toBe('1,5 KB');
    expect(formatList(['a', 'b', 'c'])).toBe('a, b ve c');
    expect(formatRelativeTime(Date.now() - 3 * 3600_000)).toBe('3 saat önce');
    await setLanguage('en', { explicit: false });
    expect(formatNumber(1234.5)).toBe('1,234.5');
    expect(formatPercent(99.5)).toBe('99.5%');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatList(['a', 'b', 'c'])).toBe('a, b, and c');
    expect(formatRelativeTime(Date.now() - 86_400_000)).toBe('yesterday');
  });

  it('büyük/küçük harf ve sıralama dil kuralına göre', async () => {
    expect(toUpper('istek')).toBe('İSTEK');
    expect(toLower('IŞIK')).toBe('ışık');
    expect(['şeker', 'zeytin', 'sabun'].sort(compareText)).toEqual(['sabun', 'şeker', 'zeytin']);
    await setLanguage('en', { explicit: false });
    expect(toUpper('istek')).toBe('ISTEK');
  });
});

describe('eksik metin için yedek diller', () => {
  const store = new Map([
    ['de:common', new Map([['a', 'Deutsch A']])],
    [
      'en:common',
      new Map([
        ['a', 'English A'],
        ['b', 'English B'],
      ]),
    ],
    [
      'tr:common',
      new Map([
        ['a', 'Türkçe A'],
        ['b', 'Türkçe B'],
        ['c', 'Türkçe C'],
      ]),
    ],
  ]);

  it('etkin dil → İngilizce → Türkçe', () => {
    expect(lookupMessage(store, 'de', 'common', 'a')).toBe('Deutsch A');
    expect(lookupMessage(store, 'de', 'common', 'b')).toBe('English B');
    expect(lookupMessage(store, 'de', 'common', 'c')).toBe('Türkçe C');
    expect(lookupMessage(store, 'en', 'common', 'c')).toBe('Türkçe C');
    expect(lookupMessage(store, 'de', 'common', 'yok')).toBeUndefined();
  });
});
