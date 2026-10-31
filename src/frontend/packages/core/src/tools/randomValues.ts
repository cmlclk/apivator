import { msg } from '../i18n';
import { ToolError } from './errors';
import { formatDate } from './time';

/** Aralıkta rastgele sayı ve tarih listeleri (crypto.getRandomValues, yansız reddetmeli örnekleme). */

export const RANDOM_MAX_COUNT = 10000;
export const RANDOM_MAX_PRECISION = 10;

export type RandomSort = 'none' | 'asc' | 'desc';

interface ListOptions {
  count: number;
  /** Tekrarsız; aralık yetmezse hata. */
  unique?: boolean;
  sort?: RandomSort;
}

/** [0, span) aralığında yansız bigint: span'ı kapsayan en küçük bit sayısı kadar rastgele bit, taşan atılır. */
function uniformBelow(span: bigint): bigint {
  const bits = (span - 1n).toString(2).length;
  const words = Math.ceil(bits / 32);
  const mask = (1n << BigInt(bits)) - 1n;
  const buffer = new Uint32Array(words);
  for (;;) {
    crypto.getRandomValues(buffer);
    let value = 0n;
    for (const word of buffer) value = (value << 32n) | BigInt(word);
    value &= mask;
    if (value < span) return value;
  }
}

/** [0, span) aralığından `count` ofset; tekrarsızsa küçük aralıkta karıştırma, büyükte kümeyle eleme. */
function sampleOffsets(span: bigint, count: number, unique: boolean): bigint[] {
  if (!Number.isInteger(count) || count < 1 || count > RANDOM_MAX_COUNT) {
    throw new ToolError(
      msg('toolsMisc.random.count', 'Adet 1–{max} arasında olmalı.', { max: String(RANDOM_MAX_COUNT) }),
    );
  }
  if (!unique) return Array.from({ length: count }, () => uniformBelow(span));
  if (span < BigInt(count)) {
    throw new ToolError(
      msg(
        'toolsMisc.random.notEnoughUnique',
        'Aralıkta yalnızca {span} farklı değer var; {count} tekrarsız değer üretilemez.',
        { span: String(span), count: String(count) },
      ),
    );
  }
  if (span <= BigInt(count) * 2n) {
    // Kısmi Fisher–Yates: ilk `count` eleman rastgele ve tekrarsız.
    const pool = Array.from({ length: Number(span) }, (_, i) => BigInt(i));
    for (let i = 0; i < count; i++) {
      const j = i + Number(uniformBelow(BigInt(pool.length - i)));
      [pool[i], pool[j]] = [pool[j]!, pool[i]!];
    }
    return pool.slice(0, count);
  }
  const seen = new Set<bigint>();
  while (seen.size < count) seen.add(uniformBelow(span));
  return [...seen];
}

function sortValues(values: bigint[], sort: RandomSort | undefined): bigint[] {
  if (sort === 'asc') values.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  else if (sort === 'desc') values.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  return values;
}

const minAboveMax = () =>
  new ToolError(msg('toolsMisc.random.minAboveMax', 'En küçük değer en büyükten büyük olamaz.'));

function safeInteger(value: number, bound: 'min' | 'max'): bigint {
  if (!Number.isSafeInteger(value)) {
    throw new ToolError(
      bound === 'min'
        ? msg('toolsMisc.random.minSafe', 'En küçük değer ±(2^53 − 1) aralığında bir tamsayı olmalı.')
        : msg('toolsMisc.random.maxSafe', 'En büyük değer ±(2^53 − 1) aralığında bir tamsayı olmalı.'),
    );
  }
  return BigInt(value);
}

/** Ölçeklenmiş tamsayı aralığından değer listesi. */
function sampleRange(min: bigint, max: bigint, options: ListOptions): bigint[] {
  if (min > max) throw minAboveMax();
  const offsets = sampleOffsets(max - min + 1n, options.count, options.unique ?? false);
  return sortValues(
    offsets.map((o) => min + o),
    options.sort,
  );
}

/** [min, max] aralığında tamsayılar (uçlar dahil; 2^53'e kadar güvenli). */
export function randomIntegerList(min: number, max: number, options: ListOptions): number[] {
  return sampleRange(safeInteger(min, 'min'), safeInteger(max, 'max'), options).map(Number);
}

