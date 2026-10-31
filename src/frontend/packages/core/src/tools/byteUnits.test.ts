import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import en from '../locales/en/toolsMisc.json';
import { registerCoreMessages, setCoreLanguage } from '../i18n';
import { ToolError } from './errors';
import {
  BYTE_UNITS,
  bytesQuantity,
  convertByteSize,
  formatByteSize,
  formatRatio,
  parseBandwidth,
  parseByteSize,
  parseByteUnit,
  transferTime,
  type ByteUnit,
} from './byteUnits';

const unitOf = (symbol: string): ByteUnit => BYTE_UNITS.find((u) => u.symbol === symbol)!;
/** Bayt cinsinden metin. */
const inBytes = (text: string, precision = 4) =>
  convertByteSize(parseByteSize(text).quantity, unitOf('B'), { precision });

describe('BYTE_UNITS', () => {
  it('SI 1000, IEC 1024 tabanlı; bit ve bayt', () => {
    expect(BYTE_UNITS).toHaveLength(34);
    expect(unitOf('kB').bits).toBe(8000n);
    expect(unitOf('KiB').bits).toBe(8192n);
    expect(unitOf('EiB').bits).toBe(8n * 1024n ** 6n);
    expect(unitOf('YB').bits).toBe(8n * 10n ** 24n);
    expect(unitOf('Mbit').bits).toBe(1000000n);
    expect(unitOf('Kibit').bits).toBe(1024n);
  });
});

describe('parseByteUnit', () => {
  it('b bit, B bayt; önek ve IEC', () => {
    expect(parseByteUnit('Kb').symbol).toBe('kbit');
    expect(parseByteUnit('Gb').symbol).toBe('Gbit');
    expect(parseByteUnit('b').symbol).toBe('bit');
    expect(parseByteUnit('kbit').symbol).toBe('kbit');
    expect(parseByteUnit('KB').symbol).toBe('kB');
    expect(parseByteUnit('kB').symbol).toBe('kB');
    expect(parseByteUnit('KiB').symbol).toBe('KiB');
    expect(parseByteUnit('Mib').symbol).toBe('Mibit');
    expect(parseByteUnit('GB').symbol).toBe('GB');
    expect(parseByteUnit('bits').symbol).toBe('bit');
    expect(parseByteUnit('').symbol).toBe('B');
  });

  it('tamamı küçük harf (kb, mb, gb) gündelik bayt yazımıdır', () => {
    expect(parseByteUnit('kb').symbol).toBe('kB');
    expect(parseByteUnit('gb').symbol).toBe('GB');
    expect(parseByteUnit('mib').symbol).toBe('MiB');
    // "KB/MB/GB = 1024" seçiliyken küçük harfli yazım da 1024 tabanlıdır: 1 gb = 1 GiB.
    expect(parseByteUnit('gb', { legacyBinary: true }).symbol).toBe('GiB');
    expect(parseByteSize('1 gb', { legacyBinary: true }).quantity).toEqual({
      num: 8n * 1024n ** 3n,
      den: 1n,
    });
  });

  it('uzun adlar (Türkçe ve İngilizce)', () => {
    expect(parseByteUnit('megabayt').symbol).toBe('MB');
    expect(parseByteUnit('Gigabytes').symbol).toBe('GB');
    expect(parseByteUnit('kibibyte').symbol).toBe('KiB');
    expect(parseByteUnit('megabit').symbol).toBe('Mbit');
    expect(parseByteUnit('bayt').symbol).toBe('B');
  });

  it('eski ikili alışkanlık: KB/MB/GB 1024', () => {
    expect(parseByteUnit('MB', { legacyBinary: true }).symbol).toBe('MiB');
    expect(parseByteUnit('kB', { legacyBinary: true }).symbol).toBe('kB');
    expect(parseByteUnit('Mb', { legacyBinary: true }).symbol).toBe('Mbit');
  });

  it('bilinmeyen birim', () => {
    expect(() => parseByteUnit('XB')).toThrow(/Bilinmeyen birim/);
    expect(() => parseByteUnit('iB')).toThrow(ToolError);
  });
});

