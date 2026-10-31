import type { CronField } from './cronParse';

/** Cron açıklayıcılarının (Türkçe/İngilizce) paylaştığı alan biçimi yardımcıları. */

/** Tek parça `*\/n` (ya da `min-max/n`, `min/n`) → n. */
export function everyStep(field: CronField, min: number, max: number): number | null {
  if (field.ranges.length !== 1) return null;
  const { start, end, step } = field.ranges[0]!;
  return start === min && end === max && step > 1 ? step : null;
}

/** Tek parça, adımsız, sarmayan aralık `a-b`. */
export function singleRange(field: CronField): [number, number] | null {
  if (field.ranges.length !== 1 || field.star) return null;
  const { start, end, step } = field.ranges[0]!;
  return step === 1 && start < end ? [start, end] : null;
}

/** `*`/adım/aralık içermeyen, değerleri tek tek yazılmış alan. */
export function explicit(field: CronField): boolean {
  return !field.star && field.ranges.every((r) => r.step === 1 && r.start === r.end);
}

/** Değerlerin ardışık blokları; ör. 9,10,11,17 → [[9, 11], [17, 17]]. */
export function valueRuns(field: CronField): [number, number][] {
  const runs: [number, number][] = [];
  for (const v of field.values) {
    const last = runs[runs.length - 1];
    if (last && v === last[1] + 1) last[1] = v;
    else runs.push([v, v]);
  }
  return runs;
}

/** Saat bloklarının en çok bu kadarı aralık olarak yazılır ("09:00–09:59 ve 17:00–17:59"); fazlası saat listesi. */
export const MAX_HOUR_RUNS = 3;

export const pad2 = (n: number) => String(n).padStart(2, '0');
