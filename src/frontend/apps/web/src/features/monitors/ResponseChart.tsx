import { useState } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { cn } from '@apivator/ui';
import type { MonitorRunPointDto } from '@apivator/core';
import { formatDateTime, formatNumber, translate, useT } from '../../i18n';
import { perRequestMs } from './useMonitors';

function formatMs(ms: number) {
  return ms >= 1000
    ? translate('monitors', 'chart.seconds', {
        value: formatNumber(ms / 1000, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
      })
    : `${Math.round(ms)} ms`;
}

/** Üst sınırı okunur bir değere yuvarlar (100, 200, 500, 1000…). */
function niceMax(value: number) {
  if (value <= 0) return 100;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 5, 10].find((s) => s * magnitude >= value) ?? 10;
  return step * magnitude;
}

/**
 * Her çalıştırma bir çubuk: yükseklik istek başına ortalama yanıt süresi, renk sonuç (başarılı/başarısız).
 * Renk tek başına anlam taşımaz: üstte simgeli açıklama, üzerine gelince ayrıntı ve altta tablo görünümü var.
 */
export function ResponseChart({ points }: { points: MonitorRunPointDto[] }) {
  const t = useT('monitors');
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  if (points.length === 0) return null;

  const max = niceMax(Math.max(...points.map(perRequestMs)));
  const hovered = hover === null ? null : points[hover];

  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="flex items-center gap-4 text-xs text-fg-muted">
        <span className="font-medium text-fg">{t('chart.title')}</span>
        <span className="flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3 text-success" aria-hidden="true" /> {t('chart.ok')}
        </span>
        <span className="flex items-center gap-1">
          <XCircle className="h-3 w-3 text-danger" aria-hidden="true" /> {t('chart.failed')}
        </span>
        <button
          type="button"
          onClick={() => setTable((t) => !t)}
          className="ms-auto text-accent hover:underline"
        >
          {table ? t('chart.chartView') : t('chart.tableView')}
        </button>
      </figcaption>

      {table ? (
        <div className="max-h-48 overflow-auto rounded-md border border-line">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-surface text-start text-fg-subtle">
              <tr>
                <th className="px-2 py-1 font-medium">{t('chart.time')}</th>
                <th className="px-2 py-1 font-medium">{t('chart.result')}</th>
                <th className="px-2 py-1 text-end font-medium">{t('chart.perRequest')}</th>
              </tr>
            </thead>
            <tbody>
              {[...points].reverse().map((p) => (
                <tr key={p.id} className="border-t border-line">
                  <td className="px-2 py-1">{formatDateTime(p.startedAt)}</td>
                  <td className="px-2 py-1">{p.healthy ? t('chart.ok') : t('chart.failed')}</td>
                  <td className="px-2 py-1 text-end tabular-nums">{formatMs(perRequestMs(p))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <div className="flex h-32 gap-2">
            <div className="flex w-12 shrink-0 flex-col justify-between text-end text-[10px] text-fg-subtle tabular-nums">
              <span>{formatMs(max)}</span>
              <span>{formatMs(max / 2)}</span>
              <span>0</span>
            </div>
            <div
              className="relative flex min-w-0 flex-1 items-end gap-[2px] border-b border-line"
              onMouseLeave={() => setHover(null)}
            >
              <div className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-line/70" />
              <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-line/70" />
              {points.map((p, i) => (
                <div
                  key={p.id}
                  role="img"
                  aria-label={t(p.healthy ? 'chart.pointOk' : 'chart.pointFailed', {
                    time: formatDateTime(p.startedAt),
                    value: formatMs(perRequestMs(p)),
                  })}
                  onMouseEnter={() => setHover(i)}
                  className="flex h-full max-w-4 min-w-px flex-1 items-end"
                >
                  <div
                    className={cn(
                      'w-full rounded-t-[3px]',
                      p.healthy ? 'bg-success' : 'bg-danger',
                      hover !== null && hover !== i && 'opacity-40',
                    )}
                    style={{ height: `${Math.max(2, (perRequestMs(p) / max) * 100)}%` }}
                  />
                </div>
              ))}
            </div>
          </div>
          {hovered && (
            <div className="pointer-events-none absolute top-0 end-0 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs shadow-md">
              <div className="flex items-center gap-1 font-medium">
                {hovered.healthy ? (
                  <CheckCircle2 className="h-3 w-3 text-success" aria-hidden="true" />
                ) : (
                  <XCircle className="h-3 w-3 text-danger" aria-hidden="true" />
                )}
                {hovered.healthy ? t('chart.ok') : t('chart.failed')} · {formatDateTime(hovered.startedAt)}
              </div>
              <div className="text-fg-muted">
                {t('chart.hover', {
                  value: formatMs(perRequestMs(hovered)),
                  requests: hovered.totalRequests,
                  passed: hovered.testsPassed,
                  failed: hovered.testsFailed,
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </figure>
  );
}
