import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import en from '../locales/en/toolsMisc.json';
import { registerCoreMessages, setCoreLanguage } from '../i18n';
import { ToolError } from './errors';
import { randomDateList, randomDecimalList, randomIntegerList } from './randomValues';
import { formatDate } from './time';

describe('randomIntegerList', () => {
  it('uçlar dahil aralıkta kalır, iki uç da görülür', () => {
    const values = randomIntegerList(-3, 3, { count: 2000 });
    expect(values.every((v) => Number.isInteger(v) && v >= -3 && v <= 3)).toBe(true);
    expect(new Set(values).size).toBe(7);
  });

  it('kaba yansızlık: 3 değerin her biri yaklaşık 1/3', () => {
    const values = randomIntegerList(1, 3, { count: 9000 });
    for (const v of [1, 2, 3]) {
      const n = values.filter((x) => x === v).length;
      expect(n).toBeGreaterThan(2700);
      expect(n).toBeLessThan(3300);
    }
  });

  it('2^53 sınırına yakın değerler güvenle çalışır', () => {
    const max = Number.MAX_SAFE_INTEGER;
    const values = randomIntegerList(-max, max, { count: 200 });
    expect(values.every((v) => Number.isSafeInteger(v))).toBe(true);
    expect(randomIntegerList(max, max, { count: 3 })).toEqual([max, max, max]);
    expect(() => randomIntegerList(0, 2 ** 53, { count: 1 })).toThrow(ToolError);
  });

  it('tekrarsız: küçük ve büyük aralıkta, sıralı', () => {
    const all = randomIntegerList(1, 10, { count: 10, unique: true, sort: 'asc' });
    expect(all).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const big = randomIntegerList(0, 1e12, { count: 1000, unique: true, sort: 'desc' });
    expect(new Set(big).size).toBe(1000);
    expect([...big].sort((a, b) => b - a)).toEqual(big);
  });

  it('aralık tekrarsız değer için yetmezse hata', () => {
    expect(() => randomIntegerList(1, 5, { count: 6, unique: true })).toThrow(/yalnızca 5 farklı/);
    expect(() => randomIntegerList(5, 1, { count: 1 })).toThrow(ToolError);
    expect(() => randomIntegerList(1, 5, { count: 10001 })).toThrow(ToolError);
  });
});

describe('randomDecimalList', () => {
  it('sabit basamak, aralık içinde', () => {
    const values = randomDecimalList(-1.5, 2.25, 2, { count: 500 });
    for (const v of values) {
      expect(v).toMatch(/^-?\d+\.\d{2}$/);
      expect(Number(v)).toBeGreaterThanOrEqual(-1.5);
      expect(Number(v)).toBeLessThanOrEqual(2.25);
    }
    expect(randomDecimalList(0.1, 0.1, 3, { count: 1 })).toEqual(['0.100']);
    expect(randomDecimalList(-0.05, -0.05, 2, { count: 1 })).toEqual(['-0.05']);
    expect(randomDecimalList(3, 3, 0, { count: 1 })).toEqual(['3']);
  });

  it('tekrarsız ondalıklar ve hatalar', () => {
    expect(randomDecimalList(0, 0.3, 1, { count: 4, unique: true, sort: 'asc' })).toEqual([
      '0.0',
      '0.1',
      '0.2',
      '0.3',
    ]);
    expect(() => randomDecimalList(0.11, 0.19, 1, { count: 1 })).toThrow(/gösterilebilen/);
    expect(() => randomDecimalList(0, 1, 11, { count: 1 })).toThrow(ToolError);
    expect(() => randomDecimalList(0, 1e10, 10, { count: 1 })).toThrow(/çok büyük/);
  });
});

describe('randomDateList', () => {
  const from = new Date('2026-01-01T00:00:00Z');
  const to = new Date('2026-12-31T23:59:59Z');

  it('ISO çıktısı aralıkta ve saniye adımlı', () => {
    const values = randomDateList(from, to, { count: 300, sort: 'asc' });
    for (const v of values) expect(v).toMatch(/^2026-\d\d-\d\dT\d\d:\d\d:\d\d\.000Z$/);
    expect([...values].sort()).toEqual(values);
  });

  it('gün adımı, saat dilimi ve biçimler', () => {
    const days = randomDateList(from, new Date('2026-01-10T00:00:00Z'), {
      count: 10,
      unique: true,
      step: 'day',
      format: 'date',
      timeZone: 'Europe/Istanbul',
      sort: 'asc',
    });
    expect(days).toEqual(Array.from({ length: 10 }, (_, i) => `2026-01-${String(i + 1).padStart(2, '0')}`));
    const one = (format: Parameters<typeof randomDateList>[2]['format']) =>
      randomDateList(from, from, { count: 1, format, timeZone: 'Europe/Istanbul' })[0];
    expect(one('zoned')).toBe('2026-01-01T03:00:00+03:00');
    expect(one('time')).toBe('03:00:00');
    expect(one('unix')).toBe('1767225600');
    expect(one('unix-ms')).toBe('1767225600000');
    expect(one('rfc1123')).toBe('Thu, 01 Jan 2026 00:00:00 GMT');
  });

  it('ofsetli çıktı formatDate ile aynı (yaz saati, çeyrek saat ofseti)', () => {
    for (const timeZone of ['America/New_York', 'Asia/Kathmandu', 'UTC']) {
      for (const iso of ['2026-03-08T07:30:00.250Z', '2026-07-01T12:00:00Z', '2026-11-01T05:59:59Z']) {
        const at = new Date(iso);
        const [value] = randomDateList(at, at, { count: 1, step: 'ms', format: 'zoned', timeZone });
        expect(value).toBe(formatDate(at, timeZone).isoZoned);
      }
    }
  });

  it('hatalar', () => {
    expect(() => randomDateList(to, from, { count: 1 })).toThrow(/sonra/);
    expect(() => randomDateList(new Date('x'), to, { count: 1 })).toThrow(ToolError);
    expect(() => randomDateList(from, from, { count: 2, unique: true })).toThrow(ToolError);
    expect(() => randomDateList(from, to, { count: 1, format: 'zoned', timeZone: 'Yok/Bura' })).toThrow(
      /saat dilimi/,
    );
  });

  it('10000 ofsetli tarih makul sürede', () => {
    const t = performance.now();
    randomDateList(from, to, { count: 10000, format: 'zoned', timeZone: 'Europe/Istanbul' });
    expect(performance.now() - t).toBeLessThan(5000);
  });
});

describe('İngilizce iletiler', () => {
  beforeAll(() => registerCoreMessages('en', { toolsMisc: en }));
  beforeEach(() => setCoreLanguage('en'));
  afterEach(() => setCoreLanguage('tr'));

  it('hata iletileri İngilizce', () => {
    expect(() => randomIntegerList(5, 1, { count: 1 })).toThrow(
      'The minimum cannot be greater than the maximum.',
    );
    expect(() => randomIntegerList(1, 5, { count: 0 })).toThrow('Count must be between 1 and');
    expect(() => randomDateList(new Date(2), new Date(1), { count: 1 })).toThrow(
      'The start date cannot be after the end date.',
    );
  });
});
