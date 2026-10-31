import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import en from '../locales/en/cron.json';
import { registerCoreMessages, setCoreLanguage } from '../i18n';
import { ToolError } from './errors';
import {
  CRON_FIELD_KEYS,
  cronFieldSummary,
  cronWeekdayNames,
  describeCron,
  nextRuns,
  parseCron,
} from './cron';
import { formatDate } from './time';

/** Beklenen değerler sunucudaki Cronos 0.13 (`CronFormat.Standard`) çıktısından alındı. */
function runs(expr: string, zone: string, from: string, count: number): string[] {
  return nextRuns(expr, new Date(from), count, zone).map((d) => formatDate(d, zone).isoZoned);
}

const UTC_FROM = '2026-10-29T00:00Z';
const u = (date: string) => `${date}T00:00:00+00:00`;

describe('nextRuns — temel sözdizimi', () => {
  it.each([
    ['5/15 * * * *', ['2026-10-29T00:05:00+00:00', '2026-10-29T00:20:00+00:00', '2026-10-29T00:35:00+00:00']],
    [
      '50-10/5 * * * *',
      ['2026-10-29T00:05:00+00:00', '2026-10-29T00:10:00+00:00', '2026-10-29T00:50:00+00:00'],
    ],
    ['0 */23 * * *', ['2026-10-29T23:00:00+00:00', u('2026-10-30'), '2026-10-30T23:00:00+00:00']],
    ['0 0 * * 7', [u('2026-11-01'), u('2026-11-08')]],
    ['0 0 * * sun', [u('2026-11-01'), u('2026-11-08')]],
    [
      '0 0 * * FRI-MON',
      [u('2026-10-30'), u('2026-10-31'), u('2026-11-01'), u('2026-11-02'), u('2026-11-06')],
    ],
    ['0 0 * * 7-1', [u('2026-11-01'), u('2026-11-02'), u('2026-11-08')]],
    ['0 0 * * */2', [u('2026-10-31'), u('2026-11-01'), u('2026-11-03')]],
    ['0 0 * * 5/2', [u('2026-10-30'), u('2026-11-01'), u('2026-11-06')]],
    ['0 0 * * mon-fri/2', [u('2026-10-30'), u('2026-11-02'), u('2026-11-04')]],
    ['0 0 1 jan-mar *', [u('2027-01-01'), u('2027-02-01'), u('2027-03-01')]],
    ['0 0 1 nov-feb/2 *', [u('2026-11-01'), u('2027-01-01'), u('2027-11-01')]],
    ['0 0 * 1/5 *', [u('2026-11-01'), u('2026-11-02')]],
    ['0 0 ?/2 * *', [u('2026-10-31'), u('2026-11-01')]],
    ['? 0 * * *', ['2026-10-29T00:01:00+00:00']],
    ['00 09 * * *', ['2026-10-29T09:00:00+00:00']],
    ['@yearly', [u('2027-01-01')]],
    ['@Daily', [u('2026-10-30')]],
    ['@weekly', [u('2026-11-01')]],
    ['@hourly', ['2026-10-29T01:00:00+00:00']],
    ['@every_minute', ['2026-10-29T00:01:00+00:00']],
  ])('%s', (expr, expected) => {
    expect(runs(expr, 'UTC', UTC_FROM, expected.length)).toEqual(expected);
  });

  it('başlangıç anı dahil değildir', () => {
    expect(runs('0 0 * * *', 'UTC', '2026-10-29T00:00:00Z', 1)).toEqual([u('2026-10-30')]);
  });
});

