import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import en from '../locales/en/toolsMisc.json';
import { registerCoreMessages, setCoreLanguage } from '../i18n';
import { ToolError } from './errors';
import { durationBetween, formatDate, parseTimestamp } from './time';

// 2026-10-29T11:05:00Z
const SECONDS = 1793271900;
const DATE = new Date(SECONDS * 1000);

describe('parseTimestamp', () => {
  it('basamak sayısından saniye / milisaniye / mikrosaniye', () => {
    expect(parseTimestamp(String(SECONDS))).toEqual({ date: DATE, source: 'seconds' });
    expect(parseTimestamp(`${SECONDS}123`)).toEqual({
      date: new Date(SECONDS * 1000 + 123),
      source: 'milliseconds',
    });
    expect(parseTimestamp(`${SECONDS}123456`)).toEqual({
      date: new Date(SECONDS * 1000 + 123),
      source: 'microseconds',
    });
  });

  it('ondalıklı saniye ve çevredeki boşluk', () => {
    expect(parseTimestamp(`${SECONDS}.5`)).toEqual({
      date: new Date(SECONDS * 1000 + 500),
      source: 'seconds',
    });
    expect(parseTimestamp(`  ${SECONDS}\n`)?.date).toEqual(DATE);
  });

  it('ISO 8601 (Z, ofsetli, yalnız tarih)', () => {
    expect(parseTimestamp('2026-10-29T11:05:00Z')).toEqual({ date: DATE, source: 'iso' });
    expect(parseTimestamp('2026-10-29T14:05:00+03:00')).toEqual({ date: DATE, source: 'iso' });
    expect(parseTimestamp('2026-10-29T11:05:00.250Z')?.date).toEqual(new Date(SECONDS * 1000 + 250));
    const dateOnly = parseTimestamp('2026-10-29');
    expect(dateOnly?.source).toBe('iso');
    expect(dateOnly?.date.toISOString().slice(0, 10)).toBe('2026-10-29');
  });

  it('timeZone verilirse ofsetsiz ISO o dilimin duvar saati sayılır', () => {
    expect(parseTimestamp('2026-10-29 14:05', 'America/New_York')).toEqual({
      date: new Date('2026-10-29T18:05:00Z'),
      source: 'iso',
      zoned: true,
    });
    expect(parseTimestamp('2026-10-29', 'Europe/Istanbul')?.date).toEqual(new Date('2026-10-28T21:00:00Z'));
    expect(parseTimestamp('2026-10-29T14:05:00', 'UTC')?.date).toEqual(new Date('2026-10-29T14:05:00Z'));
    // Yaz saati geçişinin iki yanında doğru ofset (EST -5 / EDT -4)
    expect(parseTimestamp('2026-11-02 12:00', 'America/New_York')?.date).toEqual(
      new Date('2026-11-02T17:00:00Z'),
    );
    expect(parseTimestamp('2026-03-09 12:00', 'America/New_York')?.date).toEqual(
      new Date('2026-03-09T16:00:00Z'),
    );
  });

  it('timeZone verilse de ofsetli ISO, sayı ve RFC olduğu gibi yorumlanır', () => {
    expect(parseTimestamp('2026-10-29T14:05:00+03:00', 'America/New_York')?.date).toEqual(DATE);
    expect(parseTimestamp('2026-10-29T11:05:00Z', 'Europe/Istanbul')?.date).toEqual(DATE);
    expect(parseTimestamp(String(SECONDS), 'Europe/Istanbul')?.date).toEqual(DATE);
    expect(parseTimestamp('Thu, 29 Oct 2026 11:05:00 GMT', 'America/New_York')?.date).toEqual(DATE);
  });

  it('geçersiz saat diliminde ToolError', () => {
    expect(() => parseTimestamp('2026-10-29 14:05', 'Mars/Olympus')).toThrow(ToolError);
  });

  it('RFC 1123 / 2822', () => {
    expect(parseTimestamp('Thu, 29 Oct 2026 11:05:00 GMT')).toEqual({ date: DATE, source: 'rfc' });
    expect(parseTimestamp('Thu, 29 Oct 2026 14:05:00 +0300')).toEqual({ date: DATE, source: 'rfc' });
  });

  it('tanınmayan girdide null', () => {
    for (const input of ['', '   ', 'merhaba', 'abc123', '12:30', '2026-13-45T99:00:00Z', '1.2.3'])
      expect(parseTimestamp(input), input).toBeNull();
  });
});

