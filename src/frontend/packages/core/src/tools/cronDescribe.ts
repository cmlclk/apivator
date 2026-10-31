import { coreLanguage, msg } from '../i18n';
import { parseCron, type CronField, type ParsedCron } from './cronParse';
import { describeCronEn, MONTHS_EN, WEEKDAYS_EN } from './cronDescribeEn';
import { everyStep, explicit, MAX_HOUR_RUNS, pad2, singleRange, valueRuns } from './cronFieldShape';

/** Cron ifadesini etkin dilde açıklar (Türkçe metin burada, İngilizce `cronDescribeEn.ts`); monitörler ve cron aracı aynı metni kullanır. */

export const MONTHS_TR = [
  'Ocak',
  'Şubat',
  'Mart',
  'Nisan',
  'Mayıs',
  'Haziran',
  'Temmuz',
  'Ağustos',
  'Eylül',
  'Ekim',
  'Kasım',
  'Aralık',
];
/** Bulunma ekli ay adları ("Ocak'ta"). */
const MONTHS_LOCATIVE = [
  "Ocak'ta",
  "Şubat'ta",
  "Mart'ta",
  "Nisan'da",
  "Mayıs'ta",
  "Haziran'da",
  "Temmuz'da",
  "Ağustos'ta",
  "Eylül'de",
  "Ekim'de",
  "Kasım'da",
  "Aralık'ta",
];
export const WEEKDAYS_TR = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];

/** "a", "a ve b", "a, b ve c" */
function joinTr(items: string[]): string {
  return items.length <= 1
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} ve ${items[items.length - 1]}`;
}

/** Sayının okunuşuna göre bulunma eki (5 → "te", 30 → "da", 0 → "da"). */
function locativeSuffix(n: number): string {
  if (n === 0) return 'da';
  const units = ['', 'de', 'de', 'te', 'te', 'te', 'da', 'de', 'de', 'da'];
  const tens = ['', 'da', 'de', 'da', 'ta', 'de'];
  return n % 10 ? units[n % 10]! : (tens[Math.floor(n / 10) % 10] ?? 'de');
}

/** Saat listesi, son öğe ekli: "09:00 ve 18:30'da". */
function timesText(times: [number, number][]): string {
  const [h, m] = times[times.length - 1]!;
  const texts = times.map(([hh, mm]) => `${pad2(hh)}:${pad2(mm)}`);
  return `${joinTr(texts)}'${locativeSuffix(m || h)}`;
}

const ordinals = (values: number[]) => joinTr(values.map((v) => `${v}.`));

/** Dakika alanı, saat kısıtı ile birlikte söylenecek biçimde ("her 15 dakikada bir"). */
function minuteEvery(minute: CronField): string {
  if (minute.values.length === 60) return 'her dakika';
  const step = everyStep(minute, 0, 59);
  if (step) return `her ${step} dakikada bir`;
  if (minute.values.length === 1 && minute.values[0] === 0) return 'her saat başı';
  const range = singleRange(minute);
  if (range) return `her saatin ${range[0]}–${range[1]}. dakikaları arasında her dakika`;
  const many = minute.values.length > 1;
  return `her saatin ${ordinals(minute.values)} ${many ? 'dakikalarında' : 'dakikasında'}`;
}

/** Saat kısmı; `fixed` belirli saat(ler) demektir ("09:00'da"). */
function timePart(cron: ParsedCron): { text: string; fixed: boolean } {
  const { minute, hour } = cron;
  const combos = minute.values.length * hour.values.length;
  if (explicit(minute) && explicit(hour) && combos <= 8) {
    const times = hour.values.flatMap((h) => minute.values.map((m): [number, number] => [h, m]));
    return { text: timesText(times), fixed: true };
  }
  if (hour.values.length === 24) return { text: minuteEvery(minute), fixed: false };
  const hourStep = everyStep(hour, 0, 23);
  if (hourStep && minute.values.length === 1) {
    const m = minute.values[0]!;
    const tail = m ? `, saatin ${m}. dakikasında` : '';
    return { text: `her ${hourStep} saatte bir${tail}`, fixed: false };
  }
  const range = singleRange(hour);
  if (range) {
    return {
      text: `${pad2(range[0])}:00–${pad2(range[1])}:59 arasında ${minuteEvery(minute)}`,
      fixed: false,
    };
  }
  if (explicit(minute) && combos <= 24) {
    const times = hour.values.flatMap((h) => minute.values.map((m): [number, number] => [h, m]));
    return { text: timesText(times), fixed: true };
  }
  // Tek saat ya da birkaç ayrı blok: "09:00–09:59 arasında her 5 dakikada bir".
  const runs = valueRuns(hour);
  if (runs.length <= MAX_HOUR_RUNS) {
    const spans = runs.map(([a, b]) => `${pad2(a)}:00–${pad2(b)}:59`);
    return { text: `${joinTr(spans)} arasında ${minuteEvery(minute)}`, fixed: false };
  }
  return { text: `${joinTr(hour.values.map(pad2))} saatlerinde ${minuteEvery(minute)}`, fixed: false };
}

