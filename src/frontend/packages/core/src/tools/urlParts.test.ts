import { describe, expect, it } from 'vitest';
import { buildUrl, describeUrl, parseUrl, type UrlParts } from './urlParts';
import { domainToAscii, domainToUnicode, punycodeDecode, punycodeEncode } from './punycode';
import { ToolError } from './errors';

const parts = (url: string) => parseUrl(url).parts;
const roundTrip = (url: string) => buildUrl(parts(url));

describe('punycode', () => {
  // Beklenen değerler Node'un url.domainToASCII çıktısıyla doğrulandı.
  it('encodes and decodes RFC 3492 labels', () => {
    expect(punycodeEncode('çiçek')).toBe('iek-1lab');
    expect(punycodeEncode('münchen')).toBe('mnchen-3ya');
    expect(punycodeEncode('例え')).toBe('r8jz45g');
    expect(punycodeDecode('iek-1lab')).toBe('çiçek');
    expect(punycodeDecode('r8jz45g')).toBe('例え');
    expect(punycodeDecode('k-ekaa7p')).toBe('ışık');
  });

  it('converts whole domains both ways', () => {
    expect(domainToAscii('çiçek.com.tr')).toBe('xn--iek-1lab.com.tr');
    expect(domainToAscii('Bücher.Example')).toBe('xn--bcher-kva.example');
    expect(domainToAscii('例え.テスト')).toBe('xn--r8jz45g.xn--zckzah');
    expect(domainToUnicode('xn--iek-1lab.com.tr')).toBe('çiçek.com.tr');
    expect(domainToUnicode('ornek.com')).toBe('ornek.com');
  });

  it('rejects broken punycode', () => {
    expect(() => punycodeDecode('iek-z')).toThrow(ToolError);
    expect(() => punycodeDecode('ab-ç')).toThrow(ToolError);
  });
});

