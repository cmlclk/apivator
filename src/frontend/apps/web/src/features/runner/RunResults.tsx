import { useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, CircleSlash, Play, Square, XCircle } from 'lucide-react';
import {
  formatDuration,
  runResultTables,
  type ConsoleEntry,
  type RunResultEntry,
  type RunSummaryDto,
} from '@apivator/core';
import { Alert, Button, Spinner, cn } from '@apivator/ui';
import { useT } from '../../i18n';
import { methodColor } from '../requests/methodColors';
import { ExportTablesMenu } from '../export/ExportTablesMenu';

export interface RunView {
  runId: string | null;
  iterations: number;
  plannedPerIteration: number;
  results: RunResultEntry[];
  logs: Record<number, ConsoleEntry[]>;
  warnings: string[];
  summary: RunSummaryDto | null;
  message: string | null;
  running: boolean;
  /** Geçmişten açılan rapor (canlı değil). */
  fromHistory: boolean;
  /** Kullanıcı çalıştırmayı kendisi durdurdu. */
  aborted?: boolean;
}

function resultFailed(r: RunResultEntry) {
  return (
    r.error !== null || r.status === null || r.status >= 400 || r.tests.some((t) => t.status === 'failed')
  );
}

function statusColor(r: RunResultEntry) {
  if (r.error || r.status === null) return 'text-danger';
  if (r.status >= 400) return 'text-danger';
  if (r.status >= 300) return 'text-warning';
  return 'text-success';
}

