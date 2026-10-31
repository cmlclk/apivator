import { ToolError } from './errors';
import { coreLocale, msg } from '../i18n';

/**
 * 5 alanlı standart cron ayrıştırıcısı; sunucudaki Cronos (`CronFormat.Standard`) ile aynı kuralları uygular:
 * `*` / `?`, liste, aralık (ters aralık sarar: `22-2`), adım (`*\/5`, `1-10/2`, `5/15`), ay ve gün adları,
 * haftanın günü 0–7 (0 ve 7 Pazar), ayın günü `L`, `L-n`, `LW`, `L-nW`, `nW`; haftanın günü `nL`, `n#k`; makrolar.
 */

export type CronFieldKey = 'minute' | 'hour' | 'dayOfMonth' | 'month' | 'dayOfWeek';

export interface CronRange {
  start: number;
  end: number;
  step: number;
}

export type CronSpecial =
  /** `L` / `L-n`: ayın son gününden `offset` gün önce. */
  | { kind: 'last'; offset: number }
  /** `LW` / `L-nW`: o güne en yakın hafta içi gün. */
  | { kind: 'lastWeekday'; offset: number }
  /** `nW`: ayın `day`. gününe en yakın hafta içi gün (ay dışına taşmaz). */
  | { kind: 'nearestWeekday'; day: number }
  /** `nL`: ayın son `dow` günü. */
  | { kind: 'lastDow'; dow: number }
  /** `n#k`: ayın `nth`. `dow` günü. */
  | { kind: 'nthDow'; dow: number; nth: number };

export interface CronField {
  key: CronFieldKey;
  /** Türkçe alan adı ("dakika"). */
  label: string;
  raw: string;
  /** Eşleşen değerler, artan; haftanın günü 0–6 (0 = Pazar). Özel biçimde boş. */
  values: number[];
  /** Yazıldığı gibi parçalar (`*` tüm aralık olarak). */
  ranges: CronRange[];
  /** Alan `*` ya da `?` ile yazıldı (adımlı olabilir). */
  star: boolean;
  special?: CronSpecial;
}

export interface ParsedCron {
  /** Makrosu açılmış, tek boşlukla ayrılmış 5 alan. */
  expression: string;
  /** `@daily` gibi kullanılan makro (küçük harf). */
  macro?: string;
  minute: CronField;
  hour: CronField;
  dayOfMonth: CronField;
  month: CronField;
  dayOfWeek: CronField;
  /**
   * Dakika ya da saat alanında `*`, `?`, adım ya da aralık var. Cronos böyle ifadeleri yaz saati geri
   * alındığında tekrarlanan saatte iki kez çalıştırır; diğerleri yalnız ilk geçişte çalışır.
   */
  interval: boolean;
}

export const CRON_FIELD_KEYS: CronFieldKey[] = ['minute', 'hour', 'dayOfMonth', 'month', 'dayOfWeek'];

const MONTH_NAMES = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

interface FieldSpec {
  label: () => string;
  min: number;
  max: number;
  names?: string[];
  /** İsimlerin karşılık geldiği ilk değer. */
  nameBase?: number;
}

const SPECS: Record<CronFieldKey, FieldSpec> = {
  minute: { label: () => msg('cron.field.minute', 'dakika'), min: 0, max: 59 },
  hour: { label: () => msg('cron.field.hour', 'saat'), min: 0, max: 23 },
  dayOfMonth: { label: () => msg('cron.field.dayOfMonth', 'ayın günü'), min: 1, max: 31 },
  month: { label: () => msg('cron.field.month', 'ay'), min: 1, max: 12, names: MONTH_NAMES, nameBase: 1 },
  dayOfWeek: {
    label: () => msg('cron.field.dayOfWeek', 'haftanın günü'),
    min: 0,
    max: 7,
    names: DAY_NAMES,
    nameBase: 0,
  },
};

const MACROS: Record<string, string> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
  '@every_minute': '* * * * *',
};

const unexpectedChar = (char: string) =>
  msg('cron.error.unexpectedChar', 'beklenmeyen karakter {char}.', { char: `'${char}'` });
const capitalize = (text: string) => text.charAt(0).toLocaleUpperCase(coreLocale()) + text.slice(1);

/** Alan içi hata; konum ifadenin 1 tabanlı karakter sırasıdır. */
function fail(spec: FieldSpec, position: number, detail: string): never {
  throw new ToolError(
    msg('cron.error.field', '{field} alanında hata ({position}. karakter): {detail}', {
      field: capitalize(spec.label()),
      position,
      detail,
    }),
  );
}

