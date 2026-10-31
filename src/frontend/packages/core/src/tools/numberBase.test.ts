import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import en from '../locales/en/toolsMisc.json';
import { registerCoreMessages, setCoreLanguage } from '../i18n';
import { ToolError } from './errors';
import {
  convertNumberBase,
  formatInteger,
  fromTwosComplement,
  parseInteger,
  toTwosComplement,
} from './numberBase';

const U64_MAX = 2n ** 64n - 1n;

describe('parseInteger', () => {
  it('seçili tabanda okur; büyük/küçük harf duyarsız', () => {
    expect(parseInteger('ff', 16)).toEqual({ value: 255n, base: 16 });
    expect(parseInteger('FF', 16).value).toBe(255n);
    expect(parseInteger('777', 8).value).toBe(511n);
    expect(parseInteger('1010', 2).value).toBe(10n);
    expect(parseInteger('zz', 36).value).toBe(1295n);
    expect(parseInteger('0', 10).value).toBe(0n);
  });

  it('önekler: seçili tabanla aynıysa ya da harf o tabanda hane değilse', () => {
    expect(parseInteger('0x1F', 10)).toEqual({ value: 31n, base: 16 });
    expect(parseInteger('0b101', 10)).toEqual({ value: 5n, base: 2 });
    expect(parseInteger('0o17', 10)).toEqual({ value: 15n, base: 8 });
    expect(parseInteger('0xff', 16)).toEqual({ value: 255n, base: 16 });
    expect(parseInteger('0x1F', 2)).toEqual({ value: 31n, base: 16 });
    // 16'lık tabanda b bir hanedir: 0b1 = 0xb1.
    expect(parseInteger('0b1', 16)).toEqual({ value: 0xb1n, base: 16 });
  });

  it('işaret, `_` ve boşluk ayraçları', () => {
    expect(parseInteger('-42').value).toBe(-42n);
    expect(parseInteger('+42').value).toBe(42n);
    expect(parseInteger('-0x80', 10).value).toBe(-128n);
    expect(parseInteger('1_000_000').value).toBe(1000000n);
    expect(parseInteger('ff ff', 16).value).toBe(65535n);
    expect(parseInteger('  1010 0101 ', 2).value).toBe(165n);
  });

  it('onlu tabanda binlik ayraç (Türkçe ve İngilizce)', () => {
    expect(parseInteger('1.000.000').value).toBe(1000000n);
    expect(parseInteger('1,234,567').value).toBe(1234567n);
    expect(parseInteger('-12.345').value).toBe(-12345n);
  });

  it('keyfi büyüklük: 2^64-1 ve 2^200', () => {
    expect(parseInteger('18446744073709551615').value).toBe(U64_MAX);
    expect(parseInteger('ffffffffffffffff', 16).value).toBe(U64_MAX);
    expect(parseInteger('1' + '0'.repeat(200), 2).value).toBe(2n ** 200n);
  });

  it('geçersiz hane konumlu ToolError', () => {
    expect(() => parseInteger('12a4', 10)).toThrow(/geçersiz hane: "a" \(konum 3\)/);
    expect(() => parseInteger('102', 2)).toThrow(/konum 3/);
    expect(() => parseInteger('0x1g', 10)).toThrow(/16 tabanında geçersiz hane: "g" \(konum 4\)/);
    expect(() => parseInteger('', 10)).toThrow('Sayı girilmedi.');
    expect(() => parseInteger('-', 10)).toThrow('Sayı hanesi yok.');
    expect(() => parseInteger('0x', 10)).toThrow(ToolError);
  });

  it('kesirler desteklenmez; geçersiz taban', () => {
    expect(() => parseInteger('1.5')).toThrow(/Ondalık kesirler desteklenmez.*konum 2/);
    expect(() => parseInteger('1,23,4')).toThrow(ToolError);
    expect(() => parseInteger('1', 37)).toThrow(/Geçersiz taban/);
    expect(() => parseInteger('1', 1)).toThrow(/Geçersiz taban/);
  });

  it('çok uzun girdi reddedilir', () => {
    expect(() => parseInteger('1'.repeat(10_001))).toThrow(/çok uzun/);
  });
});

describe('formatInteger', () => {
  it('gruplama, büyük harf, doldurma, negatif', () => {
    expect(formatInteger(255n, 16, { upper: true })).toBe('FF');
    expect(formatInteger(0xabcdefn, 16, { group: 2 })).toBe('ab cd ef');
    expect(formatInteger(0xabcden, 16, { group: 2 })).toBe('a bc de');
    expect(formatInteger(5n, 2, { minDigits: 8, group: 4 })).toBe('0000 0101');
    expect(formatInteger(1234567n, 10, { group: 3, separator: '.' })).toBe('1.234.567');
    expect(formatInteger(-1234n, 10, { group: 3, separator: ',' })).toBe('-1,234');
    expect(formatInteger(0n, 2)).toBe('0');
  });
});

