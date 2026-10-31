import { describe, expect, it } from 'vitest';
import { toCurl } from '../curl';
import { ToolError } from './errors';
import {
  baseMimeType,
  filterHarEntries,
  harEntryToRequest,
  harMimeCategory,
  harResponseBody,
  harStatusClass,
  parseHar,
  prettyBody,
  sortHarEntries,
} from './har';

const HAR = {
  log: {
    version: '1.2',
    creator: { name: 'WebInspector', version: '537.36' },
    entries: [
      {
        startedDateTime: '2026-10-29T10:00:01.000Z',
        time: 120.5,
        serverIPAddress: '10.0.0.1',
        request: {
          method: 'post',
          url: 'https://api.ornek.com/v1/users?page=2',
          httpVersion: 'HTTP/2',
          headers: [
            { name: ':authority', value: 'api.ornek.com' },
            { name: 'Content-Type', value: 'application/json' },
            { name: 'Content-Length', value: '13' },
            { name: 'Authorization', value: 'Bearer abc' },
          ],
          queryString: [{ name: 'page', value: '2' }],
          cookies: [{ name: 'sid', value: 'x1' }],
          postData: { mimeType: 'application/json', text: '{"ad":"Ayşe"}' },
          bodySize: 13,
        },
        response: {
          status: 201,
          statusText: 'Created',
          headers: [{ name: 'Content-Type', value: 'application/json; charset=utf-8' }],
          cookies: [],
          content: { size: 14, mimeType: 'application/json; charset=utf-8', text: '{"id":7,"a":[1]}' },
          redirectURL: '',
          bodySize: 40,
        },
        timings: { blocked: 1, dns: -1, connect: -1, ssl: -1, send: 0.5, wait: 100, receive: 19 },
      },
      {
        startedDateTime: '2026-10-29T10:00:00.000Z',
        time: 30,
        request: { method: 'GET', url: 'https://cdn.ornek.com/logo.png', headers: [] },
        response: {
          status: 404,
          content: { size: 4, mimeType: 'image/png', text: 'iVBORw==', encoding: 'base64' },
        },
      },
      {
        startedDateTime: 'geçersiz',
        request: {
          method: 'POST',
          url: 'https://api.ornek.com/upload',
          postData: {
            mimeType: 'multipart/form-data; boundary=xyz',
            params: [
              { name: 'aciklama', value: 'rapor' },
              { name: 'dosya', fileName: 'rapor.pdf', contentType: 'application/pdf' },
            ],
          },
          headers: [{ name: 'Content-Type', value: 'multipart/form-data; boundary=xyz' }],
        },
        response: { status: 0, content: { mimeType: '', text: 'gizli', encoding: 'base64' } },
      },
    ],
  },
};
const text = JSON.stringify(HAR);

