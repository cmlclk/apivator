import { CheckCircle2, History, Trash2, XCircle } from 'lucide-react';
import { formatDuration, type RunSummaryDto } from '@apivator/core';
import { Alert, Spinner } from '@apivator/ui';
import { formatDateTime, useT } from '../../i18n';

export function RunHistory({
  loading,
  error,
  runs,
  onOpen,
  onDelete,
}: {
  loading: boolean;
  error: string | null;
  runs: RunSummaryDto[];
  onOpen: (run: RunSummaryDto) => void;
  onDelete: (run: RunSummaryDto) => Promise<void>;
}) {
  const t = useT('runner');
  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <Spinner className="h-5 w-5" />
      </div>
    );
  }
  if (error) return <Alert tone="error">{error}</Alert>;
  if (!runs.length) {
    return (
      <div className="flex flex-col items-center gap-2 py-12 text-center text-sm text-fg-subtle">
        <History className="h-7 w-7 opacity-60" aria-hidden="true" />
        {t('history.empty')}
      </div>
    );
  }
  const statusLabel = {
    Completed: 'status.completed',
    Stopped: 'status.stopped',
    Failed: 'status.failed',
  } as const;
  return (
    <ul aria-label={t('history.list')} className="divide-y divide-line rounded-md border border-line">
      {runs.map((r) => (
        <li key={r.id} className="group flex items-center gap-3 px-3 py-2 text-[13px] hover:bg-muted">
          <button
            type="button"
            onClick={() => onOpen(r)}
            className="flex min-w-0 flex-1 items-center gap-3 text-start"
          >
            {r.testsFailed === 0 && r.failedRequests === 0 && r.status === 'Completed' ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-label={t('history.success')} />
            ) : (
              <XCircle className="h-4 w-4 shrink-0 text-danger" aria-label={t('history.failure')} />
            )}
            <span className="w-36 shrink-0 text-fg-muted">{formatDateTime(r.startedAt)}</span>
            <span className="min-w-0 flex-1 truncate">
              {r.name}
              <span className="text-fg-subtle">
                {' '}
                · {r.userName}
                {r.environmentName ? ` · ${r.environmentName}` : ''} ·{' '}
                {t('history.iterations', { count: r.iterations })} · {t(statusLabel[r.status])}
                {r.origin === 'Desktop' && ` · ${t('history.fromDesktop')}`}
                {r.origin === 'Cli' && ` · ${t('history.fromCli')}`}
                {r.origin === 'Monitor' && ` · ${t('history.fromMonitor')}`}
              </span>
            </span>
            <span className="shrink-0 text-xs">
              <span className="text-success">✓{r.testsPassed}</span>{' '}
              <span className={r.testsFailed ? 'text-danger' : 'text-fg-subtle'}>✗{r.testsFailed}</span>
            </span>
            <span className="w-24 shrink-0 text-end text-xs text-fg-subtle">
              {t('history.requests', { requests: r.totalRequests, duration: formatDuration(r.totalTimeMs) })}
            </span>
          </button>
          <button
            type="button"
            onClick={() => void onDelete(r)}
            aria-label={t('history.deleteReport')}
            title={t('history.deleteReport')}
            className="rounded p-1 text-fg-subtle opacity-0 group-hover:opacity-100 hover:bg-danger/10 hover:text-danger"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </li>
      ))}
    </ul>
  );
}
