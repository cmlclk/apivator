import { describe, expect, it } from 'vitest';
import { detectContent } from './detect';

const JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

const ids = (text: string) => detectContent(text).map((d) => d.toolId);
const first = (text: string) => detectContent(text)[0]?.toolId;

describe('detectContent', () => {
  it('JWT ilk öneri; Bearer önekli de tanınır', () => {
    expect(first(JWT)).toBe('jwt');
    expect(first(`Bearer ${JWT}`)).toBe('jwt');
  });

  it('JSON nesnesi ve dizisi', () => {
    expect(first('{"a": 1, "b": [true, null]}')).toBe('json-format');
    expect(first('  [\n  {"id": 1}\n]  ')).toBe('json-format');
  });

  it('Unix zaman damgası (saniye ve milisaniye)', () => {
    expect(first('1793271900')).toBe('timestamp');
    expect(first('1793271900123')).toBe('timestamp');
    expect(first('2026-10-29T11:05:00Z')).toBe('timestamp');
  });

  it('UUID', () => {
    expect(first('f47ac10b-58cc-4372-a567-0e02b2c3d479')).toBe('uuid');
  });

  it('URL kodlu metin ya da adres', () => {
    expect(ids('https://ornek.com/ara?q=%C3%A7a%C4%9Fr%C4%B1&x=1')).toContain('url');
    expect(ids('a%20b%26c%3Dd')).toContain('url');
  });

  it('cURL komutu → cURL → kod aracı, ardından yeni istek', () => {
    expect(ids("curl -X POST 'https://api.ornek.com/v1/users' -H 'Content-Type: application/json'")).toEqual([
      'curl-code',
      'curl',
    ]);
  });

  it('HAR → HAR görüntüleyici; HAR olmayan benzer JSON → JSON araçları', () => {
    expect(ids('{"log": {"version": "1.2", "creator": {}, "entries": []}}')).toEqual(['har', 'json-format']);
    expect(first('{"log": {"entries": "yok"}}')).toBe('json-format');
    expect(first('{"log": "metin", "entries": []}')).toBe('json-format');
  });

  it('uzun Base64 metni', () => {
    const encoded = Buffer.from('Merhaba dünya, bu bir Base64 örneğidir!').toString('base64');
    expect(ids(encoded)).toContain('base64');
  });

  it('gzip ile sıkıştırılmış Base64 → sıkıştırma aracı, ardından Base64', () => {
    expect(ids('H4sIAAAAAAAAA8tIzcnJBwCGphA2BQAAAA==')).toEqual(['compress', 'base64']);
  });

  it('\\uXXXX ağırlıklı metin → unicode', () => {
    expect(first('\\u00c7a\\u011fr\\u0131')).toBe('unicode');
    expect(first('\\u{1F600}')).toBe('unicode');
    expect(first('Merhaba \\u00e7 dünya, bugün hava güzel')).toBeUndefined();
  });

  it('HTML varlıkları → html-entity', () => {
    expect(first('&lt;b&gt;Tom &amp; Jerry&lt;/b&gt;')).toBe('html-entity');
    expect(first('&ccedil;')).toBe('html-entity');
    expect(first('Ali & Veli')).toBeUndefined();
  });

  it('JSON içindeki \\u kaçışları JSON olarak kalır', () => {
    expect(first('{"ad": "\\u00c7a\\u011fr\\u0131"}')).toBe('json-format');
  });

  it('her öneride açıklama var', () => {
    for (const detection of detectContent(JWT)) expect(detection.reason).toBeTruthy();
  });

  it('düz kelimeler ve kısa metinler Base64 sayılmaz', () => {
    for (const text of ['hello', 'test', 'abcd', 'Merhaba', 'admin123', 'password'])
      expect(ids(text), text).not.toContain('base64');
  });

  it('boş ya da tanınmayan içerikte boş dizi', () => {
    expect(detectContent('')).toEqual([]);
    expect(detectContent('   \n ')).toEqual([]);
    expect(detectContent('hello')).toEqual([]);
    expect(detectContent('bugün hava çok güzel, dışarı çıkalım mı?')).toEqual([]);
  });

  it('JSON metni JWT ya da Base64 sanılmaz', () => {
    expect(ids('{"token": "abc"}')).not.toContain('jwt');
    expect(ids('{"token": "abc"}')).not.toContain('base64');
  });
});

describe('detectContent: sertifika ve kimlik', () => {
  it('PEM sertifika, zincir, CSR ve anahtar → certificate', () => {
    const pem = '-----BEGIN CERTIFICATE-----\nMIIBszCCAVmgAwIBAgIUAA==\n-----END CERTIFICATE-----';
    expect(ids(pem)).toEqual(['certificate']);
    expect(first(`${pem}\n${pem}`)).toBe('certificate');
    expect(first('-----BEGIN CERTIFICATE REQUEST-----\nAA==\n-----END CERTIFICATE REQUEST-----')).toBe(
      'certificate',
    );
    expect(first('-----BEGIN PUBLIC KEY-----\nAA==\n-----END PUBLIC KEY-----')).toBe('certificate');
  });

  it('Basic kimlik başlığı → basic-auth', () => {
    expect(ids('Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ==')).toEqual(['basic-auth']);
    expect(first('Authorization: Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ==')).toBe('basic-auth');
    expect(first('basic dXNlcjpwYXNz')).toBe('basic-auth');
    // Düz cümle başlık sayılmaz.
    expect(ids('Basic setup guide')).not.toContain('basic-auth');
    expect(ids('Basic authentication')).not.toContain('basic-auth');
  });
});

describe('detectContent: web ve ağ', () => {
  it('Set-Cookie ve Cookie başlıkları → cookie', () => {
    expect(ids('Set-Cookie: SID=31d4d96e407aad42; Path=/; Secure; HttpOnly')).toEqual(['cookie']);
    expect(first('HTTP/1.1 200 OK\nContent-Type: text/html\nset-cookie: a=b\nSet-Cookie: c=d')).toBe(
      'cookie',
    );
    expect(first('Cookie: SID=31d4d96e407aad42; lang=en-US')).toBe('cookie');
    expect(first('lang=en-US; Path=/; Max-Age=3600')).toBe('cookie');
    // Sorgu dizesi ya da düz metin çerez sayılmaz.
    expect(first('a=1&b=2')).not.toBe('cookie');
    expect(first('Cookie policy page')).toBeUndefined();
    // JSON ve adres, içlerinde "; path=" geçse de çerez sayılmaz.
    expect(first('{"set-cookie":"a=b; path=/"}')).toBe('json-format');
    expect(first('https://x.test/?a=b; path=/')).not.toBe('cookie');
  });

  it('tarayıcı UA metni → user-agent', () => {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
    expect(ids(ua)).toEqual(['user-agent']);
    expect(first(`User-Agent: ${ua}`)).toBe('user-agent');
    expect(first('Mozilla Firefox harika')).toBeUndefined();
  });

  it('CIDR → cidr; yalın sürüm numaraları ve tarihler değil', () => {
    expect(ids('192.168.1.0/24')).toEqual(['cidr']);
    expect(first('2001:db8::/32')).toBe('cidr');
    expect(first('2001:db8:0:0:0:0:0:1/128')).toBe('cidr');
    expect(first('1.2.3.4')).toBeUndefined();
    expect(first('2026/10/30')).not.toBe('cidr');
    expect(first('https://x.test/10.0.0.0/24')).toBe('url');
    expect(first('12:34:56/24')).not.toBe('cidr');
  });
});