describe('ikiye tümleyen', () => {
  it('negatif değerlerin bit deseni ve geri dönüşü', () => {
    expect(toTwosComplement(-1n, 8)).toBe(0xffn);
    expect(toTwosComplement(-128n, 8)).toBe(0x80n);
    expect(toTwosComplement(255n, 8)).toBe(0xffn);
    expect(toTwosComplement(-1n, 64)).toBe(U64_MAX);
    expect(toTwosComplement(-1n, 128)).toBe(2n ** 128n - 1n);
    expect(fromTwosComplement(0xffn, 8, true)).toBe(-1n);
    expect(fromTwosComplement(0xffn, 8, false)).toBe(255n);
    expect(fromTwosComplement(0x8000n, 16, true)).toBe(-32768n);
  });

  it('sığmayan değer ToolError', () => {
    expect(() => toTwosComplement(256n, 8)).toThrow(/8 bit genişliğine sığmaz/);
    expect(() => toTwosComplement(-129n, 8)).toThrow(ToolError);
    expect(() => toTwosComplement(2n ** 64n, 64)).toThrow(ToolError);
  });
});

describe('convertNumberBase', () => {
  it('tüm tabanlar bir arada', () => {
    const r = convertNumberBase('255', { base: 10 });
    expect(r).toMatchObject({
      binary: '11111111',
      octal: '377',
      decimal: '255',
      hex: 'FF',
      bitLength: 8,
      viewWidth: 8,
    });
    expect(r.pattern).toBeNull();
    expect(convertNumberBase('zz', { base: 36, customBase: 36 }).custom).toBe('ZZ');
  });

  it('2^64-1 ve sıfır', () => {
    const max = convertNumberBase('0xffffffffffffffff', { base: 10 });
    expect(max.decimal).toBe('18446744073709551615');
    expect(max.bitLength).toBe(64);
    expect(max.viewWidth).toBe(64);
    const zero = convertNumberBase('0', { base: 2 });
    expect(zero).toMatchObject({ binary: '0', hex: '0', decimal: '0', bitLength: 0, viewWidth: 8 });
  });

  it('genişliksiz negatif: işaretli gösterim, bit görünümü yok', () => {
    const r = convertNumberBase('-255', { base: 10 });
    expect(r).toMatchObject({ hex: '-FF', binary: '-11111111', viewWidth: null });
  });

  it('sabit genişlik: işaretli/işaretsiz yorum ve dolgu', () => {
    const signed = convertNumberBase('-1', { base: 10, width: 8, signed: true });
    expect(signed).toMatchObject({
      value: -1n,
      pattern: 255n,
      binary: '11111111',
      hex: 'FF',
      decimal: '-1',
      octal: '377',
    });
    const unsigned = convertNumberBase('-1', { base: 10, width: 8, signed: false });
    expect(unsigned.decimal).toBe('255');
    expect(convertNumberBase('FF', { base: 16, width: 8 }).decimal).toBe('-1');
    expect(convertNumberBase('5', { base: 10, width: 16 }).hex).toBe('0005');
    expect(convertNumberBase('-2', { base: 10, width: 32 }).hex).toBe('FFFFFFFE');
    expect(convertNumberBase('-1', { base: 10, width: 64 }).decimal).toBe('-1');
    expect(convertNumberBase('-1', { base: 10, width: 64, signed: false }).decimal).toBe(
      '18446744073709551615',
    );
  });

  it('gruplama ve Türkçe binlik ayraç', () => {
    const r = convertNumberBase('3735928559', { base: 10, group: true, thousands: '.' });
    expect(r.hex).toBe('DE AD BE EF');
    expect(r.binary).toBe('1101 1110 1010 1101 1011 1110 1110 1111');
    expect(r.decimal).toBe('3.735.928.559');
    expect(convertNumberBase('1', { base: 10, width: 16, group: true }).binary).toBe('0000 0000 0000 0001');
    expect(convertNumberBase('255', { base: 10, upper: false }).hex).toBe('ff');
  });

  it('sığmayan değer genişlikle ToolError', () => {
    expect(() => convertNumberBase('300', { base: 10, width: 8 })).toThrow(ToolError);
  });

  it('gidiş-dönüş: her tabanda yazılan değer aynı sayıya çözülür', () => {
    for (const value of [0n, 1n, 255n, U64_MAX, -12345678901234567890n]) {
      for (const base of [2, 8, 10, 16, 36]) {
        expect(parseInteger(formatInteger(value, base), base).value).toBe(value);
      }
    }
  });

  it('binlik gruplu onlu girdi de hane sınırına tabi', () => {
    expect(() => parseInteger('1' + ',000'.repeat(4000), 10)).toThrow(/çok uzun/);
  });
});

describe('İngilizce iletiler', () => {
  beforeAll(() => registerCoreMessages('en', { toolsMisc: en }));
  beforeEach(() => setCoreLanguage('en'));
  afterEach(() => setCoreLanguage('tr'));

  it('hata iletileri İngilizce', () => {
    expect(() => parseInteger('12', 2)).toThrow('Invalid digit in base 2: "2" (position 2).');
    expect(() => parseInteger('', 10)).toThrow('No number entered.');
    expect(() => parseInteger('1.5', 10)).toThrow('Decimal fractions are not supported');
  });
});
