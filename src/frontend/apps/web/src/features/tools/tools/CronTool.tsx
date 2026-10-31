import { useEffect, useMemo, useState } from 'react';
import { Alert, cn } from '@apivator/ui';
import {
  CRON_FIELD_KEYS,
  cronFieldSummary,
  describeCron,
  formatDate,
  nextRuns,
  parseCron,
  type ParsedCron,
} from '@apivator/core/tools';
import { CopyButton } from '../../../components/ui/CopyButton';
import { dateFormatter, useLocale, useT } from '../../../i18n';
import { ToolErrorMessage, ToolOptions } from '../ToolLayout';
import { useToolInput } from '../toolsStore';
import { toolErrorText, toolLabelClass, toolSelectClass } from '../toolUtils';

const TOOL = 'cron';
const MAX_COUNT = 100;
/** Sunucudaki monitör kuralı: iki çalıştırma arası en az 5 dakika (MonitorSchedule). */
const MONITOR_MIN_MINUTES = 5;

const PRESET_EXPRESSIONS = [
  '* * * * *',
  '*/5 * * * *',
  '*/15 * * * *',
  '0 * * * *',
  '0 9 * * *',
  '0 9 * * 1-5',
  '*/15 9-17 * * 1-5',
  '0 0 1 * *',
  '0 18 L * *',
  '0 12 * * 1#1',
  '@weekly',
  '@yearly',
];

const inputClass =
  'h-8 w-full rounded-md border border-line bg-surface px-2 font-mono text-[12.5px] text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25';
const cellClass = 'border-b border-line px-2 py-1';
const headClass = 'border-b border-line px-2 py-1 font-medium';

function userZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Kullanıcının dilimi, İstanbul ve UTC en üstte; ardından tarayıcının bildiği tüm dilimler. */
function zoneList(): string[] {
  let all: string[] = [];
  try {
    all = Intl.supportedValuesOf('timeZone');
  } catch {
    // Eski tarayıcı: yalnız hızlı seçenekler.
  }
  return [...new Set([userZone(), 'Europe/Istanbul', 'UTC', ...all])];
}

/** Dakikada bir yenilenen "şimdi"; sonraki çalıştırmalar güncel kalsın. */
function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/**
 * Sunucuyla aynı kontrol: sonraki 8 gündeki ilk 50 çalıştırmada iki çalıştırma arası en kısa süre (dakika).
 * Tek çalıştırma varsa null.
 */
function shortestGapMinutes(cron: ParsedCron, now: Date, timeZone: string): number | null {
  const until = now.getTime() + 8 * 86_400_000;
  const runs = nextRuns(cron, now, 50, timeZone).filter((d) => d.getTime() <= until);
  let shortest: number | null = null;
  for (let i = 1; i < runs.length; i++) {
    const gap = (runs[i]!.getTime() - runs[i - 1]!.getTime()) / 60_000;
    if (shortest === null || gap < shortest) shortest = gap;
  }
  return shortest;
}

