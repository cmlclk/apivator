import type { CronField, ParsedCron } from './cronParse';
import { everyStep, explicit, MAX_HOUR_RUNS, pad2, singleRange, valueRuns } from './cronFieldShape';

/** `describeCron`un İngilizce karşılığı: Türkçe şablonlar taklit edilmez, cümle baştan kurulur. */

export const MONTHS_EN = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
export const WEEKDAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "a", "a and b", "a, b and c" */
function join(items: string[], word = 'and'): string {
  return items.length <= 1
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} ${word} ${items[items.length - 1]}`;
}

export function ordinalEn(n: number): string {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
}

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;

function timesText(times: [number, number][]): string {
  return `at ${join(times.map(([h, m]) => `${pad2(h)}:${pad2(m)}`))}`;
}

function minuteEvery(minute: CronField): string {
  if (minute.values.length === 60) return 'every minute';
  const step = everyStep(minute, 0, 59);
  if (step) return `every ${step} minutes`;
  if (minute.values.length === 1 && minute.values[0] === 0) return 'at the top of every hour';
  const range = singleRange(minute);
  if (range) return `every minute from minute ${range[0]} to ${range[1]} of every hour`;
  const many = minute.values.length > 1;
  return `at ${many ? 'minutes' : 'minute'} ${join(minute.values.map(String))} past every hour`;
}

function timePart(cron: ParsedCron): { text: string; fixed: boolean } {
  const { minute, hour } = cron;
  const combos = minute.values.length * hour.values.length;
  const times = () => hour.values.flatMap((h) => minute.values.map((m): [number, number] => [h, m]));
  if (explicit(minute) && explicit(hour) && combos <= 8) return { text: timesText(times()), fixed: true };
  if (hour.values.length === 24) return { text: minuteEvery(minute), fixed: false };
  const hourStep = everyStep(hour, 0, 23);
  if (hourStep && minute.values.length === 1) {
    const m = minute.values[0]!;
    const tail = m ? `, at minute ${m} past the hour` : '';
    return { text: `every ${plural(hourStep, 'hour')}${tail}`, fixed: false };
  }
  const range = singleRange(hour);
  if (range) {
    return {
      text: `${minuteEvery(minute)} between ${pad2(range[0])}:00 and ${pad2(range[1])}:59`,
      fixed: false,
    };
  }
  if (explicit(minute) && combos <= 24) return { text: timesText(times()), fixed: true };
  const runs = valueRuns(hour);
  if (runs.length === 1) {
    const [a, b] = runs[0]!;
    return { text: `${minuteEvery(minute)} between ${pad2(a)}:00 and ${pad2(b)}:59`, fixed: false };
  }
  if (runs.length <= MAX_HOUR_RUNS) {
    const spans = runs.map(([a, b]) => `${pad2(a)}:00–${pad2(b)}:59`);
    return { text: `${minuteEvery(minute)} during ${join(spans)}`, fixed: false };
  }
  return { text: `${minuteEvery(minute)} during hours ${join(hour.values.map(pad2))}`, fixed: false };
}

function dayOfMonthPart(field: CronField, everyMonth: boolean): string {
  const month = everyMonth ? 'every month' : 'the month';
  const s = field.special;
  if (s?.kind === 'last') {
    return s.offset
      ? `${plural(s.offset, 'day')} before the last day of ${month}`
      : `on the last day of ${month}`;
  }
  if (s?.kind === 'lastWeekday') {
    return s.offset
      ? `on the weekday nearest to ${plural(s.offset, 'day')} before the last day of ${month}`
      : `on the last weekday of ${month}`;
  }
  if (s?.kind === 'nearestWeekday') return `on the weekday nearest to day ${s.day} of ${month}`;
  const step = everyStep(field, 1, 31);
  if (step) return `every ${plural(step, 'day')} starting on day 1 of ${month}`;
  const range = singleRange(field);
  if (range) return `on days ${range[0]}–${range[1]} of ${month}`;
  return `on ${field.values.length > 1 ? 'days' : 'day'} ${join(field.values.map(String))} of ${month}`;
}

function dayOfWeekPart(field: CronField): string {
  const s = field.special;
  if (s?.kind === 'lastDow') return `on the last ${WEEKDAYS_EN[s.dow]} of the month`;
  if (s?.kind === 'nthDow') return `on the ${ordinalEn(s.nth)} ${WEEKDAYS_EN[s.dow]} of the month`;
  const key = field.values.join(',');
  if (key === '1,2,3,4,5') return 'every weekday';
  if (key === '0,6') return 'every weekend day';
  if (field.values.length === 1) return `every ${WEEKDAYS_EN[field.values[0]!]}`;
  // Sunday is read last ("Friday, Saturday and Sunday").
  const ordered = [...field.values.filter((v) => v !== 0), ...field.values.filter((v) => v === 0)];
  return `on ${join(ordered.map((v) => WEEKDAYS_EN[v]!))}`;
}

function dayOfWeekCondition(field: CronField): string {
  if (field.special) return dayOfWeekPart(field);
  const key = field.values.join(',');
  if (key === '1,2,3,4,5') return 'a weekday';
  if (key === '0,6') return 'a weekend day';
  return join(
    field.values.map((v) => WEEKDAYS_EN[v]!),
    'or',
  );
}

function monthPart(field: CronField): string {
  const range = singleRange(field);
  if (range) return `from ${MONTHS_EN[range[0] - 1]} to ${MONTHS_EN[range[1] - 1]}`;
  return `in ${join(field.values.map((v) => MONTHS_EN[v - 1]!))}`;
}

export function describeCronEn(cron: ParsedCron): string {
  const time = timePart(cron);
  const everyMonth = cron.month.values.length === 12;
  const domAll = !cron.dayOfMonth.special && cron.dayOfMonth.values.length === 31;
  const dowAll = !cron.dayOfWeek.special && cron.dayOfWeek.values.length === 7;

  let months = everyMonth ? '' : monthPart(cron.month);
  let days: string;
  if (!everyMonth && cron.month.values.length === 1 && explicit(cron.dayOfMonth) && dowAll) {
    // "every year on January 1st"
    const monthName = MONTHS_EN[cron.month.values[0]! - 1];
    days = `every year on ${monthName} ${join(cron.dayOfMonth.values.map(ordinalEn))}`;
    months = '';
  } else if (domAll && dowAll) {
    days = time.fixed ? 'every day' : '';
  } else if (dowAll) {
    days = dayOfMonthPart(cron.dayOfMonth, everyMonth);
  } else if (domAll) {
    days = dayOfWeekPart(cron.dayOfWeek);
  } else {
    // Cronos requires both to match.
    days = `${dayOfMonthPart(cron.dayOfMonth, everyMonth)} (only if it is ${dayOfWeekCondition(cron.dayOfWeek)})`;
  }

  let text = time.text;
  if (days) text = time.fixed ? `${days} ${text}` : `${days}, ${text}`;
  if (months) text = `${months}, ${text}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}