describe('nextRuns — gün kuralları', () => {
  it.each([
    // Cronos ayın günü ile haftanın gününü VE ile birleştirir (Vixie cron'daki VEYA değil).
    ['0 0 1 * 1', [u('2027-02-01'), u('2027-03-01'), u('2027-11-01')]],
    ['0 0 1-7 * 1', [u('2026-11-02'), u('2026-12-07'), u('2027-01-04')]],
    ['0 0 L * 1', [u('2026-11-30'), u('2027-05-31'), u('2028-01-31')]],
    ['0 0 L * *', [u('2026-10-31'), u('2026-11-30'), u('2026-12-31')]],
    ['0 0 L-2 * *', [u('2026-11-28'), u('2026-12-29'), u('2027-01-29')]],
    ['0 0 L-30 * *', [u('2026-12-01')]],
    ['0 0 LW * *', [u('2026-10-30'), u('2026-11-30'), u('2026-12-31')]],
    ['0 0 L-3W * *', [u('2026-11-27'), u('2026-12-28')]],
    ['0 0 15W * *', [u('2026-11-16'), u('2026-12-15'), u('2027-01-15')]],
    ['0 0 1W * *', [u('2026-11-02'), u('2026-12-01'), u('2027-01-01')]],
    ['0 0 31W * *', [u('2026-10-30'), u('2026-12-31'), u('2027-01-29')]],
    ['0 0 * * 5L', [u('2026-10-30'), u('2026-11-27'), u('2026-12-25')]],
    ['0 0 * * 7L', [u('2026-11-29')]],
    ['0 0 * * 5#2', [u('2026-11-13'), u('2026-12-11'), u('2027-01-08')]],
    ['0 0 * * FRI#5', [u('2026-10-30'), u('2027-01-29'), u('2027-04-30')]],
    ['0 0 * * 1#5', [u('2026-11-30'), u('2027-03-29'), u('2027-05-31')]],
    ['0 0 29 2 *', [u('2028-02-29'), u('2032-02-29')]],
    ['0 0 29 2 1', [u('2044-02-29'), u('2072-02-29'), u('2112-02-29')]],
  ])('%s', (expr, expected) => {
    expect(runs(expr, 'UTC', UTC_FROM, expected.length)).toEqual(expected);
  });

  it('hiç çalışmayan ifade boş liste döndürür ve takılmaz', () => {
    const started = performance.now();
    expect(nextRuns('0 0 30 2 *', new Date(UTC_FROM), 5, 'UTC')).toEqual([]);
    expect(nextRuns('0 0 31 4,6,9,11 *', new Date(UTC_FROM), 5, 'UTC')).toEqual([]);
    expect(nextRuns('0 0 1 * 1#5', new Date(UTC_FROM), 5, 'UTC')).toEqual([]);
    expect(performance.now() - started).toBeLessThan(3000);
  });

  it('seyrek ifadeler ve çok sayıda çalıştırma', () => {
    expect(runs('0 0 31 * *', 'UTC', UTC_FROM, 3)).toEqual([
      u('2026-10-31'),
      u('2026-12-31'),
      u('2027-01-31'),
    ]);
    expect(nextRuns('* * * * *', new Date(UTC_FROM), 1000, 'UTC')).toHaveLength(1000);
    expect(nextRuns('0 0 29 2 *', new Date(UTC_FROM), 100, 'UTC')).toHaveLength(100);
    expect(nextRuns('* * * * *', new Date(UTC_FROM), 0, 'UTC')).toEqual([]);
  });
});