describe('parseByteSize', () => {
  it('Türkçe ve İngilizce ondalık', () => {
    expect(inBytes('1.5 GB')).toBe('1500000000');
    expect(inBytes('1,5 GB')).toBe('1500000000');
    expect(inBytes('1536 KiB')).toBe('1572864');
    expect(inBytes('1,5GiB')).toBe('1610612736');
    expect(inBytes('1.234,5 KB')).toBe('1234500');
    expect(inBytes('1,234.5 KB')).toBe('1234500');
    expect(inBytes('1.000.000 B')).toBe('1000000');
    expect(inBytes('1 536 KiB')).toBe('1572864');
    expect(inBytes(',5 kB')).toBe('500');
  });

  it('tek ayraç + üç rakam: etkin dilin binlik ayracıysa binlik (Türkçede nokta)', () => {
    expect(inBytes('1.000 GB')).toBe('1000000000000');
    expect(inBytes('12.500 B')).toBe('12500');
    expect(inBytes('1,000 GB')).toBe('1000000000');
    expect(inBytes('1.50 GB')).toBe('1500000000');
    expect(inBytes('1.0000 GB')).toBe('1000000000');
    expect(inBytes('1234.567 B')).toBe('1234.567');
  });

  it('birimsiz sayı bayttır; bitler', () => {
    expect(inBytes('2048')).toBe('2048');
    expect(inBytes('8 bit')).toBe('1');
    expect(inBytes('1 b')).toBe('0.125');
    expect(inBytes('100 Mbit')).toBe('12500000');
  });

  it('EB/EiB ve ötesi kesin', () => {
    expect(inBytes('1 EiB')).toBe('1152921504606846976');
    expect(inBytes('16 EiB')).toBe((2n ** 64n).toString());
    expect(inBytes('1 YB')).toBe('1' + '0'.repeat(24));
    expect(inBytes('1.000000000000000001 EB')).toBe('1000000000000000001');
  });

  it('hatalar', () => {
    expect(() => parseByteSize('')).toThrow('Boyut girilmedi.');
    expect(() => parseByteSize('-1 GB')).toThrow(/negatif/);
    expect(() => parseByteSize('GB')).toThrow(/tanınmadı/);
    expect(() => parseByteSize('1e3 B')).toThrow(ToolError);
    expect(() => parseByteSize('1.5.6 B')).toThrow(/Geçersiz sayı/);
    expect(() => parseByteSize('12 parsec')).toThrow(/Bilinmeyen birim/);
  });
});

describe('dönüşüm ve biçim', () => {
  it('her birime kesin dönüşüm', () => {
    const q = parseByteSize('1 GiB').quantity;
    expect(convertByteSize(q, unitOf('MiB'))).toBe('1024');
    expect(convertByteSize(q, unitOf('MB'))).toBe('1073.7418');
    expect(convertByteSize(q, unitOf('GB'), { precision: 9 })).toBe('1.073741824');
    expect(convertByteSize(q, unitOf('Gibit'))).toBe('8');
    expect(convertByteSize(q, unitOf('MB'), { decimalSeparator: ',' })).toBe('1073,7418');
  });

  it('küçük değerlerde anlamlı hane korunur', () => {
    const q = parseByteSize('1 B').quantity;
    expect(convertByteSize(q, unitOf('GB'))).toBe('0.000000001');
    expect(convertByteSize(q, unitOf('TB'), { precision: 2 })).toBe('0.000000000001');
    expect(convertByteSize(parseByteSize('0 B').quantity, unitOf('GB'))).toBe('0');
  });

  it('formatRatio yarım yukarı yuvarlar', () => {
    expect(formatRatio(1n, 3n, { precision: 2 })).toBe('0.33');
    expect(formatRatio(2n, 3n, { precision: 2 })).toBe('0.67');
    expect(formatRatio(5n, 2n, { precision: 0 })).toBe('3');
    expect(formatRatio(3n, 2n, { precision: 2, trim: false })).toBe('1.50');
  });

  it('okunur biçim: SI ve IEC', () => {
    expect(formatByteSize(1536)).toBe('1.5 KiB');
    expect(formatByteSize(1536, { standard: 'si' })).toBe('1.54 kB');
    expect(formatByteSize(999)).toBe('999 B');
    expect(formatByteSize(0)).toBe('0 B');
    expect(formatByteSize(2n ** 64n - 1n)).toBe('16 EiB');
    expect(formatByteSize(1610612736, { decimalSeparator: ',' })).toBe('1,5 GiB');
    expect(formatByteSize(12_500_000, { bits: true, standard: 'si' })).toBe('100 Mbit');
    expect(formatByteSize(parseByteSize('3 YB').quantity, { standard: 'si' })).toBe('3 YB');
    expect(formatByteSize(bytesQuantity(1.5))).toBe('1.5 B');
  });
});

