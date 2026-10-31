import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import en from '../locales/en/toolsMisc.json';
import { registerCoreMessages, setCoreLanguage } from '../i18n';
import { ToolError } from './errors';
import {
  NANOID_ALPHABET,
  NANOID_DEFAULT_SIZE,
  formatIdList,
  inspectId,
  inspectUlid,
  inspectUuid,
  monotonicUlidFactory,
  nanoid,
  nanoidCollisionHint,
  ulid,
  uuidV4,
  uuidV7,
} from './ids';

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('uuidV4', () => {
  it('RFC 9562 biçiminde, sürüm 4 ve varyant 10xx', () => {
    const ids = Array.from({ length: 200 }, () => uuidV4());
    for (const id of ids) expect(id).toMatch(V4);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('uuidV7', () => {
  it('biçim ve ilk 48 bitte milisaniye zamanı', () => {
    const now = Date.UTC(2026, 9, 29, 11, 5, 0, 123);
    const id = uuidV7(now);
    expect(id).toMatch(V7);
    expect(parseInt(id.replace(/-/g, '').slice(0, 12), 16)).toBe(now);
  });

  it('zamana göre sıralanabilir', () => {
    const a = uuidV7(1_700_000_000_000);
    const b = uuidV7(1_700_000_000_001);
    const c = uuidV7(1_800_000_000_000);
    expect([c, a, b].sort()).toEqual([a, b, c]);
  });

  it('aynı milisaniyede bile benzersiz', () => {
    const ids = Array.from({ length: 100 }, () => uuidV7(1_700_000_000_000));
    expect(new Set(ids).size).toBe(100);
  });
});

describe('inspectUuid', () => {
  it('v4 sürümünü bulur, zaman yok', () => {
    expect(inspectUuid('f47ac10b-58cc-4372-a567-0e02b2c3d479')).toEqual({ version: 4 });
  });

  it('v7 içindeki zamanı çıkarır (gidiş-dönüş)', () => {
    const now = Date.UTC(2026, 9, 29, 11, 5, 0, 123);
    const info = inspectUuid(uuidV7(now));
    expect(info?.version).toBe(7);
    expect(info?.time).toEqual(new Date(now));
  });

  it('RFC 9562 ek A v7 örneği', () => {
    // 017F22E2-79B0-7CC3-98C4-DC0C0C07398F → 2022-02-22T19:22:22.000Z
    const info = inspectUuid('017F22E2-79B0-7CC3-98C4-DC0C0C07398F');
    expect(info?.version).toBe(7);
    expect(info?.time?.toISOString()).toBe('2022-02-22T19:22:22.000Z');
  });

  it('büyük harf ve v1 kabul edilir', () => {
    expect(inspectUuid('C232AB00-9414-11EC-B3C8-9F6BDECED846')?.version).toBe(1);
  });

  it('geçersizse null', () => {
    expect(inspectUuid('merhaba')).toBeNull();
    expect(inspectUuid('f47ac10b-58cc-4372-a567-0e02b2c3d47')).toBeNull();
    expect(inspectUuid('g47ac10b-58cc-4372-a567-0e02b2c3d479')).toBeNull();
    expect(inspectUuid('')).toBeNull();
  });
});

const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

describe('ulid', () => {
  it('26 karakter Crockford Base32, ilk 10 karakter zaman', () => {
    const now = 1469918176385;
    const id = ulid(now);
    expect(id).toMatch(ULID);
    expect(id.slice(0, 10)).toBe('01ARYZ6S41');
    expect(inspectUlid(id)?.time.getTime()).toBe(now);
  });

  it('spec örneklerini çözer', () => {
    // ulid/spec ve ulid/javascript test vektörleri.
    expect(inspectUlid('01ARYZ6S41TSV4RRFFQ69G5FAV')?.time.getTime()).toBe(1469918176385);
    expect(inspectUlid('01arz3ndektsv4rrffq69g5fav')?.time.toISOString()).toBe('2016-07-30T23:54:10.259Z');
    expect(inspectUlid('7ZZZZZZZZZZZZZZZZZZZZZZZZZ')?.time.getTime()).toBe(2 ** 48 - 1);
    expect(inspectUlid('00000000000000000000000000')?.time.getTime()).toBe(0);
  });

  it('geçersiz ULID null', () => {
    expect(inspectUlid('8ZZZZZZZZZZZZZZZZZZZZZZZZZ')).toBeNull(); // 48 biti aşar
    expect(inspectUlid('01ARYZ6S41TSV4RRFFQ69G5FAU')).toBeNull(); // U yok
    expect(inspectUlid('01ARYZ6S41')).toBeNull();
  });

  it('zamana göre sıralanabilir ve benzersiz', () => {
    const a = ulid(1_700_000_000_000);
    const b = ulid(1_700_000_000_001);
    const c = ulid(1_800_000_000_000);
    expect([c, b, a].sort()).toEqual([a, b, c]);
    const ids = Array.from({ length: 500 }, () => ulid(1_700_000_000_000));
    expect(new Set(ids).size).toBe(500);
  });

  it('aralık dışı zaman hata verir', () => {
    expect(() => ulid(-1)).toThrow(ToolError);
    expect(() => ulid(2 ** 48)).toThrow(ToolError);
  });

  it('monoton üreteç aynı milisaniyede artan sırada üretir', () => {
    const next = monotonicUlidFactory();
    const ids = Array.from({ length: 1000 }, () => next(1_700_000_000_000));
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(1000);
    for (const id of ids) expect(inspectUlid(id)?.time.getTime()).toBe(1_700_000_000_000);
    // Saat geri giderse son zaman korunur.
    const back = next(1_600_000_000_000);
    expect(back > ids[999]!).toBe(true);
    expect(next(1_800_000_000_000).startsWith(ulid(1_800_000_000_000).slice(0, 10))).toBe(true);
  });
});

describe('inspectId', () => {
  it('UUID ve ULID ayırt edilir', () => {
    expect(inspectId('f47ac10b-58cc-4372-a567-0e02b2c3d479')).toEqual({ kind: 'uuid', version: 4 });
    expect(inspectId('01ARYZ6S41TSV4RRFFQ69G5FAV')).toEqual({ kind: 'ulid', time: new Date(1469918176385) });
    expect(inspectId('merhaba')).toBeNull();
  });
});

describe('nanoid', () => {
  it('varsayılan: 21 karakter, URL güvenli alfabe', () => {
    const ids = Array.from({ length: 500 }, () => nanoid());
    for (const id of ids) {
      expect(id).toHaveLength(NANOID_DEFAULT_SIZE);
      expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
    }
    expect(new Set(ids).size).toBe(500);
    expect(new Set(NANOID_ALPHABET).size).toBe(64);
  });

  it('özel alfabe ve uzunluk; tüm karakterler kullanılır', () => {
    const id = Array.from({ length: 12 }, () => nanoid(250, 'abc')).join('');
    expect(id).toHaveLength(3000);
    expect(id).toMatch(/^[abc]+$/);
    // Yansızlık için kaba kontrol: her harf ~1000 kez.
    for (const ch of 'abc') {
      const n = id.split(ch).length - 1;
      expect(n).toBeGreaterThan(850);
      expect(n).toBeLessThan(1150);
    }
    expect(nanoid(10, 'çğış')).toMatch(/^[çğış]{10}$/u);
  });

  it('geçersiz seçenekler hata verir', () => {
    expect(() => nanoid(0)).toThrow(ToolError);
    expect(() => nanoid(10, 'a')).toThrow(/2–256/);
    expect(() => nanoid(10, 'abca')).toThrow(/tekrar/);
  });

  it('çakışma ipucu', () => {
    const hint = nanoidCollisionHint(21, 64);
    expect(hint.bits).toBe(126);
    expect(hint.idsForOnePercent).toBeGreaterThan(1e18);
  });
});

describe('formatIdList', () => {
  it('satır, JSON ve CSV', () => {
    expect(formatIdList(['a', 'b'], 'lines')).toBe('a\nb');
    expect(JSON.parse(formatIdList(['a', 'b'], 'json'))).toEqual(['a', 'b']);
    expect(formatIdList(['a', 'b,c', 'd"e'], 'csv', 'ulid')).toBe('ulid\na\n"b,c"\n"d""e"');
  });
});

describe('İngilizce iletiler', () => {
  beforeAll(() => registerCoreMessages('en', { toolsMisc: en }));
  beforeEach(() => setCoreLanguage('en'));
  afterEach(() => setCoreLanguage('tr'));

  it('hata iletileri İngilizce', () => {
    expect(() => nanoid(5, 'a')).toThrow('The alphabet must have 2–256 characters.');
    expect(() => nanoid(5, 'aab')).toThrow('The alphabet has duplicate characters.');
  });
});