function dayOfMonthPart(field: CronField, everyMonth: boolean): string {
  const prefix = everyMonth ? 'her ayın' : 'ayın';
  const s = field.special;
  if (s?.kind === 'last')
    return s.offset ? `${prefix} son gününden ${s.offset} gün önce` : `${prefix} son günü`;
  if (s?.kind === 'lastWeekday') {
    return s.offset
      ? `${prefix} son gününden ${s.offset} gün öncesine en yakın hafta içi gün`
      : `${prefix} son hafta içi günü`;
  }
  if (s?.kind === 'nearestWeekday') return `${prefix} ${s.day}. gününe en yakın hafta içi gün`;
  const step = everyStep(field, 1, 31);
  if (step) return `${prefix} 1. gününden başlayarak ${step} günde bir`;
  const range = singleRange(field);
  if (range) return `${prefix} ${range[0]}–${range[1]}. günleri`;
  return `${prefix} ${ordinals(field.values)} günü`;
}

function dayOfWeekPart(field: CronField): string {
  const s = field.special;
  if (s?.kind === 'lastDow') return `ayın son ${WEEKDAYS_TR[s.dow]} günü`;
  if (s?.kind === 'nthDow') return `ayın ${s.nth}. ${WEEKDAYS_TR[s.dow]} günü`;
  const key = field.values.join(',');
  if (key === '1,2,3,4,5') return 'hafta içi her gün';
  if (key === '0,6') return 'hafta sonu her gün';
  if (field.values.length === 1) return `her ${WEEKDAYS_TR[field.values[0]!]}`;
  // Pazar sonda okunur ("Cuma, Cumartesi ve Pazar").
  const ordered = [...field.values.filter((v) => v !== 0), ...field.values.filter((v) => v === 0)];
  return `${joinTr(ordered.map((v) => WEEKDAYS_TR[v]!))} günleri`;
}

