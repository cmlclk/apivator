import { coreLocale, msg } from '../i18n';
import { ToolError } from './errors';

export interface ParsedTimestamp {
  date: Date;
  /** Girdinin nasıl yorumlandığı. */
  source: 'seconds' | 'milliseconds' | 'microseconds' | 'iso' | 'rfc';
  /** Ofsetsiz ISO girdi verilen saat diliminde yorumlandıysa true. */
  zoned?: boolean;
}

const NUMERIC = /^-?\d+(\.\d+)?$/;
const ISO_START = /^[+-]?\d{4,6}-\d{2}(-\d{2})?([T ]|$)/;
/** Saat kısmından sonra `Z` ya da `±hh[:mm]` ofseti var mı. */
const ISO_OFFSET = /T\d.*(Z|[+-]\d{2}(:?\d{2})?)$/i;
const MONTH_NAME = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i;

/**
 * Unix zaman damgası (saniye/milisaniye/mikrosaniye basamak sayısından otomatik; ondalıklı saniye dahil),
 * ISO 8601 ya da RFC 1123/2822 tarih. Tanınmazsa null.
 * Ofsetsiz ISO girdi (`2026-10-29 14:05`, `2026-10-29`) `timeZone` verilirse o dilimin duvar saati olarak,
 * verilmezse JavaScript kuralıyla (tarih-saat yerel, yalnız tarih UTC) yorumlanır. Geçersiz dilimde ToolError.
 */
export function parseTimestamp(input: string, timeZone?: string): ParsedTimestamp | null {
  const text = input.trim();
  if (!text) return null;
  if (NUMERIC.test(text)) {
    const value = Number(text);
    // Tam kısmın basamak sayısı birimi belirler: ≤11 saniye, ≤14 milisaniye, ≤17 mikrosaniye.
    const digits = text
      .replace(/^-/, '')
      .split('.')[0]!
      .replace(/^0+(?=\d)/, '').length;
    if (digits <= 11) return valid(value * 1000, 'seconds');
    if (digits <= 14) return valid(value, 'milliseconds');
    if (digits <= 17) return valid(value / 1000, 'microseconds');
    return null;
  }
  if (ISO_START.test(text)) {
    // "2026-10-29 14:05" gibi boşluklu yazımı da kabul et.
    const normalized = text.replace(/^(\S+) (\d)/, '$1T$2');
    if (!timeZone || ISO_OFFSET.test(normalized)) return valid(Date.parse(normalized), 'iso');
    const wallAsUtc = Date.parse(normalized.includes('T') ? `${normalized}Z` : `${normalized}T00:00Z`);
    if (Number.isNaN(wallAsUtc)) return null;
    // Ofset hedef anda farklı olabilir (yaz saati geçişi); bulunan anın ofsetiyle bir kez düzelt.
    const first = wallAsUtc - zoneOffsetMinutes(wallAsUtc, timeZone) * 60000;
    const parsed = valid(wallAsUtc - zoneOffsetMinutes(first, timeZone) * 60000, 'iso');
    return parsed && { ...parsed, zoned: true };
  }
  if (MONTH_NAME.test(text) && /\d{1,2}/.test(text)) return valid(Date.parse(text), 'rfc');
  return null;
}

function valid(ms: number, source: ParsedTimestamp['source']): ParsedTimestamp | null {
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : { date, source };
}

export interface FormattedDate {
  unixSeconds: number;
  unixMilliseconds: number;
  /** UTC, `Z` ile. */
  iso: string;
  /** Seçilen saat diliminde ofsetli ISO 8601 (`2026-10-29T14:05:00+03:00`). */
  isoZoned: string;
  /** RFC 1123 (HTTP tarih biçimi), her zaman GMT. */
  rfc1123: string;
  /** Seçilen saat diliminde, etkin dilde okunur tarih. */
  local: string;
  /** "3 saat önce", "2 gün sonra" (Intl.RelativeTimeFormat, etkin dil). */
  relative: string;
}

export function formatDate(date: Date, timeZone: string, now: Date = new Date()): FormattedDate {
  const ms = date.getTime();
  if (Number.isNaN(ms)) throw new ToolError(msg('toolsMisc.time.invalidDate', 'Geçersiz tarih.'));
  const parts = zoneParts(date, timeZone);
  let local: string;
  try {
    local = cachedFormatter(
      `local|${coreLocale()}`,
      timeZone,
      () => new Intl.DateTimeFormat(coreLocale(), { timeZone, dateStyle: 'full', timeStyle: 'long' }),
    ).format(date);
  } catch {
    throw invalidZone(timeZone);
  }
  return {
    unixSeconds: Math.floor(ms / 1000),
    unixMilliseconds: ms,
    iso: date.toISOString(),
    isoZoned: zonedIso(ms, parts),
    rfc1123: date.toUTCString(),
    local,
    relative: relativeText(ms - now.getTime()),
  };
}