export function RunResults({
  run,
  onStop,
  onBack,
  onRerun,
}: {
  run: RunView;
  onStop: () => void;
  onBack: () => void;
  onRerun: () => void;
}) {
  const t = useT('runner');
  const [onlyFailures, setOnlyFailures] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const passed = run.results.reduce(
    (n, r) => n + r.tests.filter((test) => test.status === 'passed').length,
    0,
  );
  const failed = run.results.reduce(
    (n, r) => n + r.tests.filter((test) => test.status === 'failed').length,
    0,
  );
  const failedRequests = run.results.filter((r) => r.error || r.status === null || r.status >= 400).length;
  const totalTime = run.results.reduce((n, r) => n + r.timeMs, 0);
  const planned = run.plannedPerIteration * run.iterations;
  const progress = planned ? Math.min(100, (run.results.length / planned) * 100) : 100;
  const indexed = run.results.map((result, index) => ({ result, index }));
  const shown = onlyFailures ? indexed.filter(({ result }) => resultFailed(result)) : indexed;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        <span className="flex items-center gap-1.5">
          {run.running ? (
            <Spinner className="h-4 w-4 text-accent" />
          ) : run.summary?.status === 'Completed' && failed === 0 && failedRequests === 0 ? (
            <CheckCircle2 className="h-4 w-4 text-success" />
          ) : (
            <XCircle className="h-4 w-4 text-danger" />
          )}
          <strong>
            {run.running
              ? t('status.running')
              : run.summary?.status === 'Stopped' || run.aborted
                ? t('status.stopped')
                : run.summary?.status === 'Failed'
                  ? t('status.failed')
                  : t('status.completed')}
          </strong>
        </span>
        <span className="text-success">{t('results.testsPassed', { count: passed })}</span>
        <span className={failed ? 'text-danger' : 'text-fg-subtle'}>
          {t('results.testsFailed', { count: failed })}
        </span>
        <span className={failedRequests ? 'text-danger' : 'text-fg-subtle'}>
          {t('results.failedRequests', { count: failedRequests })}
        </span>
        <span className="text-fg-subtle">
          {t('results.summary', { requests: run.results.length, duration: formatDuration(totalTime) })}
        </span>
        <span className="ms-auto flex gap-2">
          {run.running ? (
            <Button variant="secondary" size="sm" onClick={onStop}>
              <Square className="h-3.5 w-3.5" /> {t('results.stop')}
            </Button>
          ) : (
            <>
              <Button variant="secondary" size="sm" onClick={onBack}>
                {t('results.settings')}
              </Button>
              {!run.fromHistory && (
                <Button size="sm" onClick={onRerun}>
                  <Play className="h-3.5 w-3.5" /> {t('results.rerun')}
                </Button>
              )}
            </>
          )}
        </span>
      </div>

      {run.running && (
        <div
          className="h-1.5 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={Math.round(progress)}
        >
          <div className="h-full bg-accent transition-all" style={{ width: `${progress}%` }} />
        </div>
      )}
      {run.message && <Alert tone={run.summary?.status === 'Failed' ? 'error' : 'info'}>{run.message}</Alert>}
      {run.warnings.map((w, i) => (
        <Alert key={i} tone="warning">
          {w}
        </Alert>
      ))}

      <div className="flex items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-xs text-fg-muted">
          <input
            type="checkbox"
            checked={onlyFailures}
            onChange={(e) => setOnlyFailures(e.target.checked)}
            className="accent-[var(--app-accent)]"
          />
          {t('results.onlyFailures')}
        </label>
        {!run.running && run.results.length > 0 && (
          <ExportTablesMenu
            tables={() => runResultTables(run.results)}
            baseName={`${run.summary?.name ?? 'Runner'} ${(run.summary?.startedAt ?? new Date().toISOString()).slice(0, 10)}`}
            onError={setExportError}
          />
        )}
      </div>
      {exportError && <Alert tone="error">{exportError}</Alert>}

      <ul
        aria-label={t('results.list')}
        className="max-h-[50vh] divide-y divide-line overflow-y-auto rounded-md border border-line"
      >
        {shown.length === 0 && (
          <li className="p-6 text-center text-sm text-fg-subtle">
            {run.running ? t('results.waiting') : t('results.none')}
          </li>
        )}
        {shown.map(({ result, index }) => {
          const isOpen = open.has(index);
          const testsPassed = result.tests.filter((test) => test.status === 'passed').length;
          const testsFailed = result.tests.filter((test) => test.status === 'failed').length;
          const newIteration =
            run.iterations > 1 && (index === 0 || run.results[index - 1]!.iteration !== result.iteration);
          return (
            <li key={index}>
              {newIteration && !onlyFailures && (
                <p className="bg-muted/60 px-3 py-1 text-[11px] font-semibold tracking-wide text-fg-subtle uppercase">
                  {t('results.iteration', { number: result.iteration + 1 })}
                </p>
              )}
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => {
                  const next = new Set(open);
                  if (isOpen) next.delete(index);
                  else next.add(index);
                  setOpen(next);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-start text-[13px] hover:bg-muted"
              >
                {isOpen ? (
                  <ChevronDown className="h-3 w-3 shrink-0" />
                ) : (
                  <ChevronRight className="h-3 w-3 shrink-0" />
                )}
                <span
                  className={cn(
                    'w-12 shrink-0 font-mono text-[11px] font-semibold',
                    methodColor(result.method),
                  )}
                >
                  {result.method}
                </span>
                <span className="w-44 shrink-0 truncate">{result.name}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg-subtle">{result.url}</span>
                {result.tests.length > 0 && (
                  <span className="shrink-0 text-xs">
                    <span className="text-success">✓{testsPassed}</span>{' '}
                    {testsFailed > 0 && <span className="text-danger">✗{testsFailed}</span>}
                  </span>
                )}
                <span className={cn('w-14 shrink-0 text-end font-mono text-xs', statusColor(result))}>
                  {result.status ?? 'ERR'}
                </span>
                <span className="w-16 shrink-0 text-end text-xs text-fg-subtle">
                  {formatDuration(result.timeMs)}
                </span>
              </button>
              {isOpen && (
                <div className="space-y-1 bg-surface px-9 pb-2 text-xs">
                  {result.error && <p className="text-danger">{result.error}</p>}
                  {result.tests.map((test, i) => (
                    <p key={i} className="flex items-start gap-1.5">
                      {test.status === 'passed' ? (
                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                      ) : test.status === 'failed' ? (
                        <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" />
                      ) : (
                        <CircleSlash className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-subtle" />
                      )}
                      <span>
                        {test.name}
                        {test.error && <span className="block font-mono text-danger">{test.error}</span>}
                      </span>
                    </p>
                  ))}
                  {(run.logs[index] ?? []).map((l, i) => (
                    <p
                      key={`log-${i}`}
                      className={cn(
                        'font-mono whitespace-pre-wrap',
                        l.level === 'error'
                          ? 'text-danger'
                          : l.level === 'warn'
                            ? 'text-warning'
                            : 'text-fg-muted',
                      )}
                    >
                      › {l.message}
                    </p>
                  ))}
                  {!result.error && result.tests.length === 0 && !run.logs[index]?.length && (
                    <p className="text-fg-subtle">{t('results.noTests')}</p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