/** Gün koşulu olarak kısa biçim ("Pazartesi ya da Cuma", "hafta içi"). */
function dayOfWeekCondition(field: CronField): string {
  if (field.special) return dayOfWeekPart(field);
  const key = field.values.join(',');
  if (key === '1,2,3,4,5') return 'hafta içi';
  if (key === '0,6') return 'hafta sonu';
  const names = field.values.map((v) => WEEKDAYS_TR[v]!);
  return names.length <= 1
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} ya da ${names[names.length - 1]}`;
}

function monthPart(field: CronField): string {
  const range = singleRange(field);
  if (range) return `${MONTHS_TR[range[0] - 1]}–${MONTHS_TR[range[1] - 1]} arasında`;
  const names = field.values.map((v) => MONTHS_TR[v - 1]!);
  names[names.length - 1] = MONTHS_LOCATIVE[field.values[field.values.length - 1]! - 1]!;
  return joinTr(names);
}

/**
 * Doğal Türkçe açıklama: "Her 15 dakikada bir", "Hafta içi her gün 09:00'da",
 * "Ocak ve Temmuz'da, ayın son günü 18:30'da". Geçersiz ifadede ToolError.
 */
export function describeCron(expression: string | ParsedCron): string {
  const cron = typeof expression === 'string' ? parseCron(expression) : expression;
  if (coreLanguage() === 'en') return describeCronEn(cron);
  const time = timePart(cron);
  const everyMonth = cron.month.values.length === 12;
  const domAll = !cron.dayOfMonth.special && cron.dayOfMonth.values.length === 31;
  const dowAll = !cron.dayOfWeek.special && cron.dayOfWeek.values.length === 7;

  let months = everyMonth ? '' : monthPart(cron.month);
  let days: string;
  if (!everyMonth && cron.month.values.length === 1 && explicit(cron.dayOfMonth) && dowAll) {
    // "Her yıl 1 Ocak 00:00'da"
    const monthName = MONTHS_TR[cron.month.values[0]! - 1];
    days = `her yıl ${joinTr(cron.dayOfMonth.values.map(String))} ${monthName}`;
    months = '';
  } else if (domAll && dowAll) {
    days = time.fixed ? 'her gün' : '';
  } else if (dowAll) {
    days = dayOfMonthPart(cron.dayOfMonth, everyMonth);
  } else if (domAll) {
    days = dayOfWeekPart(cron.dayOfWeek);
  } else {
    // Cronos ikisinin birlikte tutmasını ister.
    days = `${dayOfMonthPart(cron.dayOfMonth, everyMonth)} (yalnız ${dayOfWeekCondition(cron.dayOfWeek)} ise)`;
  }

  let text = time.text;
  if (days) text = time.fixed ? `${days} ${text}` : `${days}, ${text}`;
  if (months) text = `${months}, ${text}`;
  return text.charAt(0).toLocaleUpperCase('tr') + text.slice(1);
}

/** Etkin dildeki ay adları (Ocak…Aralık / January…December). */
export function cronMonthNames(): string[] {
  return coreLanguage() === 'en' ? MONTHS_EN : MONTHS_TR;
}

/** Etkin dildeki gün adları, Pazar (0) ile başlar. */
export function cronWeekdayNames(): string[] {
  return coreLanguage() === 'en' ? WEEKDAYS_EN : WEEKDAYS_TR;
}

/** Alanın değerleri okunur biçimde ("0, 15, 30, 45", "Pazartesi–Cuma", "her değer (0–59)"). */
export function cronFieldSummary(field: CronField): string {
  const s = field.special;
  const weekdays = cronWeekdayNames();
  if (s?.kind === 'last') {
    return s.offset
      ? msg('cron.summary.lastOffset', 'son günden {offset} gün önce', { offset: s.offset })
      : msg('cron.summary.last', 'ayın son günü');
  }
  if (s?.kind === 'lastWeekday') {
    return s.offset
      ? msg('cron.summary.lastWeekdayOffset', 'son günden {offset} gün öncesine en yakın hafta içi gün', {
          offset: s.offset,
        })
      : msg('cron.summary.lastWeekday', 'ayın son hafta içi günü');
  }
  if (s?.kind === 'nearestWeekday') {
    return msg('cron.summary.nearestWeekday', '{day}. güne en yakın hafta içi gün', { day: s.day });
  }
  if (s?.kind === 'lastDow') {
    return msg('cron.summary.lastDow', 'ayın son {day} günü', { day: weekdays[s.dow]! });
  }
  if (s?.kind === 'nthDow') {
    return msg('cron.summary.nthDow', 'ayın {nth}. {day} günü', { nth: s.nth, day: weekdays[s.dow]! });
  }
  const full = { minute: 60, hour: 24, dayOfMonth: 31, month: 12, dayOfWeek: 7 }[field.key];
  const name = (v: number) =>
    field.key === 'month' ? cronMonthNames()[v - 1]! : field.key === 'dayOfWeek' ? weekdays[v]! : String(v);
  if (field.values.length === full) {
    const months = cronMonthNames();
    const span = {
      minute: '0–59',
      hour: '0–23',
      dayOfMonth: '1–31',
      month: `${months[0]}–${months[11]}`,
      dayOfWeek: `${weekdays[0]}–${weekdays[6]}`,
    };
    return msg('cron.summary.everyValue', 'her değer ({span})', { span: span[field.key] });
  }
  // Ardışık değerleri aralık olarak yaz.
  const groups: string[] = [];
  const values = field.values;
  for (let i = 0; i < values.length;) {
    let j = i;
    while (j + 1 < values.length && values[j + 1] === values[j]! + 1) j++;
    groups.push(
      j - i >= 2
        ? `${name(values[i]!)}–${name(values[j]!)}`
        : values
            .slice(i, j + 1)
            .map(name)
            .join(', '),
    );
    i = j + 1;
  }
  return groups.join(', ');
}