/** [min, max] aralığında `precision` ondalık basamaklı sayılar; sabit basamaklı metin olarak. */
export function randomDecimalList(
  min: number,
  max: number,
  precision: number,
  options: ListOptions,
): string[] {
  if (!Number.isInteger(precision) || precision < 0 || precision > RANDOM_MAX_PRECISION) {
    throw new ToolError(
      msg('toolsMisc.random.precision', 'Ondalık basamak 0–{max} olmalı.', {
        max: String(RANDOM_MAX_PRECISION),
      }),
    );
  }
  if (!Number.isFinite(min) || !Number.isFinite(max))
    throw new ToolError(msg('toolsMisc.random.finiteBounds', 'Sınırlar geçerli sayı olmalı.'));
  const scale = 10 ** precision;
  const low = Math.ceil(Number((min * scale).toPrecision(15)));
  const high = Math.floor(Number((max * scale).toPrecision(15)));
  if (!Number.isSafeInteger(low) || !Number.isSafeInteger(high)) {
    throw new ToolError(
      msg(
        'toolsMisc.random.rangeTooLarge',
        'Aralık bu basamak sayısı için çok büyük (değer × 10^basamak, 2^53’ü aşmamalı).',
      ),
    );
  }
  if (low > high) {
    if (min > max) throw minAboveMax();
    throw new ToolError(
      msg('toolsMisc.random.noRepresentable', 'Aralıkta bu basamak sayısıyla gösterilebilen değer yok.'),
    );
  }
  return sampleRange(BigInt(low), BigInt(high), options).map((v) => formatScaled(v, precision));
}

function formatScaled(value: bigint, precision: number): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(precision + 1, '0');
  const whole = digits.slice(0, digits.length - precision);
  const fraction = precision ? `.${digits.slice(digits.length - precision)}` : '';
  return `${negative ? '-' : ''}${whole}${fraction}`;
}

/* ---------------------------------------------------------------- Tarih */

export type DateStep = 'ms' | 'second' | 'minute' | 'hour' | 'day';
export type DateOutputFormat = 'iso' | 'zoned' | 'date' | 'time' | 'unix' | 'unix-ms' | 'rfc1123';

const STEP_MS: Record<DateStep, number> = {
  ms: 1,
  second: 1000,
  minute: 60000,
  hour: 3600000,
  day: 86400000,
};

export interface DateListOptions extends ListOptions {
  /** `from`dan başlayarak bu adımlarla seçilir (ör. gün: hep aynı saat). */
  step?: DateStep;
  format?: DateOutputFormat;
  /** `zoned`, `date` ve `time` biçimleri için IANA saat dilimi; varsayılan UTC. */
  timeZone?: string;
}

/** İki tarih arasında (uçlar dahil) rastgele anlar; seçilen biçimde metin. */
export function randomDateList(from: Date, to: Date, options: DateListOptions): string[] {
  const start = from.getTime();
  const end = to.getTime();
  if (Number.isNaN(start) || Number.isNaN(end))
    throw new ToolError(msg('toolsMisc.random.invalidDate', 'Geçersiz tarih.'));
  if (start > end)
    throw new ToolError(msg('toolsMisc.random.startAfterEnd', 'Başlangıç tarihi bitişten sonra olamaz.'));
  const step = STEP_MS[options.step ?? 'second'];
  const steps = Math.floor((end - start) / step);
  const values = sampleRange(0n, BigInt(steps), options);
  const format = options.format ?? 'iso';
  const toZoned =
    format === 'zoned' || format === 'date' || format === 'time'
      ? zonedIsoFormatter(options.timeZone || 'UTC')
      : null;
  return values.map((v) => {
    const date = new Date(start + Number(v) * step);
    if (!toZoned) return formatPlain(date, format);
    // Ofsetli ISO: "2026-10-29T14:05:00+03:00"; tarih ve saat parçaları da buradan.
    const text = toZoned(date);
    const t = text.indexOf('T');
    return format === 'date' ? text.slice(0, t) : format === 'time' ? text.slice(t + 1, t + 9) : text;
  });
}

function formatPlain(date: Date, format: DateOutputFormat): string {
  if (format === 'unix') return String(Math.floor(date.getTime() / 1000));
  if (format === 'unix-ms') return String(date.getTime());
  if (format === 'rfc1123') return date.toUTCString();
  return date.toISOString();
}

/**
 * Seçilen dilimde ofsetli ISO 8601 yazıcı. Intl biçimleyicisi bir kez kurulur (`formatDate` her çağrıda
 * yeniden kurduğundan binlerce tarihte yavaştır); 1–9998 dışındaki yıllar yine ona bırakılır.
 */
function zonedIsoFormatter(timeZone: string): (date: Date) => string {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'longOffset',
    });
  } catch {
    throw new ToolError(
      msg('toolsMisc.random.invalidTimeZone', 'Geçersiz saat dilimi: {timeZone}', { timeZone }),
    );
  }
  return (date) => {
    const year = date.getUTCFullYear();
    if (year < 1 || year > 9998) return formatDate(date, timeZone).isoZoned;
    const p = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
    const offset = (p.timeZoneName ?? '').replace(/^GMT/, '') || '+00:00';
    const millis = date.getUTCMilliseconds();
    const fraction = millis ? `.${String(millis).padStart(3, '0')}` : '';
    return `${p.year!.padStart(4, '0')}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${fraction}${offset}`;
  };
}
