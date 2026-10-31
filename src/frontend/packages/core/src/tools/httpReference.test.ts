import { describe, expect, it } from 'vitest';
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

// IANA HTTP Status Code Registry'deki atanmış kodlar (104 geçici, 306/418 ayrılmış olarak dahil).
const IANA_CODES = [
  100, 101, 102, 103, 104, 200, 201, 202, 203, 204, 205, 206, 207, 208, 226, 300, 301, 302, 303, 304, 305,
  306, 307, 308, 400, 401, 402, 403, 404, 405, 406, 407, 408, 409, 410, 411, 412, 413, 414, 415, 416, 417,
  418, 421, 422, 423, 424, 425, 426, 428, 429, 431, 451, 500, 501, 502, 503, 504, 505, 506, 507, 508, 510,
  511,
];

describe('HTTP durum kodları', () => {
  it('covers every IANA code exactly once with all fields filled', () => {
    expect(HTTP_STATUSES.map((s) => s.code)).toEqual(IANA_CODES);
    for (const s of HTTP_STATUSES) {
      expect(s.phrase && s.name && s.description && s.usage && s.reference, String(s.code)).toBeTruthy();
      expect(s.statusClass).toBe(`${String(s.code)[0]}xx`);
    }
  });

  it('uses the RFC 9110 reason phrases', () => {
    expect(httpStatusInfo(404)).toMatchObject({ phrase: 'Not Found', name: 'Bulunamadı' });
    expect(httpStatusInfo(413)!.phrase).toBe('Content Too Large');
    expect(httpStatusInfo(422)!.phrase).toBe('Unprocessable Content');
    expect(httpStatusInfo(305)!.note).toMatch(/kaldırıldı/);
    expect(httpStatusInfo(299)).toBeUndefined();
  });

  it('searches with Turkish case folding and class filter', () => {
    expect(searchHttpStatuses('İSTEK zaman').map((s) => s.code)).toContain(408);
    expect(searchHttpStatuses('yonlendirme', '3xx').map((s) => s.code)).toEqual(
      expect.arrayContaining([302, 307, 308]),
    );
    expect(searchHttpStatuses('429').map((s) => s.code)).toEqual([429]);
    expect(searchHttpStatuses('', '1xx')).toHaveLength(5);
    expect(searchHttpStatuses('teapot').map((s) => s.code)).toEqual([418]);
  });
});

describe('HTTP başlıkları', () => {
  it('has about 80+ unique, complete headers', () => {
    expect(HTTP_HEADERS.length).toBeGreaterThanOrEqual(80);
    const names = HTTP_HEADERS.map((h) => h.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
    for (const h of HTTP_HEADERS) {
      expect(['request', 'response', 'both']).toContain(h.direction);
      expect(h.description && h.example && h.reference && h.group, h.name).toBeTruthy();
    }
  });

  it('finds headers by name and direction', () => {
    expect(httpHeaderInfo('content-type')).toMatchObject({ name: 'Content-Type', direction: 'both' });
    expect(searchHttpHeaders('çerez').map((h) => h.name)).toEqual(
      expect.arrayContaining(['Cookie', 'Set-Cookie']),
    );
    expect(searchHttpHeaders('cookie', 'request').map((h) => h.name)).toEqual(['Cookie']);
    expect(searchHttpHeaders('', 'response').every((h) => h.direction !== 'request')).toBe(true);
  });
});

describe('MIME türleri', () => {
  it('has about 100 unique entries', () => {
    expect(MIME_TYPES.length).toBeGreaterThanOrEqual(100);
    const types = MIME_TYPES.map((m) => m.type);
    expect(new Set(types).size).toBe(types.length);
  });

  it('looks up by type or extension', () => {
    expect(mimeTypeInfo('application/json; charset=utf-8')).toMatchObject({
      textLike: true,
      compressible: true,
    });
    expect(mimeTypeInfo('.png')).toMatchObject({ type: 'image/png', textLike: false, compressible: false });
    expect(mimeTypeInfo('xlsx')!.type).toContain('spreadsheetml');
    expect(searchMimeTypes('.svg').map((m) => m.type)).toEqual(['image/svg+xml']);
    expect(searchMimeTypes('görüntü').length).toBeGreaterThan(5);
  });
});