describe('formatDate', () => {
  it('UTC biçimleri', () => {
    const f = formatDate(DATE, 'UTC', DATE);
    expect(f.unixSeconds).toBe(SECONDS);
    expect(f.unixMilliseconds).toBe(SECONDS * 1000);
    expect(f.iso).toBe('2026-10-29T11:05:00.000Z');
    expect(f.isoZoned).toMatch(/^2026-10-29T11:05:00(\.000)?(Z|\+00:00)$/);
    expect(f.rfc1123).toBe('Thu, 29 Oct 2026 11:05:00 GMT');
  });

  it('Europe/Istanbul ofseti ve Türkçe yerel metin', () => {
    const f = formatDate(DATE, 'Europe/Istanbul', DATE);
    expect(f.isoZoned).toMatch(/^2026-10-29T14:05:00(\.000)?\+03:00$/);
    expect(f.rfc1123).toBe('Thu, 29 Oct 2026 11:05:00 GMT');
    expect(f.iso).toBe('2026-10-29T11:05:00.000Z');
    expect(f.local).toContain('14:05');
    expect(f.local).toMatch(/Ekim|29\.10\.2026/);
  });

  it('negatif ofsetli saat dilimi', () => {
    // New York 29 Ekim 2026'da EDT (UTC-4)
    expect(formatDate(DATE, 'America/New_York', DATE).isoZoned).toMatch(
      /^2026-10-29T07:05:00(\.000)?-04:00$/,
    );
  });

  it('göreli zaman sabit now ile', () => {
    const later = new Date(DATE.getTime() + 3 * 3600_000);
    expect(formatDate(DATE, 'UTC', later).relative).toBe('3 saat önce');
    const earlier = new Date(DATE.getTime() - 3 * 86_400_000);
    expect(formatDate(DATE, 'UTC', earlier).relative).toBe('3 gün sonra');
  });
});

describe('durationBetween', () => {
  const a = new Date(0);
  const b = new Date(((2 * 24 + 3) * 3600 + 5 * 60 + 7) * 1000);

  it('bileşenler ve metin', () => {
    const d = durationBetween(a, b);
    expect(d).toMatchObject({ totalSeconds: 183907, days: 2, hours: 3, minutes: 5, seconds: 7 });
    expect(d.text).toContain('2 gün 3 saat 5 dakika');
  });

  it('a > b ise negatif', () => {
    const d = durationBetween(b, a);
    expect(d.totalSeconds).toBe(-183907);
    expect(Math.abs(d.days)).toBe(2);
    expect(Math.abs(d.hours)).toBe(3);
  });

  it('eşit tarihlerde sıfır', () => {
    expect(durationBetween(a, a)).toMatchObject({
      totalSeconds: 0,
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
    });
  });
});

describe('İngilizce iletiler', () => {
  beforeAll(() => registerCoreMessages('en', { toolsMisc: en }));
  beforeEach(() => setCoreLanguage('en'));
  afterEach(() => setCoreLanguage('tr'));

  it('süre, göreli zaman ve hatalar İngilizce', () => {
    expect(durationBetween(new Date(0), new Date(((2 * 24 + 3) * 3600 + 300) * 1000)).text).toBe('2d 3h 5m');
    expect(durationBetween(new Date(0), new Date(0)).text).toBe('0s');
    const f = formatDate(
      new Date('2026-10-29T11:05:00Z'),
      'Europe/Istanbul',
      new Date('2026-10-29T14:05:00Z'),
    );
    expect(f.relative).toBe('3 hours ago');
    expect(f.local).toContain('October');
    expect(() => formatDate(new Date(NaN), 'UTC')).toThrow('Invalid date.');
    expect(() => formatDate(new Date(), 'Nope/Zone')).toThrow('Invalid time zone: Nope/Zone');
  });
});