describe('nextRuns — saat dilimi ve yaz saati', () => {
  it('Europe/Istanbul (2016’dan beri sabit +03:00)', () => {
    expect(runs('0 9 * * 1-5', 'Europe/Istanbul', '2026-10-29T06:00Z', 3)).toEqual([
      '2026-10-30T09:00:00+03:00',
      '2026-11-02T09:00:00+03:00',
      '2026-11-03T09:00:00+03:00',
    ]);
    expect(runs('0 3 * * *', 'Europe/Istanbul', '2016-09-05T00:00Z', 2)).toEqual([
      '2016-09-06T03:00:00+03:00',
      '2016-09-07T03:00:00+03:00',
    ]);
  });

  it('ileri alınırken atlanan saat geçişin bittiği ana kayar', () => {
    expect(runs('30 2 * * *', 'America/New_York', '2026-03-07T00:00Z', 3)).toEqual([
      '2026-03-07T02:30:00-05:00',
      '2026-03-08T03:00:00-04:00',
      '2026-03-09T02:30:00-04:00',
    ]);
    expect(runs('*/30 * * * *', 'America/New_York', '2026-03-08T06:00Z', 4)).toEqual([
      '2026-03-08T01:30:00-05:00',
      '2026-03-08T03:00:00-04:00',
      '2026-03-08T03:30:00-04:00',
      '2026-03-08T04:00:00-04:00',
    ]);
    expect(runs('*/30 2 * * *', 'America/New_York', '2026-03-08T05:00Z', 3)).toEqual([
      '2026-03-08T03:00:00-04:00',
      '2026-03-09T02:00:00-04:00',
      '2026-03-09T02:30:00-04:00',
    ]);
    expect(runs('0 2 * * *', 'Europe/Berlin', '2026-03-28T00:00Z', 3)).toEqual([
      '2026-03-28T02:00:00+01:00',
      '2026-03-29T03:00:00+02:00',
      '2026-03-30T02:00:00+02:00',
    ]);
    expect(runs('*/20 * * * *', 'Europe/Berlin', '2026-03-29T00:30Z', 3)).toEqual([
      '2026-03-29T01:40:00+01:00',
      '2026-03-29T03:00:00+02:00',
      '2026-03-29T03:20:00+02:00',
    ]);
    // 30 dakikalık yaz saati farkı.
    expect(runs('30 2 * * *', 'Australia/Lord_Howe', '2026-10-03T00:00Z', 2)).toEqual([
      '2026-10-04T02:30:00+11:00',
      '2026-10-05T02:30:00+11:00',
    ]);
  });

  it('geri alınırken tekrarlanan saat: tek değerler bir, aralık/adım/yıldız iki kez', () => {
    expect(runs('30 1 * * *', 'America/New_York', '2026-10-31T12:00Z', 2)).toEqual([
      '2026-11-01T01:30:00-04:00',
      '2026-11-02T01:30:00-05:00',
    ]);
    expect(runs('0,30 1 * * *', 'America/New_York', '2026-11-01T04:00Z', 3)).toEqual([
      '2026-11-01T01:00:00-04:00',
      '2026-11-01T01:30:00-04:00',
      '2026-11-02T01:00:00-05:00',
    ]);
    expect(runs('*/30 1 * * *', 'America/New_York', '2026-11-01T04:00Z', 5)).toEqual([
      '2026-11-01T01:00:00-04:00',
      '2026-11-01T01:30:00-04:00',
      '2026-11-01T01:00:00-05:00',
      '2026-11-01T01:30:00-05:00',
      '2026-11-02T01:00:00-05:00',
    ]);
    expect(runs('0 1-2 * * *', 'America/New_York', '2026-11-01T04:00Z', 4)).toEqual([
      '2026-11-01T01:00:00-04:00',
      '2026-11-01T01:00:00-05:00',
      '2026-11-01T02:00:00-05:00',
      '2026-11-02T01:00:00-05:00',
    ]);
    expect(runs('0 22-2 * * *', 'America/New_York', '2026-11-01T01:00Z', 6)).toEqual([
      '2026-10-31T22:00:00-04:00',
      '2026-10-31T23:00:00-04:00',
      '2026-11-01T00:00:00-04:00',
      '2026-11-01T01:00:00-04:00',
      '2026-11-01T01:00:00-05:00',
      '2026-11-01T02:00:00-05:00',
    ]);
    expect(runs('*/15 2 * * *', 'Europe/Berlin', '2026-10-25T00:00Z', 5)).toEqual([
      '2026-10-25T02:15:00+02:00',
      '2026-10-25T02:30:00+02:00',
      '2026-10-25T02:45:00+02:00',
      '2026-10-25T02:00:00+01:00',
      '2026-10-25T02:15:00+01:00',
    ]);
    // İlk geçiş kaçırıldıysa tek değerli ifade ikinci geçişte çalışmaz.
    expect(runs('30 1 * * *', 'America/New_York', '2026-11-01T05:45Z', 1)).toEqual([
      '2026-11-02T01:30:00-05:00',
    ]);
    expect(runs('*/5 1 * * *', 'America/New_York', '2026-11-01T05:52Z', 3)).toEqual([
      '2026-11-01T01:55:00-04:00',
      '2026-11-01T01:00:00-05:00',
      '2026-11-01T01:05:00-05:00',
    ]);
  });

  it('geçersiz saat dilimi ve tarih ToolError', () => {
    expect(() => nextRuns('* * * * *', new Date(), 1, 'Mars/Olympus')).toThrow(ToolError);
    expect(() => nextRuns('* * * * *', new Date(NaN), 1, 'UTC')).toThrow(ToolError);
  });
});

