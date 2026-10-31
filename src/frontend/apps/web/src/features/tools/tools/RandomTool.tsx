import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button, Input } from '@apivator/ui';
import {
  RANDOM_MAX_COUNT,
  RANDOM_MAX_PRECISION,
  ToolError,
  parseTimestamp,
  randomDateList,
  randomDecimalList,
  randomIntegerList,
  type DateOutputFormat,
  type DateStep,
  type RandomSort,
} from '@apivator/core/tools';
import { translate, useT } from '../../../i18n';
import { ToolErrorMessage, ToolOptions, ToolPane } from '../ToolLayout';
import { toolErrorText, toolLabelClass, toolSelectClass } from '../toolUtils';
import { useToolInput } from '../toolsStore';

const TOOL = 'random';

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
    // Eski tarayıcı: yalnızca üstteki dilimler.
  }
  return [...new Set([userZone(), 'Europe/Istanbul', 'UTC', ...all])];
}

/** Boş ya da sayı olmayan sınırda açık hata (Number('') 0 olurdu). */
function parseNumber(text: string, label: string): number {
  const value = Number(text.trim().replace(',', '.'));
  if (!text.trim() || !Number.isFinite(value))
    throw new ToolError(translate('toolsSecurity', 'random.notNumber', { label }));
  return value;
}

function parseMoment(text: string, zone: string, label: string): Date {
  const parsed = parseTimestamp(text, zone);
  if (!parsed) throw new ToolError(translate('toolsSecurity', 'random.notMoment', { label }));
  return parsed.date;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className={toolLabelClass}>
      {label}
      {children}
    </label>
  );
}

