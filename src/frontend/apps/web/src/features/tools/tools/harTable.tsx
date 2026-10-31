import { useMemo } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { cn } from '@apivator/ui';
import {
  harMimeCategories,
  filterHarEntries,
  sortHarEntries,
  type HarEntry,
  type HarMimeCategory,
  type HarSortKey,
} from '@apivator/core/tools';
import { toolLabelClass, toolSelectClass } from '../toolUtils';
import { useToolInput } from '../toolsStore';
import { formatBytes, formatMs } from './harFormat';
import { useT } from '../../../i18n';

/** Tablo bundan fazla satırı DOM'a basmaz (binlerce kayıtlı HAR'da sayfa donmasın). */
const MAX_ROWS = 1000;
const STATUS_CLASSES = ['1xx', '2xx', '3xx', '4xx', '5xx', 'hata'];

/** Kaydın ilk isteğe göre başlangıç zamanı: +1.25 sn */
function formatStart(entry: HarEntry, firstMs: number | null): string {
  if (entry.startMs === null || firstMs === null) return '—';
  return `+${formatMs(entry.startMs - firstMs)}`;
}

const statusTone = (status: number) =>
  status === 0 || status >= 500
    ? 'text-danger'
    : status >= 400
      ? 'text-warning'
      : status >= 300
        ? 'text-fg-muted'
        : 'text-success';

const COLUMNS: { key: HarSortKey; className?: string }[] = [
  { key: 'method' },
  { key: 'url', className: 'w-full' },
  { key: 'status' },
  { key: 'mimeType' },
  { key: 'size' },
  { key: 'time' },
  { key: 'start' },
];

/** Süzgeçler, sıralanabilir kayıt tablosu; seçilen kaydın dosyadaki sırası `selected`. */
export function HarTable({
  entries,
  selected,
  onSelect,
}: {
  entries: HarEntry[];
  selected: number | null;
  onSelect: (index: number) => void;
}) {
  const t = useT('toolsData');
  const [text, setText] = useToolInput('har', 'filterText');
  const [method, setMethod] = useToolInput('har', 'filterMethod');
  const [statusClass, setStatusClass] = useToolInput('har', 'filterStatus');
  const [mime, setMime] = useToolInput('har', 'filterMime');
  const [sortKey, setSortKey] = useToolInput('har', 'sortKey', 'start');
  const [sortDir, setSortDir] = useToolInput('har', 'sortDir', 'asc');

  const methods = useMemo(() => [...new Set(entries.map((e) => e.method))].sort(), [entries]);
  const firstMs = useMemo(
    () =>
      entries.reduce<number | null>(
        (min, e) => (e.startMs === null || (min !== null && min <= e.startMs) ? min : e.startMs),
        null,
      ),
    [entries],
  );
  const rows = useMemo(
    () =>
      sortHarEntries(
        filterHarEntries(entries, {
          text,
          method,
          statusClass,
          mimeCategory: mime as HarMimeCategory | '',
        }),
        sortKey as HarSortKey,
        sortDir === 'desc',
      ),
    [entries, text, method, statusClass, mime, sortKey, sortDir],
  );

  const sortBy = (key: HarSortKey) => {
    if (key === sortKey) setSortDir(sortDir === 'desc' ? 'asc' : 'desc');
    else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  return (
    <section className="flex min-h-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('har.table.search')}
          aria-label={t('har.table.search')}
          className="h-7 w-56 rounded-md border border-line bg-surface px-2 text-xs text-fg"
        />
        <label className={toolLabelClass}>
          {t('har.table.method')}
          <select className={toolSelectClass} value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="">{t('har.table.all')}</option>
            {methods.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
        <label className={toolLabelClass}>
          {t('har.table.status')}
          <select
            className={toolSelectClass}
            value={statusClass}
            onChange={(e) => setStatusClass(e.target.value)}
          >
            <option value="">{t('har.table.all')}</option>
            {STATUS_CLASSES.map((s) => (
              <option key={s} value={s}>
                {s === 'hata' ? t('har.table.noResponse') : s}
              </option>
            ))}
          </select>
        </label>
        <label className={toolLabelClass}>
          {t('har.table.type')}
          <select className={toolSelectClass} value={mime} onChange={(e) => setMime(e.target.value)}>
            <option value="">{t('har.table.all')}</option>
            {harMimeCategories().map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <span className="text-xs text-fg-subtle" aria-live="polite">
          {rows.length === entries.length
            ? t('har.table.recordCount', { count: entries.length })
            : t('har.table.recordFiltered', { shown: rows.length, total: entries.length })}
        </span>
      </div>
      <div className="max-h-80 min-h-24 overflow-auto rounded-md border border-line">
        <table className="w-full border-collapse text-[12.5px]" aria-label={t('har.table.entries')}>
          <thead className="sticky top-0 bg-surface">
            <tr className="text-start text-[11px] font-medium tracking-wide text-fg-subtle uppercase">
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  className={cn('border-b border-line px-2 py-1 font-medium whitespace-nowrap', c.className)}
                  aria-sort={
                    sortKey === c.key ? (sortDir === 'desc' ? 'descending' : 'ascending') : undefined
                  }
                >
                  <button
                    type="button"
                    className="flex items-center gap-1 uppercase hover:text-fg"
                    onClick={() => sortBy(c.key)}
                  >
                    {t(`har.columns.${c.key}`)}
                    {sortKey === c.key &&
                      (sortDir === 'desc' ? (
                        <ArrowDown className="h-3 w-3" />
                      ) : (
                        <ArrowUp className="h-3 w-3" />
                      ))}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="font-mono">
            {rows.slice(0, MAX_ROWS).map((e) => (
              <tr
                key={e.index}
                aria-selected={selected === e.index}
                className={cn(
                  'cursor-pointer align-top hover:bg-muted',
                  selected === e.index && 'bg-accent/10',
                )}
                onClick={() => onSelect(e.index)}
              >
                <td className="border-b border-line px-2 py-1 font-semibold">{e.method}</td>
                <td className="max-w-0 border-b border-line px-2 py-1" title={e.url}>
                  <button
                    type="button"
                    className="block w-full truncate text-start text-fg"
                    onClick={() => onSelect(e.index)}
                  >
                    {e.path || e.url}
                    {e.host && <span className="ms-2 text-fg-subtle">{e.host}</span>}
                  </button>
                </td>
                <td className={cn('border-b border-line px-2 py-1', statusTone(e.status))}>
                  {e.status || '—'}
                </td>
                <td className="border-b border-line px-2 py-1 whitespace-nowrap text-fg-muted">
                  {e.mimeType || '—'}
                </td>
                <td className="border-b border-line px-2 py-1 whitespace-nowrap text-fg-muted">
                  {formatBytes(e.size)}
                </td>
                <td className="border-b border-line px-2 py-1 whitespace-nowrap text-fg-muted">
                  {formatMs(e.time)}
                </td>
                <td className="border-b border-line px-2 py-1 whitespace-nowrap text-fg-subtle">
                  {formatStart(e, firstMs)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="p-3 text-sm text-fg-muted">{t('har.table.noMatch')}</p>}
        {rows.length > MAX_ROWS && (
          <p className="p-2 text-xs text-fg-subtle">{t('har.table.firstShown', { count: MAX_ROWS })}</p>
        )}
      </div>
    </section>
  );
}