export function parseCron(input: string): ParsedCron {
  const text = input.trim();
  if (!text) throw new ToolError(msg('cron.error.empty', 'Cron ifadesi boş.'));
  let source = input;
  let macro: string | undefined;
  if (text.startsWith('@')) {
    macro = text.toLowerCase();
    const expanded = MACROS[macro];
    if (!expanded) {
      throw new ToolError(
        msg('cron.error.unknownMacro', 'Bilinmeyen makro: {macro} (desteklenenler: {supported}).', {
          macro: text,
          supported: Object.keys(MACROS).join(', '),
        }),
      );
    }
    source = expanded;
  }
  const tokens = [...source.matchAll(/\S+/g)];
  if (tokens.length !== 5) {
    throw new ToolError(
      msg(
        'cron.error.fieldCount',
        'Cron ifadesi 5 alandan oluşmalı (dakika saat gün ay haftanın-günü); {count} alan var.',
        { count: tokens.length },
      ),
    );
  }
  const fields = CRON_FIELD_KEYS.map((key, i) => {
    const token = tokens[i]!;
    // Makroda konum anlamsız; hata zaten oluşmaz.
    return parseField(key, token[0], macro ? 1 : token.index! + 1);
  }) as [CronField, CronField, CronField, CronField, CronField];
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  const intervalLike = (raw: string) => /[*?/-]/.test(raw);
  return {
    expression: fields.map((f) => f.raw).join(' '),
    macro,
    minute,
    hour,
    dayOfMonth,
    month,
    dayOfWeek,
    interval: intervalLike(minute.raw) || intervalLike(hour.raw),
  };
}

function parseField(key: CronFieldKey, raw: string, position: number): CronField {
  const spec = SPECS[key];
  const field: CronField = { key, label: spec.label(), raw, values: [], ranges: [], star: false };
  const upper = raw.toUpperCase();

  if (key === 'dayOfMonth' && /L|W/.test(upper)) {
    field.special = parseDomSpecial(spec, upper, position);
    return field;
  }
  if (key === 'dayOfWeek' && /L|#/.test(upper) && !/^[A-Z]{3}$/.test(upper)) {
    field.special = parseDowSpecial(spec, upper, position);
    return field;
  }

  if (/^[*?]/.test(raw)) {
    // `*` ve `?` yalnız tek başına (adımla birlikte) yazılabilir.
    field.star = true;
    const rest = raw.slice(1);
    let step = 1;
    if (rest) {
      if (!rest.startsWith('/')) fail(spec, position + 1, unexpectedChar(rest[0]!));
      step = parseStep(spec, rest.slice(1), position + 2);
    }
    field.ranges.push({ start: spec.min, end: spec.max, step });
  } else {
    let offset = 0;
    for (const part of raw.split(',')) {
      field.ranges.push(parseRange(spec, part, position + offset));
      offset += part.length + 1;
    }
  }
  field.values = expand(spec, field.ranges, key === 'dayOfWeek');
  return field;
}

function parseRange(spec: FieldSpec, part: string, position: number): CronRange {
  const [base = '', stepText, extra] = part.split('/');
  if (extra !== undefined) fail(spec, position + base.length + stepText!.length + 1, unexpectedChar('/'));
  if (base.startsWith('*') || base.startsWith('?')) {
    fail(
      spec,
      position,
      msg('cron.error.standalone', '{char} listede kullanılamaz; tek başına yazın.', {
        char: `'${base[0]}'`,
      }),
    );
  }
  const bounds = base.split('-');
  if (bounds.length > 2)
    fail(spec, position + bounds[0]!.length + bounds[1]!.length + 1, unexpectedChar('-'));
  const start = parseValue(spec, bounds[0]!, position);
  let end = bounds.length === 2 ? parseValue(spec, bounds[1]!, position + bounds[0]!.length + 1) : start;
  let step = 1;
  if (stepText !== undefined) {
    step = parseStep(spec, stepText, position + base.length + 1);
    // `5/15` = `5-max/15`.
    if (bounds.length === 1) end = spec.max;
  }
  return { start, end, step };
}

function parseValue(spec: FieldSpec, text: string, position: number): number {
  const range = `${spec.min}–${spec.max}`;
  if (/^\d{1,2}$/.test(text)) {
    const value = Number(text);
    if (value < spec.min || value > spec.max)
      fail(
        spec,
        position,
        msg('cron.error.outOfRange', '{value} {range} aralığında olmalı.', { value: `'${text}'`, range }),
      );
    return value;
  }
  if (spec.names && /^[a-z]{3}$/i.test(text)) {
    const index = spec.names.indexOf(text.toUpperCase());
    if (index >= 0) return index + spec.nameBase!;
  }
  const names = spec.names ? `${spec.names[0]}–${spec.names[spec.names.length - 1]}` : '';
  const allowed = names ? msg('cron.error.rangeOrNames', '{range} ya da {names}', { range, names }) : range;
  fail(
    spec,
    position,
    text
      ? msg('cron.error.invalidValue', '{value} geçerli bir değer değil ({allowed}).', {
          value: `'${text}'`,
          allowed,
        })
      : msg('cron.error.missingValue', 'değer eksik ({allowed}).', { allowed }),
  );
}