export default function RandomTool() {
  const t = useT('toolsSecurity');
  const [section, setSection] = useToolInput(TOOL, 'section', 'number');
  const [countText, setCountText] = useToolInput(TOOL, 'count', '10');
  const [unique, setUnique] = useToolInput(TOOL, 'unique', '');
  const [sort, setSort] = useToolInput(TOOL, 'sort', 'none');
  const [numberKind, setNumberKind] = useToolInput(TOOL, 'numberKind', 'integer');
  const [min, setMin] = useToolInput(TOOL, 'min', '1');
  const [max, setMax] = useToolInput(TOOL, 'max', '100');
  const [precisionText, setPrecisionText] = useToolInput(TOOL, 'precision', '2');
  const [from, setFrom] = useToolInput(TOOL, 'from', '2026-01-01T00:00:00');
  const [to, setTo] = useToolInput(TOOL, 'to', '2026-12-31T23:59:59');
  const [step, setStep] = useToolInput(TOOL, 'step', 'second');
  const [dateFormat, setDateFormat] = useToolInput(TOOL, 'dateFormat', 'zoned');
  const [zone, setZone] = useToolInput(TOOL, 'zone', userZone());
  const [values, setValues] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const zones = useMemo(zoneList, []);

  const n = Math.floor(Number(countText));
  const count = Number.isFinite(n) ? Math.min(RANDOM_MAX_COUNT, Math.max(1, n)) : 1;
  const p = Math.floor(Number(precisionText));
  const precision = Number.isFinite(p) ? Math.min(RANDOM_MAX_PRECISION, Math.max(0, p)) : 2;

  const regenerate = () => {
    try {
      const options = { count, unique: unique === '1', sort: sort as RandomSort };
      let list: string[];
      if (section === 'date') {
        list = randomDateList(
          parseMoment(from, zone, t('random.from')),
          parseMoment(to, zone, t('random.to')),
          {
            ...options,
            step: step as DateStep,
            format: dateFormat as DateOutputFormat,
            timeZone: zone,
          },
        );
      } else {
        const low = parseNumber(min, t('random.min'));
        const high = parseNumber(max, t('random.max'));
        list =
          numberKind === 'decimal'
            ? randomDecimalList(low, high, precision, options)
            : randomIntegerList(low, high, options).map(String);
      }
      setValues(list);
      setError(null);
    } catch (e) {
      setValues([]);
      setError(toolErrorText(e));
    }
  };

  // Seçenek değişince yeniden üretilir.
  useEffect(regenerate, [
    t,
    section,
    count,
    unique,
    sort,
    numberKind,
    min,
    max,
    precision,
    from,
    to,
    step,
    dateFormat,
    zone,
  ]);

  const tab = (value: string, label: string) => (
    <Button
      size="sm"
      variant={section === value ? 'primary' : 'secondary'}
      aria-pressed={section === value}
      onClick={() => setSection(value)}
    >
      {label}
    </Button>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <ToolOptions>
        <div className="flex items-center gap-1" role="group" aria-label={t('random.section')}>
          {tab('number', t('random.number'))}
          {tab('date', t('random.date'))}
        </div>
        <Field label={t('random.count')}>
          <Input
            type="number"
            min={1}
            max={RANDOM_MAX_COUNT}
            className="h-7 w-20 text-xs"
            value={countText}
            onChange={(e) => setCountText(e.target.value)}
            onBlur={() => setCountText(String(count))}
            aria-label={t('random.count')}
          />
        </Field>
        <label className={toolLabelClass}>
          <input
            type="checkbox"
            checked={unique === '1'}
            onChange={(e) => setUnique(e.target.checked ? '1' : '')}
          />
          {t('random.unique')}
        </label>
        <Field label={t('random.order')}>
          <select className={toolSelectClass} value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="none">{t('random.orderNone')}</option>
            <option value="asc">{t('random.orderAsc')}</option>
            <option value="desc">{t('random.orderDesc')}</option>
          </select>
        </Field>
        <Button size="sm" onClick={regenerate}>
          <RefreshCw className="h-3.5 w-3.5" /> {t('random.regenerate')}
        </Button>
      </ToolOptions>
      {section === 'date' ? (
        <ToolOptions>
          <Field label={t('random.from')}>
            <Input
              className="h-7 w-44 font-mono text-xs"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              aria-label={t('random.from')}
              spellCheck={false}
            />
          </Field>
          <Field label={t('random.to')}>
            <Input
              className="h-7 w-44 font-mono text-xs"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              aria-label={t('random.to')}
              spellCheck={false}
            />
          </Field>
          <Field label={t('random.zone')}>
            <select className={toolSelectClass} value={zone} onChange={(e) => setZone(e.target.value)}>
              {!zones.includes(zone) && <option value={zone}>{zone}</option>}
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('random.step')}>
            <select className={toolSelectClass} value={step} onChange={(e) => setStep(e.target.value)}>
              <option value="ms">{t('random.stepMs')}</option>
              <option value="second">{t('random.stepSecond')}</option>
              <option value="minute">{t('random.stepMinute')}</option>
              <option value="hour">{t('random.stepHour')}</option>
              <option value="day">{t('random.stepDay')}</option>
            </select>
          </Field>
          <Field label={t('random.format')}>
            <select
              className={toolSelectClass}
              value={dateFormat}
              onChange={(e) => setDateFormat(e.target.value)}
            >
              <option value="zoned">{t('random.formatZoned')}</option>
              <option value="iso">{t('random.formatIso')}</option>
              <option value="date">{t('random.formatDate')}</option>
              <option value="time">{t('random.formatTime')}</option>
              <option value="unix">{t('random.formatUnix')}</option>
              <option value="unix-ms">{t('random.formatUnixMs')}</option>
              <option value="rfc1123">{t('random.formatRfc')}</option>
            </select>
          </Field>
        </ToolOptions>
      ) : (
        <ToolOptions>
          <Field label={t('random.kind')}>
            <select
              className={toolSelectClass}
              value={numberKind}
              onChange={(e) => setNumberKind(e.target.value)}
            >
              <option value="integer">{t('random.integer')}</option>
              <option value="decimal">{t('random.decimal')}</option>
            </select>
          </Field>
          <Field label={t('random.min')}>
            <Input
              className="h-7 w-36 font-mono text-xs"
              value={min}
              onChange={(e) => setMin(e.target.value)}
              aria-label={t('random.min')}
              inputMode="decimal"
            />
          </Field>
          <Field label={t('random.max')}>
            <Input
              className="h-7 w-36 font-mono text-xs"
              value={max}
              onChange={(e) => setMax(e.target.value)}
              aria-label={t('random.max')}
              inputMode="decimal"
            />
          </Field>
          {numberKind === 'decimal' && (
            <Field label={t('random.precision')}>
              <Input
                type="number"
                min={0}
                max={RANDOM_MAX_PRECISION}
                className="h-7 w-16 text-xs"
                value={precisionText}
                onChange={(e) => setPrecisionText(e.target.value)}
                aria-label={t('random.precision')}
              />
            </Field>
          )}
        </ToolOptions>
      )}
      <ToolErrorMessage error={error} />
      <ToolPane
        label={t('random.generated', { count: values.length })}
        value={values.join('\n')}
        downloadName="rastgele.txt"
        output
      />
      <p className="text-[11px] text-fg-subtle">{t('random.note')}</p>
    </div>
  );
}