/** Intl biçimleyicilerini kurmak pahalı; dilim başına bir kez kurulur (cron aracı satır başına çağırır). */
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function cachedFormatter(
  kind: string,
  timeZone: string,
  create: () => Intl.DateTimeFormat,
): Intl.DateTimeFormat {
  const key = `${kind}|${timeZone}`;
  let formatter = formatterCache.get(key);
  if (!formatter) {
    formatter = create();
    formatterCache.set(key, formatter);
  }
  return formatter;
}

function zoneParts(date: Date, timeZone: string): Record<string, string> {
  try {
    const formatter = cachedFormatter(
      'parts',
      timeZone,
      () =>
        new Intl.DateTimeFormat('en-US', {
          timeZone,
          hourCycle: 'h23',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          era: 'short',
        }),
    );
    return Object.fromEntries(formatter.formatToParts(date).map((p) => [p.type, p.value]));
  } catch {
    throw invalidZone(timeZone);
  }
}

const invalidZone = (timeZone: string) =>
  new ToolError(msg('toolsMisc.time.invalidTimeZone', 'Geçersiz saat dilimi: {timeZone}', { timeZone }));

function wallFields(parts: Record<string, string>) {
  const bc = parts.era === 'BC' || parts.era === 'B';
  const [month, day, hour, minute, second] = ['month', 'day', 'hour', 'minute', 'second'].map((k) =>
    Number(parts[k]),
  ) as [number, number, number, number, number];
  return { year: bc ? 1 - Number(parts.year) : Number(parts.year), month, day, hour, minute, second };
}

/** Duvar saati ile UTC arasındaki fark (dakika); `ms` saniye altı kısmı yok sayılır. */
function offsetOf(ms: number, parts: Record<string, string>): number {
  const { year, month, day, hour, minute, second } = wallFields(parts);
  const wall = new Date(0);
  wall.setUTCFullYear(year, month - 1, day);
  wall.setUTCHours(hour, minute, second, 0);
  const millis = ((ms % 1000) + 1000) % 1000;
  return Math.round((wall.getTime() - (ms - millis)) / 60000);
}

/** Dilimin verilen andaki UTC ofseti (dakika). */
function zoneOffsetMinutes(ms: number, timeZone: string): number {
  return offsetOf(ms, zoneParts(new Date(ms), timeZone));
}

function zonedIso(ms: number, parts: Record<string, string>): string {
  const { year, month, day, hour, minute, second } = wallFields(parts);
  const millis = ((ms % 1000) + 1000) % 1000;
  const offsetMinutes = offsetOf(ms, parts);
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  const yearText =
    year >= 0 && year <= 9999 ? pad(year, 4) : `${year < 0 ? '-' : '+'}${pad(Math.abs(year), 6)}`;
  const fraction = millis ? `.${pad(millis, 3)}` : '';
  return (
    `${yearText}-${pad(month, 2)}-${pad(day, 2)}T${pad(hour, 2)}:${pad(minute, 2)}:${pad(second, 2)}` +
    `${fraction}${sign}${pad(Math.floor(abs / 60), 2)}:${pad(abs % 60, 2)}`
  );
}

function pad(value: number, length: number): string {
  return String(value).padStart(length, '0');
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 86400],
  ['month', 30 * 86400],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
];

const relativeFormats = new Map<string, Intl.RelativeTimeFormat>();

function relativeText(diffMs: number): string {
  const locale = coreLocale();
  let rtf = relativeFormats.get(locale);
  if (!rtf) relativeFormats.set(locale, (rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })));
  const seconds = diffMs / 1000;
  for (const [unit, size] of RELATIVE_UNITS) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.trunc(seconds / size), unit);
  }
  return rtf.format(Math.trunc(seconds), 'second');
}

export interface Duration {
  /** `b - a`; `a` > `b` ise negatif. */
  totalSeconds: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  /** "2 gün 3 saat 5 dakika" */
  text: string;
}

/** Bileşenler (gün/saat/dakika/saniye) her zaman pozitiftir; yön `totalSeconds` işaretinde ve metindeki "-" önekindedir. */
export function durationBetween(a: Date, b: Date): Duration {
  const diff = b.getTime() - a.getTime();
  if (Number.isNaN(diff)) throw new ToolError(msg('toolsMisc.time.invalidDate', 'Geçersiz tarih.'));
  const totalSeconds = Math.trunc(diff / 1000) || 0;
  let rest = Math.abs(totalSeconds);
  const days = Math.floor(rest / 86400);
  rest -= days * 86400;
  const hours = Math.floor(rest / 3600);
  rest -= hours * 3600;
  const minutes = Math.floor(rest / 60);
  const seconds = rest - minutes * 60;
  const pieces = [
    days && msg('toolsMisc.time.days', '{n} gün', { n: String(days) }),
    hours && msg('toolsMisc.time.hours', '{n} saat', { n: hours }),
    minutes && msg('toolsMisc.time.minutes', '{n} dakika', { n: minutes }),
    seconds && msg('toolsMisc.time.seconds', '{n} saniye', { n: seconds }),
  ].filter(Boolean);
  const text = pieces.length
    ? `${totalSeconds < 0 ? '-' : ''}${pieces.join(' ')}`
    : msg('toolsMisc.time.zeroSeconds', '0 saniye');
  return { totalSeconds, days, hours, minutes, seconds, text };
}