/** Biçimleyici dil ve dilim başına önbelleğe alınır; 100 satırda her çizimde yeniden kurmak pahalı. */
function localText(date: Date, timeZone: string): string {
  return dateFormatter({
    timeZone,
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

interface Result {
  cron: ParsedCron;
  description: string;
  runs: Date[];
  gap: number | null;
}

export default function CronTool() {
  const t = useT('toolsMisc');
  const [expr, setExpr] = useToolInput(TOOL, 'expr', '*/15 * * * *');
  const [zone, setZone] = useToolInput(TOOL, 'zone', userZone());
  const [countText, setCountText] = useToolInput(TOOL, 'count', '10');
  // ~420 seçenek her tuş vuruşunda yeniden karşılaştırılmasın.
  const zoneOptions = useMemo(
    () =>
      zoneList().map((z) => (
        <option key={z} value={z}>
          {z}
        </option>
      )),
    [],
  );
  const language = useLocale((s) => s.language);
  const now = useMinuteClock();
  const count = Math.min(MAX_COUNT, Math.max(1, Math.floor(Number(countText)) || 10));

  const { result, error } = useMemo((): { result: Result | null; error: string | null } => {
    if (!expr.trim()) return { result: null, error: null };
    try {
      const cron = parseCron(expr);
      return {
        result: {
          cron,
          description: describeCron(cron),
          runs: nextRuns(cron, now, count, zone),
          gap: shortestGapMinutes(cron, now, zone),
        },
        error: null,
      };
    } catch (e) {
      return { result: null, error: toolErrorText(e) };
    }
    // `language`: açıklama etkin dilde üretilir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expr, zone, count, now, language]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto">
      <section className="flex flex-col gap-2">
        <ToolOptions>
          <input
            className={cn(inputClass, 'max-w-md min-w-64 flex-1')}
            value={expr}
            onChange={(e) => setExpr(e.target.value)}
            placeholder={t('cron.placeholder')}
            spellCheck={false}
            aria-label={t('cron.expressionLabel')}
          />
          <label className={toolLabelClass}>
            {t('cron.timeZone')}
            <select className={toolSelectClass} value={zone} onChange={(e) => setZone(e.target.value)}>
              {!zoneOptions.some((o) => o.key === zone) && <option value={zone}>{zone}</option>}
              {zoneOptions}
            </select>
          </label>
          <label className={toolLabelClass}>
            {t('cron.show')}
            <input
              type="number"
              min={1}
              max={MAX_COUNT}
              className={cn(toolSelectClass, 'w-16')}
              value={countText}
              onChange={(e) => setCountText(e.target.value)}
              aria-label={t('cron.showCountLabel')}
            />
          </label>
        </ToolOptions>
        <div className="flex flex-wrap gap-1.5" aria-label={t('cron.presets')}>
          {PRESET_EXPRESSIONS.map((preset) => (
            <button
              key={preset}
              type="button"
              title={describeCron(preset)}
              onClick={() => setExpr(preset)}
              className={cn(
                'rounded-full border px-2 py-0.5 font-mono text-xs hover:border-accent hover:text-fg',
                expr.trim() === preset ? 'border-accent text-fg' : 'border-line text-fg-muted',
              )}
            >
              {preset}
            </button>
          ))}
        </div>
        <ToolErrorMessage error={error} />
        {result && (
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-fg" aria-label={t('cron.description')}>
              {result.description}
            </p>
            <CopyButton text={result.description} label={t('cron.copyDescription')} compact />
          </div>
        )}
        {result && result.gap !== null && result.gap < MONITOR_MIN_MINUTES && (
          <Alert tone="warning">{t('cron.tooFrequent', { min: MONITOR_MIN_MINUTES, gap: result.gap })}</Alert>
        )}
      </section>

      {result && (
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold text-fg-muted">{t('cron.fields')}</h3>
          <table className="w-full max-w-3xl border-collapse text-[12.5px]" aria-label={t('cron.fields')}>
            <thead>
              <tr className="text-start text-[11px] tracking-wide text-fg-subtle uppercase">
                <th className={headClass}>{t('cron.colField')}</th>
                <th className={headClass}>{t('cron.colExpression')}</th>
                <th className={headClass}>{t('cron.colValues')}</th>
              </tr>
            </thead>
            <tbody>
              {CRON_FIELD_KEYS.map((key) => (
                <tr key={key} className="align-top">
                  <td className={cn(cellClass, 'w-32 text-fg-muted')}>{t(`cron.fieldNames.${key}`)}</td>
                  <td className={cn(cellClass, 'w-40 font-mono text-fg')}>{result.cron[key].raw}</td>
                  <td className={cn(cellClass, 'break-words text-fg')}>
                    {cronFieldSummary(result.cron[key])}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {result.cron.macro && (
            <p className="text-xs text-fg-subtle">
              {result.cron.macro} = <span className="font-mono">{result.cron.expression}</span>
            </p>
          )}
          {!result.cron.dayOfMonth.star && !result.cron.dayOfWeek.star && (
            <p className="text-xs text-fg-subtle">{t('cron.dayRuleNote')}</p>
          )}
        </section>
      )}

      {result && (
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold text-fg-muted">{t('cron.nextRuns', { count, zone })}</h3>
          {result.runs.length === 0 ? (
            <p className="text-sm text-fg-muted">{t('cron.never')}</p>
          ) : (
            <table
              className="w-full max-w-3xl border-collapse text-[12.5px]"
              aria-label={t('cron.nextRunsTable')}
            >
              <thead>
                <tr className="text-start text-[11px] tracking-wide text-fg-subtle uppercase">
                  <th className={headClass}>#</th>
                  <th className={headClass}>{t('cron.colLocal')}</th>
                  <th className={headClass}>ISO 8601</th>
                  <th className={headClass}>{t('cron.colRelative')}</th>
                </tr>
              </thead>
              <tbody>
                {result.runs.map((run, i) => {
                  const formatted = formatDate(run, zone, now);
                  return (
                    <tr key={run.getTime()}>
                      <td className={cn(cellClass, 'w-8 text-fg-subtle')}>{i + 1}</td>
                      <td className={cn(cellClass, 'text-fg')}>{localText(run, zone)}</td>
                      <td className={cn(cellClass, 'font-mono text-fg')}>{formatted.isoZoned}</td>
                      <td className={cn(cellClass, 'text-fg-muted')}>{formatted.relative}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  );
}