describe('describeCron', () => {
  it.each([
    ['* * * * *', 'Her dakika'],
    ['*/15 * * * *', 'Her 15 dakikada bir'],
    ['0 * * * *', 'Her saat başı'],
    ['5 * * * *', 'Her saatin 5. dakikasında'],
    ['0,15,30,45 * * * *', 'Her saatin 0., 15., 30. ve 45. dakikalarında'],
    ['10-20 * * * *', 'Her saatin 10–20. dakikaları arasında her dakika'],
    ['0 */6 * * *', 'Her 6 saatte bir'],
    ['0 9 * * *', "Her gün 09:00'da"],
    ['15 12 * * *', "Her gün 12:15'te"],
    ['40 13 * * *', "Her gün 13:40'ta"],
    ['0 9,12,18 * * *', "Her gün 09:00, 12:00 ve 18:00'de"],
    ['0 9 * * 1-5', "Hafta içi her gün 09:00'da"],
    ['0,30 9 * * 6,0', "Hafta sonu her gün 09:00 ve 09:30'da"],
    ['0 12 * * 3', "Her Çarşamba 12:00'de"],
    ['0 9 * * 5-1', "Pazartesi, Cuma, Cumartesi ve Pazar günleri 09:00'da"],
    ['*/15 9-17 * * 1-5', 'Hafta içi her gün, 09:00–17:59 arasında her 15 dakikada bir'],
    ['*/5 9 * * *', '09:00–09:59 arasında her 5 dakikada bir'],
    ['*/10 9-11,17 * * *', '09:00–11:59 ve 17:00–17:59 arasında her 10 dakikada bir'],
    ['*/5 1,3,5,7 * * *', '01, 03, 05 ve 07 saatlerinde her 5 dakikada bir'],
    ['0 0 1,15 * *', "Her ayın 1. ve 15. günü 00:00'da"],
    ['30 18 L 1,7 *', "Ocak ve Temmuz'da, ayın son günü 18:30'da"],
    ['0 0 * 3-9 *', "Mart–Eylül arasında, her gün 00:00'da"],
    ['0 0 * * 5L', "Ayın son Cuma günü 00:00'da"],
    ['0 12 * * 1#2', "Ayın 2. Pazartesi günü 12:00'de"],
    ['0 0 LW * *', "Her ayın son hafta içi günü 00:00'da"],
    ['0 0 15W * *', "Her ayın 15. gününe en yakın hafta içi gün 00:00'da"],
    ['0 0 1 * 1', "Her ayın 1. günü (yalnız Pazartesi ise) 00:00'da"],
    ['@yearly', "Her yıl 1 Ocak 00:00'da"],
    ['0 0 29 2 *', "Her yıl 29 Şubat 00:00'da"],
    ['@weekly', "Her Pazar 00:00'da"],
    ['@monthly', "Her ayın 1. günü 00:00'da"],
  ])('%s → %s', (expr, text) => {
    expect(describeCron(expr)).toBe(text);
  });
});