describe('parseHar', () => {
  it('kayıtları normalleştirir', () => {
    const log = parseHar(text);
    expect(log.version).toBe('1.2');
    expect(log.creator).toBe('WebInspector 537.36');
    expect(log.entries).toHaveLength(3);
    const [first, second, third] = log.entries;
    expect(first).toMatchObject({
      index: 0,
      method: 'POST',
      host: 'api.ornek.com',
      path: '/v1/users?page=2',
      status: 201,
      mimeType: 'application/json',
      size: 40,
      time: 120.5,
      startMs: Date.parse('2026-10-29T10:00:01.000Z'),
      httpVersion: 'HTTP/2',
      serverIPAddress: '10.0.0.1',
    });
    expect(first!.request.queryString).toEqual([{ name: 'page', value: '2' }]);
    expect(first!.request.cookies).toEqual([{ name: 'sid', value: 'x1' }]);
    expect(first!.timings.map((t) => t.phase)).toEqual(['blocked', 'send', 'wait', 'receive']);
    expect(second).toMatchObject({
      status: 404,
      size: 4,
      mimeType: 'image/png',
      request: { postData: null },
    });
    expect(third).toMatchObject({ status: 0, startMs: null, time: 0, size: -1 });
    expect(third!.request.postData!.params[1]).toEqual({
      name: 'dosya',
      value: '',
      fileName: 'rapor.pdf',
      contentType: 'application/pdf',
    });
  });

  it('hatalı girdide Türkçe ToolError', () => {
    expect(() => parseHar('  ')).toThrow('HAR içeriği boş.');
    expect(() => parseHar('{log')).toThrow(/HAR geçerli bir JSON değil/);
    expect(() => parseHar('[]')).toThrow(/"log" nesnesi/);
    expect(() => parseHar('{"log":{"version":"1.2"}}')).toThrow(/log.entries/);
    expect(() => parseHar('{"log":{"entries":[{"response":{}}]}}')).toThrow(/#1 geçersiz/);
    expect(() => parseHar('{"log":{"entries":[1]}}')).toThrow(ToolError);
  });
});

describe('harResponseBody', () => {
  const [json, image, broken] = parseHar(text).entries;
  it('JSON gövdeyi biçimlendirir', () => {
    expect(harResponseBody(json!)).toEqual({
      text: '{\n  "id": 7,\n  "a": [\n    1\n  ]\n}',
      decoded: false,
      binary: false,
      bytes: 0,
    });
  });
  it('Base64 ikili içeriği tanır', () => {
    expect(harResponseBody(image!)).toMatchObject({ decoded: true, binary: true, bytes: 4, text: '' });
  });
  it('Base64 metin içeriği çözer', () => {
    const entry = { ...json!, response: { ...json!.response } };
    entry.response.content = { ...entry.response.content, text: btoa('{"ok":true}'), encoding: 'base64' };
    expect(harResponseBody(entry)).toMatchObject({
      text: '{\n  "ok": true\n}',
      decoded: true,
      binary: false,
    });
  });
  it('çözülemeyen Base64 olduğu gibi kalır', () => {
    expect(harResponseBody(broken!)).toMatchObject({ text: 'gizli', decoded: false });
  });
});

describe('yardımcılar', () => {
  it('prettyBody ve MIME', () => {
    expect(prettyBody('[1,2]')).toBe('[\n  1,\n  2\n]');
    expect(prettyBody('{bozuk', 'application/json')).toBe('{bozuk');
    expect(prettyBody('a=1', 'text/plain')).toBe('a=1');
    expect(baseMimeType('Text/HTML; charset=UTF-8')).toBe('text/html');
    expect(harMimeCategory('application/problem+json')).toBe('json');
    expect(harMimeCategory('application/javascript')).toBe('script');
    expect(harMimeCategory('font/woff2')).toBe('font');
    expect(harMimeCategory('text/css')).toBe('css');
    expect(harMimeCategory('')).toBe('other');
    expect(harStatusClass(204)).toBe('2xx');
    expect(harStatusClass(0)).toBe('hata');
  });

  it('süzer ve sıralar', () => {
    const entries = parseHar(text).entries;
    expect(filterHarEntries(entries, { text: 'API.ORNEK' }).map((e) => e.index)).toEqual([0, 2]);
    expect(filterHarEntries(entries, { method: 'GET' }).map((e) => e.index)).toEqual([1]);
    expect(filterHarEntries(entries, { statusClass: '4xx' }).map((e) => e.index)).toEqual([1]);
    expect(filterHarEntries(entries, { mimeCategory: 'json' }).map((e) => e.index)).toEqual([0]);
    expect(sortHarEntries(entries, 'start').map((e) => e.index)).toEqual([1, 0, 2]);
    expect(sortHarEntries(entries, 'status', true).map((e) => e.index)).toEqual([1, 0, 2]);
    expect(sortHarEntries(entries, 'url').map((e) => e.index)).toEqual([2, 0, 1]);
    expect(sortHarEntries(entries, 'time', true).map((e) => e.index)).toEqual([0, 1, 2]);
  });
});

describe('harEntryToRequest', () => {
  const [json, , multipart] = parseHar(text).entries;
  it('JSON isteği cURL olarak yazılabilir', () => {
    const request = harEntryToRequest(json!);
    expect(request.headers.map((h) => h.key)).toEqual(['Content-Type', 'Authorization']);
    expect(request.body).toMatchObject({ mode: 'Raw', rawLanguage: 'Json', raw: '{"ad":"Ayşe"}' });
    const curl = toCurl(request);
    expect(curl).toContain("'https://api.ornek.com/v1/users?page=2'");
    expect(curl).toContain(`--data-raw '{"ad":"Ayşe"}'`);
    expect(curl).not.toContain('-X POST');
    expect(curl).not.toContain(':authority');
  });
  it('multipart parametreleri form-data olur, boundary başlığı atılır', () => {
    const request = harEntryToRequest(multipart!);
    expect(request.headers).toEqual([]);
    expect(request.body.mode).toBe('FormData');
    expect(request.body.form).toEqual([
      { key: 'aciklama', value: 'rapor', enabled: true },
      { key: 'dosya', value: 'rapor.pdf', enabled: true, type: 'File' },
    ]);
    expect(toCurl(request)).toContain('-F dosya=@rapor.pdf');
  });
});
