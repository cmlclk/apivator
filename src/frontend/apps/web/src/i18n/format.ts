import { currentLocale } from './locale';

/**
 * Tarih, sayı ve metin biçimleri etkin dile göre tek yerden (doğrudan `'tr-TR'` yazılmaz).
 * Biçimleyiciler dil başına önbelleğe alınır. Bileşenler `useT` ile dile abone olduğundan dil değişince
 * yeniden çizilir ve bu fonksiyonlar yeni dili kullanır.
 */

type DateInput = Date | string | number;

const cache = new Map<string, unknown>();
function cached<T>(kind: string, options: object | undefined, make: (locale: string) => T): T {
  const locale = currentLocale();
  const key = `${kind}|${locale}|${options ? JSON.stringify(options) : ''}`;
  let value = cache.get(key) as T | undefined;
  if (value === undefined) cache.set(key, (value = make(locale)));
  return value;
}

const toDate = (value: DateInput) => (value instanceof Date ? value : new Date(value));

export function dateFormatter(options?: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return cached('date', options, (l) => new Intl.DateTimeFormat(l, options));
}

export function numberFormatter(options?: Intl.NumberFormatOptions): Intl.NumberFormat {
  return cached('number', options, (l) => new Intl.NumberFormat(l, options));
}

/** Seçeneksiz: kısa tarih (ör. 30.10.2026 / 10/30/2026). */
export function formatDate(
  value: DateInput,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'short' },
): string {
  return dateFormatter(options).format(toDate(value));
}

/** Seçeneksiz: tarih ve saat, `toLocaleString()` ile aynı. */
export function formatDateTime(
  value: DateInput,
  options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  },
): string {
  return dateFormatter(options).format(toDate(value));
}

/** 24 saatlik saat (ör. 14:05:09). */
export function formatTime(
  value: DateInput,
  options: Intl.DateTimeFormatOptions = {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  },
): string {
  return dateFormatter(options).format(toDate(value));
}

export function formatNumber(value: number | bigint, options?: Intl.NumberFormatOptions): string {
  return numberFormatter(options).format(value);
}

/** Yüzde; `value` 0–100 aralığında (ör. 99.5 → "%99,5" / "99.5%"). */
export function formatPercent(value: number, maximumFractionDigits = 1): string {
  return numberFormatter({ style: 'percent', maximumFractionDigits }).format(value / 100);
}

const RELATIVE_STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['second', 60],
  ['minute', 60],
  ['hour', 24],
  ['day', 7],
  ['week', 4.34524],
  ['month', 12],
  ['year', Number.POSITIVE_INFINITY],
];

/** "3 saat önce", "dün", "2 gün sonra" gibi göreli zaman. */
export function formatRelativeTime(value: DateInput, now: DateInput = Date.now()): string {
  const format = cached('relative', undefined, (l) => new Intl.RelativeTimeFormat(l, { numeric: 'auto' }));
  let amount = (toDate(value).getTime() - toDate(now).getTime()) / 1000;
  for (const [unit, size] of RELATIVE_STEPS) {
    if (Math.abs(amount) < size) return format.format(Math.round(amount), unit);
    amount /= size;
  }
  return format.format(Math.round(amount), 'year');
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

/** İkili (1024) katlarla bayt boyutu: "512 B", "1,5 KB" / "1.5 KB". */
export function formatBytes(bytes: number, maximumFractionDigits = 1): string {
  let value = bytes;
  let unit = 0;
  while (Math.abs(value) >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${formatNumber(value, { maximumFractionDigits: unit === 0 ? 0 : maximumFractionDigits })} ${BYTE_UNITS[unit]}`;
}

/** "a, b ve c" / "a, b, and c". */
export function formatList(items: readonly string[], type: Intl.ListFormatType = 'conjunction'): string {
  return cached('list', { type }, (l) => new Intl.ListFormat(l, { type })).format(items);
}

/** Etkin dilin büyük/küçük harf kuralı (Türkçede i ↔ İ, ı ↔ I). */
export function toLower(value: string): string {
  return value.toLocaleLowerCase(currentLocale());
}

export function toUpper(value: string): string {
  return value.toLocaleUpperCase(currentLocale());
}

/** Etkin dilin alfabetik sırası (sıralama için `array.sort(compareText)`). */
export function compareText(a: string, b: string): number {
  return cached('collator', undefined, (l) => new Intl.Collator(l, { numeric: true })).compare(a, b);
}
