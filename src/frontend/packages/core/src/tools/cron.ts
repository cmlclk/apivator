import { msg } from '../i18n';
import { ToolError } from './errors';
import { cronDayMatches, parseCron, type ParsedCron } from './cronParse';

export * from './cronParse';
export * from './cronDescribe';

const MINUTE = 60_000;
const DAY = 86_400_000;
/** Bu kadar yıl hiç eşleşme yoksa aramayı bırak (`0 0 29 2 1` gibi ifadeler 40 yıl atlayabilir). */
const MAX_GAP_YEARS = 100;
const MAX_RUNS = 1000;

const formatters = new Map<string, Intl.DateTimeFormat>();

function zoneFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
      });
    } catch {
      throw new ToolError(msg('cron.error.timeZone', 'Geçersiz saat dilimi: {timeZone}', { timeZone }));
    }
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Dilimin duvar saati, UTC milisaniyesi gibi kodlanmış (dakika hassasiyetinde). */
function wallMs(ms: number, timeZone: string): number {
  const parts: Record<string, number> = {};
  for (const p of zoneFormatter(timeZone).formatToParts(new Date(ms))) parts[p.type] = Number(p.value);
  return Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!);
}

/** Dilimin `ms` anındaki UTC ofseti (dakika). */
function offsetAt(ms: number, timeZone: string): number {
  const floored = Math.floor(ms / MINUTE) * MINUTE;
  return Math.round((wallMs(floored, timeZone) - floored) / MINUTE);
}

/**
 * Duvar saatinin (UTC gibi kodlanmış) gerçek anları. Yaz saatine geçişte atlanan saat geçişin bittiği
 * ana kayar (Cronos gibi); geri alındığında tekrarlanan saat `interval` ifadelerde iki kez, diğerlerinde
 * yalnız ilk geçişte çalışır.
 */
function instantsFor(
  wall: number,
  before: number,
  after: number,
  interval: boolean,
  timeZone: string,
): number[] {
  if (before === after) return [wall - before * MINUTE];
  const valid = [...new Set([before, after])]
    .map((offset) => wall - offset * MINUTE)
    .filter((ms) => offsetAt(ms, timeZone) === Math.round((wall - ms) / MINUTE))
    .sort((a, b) => a - b);
  if (valid.length === 0) {
    // Atlanan saat: yeni ofsetin başladığı ilk dakikayı ikili aramayla bul.
    let lo = wall - Math.max(before, after) * MINUTE;
    let hi = wall - Math.min(before, after) * MINUTE;
    const target = offsetAt(hi, timeZone);
    while (hi - lo > MINUTE) {
      const mid = lo + Math.floor((hi - lo) / 2 / MINUTE) * MINUTE;
      if (offsetAt(mid, timeZone) === target) hi = mid;
      else lo = mid;
    }
    return [hi];
  }
  return interval ? valid : valid.slice(0, 1);
}

/**
 * `from`'dan sonraki (dahil değil) en fazla `count` çalıştırma anı; ifade IANA saat diliminin duvar
 * saatine göre değerlendirilir. Hiç çalışmayan ifade (`0 0 30 2 *`) boş liste döndürür.
 */
export function nextRuns(
  expression: string | ParsedCron,
  from: Date,
  count: number,
  timeZone: string,
): Date[] {
  const cron = typeof expression === 'string' ? parseCron(expression) : expression;
  const start = from.getTime();
  if (Number.isNaN(start)) throw new ToolError(msg('cron.error.startDate', 'Geçersiz başlangıç tarihi.'));
  const limit = Math.max(0, Math.min(MAX_RUNS, Math.floor(count)));
  const runs: number[] = [];
  if (limit === 0) return [];

  const months = new Set(cron.month.values);
  const times: number[] = [];
  for (const h of cron.hour.values) for (const m of cron.minute.values) times.push((h * 60 + m) * MINUTE);

  // Geri alınan saat aynı günü uzattığı için bir gün geriden başla.
  let day = Math.floor(wallMs(start, timeZone) / DAY) * DAY - DAY;
  let lastHit = day;
  while (runs.length < limit && day - lastHit <= MAX_GAP_YEARS * 366 * DAY) {
    const date = new Date(day);
    const year = date.getUTCFullYear();
    if (year > 9999) break;
    const month = date.getUTCMonth() + 1;
    if (!months.has(month)) {
      day = Date.UTC(year, month, 1);
      continue;
    }
    if (cronDayMatches(cron, year, month, date.getUTCDate())) {
      const before = offsetAt(day - DAY, timeZone);
      const after = offsetAt(day + 2 * DAY, timeZone);
      const found = new Set<number>();
      for (const time of times) {
        for (const ms of instantsFor(day + time, before, after, cron.interval, timeZone)) {
          if (ms > start) found.add(ms);
        }
      }
      if (found.size) lastHit = day;
      for (const ms of [...found].sort((a, b) => a - b)) {
        if (runs.length >= limit) break;
        if (!runs.length || ms > runs[runs.length - 1]!) runs.push(ms);
      }
    }
    day += DAY;
  }
  return runs.map((ms) => new Date(ms));
}
