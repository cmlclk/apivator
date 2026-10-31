import { describe, expect, it } from 'vitest';
import {
  base64Decode,
  base64Encode,
  sniffMime,
  toHex,
  urlDecode,
  urlEncode,
  utf8Decode,
  utf8Encode,
} from './encoding';
import { ToolError } from './errors';

const bytes = (...values: number[]) => new Uint8Array(values);
const text = (value: Uint8Array) => new TextDecoder().decode(value);

describe('Base64', () => {
  // RFC 4648 bölüm 10 test vektörleri
  const vectors: [string, string][] = [
    ['', ''],
    ['f', 'Zg=='],
    ['fo', 'Zm8='],
    ['foo', 'Zm9v'],
    ['foob', 'Zm9vYg=='],
    ['fooba', 'Zm9vYmE='],
    ['foobar', 'Zm9vYmFy'],
  ];

  it('RFC 4648 vektörlerini kodlar ve çözer', () => {
    for (const [plain, encoded] of vectors) {
      expect(base64Encode(utf8Encode(plain))).toBe(encoded);
      expect(text(base64Decode(encoded))).toBe(plain);
    }
  });

  it('URL-safe biçimde -_ kullanır ve dolgu koymaz', () => {
    const data = bytes(0xfb, 0xff, 0xbf, 0xfe);
    expect(base64Encode(data)).toBe('+/+//g==');
    expect(base64Encode(data, { urlSafe: true })).toBe('-_-__g');
    expect(base64Decode('-_-__g')).toEqual(data);
  });

  it('eksik dolgu, boşluk ve satır sonlarını kabul eder', () => {
    expect(text(base64Decode('Zm9vYg'))).toBe('foob');
    expect(text(base64Decode('Zm9v\r\nYmFy \n'))).toBe('foobar');
  });

  it('lineLength ile satır kırar', () => {
    const encoded = base64Encode(new Uint8Array(100), { lineLength: 76 });
    const lines = encoded.split(/\r?\n/);
    expect(lines[0]).toHaveLength(76);
    expect(lines.length).toBe(2);
    expect(base64Decode(encoded)).toEqual(new Uint8Array(100));
  });

  it('UTF-8 metni (Türkçe karakterler) gidiş-dönüş korur', () => {
    const plain = 'Çağrı Öztürk — İzmir ışığı 🚀';
    expect(text(base64Decode(base64Encode(utf8Encode(plain))))).toBe(plain);
    expect(base64Encode(utf8Encode('ğ'))).toBe('xJ8=');
  });

  it('geçersiz girdide ToolError fırlatır', () => {
    expect(() => base64Decode('Zm9v!YmFy')).toThrow(ToolError);
    expect(() => base64Decode('Z')).toThrow(ToolError);
  });
});

describe('UTF-8', () => {
  it('geçersiz baytlarda fatal ise ToolError, değilse yerine koyma karakteri', () => {
    const invalid = bytes(0x61, 0xff, 0x62);
    expect(utf8Decode(invalid)).toBe('a�b');
    expect(() => utf8Decode(invalid, true)).toThrow(ToolError);
    expect(utf8Decode(utf8Encode('şeker'), true)).toBe('şeker');
  });

  it('toHex küçük harfli ve sıfır dolgulu', () => {
    expect(toHex(bytes(0, 15, 255))).toBe('000fff');
  });
});

describe('URL kodlama', () => {
  it('component modu ayırıcıları da kodlar', () => {
    expect(urlEncode('a b&c=d/é')).toBe('a%20b%26c%3Dd%2F%C3%A9');
    expect(urlEncode('a b&c=d/é', 'component')).toBe(encodeURIComponent('a b&c=d/é'));
  });

  it('full modu adres yapısını korur', () => {
    const url = 'https://örnek.com/yol ad?q=a b&x=1#bölüm';
    expect(urlEncode(url, 'full')).toBe(encodeURI(url));
    expect(urlEncode(url, 'full')).toContain('?q=a%20b&x=1#');
  });

  it('çözer, + işaretini boşluk sayar', () => {
    expect(urlDecode('a%20b%26c')).toBe('a b&c');
    expect(urlDecode('a+b+c')).toBe('a b c');
    expect(urlDecode('%C4%9F%C3%BC')).toBe('ğü');
    expect(urlDecode(urlEncode('Işık & Gölge?'))).toBe('Işık & Gölge?');
  });

  it('full modunda + yalnızca ? sonrasında boşluk olur', () => {
    expect(urlDecode('https://x.com/a+b?q=c+d', 'full')).toBe('https://x.com/a+b?q=c d');
    expect(urlDecode('https://x.com/a+b%20c', 'full')).toBe('https://x.com/a+b c');
    expect(urlDecode('a+b?c+d')).toBe('a b?c d');
  });

  it('bozuk % dizisinde ToolError', () => {
    expect(() => urlDecode('%E0%A4%A')).toThrow(ToolError);
    expect(() => urlDecode('100%')).toThrow(ToolError);
  });
});

describe('sniffMime', () => {
  const pad = (...head: number[]) => {
    const out = new Uint8Array(32);
    out.set(head);
    return out;
  };

  it('dosya imzasından tip bulur', () => {
    expect(sniffMime(pad(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('image/png');
    expect(sniffMime(pad(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
    expect(sniffMime(utf8Encode('GIF89a' + ' '.repeat(20)))).toBe('image/gif');
    expect(sniffMime(utf8Encode('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    expect(sniffMime(pad(0x42, 0x4d))).toBe('image/bmp');
    expect(['image/x-icon', 'image/vnd.microsoft.icon']).toContain(sniffMime(pad(0x00, 0x00, 0x01, 0x00)));
    expect(sniffMime(utf8Encode('%PDF-1.7\n'))).toBe('application/pdf');
    expect(sniffMime(pad(0x50, 0x4b, 0x03, 0x04))).toBe('application/zip');
    expect(sniffMime(pad(0x1f, 0x8b, 0x08))).toBe('application/gzip');
    expect(sniffMime(utf8Encode('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe(
      'image/svg+xml',
    );
    expect(sniffMime(utf8Encode('<svg viewBox="0 0 1 1"></svg>'))).toBe('image/svg+xml');
  });

  it('bilinmeyen içerikte null', () => {
    expect(sniffMime(utf8Encode('merhaba dünya'))).toBeNull();
    expect(sniffMime(new Uint8Array(0))).toBeNull();
  });
});