describe('parseUrl', () => {
  it('splits an absolute URL into parts', () => {
    const p = parts(
      'https://ayse:gizli%20sifre@api.ornek.com:8443/v1/kullan%C4%B1c%C4%B1lar/42?sayfa=2&q=a+b#ozet',
    );
    expect(p).toMatchObject({
      kind: 'absolute',
      scheme: 'https',
      username: 'ayse',
      password: 'gizli sifre',
      host: 'api.ornek.com',
      port: '8443',
      path: '/v1/kullanıcılar/42',
      fragment: 'ozet',
    });
    expect(p.query.map((q) => [q.key, q.value])).toEqual([
      ['sayfa', '2'],
      ['q', 'a b'],
    ]);
    expect(describeUrl(p).segments).toEqual(['v1', 'kullanıcılar', '42']);
  });

  it('handles IPv6 hosts with a port', () => {
    const p = parts('http://[::1]:8080/saglik');
    expect(p.host).toBe('::1');
    expect(p.port).toBe('8080');
    expect(describeUrl(p).hostType).toBe('ipv6');
    expect(buildUrl(p)).toBe('http://[::1]:8080/saglik');
    expect(buildUrl({ ...p, port: '9090' })).toBe('http://[::1]:9090/saglik');
  });

  it('shows IDN hosts in both forms', () => {
    const unicode = describeUrl(parts('https://çiçek.com.tr/'));
    expect(unicode.hostAscii).toBe('xn--iek-1lab.com.tr');
    expect(unicode.hostUnicode).toBe('çiçek.com.tr');
    const ascii = describeUrl(parts('https://xn--iek-1lab.com.tr/'));
    expect(ascii.hostUnicode).toBe('çiçek.com.tr');
    expect(buildUrl(parts('https://çiçek.com.tr/a'), { asciiHost: true })).toBe(
      'https://xn--iek-1lab.com.tr/a',
    );
  });

  it('keeps duplicate and empty query parameters in order', () => {
    const p = parts('/ara?a=&b&a=2&c=x=y');
    expect(p.kind).toBe('relative');
    expect(p.query.map((q) => [q.key, q.value, q.hasValue])).toEqual([
      ['a', '', true],
      ['b', '', false],
      ['a', '2', true],
      ['c', 'x=y', true],
    ]);
    expect(buildUrl(p)).toBe('/ara?a=&b&a=2&c=x=y');
  });

  it('treats + as space but keeps an encoded plus distinct', () => {
    const p = parts('https://x.test/?q=1+1&r=1%2B1');
    expect(p.query[0]!.value).toBe('1 1');
    expect(p.query[1]!.value).toBe('1%2B1');
    expect(fullSegments('/a%2Fb/c')).toEqual(['a/b', 'c']);
  });

  it('keeps encoded slashes inside a path segment', () => {
    const p = parts('https://x.test/dosyalar/a%2Fb.txt');
    expect(p.path).toBe('/dosyalar/a%2Fb.txt');
    expect(describeUrl(p).segments).toEqual(['dosyalar', 'a/b.txt']);
    expect(buildUrl(p)).toBe('https://x.test/dosyalar/a%2Fb.txt');
  });

  it('notes default ports', () => {
    expect(describeUrl(parts('https://x.test/'))).toMatchObject({ defaultPort: 443, portIsDefault: true });
    expect(describeUrl(parts('http://x.test:80/'))).toMatchObject({ defaultPort: 80, portIsDefault: true });
    expect(describeUrl(parts('http://x.test:8080/')).portIsDefault).toBe(false);
  });

  it('tolerates {{variables}} anywhere', () => {
    const url = '{{baseUrl}}/kullanicilar/{{id}}?token={{ api token }}&q=ç#{{bolum}}';
    const p = parts(url);
    expect(p.kind).toBe('variable');
    expect(p.base).toBe('{{baseUrl}}');
    expect(p.path).toBe('/kullanicilar/{{id}}');
    expect(p.query[0]!.value).toBe('{{ api token }}');
    expect(buildUrl(p)).toBe('{{baseUrl}}/kullanicilar/{{id}}?token={{ api token }}&q=%C3%A7#{{bolum}}');
    const host = parts('https://{{host}}:{{port}}/a?x={{a/b?c}}');
    expect(host).toMatchObject({ host: '{{host}}', port: '{{port}}', path: '/a' });
    expect(describeUrl(host).hostType).toBe('variable');
    expect(buildUrl({ ...host, path: '/a b/{{v}}' })).toBe(
      'https://{{host}}:{{port}}/a%20b/{{v}}?x={{a/b?c}}',
    );
  });

  it('recognizes schemeless, network and opaque forms', () => {
    expect(parts('api.ornek.com/v1').kind).toBe('host');
    expect(parts('localhost:5000/x')).toMatchObject({ kind: 'host', host: 'localhost', port: '5000' });
    expect(parts('//cdn.ornek.com/a.js')).toMatchObject({ kind: 'network', host: 'cdn.ornek.com' });
    expect(parts('mailto:ayse@ornek.com?subject=Merhaba')).toMatchObject({
      kind: 'opaque',
      scheme: 'mailto',
      path: 'ayse@ornek.com',
    });
    expect(roundTrip('api.ornek.com/v1?a=1')).toBe('api.ornek.com/v1?a=1');
  });

  it('reports errors and warnings', () => {
    expect(() => parseUrl('  ')).toThrow(ToolError);
    expect(() => parseUrl('http://x.test:99999/')).toThrow(/port/);
    expect(() => parseUrl('http://x.test:abc/')).toThrow(/port/);
    expect(() => parseUrl('http://[::1/')).toThrow(/köşeli/);
    expect(() => parseUrl('http://[zz::1]/')).toThrow(/IPv6/);
    expect(parseUrl('https://x.test/%E0%A4%A').warnings.join()).toMatch(/Geçersiz yüzde/);
    expect(parseUrl('https://x.test/a b').warnings.join()).toMatch(/boşluk/);
  });

  it('keeps invalid percent sequences as written when unedited', () => {
    expect(roundTrip('https://x.test/a%zz?q=%&r=100%#%g')).toBe('https://x.test/a%zz?q=%&r=100%#%g');
    // Düzenlenen değerdeki yalın % kodlanır.
    expect(buildUrl({ ...parts('https://x.test/a%zz'), path: '/b%zz' })).toBe('https://x.test/b%25zz');
  });

  it('parses very long input quickly', () => {
    const long = `https://x.test/${'a/'.repeat(100_000)}?${'a=b&'.repeat(20_000)}`;
    const start = Date.now();
    expect(roundTrip(long)).toBe(long.slice(0, -1));
    expect(Date.now() - start).toBeLessThan(3000);
  });
});

function fullSegments(path: string) {
  return describeUrl({ ...parts('https://x.test/'), path }).segments;
}

describe('buildUrl', () => {
  it('round-trips unedited URLs exactly', () => {
    for (const url of [
      'https://a:b@x.test:8443/p/q%2Fr?a=1+2&b=%20&c#f%20g',
      'https://x.test/?q=%41',
      'http://192.168.1.1/',
      'mailto:a@b.test',
    ])
      expect(roundTrip(url)).toBe(url);
  });

  it('encodes edited parts component-wise', () => {
    const p: UrlParts = parts('https://x.test/');
    const edited: UrlParts = {
      ...p,
      username: 'ali:veli',
      password: 'p@ss:1',
      path: '/arama sonuçları/a%2Fb/100%',
      query: [
        { key: 'q', value: 'a&b=c+d', hasValue: true, enabled: true, rawKey: '', rawValue: '' },
        { key: 'kapali', value: '1', hasValue: true, enabled: false, rawKey: '', rawValue: '' },
        { key: 'ç ğ', value: '', hasValue: false, enabled: true, rawKey: '', rawValue: '' },
      ],
      fragment: 'bölüm 2',
    };
    expect(buildUrl(edited)).toBe(
      'https://ali%3Aveli:p%40ss:1@x.test/arama%20sonu%C3%A7lar%C4%B1/a%2Fb/100%25?q=a%26b=c%2Bd&%C3%A7%20%C4%9F#b%C3%B6l%C3%BCm%202',
    );
  });

  it('adds a leading slash to a path after a host', () => {
    expect(buildUrl({ ...parts('https://x.test'), path: 'a/b' })).toBe('https://x.test/a/b');
  });
});
