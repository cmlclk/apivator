import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, bytesToHex, hexToBytes, unicodeEscape, unicodeUnescape } from './codecs';
import { utf8Decode, utf8Encode } from './encoding';
import { ToolError } from './errors';
import { htmlDecode, htmlEncode, htmlEntityTable } from './htmlEntities';

const text = (value: Uint8Array) => new TextDecoder().decode(value);

describe('HTML varlıkları', () => {
  it('varsayılan olarak yalnızca & < > " \' kodlanır', () => {
    expect(htmlEncode(`<a href="x">Tom & Jerry's</a> çğ`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt; çğ',
    );
  });

  it('ASCII dışı karakterler sayısal ya da adla kodlanır', () => {
    expect(htmlEncode('çğ€😀', { nonAscii: true })).toBe('&#xE7;&#x11F;&#x20AC;&#x1F600;');
    expect(htmlEncode('çğ€😀 ı', { nonAscii: true, named: true })).toBe(
      '&ccedil;&gbreve;&euro;&#x1F600; &imath;',
    );
  });

  it('sayısal ve adlandırılmış varlıkları çözer', () => {
    expect(htmlDecode('&lt;b&gt; &amp;amp; &#231;&#x11F;&#X1F600; &ccedil;&Scedil;&nbsp;&hellip;')).toBe(
      '<b> &amp; çğ😀 çŞ …',
    );
  });

  it('bilinmeyen ad ve noktalı virgülsüz dizi olduğu gibi kalır', () => {
    expect(htmlDecode('&bilinmeyen; &amp &copy')).toBe('&bilinmeyen; &amp &copy');
  });

  it('geçersiz sayısal referans U+FFFD olur', () => {
    expect(htmlDecode('&#0;&#xD800;&#x110000;&#99999999999;')).toBe('�'.repeat(4));
  });

  it('tablo Latin-1 ve Türkçe harfleri kapsar; gidiş-dönüş korunur', () => {
    const table = htmlEntityTable();
    expect(table.get('nbsp')).toBe(0xa0);
    expect(table.get('yuml')).toBe(0xff);
    expect(table.get('Omega')).toBe(0x3a9);
    expect(table.get('omega')).toBe(0x3c9);
    expect(table.size).toBeGreaterThan(250);
    const plain = 'Çağrı Öztürk — İzmir ışığı 🚀 <&>"\'';
    expect(htmlDecode(htmlEncode(plain, { nonAscii: true, named: true }))).toBe(plain);
    expect(htmlDecode(htmlEncode(plain))).toBe(plain);
  });
});

describe('Unicode kaçış', () => {
  it('ASCII dışını \\uXXXX yazar; BMP dışı vekil çiftiyle', () => {
    expect(unicodeEscape('aç😀')).toBe('a\\u00e7\\ud83d\\ude00');
    expect(unicodeEscape('aç', { all: true, upper: true })).toBe('\\u0061\\u00E7');
  });

  it('kod noktası ve Python biçimleri', () => {
    expect(unicodeEscape('ç😀', { style: 'codepoint' })).toBe('\\u{e7}\\u{1f600}');
    expect(unicodeEscape('ç😀', { style: 'python', upper: true })).toBe('\\u00E7\\U0001F600');
  });

  it('tüm biçimleri çözer', () => {
    expect(unicodeUnescape('\\u00e7\\u011F \\ud83d\\ude00 \\u{1F680} \\U0001F600 \\xe7 U+00E7 U+1F600')).toBe(
      'çğ 😀 🚀 😀 ç ç 😀',
    );
  });

  it('\\\\ ve diğer kaçışlara dokunmaz', () => {
    expect(unicodeUnescape('a\\\\u0041\\n')).toBe('a\\\\u0041\\n');
  });

  it('hatalı diziyi varsayılan olarak olduğu gibi bırakır', () => {
    expect(unicodeUnescape('C:\\Users\\xavier\\u00e7')).toBe('C:\\Users\\xavierç');
    expect(unicodeUnescape('ab\\u12 \\u{110000} \\xZZ \\UFFFFFFFF \\u{12')).toBe(
      'ab\\u12 \\u{110000} \\xZZ \\UFFFFFFFF \\u{12',
    );
  });

  it('strict: hatalı dizi konumla ToolError', () => {
    const strict = { strict: true };
    expect(() => unicodeUnescape('ab\\u12', strict)).toThrow(/konum 3/);
    expect(() => unicodeUnescape('\\u{110000}', strict)).toThrow(ToolError);
    expect(() => unicodeUnescape('\\xZZ', strict)).toThrow(ToolError);
    expect(() => unicodeUnescape('C:\\Users', strict)).toThrow(ToolError);
  });

  it('gidiş-dönüş', () => {
    const plain = 'Çağrı 🚀 ışık';
    for (const style of ['utf16', 'codepoint', 'python'] as const)
      expect(unicodeUnescape(unicodeEscape(plain, { style, all: true }))).toBe(plain);
  });
});

describe('Hex', () => {
  const hello = utf8Encode('Hiç');

  it('ayraç ve harf büyüklüğü seçenekleri', () => {
    expect(bytesToHex(hello)).toBe('4869c3a7');
    expect(bytesToHex(hello, { separator: 'space', upper: true })).toBe('48 69 C3 A7');
    expect(bytesToHex(hello, { separator: 'colon' })).toBe('48:69:c3:a7');
    expect(bytesToHex(hello, { separator: '0x' })).toBe('0x48 0x69 0xc3 0xa7');
    expect(bytesToHex(hello, { separator: '\\x' })).toBe('\\x48\\x69\\xc3\\xa7');
  });

  it('farklı yazımları çözer', () => {
    for (const input of [
      '4869c3a7',
      '48 69 C3 A7',
      '48:69:c3:a7',
      '0x48, 0x69, 0xC3, 0xA7',
      '\\x48\\x69\\xc3\\xa7',
      '0x480x69c3a7',
    ])
      expect(text(hexToBytes(input)), input).toBe('Hiç');
    expect(hexToBytes('')).toEqual(new Uint8Array());
  });

  it('geçersiz karakter ve tek sayıda hane', () => {
    expect(() => hexToBytes('48 6g')).toThrow(/"g" \(konum 5\)/);
    expect(() => hexToBytes('486')).toThrow(/Tek sayıda/);
  });

  it('geçersiz UTF-8 isteğe göre hata ya da �', () => {
    const bytes = hexToBytes('ff41');
    expect(() => utf8Decode(bytes, true)).toThrow(ToolError);
    expect(utf8Decode(bytes)).toBe('�A');
  });
});

describe('Base32', () => {
  // RFC 4648 bölüm 10 test vektörleri
  const vectors: [string, string, string][] = [
    ['', '', ''],
    ['f', 'MY======', 'CO======'],
    ['fo', 'MZXQ====', 'CPNG===='],
    ['foo', 'MZXW6===', 'CPNMU==='],
    ['foob', 'MZXW6YQ=', 'CPNMUOG='],
    ['fooba', 'MZXW6YTB', 'CPNMUOJ1'],
    ['foobar', 'MZXW6YTBOI======', 'CPNMUOJ1E8======'],
  ];

  it('RFC 4648 vektörleri (standart ve hex)', () => {
    for (const [plain, standard, hex] of vectors) {
      expect(base32Encode(utf8Encode(plain))).toBe(standard);
      expect(base32Encode(utf8Encode(plain), { variant: 'hex' })).toBe(hex);
      expect(text(base32Decode(standard))).toBe(plain);
      expect(text(base32Decode(hex, 'hex'))).toBe(plain);
    }
  });

  it('dolgusuz kodlar; çözmede küçük harf, boşluk ve eksik dolgu kabul edilir', () => {
    expect(base32Encode(utf8Encode('foobar'), { padding: false })).toBe('MZXW6YTBOI');
    expect(text(base32Decode('mzxw 6ytb\noi'))).toBe('foobar');
  });

  it('Türkçe metin gidiş-dönüş', () => {
    const plain = 'Çağrı Öztürk 🚀';
    expect(text(base32Decode(base32Encode(utf8Encode(plain))))).toBe(plain);
  });

  it('geçersiz karakter ve uzunluk', () => {
    expect(() => base32Decode('MZ1W')).toThrow(/"1" \(konum 3\)/);
    expect(() => base32Decode('M')).toThrow(/uzunluk/);
    expect(() => base32Decode('MZXW6===========')).toThrow(/dolgu/);
  });
});
