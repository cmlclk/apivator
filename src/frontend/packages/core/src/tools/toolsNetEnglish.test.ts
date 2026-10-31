import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { registerCoreMessages, setCoreLanguage } from '../i18n';
import en from '../locales/en/toolsNet.json';
import { charName } from './byteView';
import { cidrInfo, maskToPrefix, parseCidr } from './cidr';
import { analyzeSetCookie, buildSetCookie, formatCookieDuration, parseCookieHeader } from './cookieParse';
import { detectContent } from './detect';
import { harMimeCategories, parseHar } from './har';
import {
  HTTP_HEADERS,
  HTTP_STATUSES,
  MIME_TYPES,
  httpHeaderInfo,
  httpStatusInfo,
  mimeTypeInfo,
  searchHttpHeaders,
  searchHttpStatuses,
  searchMimeTypes,
} from './httpReference';
import { ipRangeTypes, parseIp, parseIpv4 } from './ipAddress';
import { punycodeDecode } from './punycode';
import { parseQuery, stringifyQuery } from './querystring';
import { parseUrl } from './urlParts';
import { parseUserAgent, uaDeviceLabel } from './userAgent';

beforeAll(() => registerCoreMessages('en', { toolsNet: en }));
afterEach(() => setCoreLanguage('tr'));

const TURKISH_LETTERS = /[çğıöşüÇĞİÖŞÜ]/;
const english = () => setCoreLanguage('en');
const catalogEntry = (table: string, key: string, field: string) =>
  (en as unknown as Record<string, Record<string, Record<string, string>>>)[table]![key]![field];
const errorOf = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return (error as Error).message;
  }
  return '';
};

describe('HTTP başvuru verisi (İngilizce)', () => {
  it('translates every status, header and MIME entry', () => {
    english();
    for (const s of HTTP_STATUSES) {
      const info = httpStatusInfo(s.code)!;
      for (const field of ['name', 'description', 'usage', 'note'] as const) {
        if (!s[field]) continue;
        expect(info[field], `${s.code}.${field}`).not.toBe(s[field]);
        expect(info[field], `${s.code}.${field}`).not.toMatch(TURKISH_LETTERS);
      }
    }
    for (const h of HTTP_HEADERS) {
      const info = httpHeaderInfo(h.name)!;
      expect(catalogEntry('header', h.name, 'description'), h.name).toBeTypeOf('string');
      expect(info.description, h.name).not.toMatch(TURKISH_LETTERS);
      expect(info.group, h.name).not.toBe(h.group === 'CORS' || h.group === 'Proxy' ? '' : h.group);
      expect(info.group, h.name).not.toMatch(TURKISH_LETTERS);
      expect(info.example, h.name).not.toMatch(TURKISH_LETTERS);
    }
    for (const m of MIME_TYPES) {
      const info = mimeTypeInfo(m.type)!;
      expect(catalogEntry('mime', m.type.replace(/\./g, '_'), 'description'), m.type).toBeTypeOf('string');
      expect(info.description, m.type).not.toMatch(TURKISH_LETTERS);
    }
  });

  it('returns English texts and searches in English', () => {
    english();
    expect(httpStatusInfo(404)).toMatchObject({ phrase: 'Not Found', name: 'Not Found' });
    expect(httpStatusInfo(301)!.note).toBe(
      'Browsers may change POST to GET; use 308 to preserve the method.',
    );
    expect(httpHeaderInfo('cache-control')).toMatchObject({
      group: 'Caching',
      description: 'Caching directives: lifetime, sharing, revalidation.',
    });
    expect(httpHeaderInfo('Cookie')!.example).toBe('session=abc123; theme=dark');
    expect(mimeTypeInfo('.json')!.description).toBe('JSON data; the default body type of REST APIs.');
    expect(searchHttpStatuses('rate limiting').map((s) => s.code)).toEqual([429]);
    expect(searchHttpStatuses('redirect', '3xx').map((s) => s.code)).toEqual(
      expect.arrayContaining([301, 307, 308]),
    );
    expect(searchHttpHeaders('Caching', 'request').map((h) => h.name)).toContain('Cache-Control');
    expect(searchMimeTypes('workbook').map((m) => m.type)).toContain('application/vnd.ms-excel');
  });
});

describe('Çerez (İngilizce)', () => {
  const now = new Date('2026-10-30T08:00:00Z');

  it('writes durations, expiry and warnings in English', () => {
    english();
    expect(formatCookieDuration(86_400_000 + 3_600_000)).toBe('1 day 1 hour');
    expect(formatCookieDuration(2 * 86_400_000 + 5 * 60_000)).toBe('2 days');
    expect(formatCookieDuration(0)).toBe('0 seconds');
    const info = analyzeSetCookie('id=1; SameSite=None', now);
    const messages = info.warnings.map((w) => w.message);
    expect(messages).toContain('SameSite=None requires Secure; browsers reject this cookie.');
    expect(info.warnings.every((w) => !TURKISH_LETTERS.test(w.message))).toBe(true);
  });

  it('translates errors', () => {
    english();
    expect(errorOf(() => buildSetCookie({ name: '', value: 'x' }))).toBe('A cookie name is required.');
    expect(errorOf(() => analyzeSetCookie('', now))).toBe('The Set-Cookie line is empty.');
    const header = parseCookieHeader('a=1; a=2; b');
    expect(header.warnings.map((w) => w.message)).toEqual(
      expect.arrayContaining([
        'Duplicate name: a. The browser sends the one with the longer Path first; servers usually read the first one.',
      ]),
    );
  });
});

