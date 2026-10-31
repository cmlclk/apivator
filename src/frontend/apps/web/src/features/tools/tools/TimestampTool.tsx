import { useEffect, useMemo, useState } from 'react';
import { Clock } from 'lucide-react';
import { Button } from '@apivator/ui';
import { durationBetween, formatDate, parseTimestamp, type ParsedTimestamp } from '@apivator/core/tools';
import { CopyButton } from '../../../components/ui/CopyButton';
import { useT } from '../../../i18n';
import { ToolErrorMessage, ToolOptions } from '../ToolLayout';
import { useToolInput } from '../toolsStore';
import { toolErrorText, toolLabelClass, toolSelectClass } from '../toolUtils';

const TOOL = 'timestamp';

const FALLBACK_ZONES = [
  'Europe/London',
  'Europe/Berlin',
  'Europe/Moscow',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Australia/Sydney',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
];

const inputClass =
  'h-8 w-full rounded-md border border-line bg-surface px-2 font-mono text-[12.5px] text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25';

function userZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Kullanıcının dilimi, İstanbul ve UTC en üstte; ardından tarayıcının bildiği tüm dilimler. */
function zoneList(): string[] {
  let all: string[];
  try {
    all = Intl.supportedValuesOf('timeZone');
  } catch {
    all = FALLBACK_ZONES;
  }
  return [...new Set([userZone(), 'Europe/Istanbul', 'UTC', ...all])];
}

const nowSeconds = () => String(Math.floor(Date.now() / 1000));

/** Ofsetsiz tarihleri seçili dilimde yorumlar; dilim geçersizse (eski kayıt) tarayıcı kuralına düşer. */
function parseIn(value: string, zone: string): ParsedTimestamp | null {
  try {
    return parseTimestamp(value, zone);
  } catch {
    return parseTimestamp(value);
  }
}

/** Göreli süre ("3 saat önce") canlı kalsın diye saniyede bir yenilenen saat. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function Row({ label, value }: { label: string; value: string }) {
  const t = useT('toolsMisc');
  return (
    <div className="flex items-center gap-2 border-b border-line px-2 py-1 last:border-b-0">
      <span className="w-36 shrink-0 text-xs text-fg-muted">{label}</span>
      <span className="min-w-0 flex-1 font-mono text-[12.5px] break-all text-fg">{value}</span>
      <CopyButton text={value} label={t('timestamp.copyRow', { label })} compact />
    </div>
  );
}

function DateField({
  label,
  value,
  zone,
  onChange,
}: {
  label: string;
  value: string;
  zone: string;
  onChange: (value: string) => void;
}) {
  const t = useT('toolsMisc');
  const parsed = value.trim() ? parseIn(value, zone) : null;
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-fg-muted">
      {label}
      <div className="flex items-center gap-1">
        <input
          className={inputClass}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t('timestamp.datePlaceholder')}
          spellCheck={false}
        />
        <Button size="sm" variant="secondary" onClick={() => onChange(new Date().toISOString())}>
          {t('timestamp.now')}
        </Button>
      </div>
      {value.trim() && (
        <span className={parsed ? 'text-fg-subtle' : 'text-danger'}>
          {parsed ? parsed.date.toISOString() : t('timestamp.dateUnrecognized')}
        </span>
      )}
    </label>
  );
}

export default function TimestampTool() {
  const t = useT('toolsMisc');
  const [input, setInput] = useToolInput(TOOL, 'input');
  const [zone, setZone] = useToolInput(TOOL, 'zone', userZone());
  const [from, setFrom] = useToolInput(TOOL, 'from');
  const [to, setTo] = useToolInput(TOOL, 'to');
  const zones = useMemo(zoneList, []);
  const now = useNow();

  const parsed = input.trim() ? parseIn(input, zone) : null;
  let formatted: ReturnType<typeof formatDate> | null = null;
  let error: string | null = input.trim() && !parsed ? t('timestamp.unrecognized') : null;
  if (parsed) {
    try {
      formatted = formatDate(parsed.date, zone, now);
    } catch (e) {
      error = toolErrorText(e);
    }
  }

  const fromDate = from.trim() ? parseIn(from, zone)?.date : undefined;
  const toDate = to.trim() ? parseIn(to, zone)?.date : undefined;
  const duration = fromDate && toDate ? durationBetween(fromDate, toDate) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto">
      <section className="flex flex-col gap-2">
        <ToolOptions>
          <div className="flex min-w-64 flex-1 items-center gap-1">
            <input
              className={inputClass}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              // eslint-disable-next-line apivator/no-literal-jsx-text -- zaman damgası biçimi örnekleri
              placeholder="1761746700, 1761746700123, 2026-10-29T14:05:00+03:00, Thu, 29 Oct 2026 11:05:00 GMT"
              spellCheck={false}
              aria-label={t('timestamp.inputLabel')}
            />
            <Button size="sm" variant="secondary" onClick={() => setInput(nowSeconds())}>
              <Clock className="h-3.5 w-3.5" /> {t('timestamp.now')}
            </Button>
          </div>
          <label className={toolLabelClass}>
            {t('timestamp.timeZone')}
            <select className={toolSelectClass} value={zone} onChange={(e) => setZone(e.target.value)}>
              {!zones.includes(zone) && <option value={zone}>{zone}</option>}
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
          </label>
        </ToolOptions>
        {parsed && (
          <p className="text-xs text-fg-subtle">
            {t(parsed.zoned ? 'timestamp.interpretedZoned' : 'timestamp.interpreted', {
              source: t(`timestamp.sources.${parsed.source}`),
              zone,
            })}
          </p>
        )}
        <ToolErrorMessage error={error} />
        {formatted && (
          <div className="rounded-md border border-line">
            <Row label={t('timestamp.unixSeconds')} value={String(formatted.unixSeconds)} />
            <Row label={t('timestamp.unixMilliseconds')} value={String(formatted.unixMilliseconds)} />
            <Row label="ISO 8601 (UTC)" value={formatted.iso} />
            <Row label={t('timestamp.isoZoned', { zone })} value={formatted.isoZoned} />
            <Row label="RFC 1123 (HTTP)" value={formatted.rfc1123} />
            <Row label={t('timestamp.readable')} value={formatted.local} />
            <Row label={t('timestamp.relative')} value={formatted.relative} />
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold text-fg-muted">{t('timestamp.durationTitle')}</h3>
        <div className="flex flex-col gap-3 md:flex-row">
          <DateField label={t('timestamp.start')} zone={zone} value={from} onChange={setFrom} />
          <DateField label={t('timestamp.end')} zone={zone} value={to} onChange={setTo} />
        </div>
        {duration && (
          <div className="rounded-md border border-line">
            <Row label={t('timestamp.duration')} value={duration.text} />
            <Row label={t('timestamp.totalSeconds')} value={String(duration.totalSeconds)} />
            <Row label={t('timestamp.totalMinutes')} value={String(Math.trunc(duration.totalSeconds / 60))} />
            <Row label={t('timestamp.totalHours')} value={String(Math.trunc(duration.totalSeconds / 3600))} />
          </div>
        )}
      </section>
    </div>
  );
}