describe('aktarım süresi', () => {
  it('bant genişliği yazımları', () => {
    expect(parseBandwidth('100 Mbps')).toEqual({ num: 100_000_000n, den: 1n });
    expect(parseBandwidth('100 Mbit/s')).toEqual({ num: 100_000_000n, den: 1n });
    expect(parseBandwidth('12,5 MB/s')).toEqual({ num: 1_000_000_000n, den: 10n });
    expect(parseBandwidth('1 Gbps').num).toBe(1_000_000_000n);
    expect(parseBandwidth('50')).toEqual({ num: 50_000_000n, den: 1n });
    // Küçük harfli bps bittir; MBps bayttır.
    expect(parseBandwidth('100 mbps').num).toBe(100_000_000n);
    expect(parseBandwidth('100 MBps').num).toBe(800_000_000n);
    expect(() => parseBandwidth('0 Mbps')).toThrow(/sıfır/);
    expect(() => parseBandwidth('')).toThrow(ToolError);
  });

  it('süre hesabı ve Türkçe metin', () => {
    const gb = parseByteSize('1 GB').quantity;
    expect(transferTime(gb, parseBandwidth('100 Mbps'))).toEqual({ seconds: 80, text: '1 dk 20 sn' });
    expect(transferTime(parseByteSize('1 TB').quantity, parseBandwidth('10 Mbps')).text).toBe(
      '9 gün 6 sa 13 dk 20 sn',
    );
    expect(transferTime(parseByteSize('1 kB').quantity, parseBandwidth('1 Gbps')).text).toBe('0 sn');
    expect(transferTime(parseByteSize('1 MB').quantity, parseBandwidth('100 Mbps')).text).toBe('0,08 sn');
    expect(transferTime(parseByteSize('15 MB').quantity, parseBandwidth('8 Mbps')).text).toBe('15 sn');
  });

  it('çok uzun sayı ToolError (BigInt donması yok)', () => {
    expect(() => parseByteSize('1'.repeat(101) + ' GB')).toThrow(/çok uzun/);
  });
});

describe('İngilizce iletiler', () => {
  beforeAll(() => registerCoreMessages('en', { toolsMisc: en }));
  beforeEach(() => setCoreLanguage('en'));
  afterEach(() => setCoreLanguage('tr'));

  it('süre metni ve hatalar İngilizce', () => {
    const gb = parseByteSize('1 GB').quantity;
    expect(transferTime(gb, parseBandwidth('100 Mbps')).text).toBe('1 m 20 s');
    expect(() => parseByteSize('')).toThrow('No size entered.');
    expect(() => parseByteSize('-1 GB')).toThrow('Size cannot be negative.');
  });

  it('İngilizcede virgül binlik, nokta ondalık', () => {
    expect(inBytes('1,000 GB')).toBe('1000000000000');
    expect(inBytes('1.000 GB')).toBe('1000000000');
    expect(inBytes('1,5 GB')).toBe('1500000000');
  });
});