function parseStep(spec: FieldSpec, text: string, position: number): number {
  const step = /^\d{1,2}$/.test(text) ? Number(text) : NaN;
  if (!(step >= 1 && step <= spec.max))
    fail(spec, position, msg('cron.error.stepRange', 'adım 1–{max} aralığında olmalı.', { max: spec.max }));
  return step;
}

/** Aralıkları değerlere açar; başı sonundan büyük aralık sarar (`22-2` = 22, 23, 0, 1, 2). */
function expand(spec: FieldSpec, ranges: CronRange[], weekday: boolean): number[] {
  const set = new Set<number>();
  const size = spec.max - spec.min + 1;
  for (const { start, end, step } of ranges) {
    const length = (end - start + size) % size;
    for (let i = 0; i <= length; i += step) {
      const value = spec.min + ((start - spec.min + i) % size);
      set.add(weekday && value === 7 ? 0 : value);
    }
  }
  return [...set].sort((a, b) => a - b);
}

function parseDomSpecial(spec: FieldSpec, text: string, position: number): CronSpecial {
  const last = /^L(?:-(\d{1,2}))?(W?)$/.exec(text);
  if (last) {
    const offset = last[1] === undefined ? 0 : Number(last[1]);
    if (offset > 30)
      fail(spec, position + 2, msg('cron.error.lastOffset', "'L-' sonrası 0–30 aralığında olmalı."));
    return last[2] ? { kind: 'lastWeekday', offset } : { kind: 'last', offset };
  }
  const nearest = /^(\d{1,2})W$/.exec(text);
  if (nearest) {
    const day = Number(nearest[1]);
    if (day < 1 || day > 31)
      fail(
        spec,
        position,
        msg('cron.error.dayRange', '{value} 1–31 aralığında olmalı.', { value: `'${nearest[1]}'` }),
      );
    return { kind: 'nearestWeekday', day };
  }
  const index = text.search(/[LW]/);
  fail(
    spec,
    position + Math.max(index, 0),
    msg(
      'cron.error.lastWeekdayUsage',
      "'L' ve 'W' yalnız L, L-n, LW, L-nW ya da nW (ör. 15W) biçiminde ve tek başına kullanılabilir.",
    ),
  );
}

function parseDowSpecial(spec: FieldSpec, text: string, position: number): CronSpecial {
  const last = /^(\w+)L$/.exec(text);
  if (last) {
    const dow = parseValue(spec, last[1]!, position);
    return { kind: 'lastDow', dow: dow % 7 };
  }
  const nth = /^(\w+)#(\d*)$/.exec(text);
  if (nth) {
    const dow = parseValue(spec, nth[1]!, position);
    const k = nth[2] ? Number(nth[2]) : NaN;
    if (!(k >= 1 && k <= 5))
      fail(
        spec,
        position + nth[1]!.length + 1,
        msg('cron.error.nthRange', "'#' sonrası 1–5 aralığında olmalı."),
      );
    return { kind: 'nthDow', dow: dow % 7, nth: k };
  }
  const index = text.search(/[L#]/);
  fail(
    spec,
    position + Math.max(index, 0),
    msg(
      'cron.error.lastDowUsage',
      "'L' ve '#' yalnız nL (ör. 5L) ya da n#k (ör. 1#2) biçiminde ve tek başına kullanılabilir.",
    ),
  );
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Ayın `day`. gününe en yakın hafta içi gün; ay sınırını aşmaz. */
function nearestWeekday(year: number, month: number, day: number, dim: number): number {
  const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  if (dow === 6) return day === 1 ? 3 : day - 1;
  if (dow === 0) return day === dim ? day - 2 : day + 1;
  return day;
}

/**
 * Gün eşleşmesi (`month` 1–12). Cronos'ta ayın günü ve haftanın günü birlikte kısıtlıysa
 * ikisinin de tutması gerekir (VE; Vixie cron'daki VEYA değil).
 */
export function cronDayMatches(cron: ParsedCron, year: number, month: number, day: number): boolean {
  const dim = daysInMonth(year, month);
  const dom = cron.dayOfMonth.special;
  if (dom) {
    if (dom.kind === 'last' && day !== dim - dom.offset) return false;
    if (dom.kind === 'lastWeekday') {
      const target = dim - dom.offset;
      if (target < 1 || day !== nearestWeekday(year, month, target, dim)) return false;
    }
    if (
      dom.kind === 'nearestWeekday' &&
      (dom.day > dim || day !== nearestWeekday(year, month, dom.day, dim))
    ) {
      return false;
    }
  } else if (!cron.dayOfMonth.values.includes(day)) return false;

  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const dow = cron.dayOfWeek.special;
  if (!dow) return cron.dayOfWeek.values.includes(weekday);
  if (dow.kind === 'lastDow') return weekday === dow.dow && day + 7 > dim;
  if (dow.kind === 'nthDow') return weekday === dow.dow && Math.ceil(day / 7) === dow.nth;
  return true;
}
