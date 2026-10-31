import { describe, expect, it } from 'vitest';
import { bytesToHex } from './codecs';
import { ToolError } from './errors';
import {
  binaryToBytes,
  bytesToBinary,
  charBreakdown,
  charName,
  decodeBytes,
  encodeText,
  findSuspiciousChars,
  formatCodePoint,
  hexdump,
  hexdumpToBytes,
  isSuspiciousChar,
} from './byteView';

const hex = (text: string, encoding: Parameters<typeof encodeText>[1]) =>
  bytesToHex(encodeText(text, encoding).bytes, { separator: 'space' });

describe('encodeText / decodeBytes', () => {
  it('UTF-8, UTF-16LE/BE ve Latin-1', () => {
    expect(hex('ç😀', 'utf-8')).toBe('c3 a7 f0 9f 98 80');
    expect(hex('ç😀', 'utf-16le')).toBe('e7 00 3d d8 00 de');
    expect(hex('ç😀', 'utf-16be')).toBe('00 e7 d8 3d de 00');
    expect(encodeText('çğ', 'latin1')).toEqual({ bytes: new Uint8Array([0xe7, 0x3f]), unmappable: 1 });
  });

  it('gidiş-dönüş', () => {
    for (const encoding of ['utf-8', 'utf-16le', 'utf-16be'] as const) {
      expect(decodeBytes(encodeText('Çağrı 🚀', encoding).bytes, encoding)).toBe('Çağrı 🚀');
    }
    expect(decodeBytes(new Uint8Array([0xe7, 0xfe]), 'latin1')).toBe('çþ');
  });

  it('bozuk UTF-16: U+FFFD ya da fatal ile hata', () => {
    expect(decodeBytes(new Uint8Array([0x41, 0x00, 0x42]), 'utf-16le')).toBe('A�');
    expect(decodeBytes(new Uint8Array([0x00, 0xd8, 0x41, 0x00]), 'utf-16le')).toBe('�A');
    expect(() => decodeBytes(new Uint8Array([0x41]), 'utf-16le', true)).toThrow(ToolError);
    expect(() => decodeBytes(new Uint8Array([0x00, 0xd8]), 'utf-16le', true)).toThrow(/vekil/);
  });
});

describe('ikili', () => {
  it('8 bitlik gruplar; ayraç ve 0b öneki kabul edilir', () => {
    expect(bytesToBinary(new Uint8Array([0x48, 0x69]))).toBe('01001000 01101001');
    expect(bytesToBinary(new Uint8Array(9)).split('\n')).toHaveLength(2);
    expect(binaryToBytes('0b01001000, 0110_1001\n')).toEqual(new Uint8Array([0x48, 0x69]));
    expect(() => binaryToBytes('0102')).toThrow(/Geçersiz ikili karakter: "2"/);
    expect(() => binaryToBytes('0101')).toThrow(/8'in katı/);
  });
});

describe('hexdump', () => {
  it('ofset, hex ve ASCII sütunu', () => {
    const bytes = encodeText('Merhaba dünya!\n12345', 'utf-8').bytes;
    expect(hexdump(bytes).split('\n')).toEqual([
      '00000000  4d 65 72 68 61 62 61 20  64 c3 bc 6e 79 61 21 0a  |Merhaba d..nya!.|',
      '00000010  31 32 33 34 35                                    |12345|',
    ]);
    expect(hexdump(new Uint8Array())).toBe('');
  });

  it('hexdump çıktısını geri okur (ASCII sütununda | olsa da)', () => {
    const bytes = encodeText('a|b 12345678 | ç\r\n'.repeat(3), 'utf-8').bytes;
    expect(hexdumpToBytes(hexdump(bytes))).toEqual(bytes);
    expect(hexdumpToBytes('0010: 48 69')).toEqual(new Uint8Array([0x48, 0x69]));
    expect(() => hexdumpToBytes('00000000  4g')).toThrow(ToolError);
  });
});

describe('karakter dökümü', () => {
  it('kod noktası, baytlar, ofset ve görünmez karakter adları', () => {
    const rows = charBreakdown('a ﻿ç', 'utf-8');
    expect(rows.map((r) => [formatCodePoint(r.codePoint), r.bytes, r.offset, r.suspicious])).toEqual([
      ['U+0061', '61', 0, false],
      ['U+00A0', 'C2 A0', 1, true],
      ['U+FEFF', 'EF BB BF', 3, true],
      ['U+00E7', 'C3 A7', 6, false],
    ]);
    expect(rows[1]!.name).toMatch(/NBSP/);
    expect(charBreakdown('abc', 'utf-8', 2)).toHaveLength(2);
  });

  it('adlar ve şüpheli karakterler', () => {
    expect(charName(0x0a)).toBe('LF');
    expect(charName(0x0d)).toBe('CR');
    expect(charName(0x200b)).toMatch(/ZWSP/);
    expect(charName(0x41)).toBeUndefined();
    expect(isSuspiciousChar(0x0a)).toBe(false);
    expect(isSuspiciousChar(0x0d)).toBe(true);
    expect(isSuspiciousChar(0x200b)).toBe(true);
  });

  it('tüm metinde şüpheli karakterleri sayar ve ilk konumunu verir', () => {
    expect(findSuspiciousChars('﻿a\nb​c​')).toEqual([
      { codePoint: 0x200b, name: charName(0x200b), count: 2, line: 2, column: 2 },
      { codePoint: 0xfeff, name: charName(0xfeff), count: 1, line: 1, column: 1 },
    ]);
  });
});