describe('Ağ araçları (İngilizce)', () => {
  it('translates URL warnings and errors', () => {
    english();
    expect(errorOf(() => parseUrl('http://a:99999/'))).toBe(
      'Invalid port: "99999". The port must be a number between 0 and 65535.',
    );
    expect(errorOf(() => parseUrl(''))).toBe('Enter a URL to parse: https://example.com/path?q=1');
    expect(parseUrl('example.com/a').warnings).toEqual([
      'No scheme; the start of the URL was interpreted as the host.',
    ]);
  });

  it('translates IP and CIDR texts', () => {
    english();
    expect(errorOf(() => parseIpv4('1.2.3'))).toBe('Invalid IPv4 address (it must have four parts): 1.2.3');
    expect(ipRangeTypes(parseIp('10.1.2.3'))[0]!.label).toBe('Private network');
    expect(ipRangeTypes(parseIp('127.0.0.1'))[0]!.label).toBe('Loopback');
    expect(ipRangeTypes(parseIp('8.8.8.8'))[0]!.label).toBe('Public address');
    expect(errorOf(() => maskToPrefix('0.0.0.255'))).toBe(
      '0.0.0.255 looks like a wildcard mask; the netmask would be 255.255.255.0.',
    );
    const { address, prefix } = parseCidr('10.0.0.1/32');
    expect(cidrInfo(address, prefix).notes).toEqual([
      '/32 is a single address (a host route); it has no network or broadcast address.',
    ]);
    expect(errorOf(() => parseCidr(''))).toBe('Enter an address or CIDR.');
  });

  it('translates punycode errors', () => {
    english();
    expect(errorOf(() => punycodeDecode('é-abc'))).toBe(
      'Invalid Punycode: "é-abc" contains a non-ASCII basic character.',
    );
  });

  it('translates user agent notes and device labels', () => {
    english();
    expect(errorOf(() => parseUserAgent(' '))).toBe('The User-Agent text is empty.');
    const info = parseUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    );
    expect(info.notes.join(' ')).not.toMatch(TURKISH_LETTERS);
    expect(info.notes[0]).toMatch(/^Windows 10 and 11 send the same/);
    expect(parseUserAgent('WhatsApp/2.23.1').bot!.name).toBe('WhatsApp preview');
    expect(uaDeviceLabel('desktop')).toBe('Desktop');
    expect(uaDeviceLabel('bot')).toBe('Bot / client');
  });
});

describe('HAR, bayt ve yapıştırma (İngilizce)', () => {
  it('translates HAR labels and errors', () => {
    english();
    expect(errorOf(() => parseHar(''))).toBe('The HAR content is empty.');
    expect(errorOf(() => parseHar('{}'))).toBe(
      'HAR format not recognized: there must be a top-level "log" object.',
    );
    expect(harMimeCategories().map((c) => c.label)).toEqual([
      'JSON',
      'HTML',
      'XML',
      'JavaScript',
      'CSS',
      'Image',
      'Font',
      'Text',
      'Other',
    ]);
    const log = parseHar(
      JSON.stringify({
        log: {
          entries: [{ request: { method: 'GET', url: 'https://a.test/' }, timings: { dns: 1, wait: 2 } }],
        },
      }),
    );
    expect(log.entries[0]!.timings.map((t) => t.label)).toEqual(['DNS lookup', 'Waiting (TTFB)']);
  });

  it('translates invisible character names', () => {
    expect(charName(0x200b)).toBe('ZWSP (sıfır genişlikte boşluk)');
    english();
    expect(charName(0x200b)).toBe('ZWSP (zero-width space)');
    expect(charName(0xfe01)).toBe('VS2 (variation selector)');
    expect(charName(0x85)).toBe('NEL (next line)');
    expect(charName(0x61)).toBeUndefined();
  });

  it('gives every named character an English name', () => {
    const turkish = new Map<number, string>();
    for (let cp = 0; cp <= 0xffff; cp++) {
      const name = charName(cp);
      if (name) turkish.set(cp, name);
    }
    for (let cp = 0xe0000; cp <= 0xe007f; cp++) turkish.set(cp, charName(cp)!);
    english();
    for (const [cp, name] of turkish) {
      const translated = charName(cp)!;
      expect(translated, cp.toString(16)).not.toMatch(TURKISH_LETTERS);
      if (TURKISH_LETTERS.test(name)) expect(translated, cp.toString(16)).not.toBe(name);
    }
  });

  it('translates smart paste suggestions', () => {
    english();
    expect(detectContent('curl https://a.test')[0]!.reason).toBe('Looks like a cURL command');
    expect(detectContent('{"a":1}').map((d) => d.reason)).toEqual([
      'Looks like JSON',
      'Run a query on the JSON',
      'Convert the JSON to CSV, Excel, YAML or XML',
      'Generate a model class from the JSON structure',
    ]);
    expect(detectContent('1700000000')[0]!.reason).toBe('Looks like a Unix timestamp (seconds)');
    expect(detectContent('10.0.0.0/8')[0]!.reason).toBe('Looks like an IP / CIDR block');
  });

  it('translates query string errors', () => {
    english();
    expect(errorOf(() => stringifyQuery([1]))).toBe(
      'The query string needs a JSON object: { "name": "Ann", "page": 2 }',
    );
    expect(errorOf(() => parseQuery('a=1&a[b]=2'))).toMatch(/^"a\[b\]": "a\.b"|used as both/);
  });
});