describe('parseCron', () => {
  it('alanları açar ve okunur özet verir', () => {
    const cron = parseCron('  */20  9-17 L-2 jan,jul mon-fri ');
    expect(cron.expression).toBe('*/20 9-17 L-2 jan,jul mon-fri');
    expect(cron.minute.values).toEqual([0, 20, 40]);
    expect(cron.dayOfWeek.values).toEqual([1, 2, 3, 4, 5]);
    expect(cron.interval).toBe(true);
    expect(CRON_FIELD_KEYS.map((k) => cronFieldSummary(cron[k]))).toEqual([
      '0, 20, 40',
      '9–17',
      'son günden 2 gün önce',
      'Ocak, Temmuz',
      'Pazartesi–Cuma',
    ]);
    expect(cronFieldSummary(parseCron('* * * * *').month)).toBe('her değer (Ocak–Aralık)');
    expect(parseCron('0,30 1 * * *').interval).toBe(false);
    expect(parseCron('@daily').macro).toBe('@daily');
  });

  it.each([
    ['', 'Cron ifadesi boş.'],
    ['* * * *', '5 alandan oluşmalı'],
    ['* * * * * *', '6 alan var'],
    ['60 * * * *', "Dakika alanında hata (1. karakter): '60' 0–59 aralığında olmalı."],
    ['007 * * * *', 'Dakika alanında hata (1. karakter)'],
    ['*/0 * * * *', 'Dakika alanında hata (3. karakter): adım 1–59'],
    ['0 */24 * * *', 'Saat alanında hata (5. karakter): adım 1–23'],
    ['0 0 0 * *', 'Ayın günü alanında hata (5. karakter)'],
    ['0 0 1 13 *', 'Ay alanında hata (7. karakter)'],
    ['0 0 * * SUNDAY', "Haftanın günü alanında hata (9. karakter): 'SUNDAY' geçerli bir değer değil"],
    ['0 0 * * 8', 'Haftanın günü alanında hata'],
    ['*,5 * * * *', "Dakika alanında hata (2. karakter): beklenmeyen karakter ','."],
    ['5,* * * * *', "Dakika alanında hata (3. karakter): '*' listede kullanılamaz"],
    ['5-10-15 * * * *', "beklenmeyen karakter '-'"],
    ['5/10/2 * * * *', "beklenmeyen karakter '/'"],
    ['1- * * * *', 'Dakika alanında hata (3. karakter): değer eksik'],
    ['0 0 L,1 * *', 'Ayın günü alanında hata (5. karakter)'],
    ['0 0 L-31 * *', "'L-' sonrası 0–30"],
    ['0 0 32W * *', "'32' 1–31 aralığında olmalı."],
    ['0 0 * * 1#6', "Haftanın günü alanında hata (11. karakter): '#' sonrası 1–5"],
    ['0 0 * * 1,5L', 'Haftanın günü alanında hata'],
    ['0 0 * L *', 'Ay alanında hata'],
    ['@reboot', 'Bilinmeyen makro: @reboot'],
  ])('%j → hata', (expr, message) => {
    expect(() => parseCron(expr)).toThrow(ToolError);
    expect(() => parseCron(expr)).toThrow(message);
  });
});

describe('İngilizce cron açıklaması', () => {
  beforeAll(() => registerCoreMessages('en', { cron: en }));
  beforeEach(() => setCoreLanguage('en'));
  afterEach(() => setCoreLanguage('tr'));

  it.each([
    ['* * * * *', 'Every minute'],
    ['*/5 * * * *', 'Every 5 minutes'],
    ['0 9 * * *', 'Every day at 09:00'],
    ['0,30 9,18 * * *', 'Every day at 09:00, 09:30, 18:00 and 18:30'],
    ['0 9 * * 1-5', 'Every weekday at 09:00'],
    ['0 9 * * 1,5', 'On Monday and Friday at 09:00'],
    ['0 0 1 1 *', 'Every year on January 1st at 00:00'],
    ['0 18 L 1,7 *', 'In January and July, on the last day of the month at 18:00'],
    ['0 0 * * 5L', 'On the last Friday of the month at 00:00'],
    ['0 0 * * 1#2', 'On the 2nd Monday of the month at 00:00'],
    ['*/15 9-17 * * *', 'Every 15 minutes between 09:00 and 17:59'],
    ['*/5 9 * * *', 'Every 5 minutes between 09:00 and 09:59'],
    ['*/10 9-11,17 * * *', 'Every 10 minutes during 09:00–11:59 and 17:00–17:59'],
    ['0 */2 * * *', 'Every 2 hours'],
  ])('%s → %s', (expr, text) => {
    expect(describeCron(expr)).toBe(text);
  });

  it('alan özeti, hata iletileri ve ay/gün adları İngilizce', () => {
    expect(cronFieldSummary(parseCron('0 0 * 1-3 *').month)).toBe('January–March');
    expect(cronFieldSummary(parseCron('0 0 * * *').dayOfWeek)).toBe('every value (Sunday–Saturday)');
    expect(cronFieldSummary(parseCron('0 0 * * 2#3').dayOfWeek)).toBe('3rd Tuesday of the month');
    expect(() => parseCron('')).toThrow('The cron expression is empty.');
    expect(() => parseCron('61 * * * *')).toThrow(
      "Minute field (character 1): '61' must be in the range 0–59.",
    );
    expect(cronWeekdayNames()[1]).toBe('Monday');
  });
});
