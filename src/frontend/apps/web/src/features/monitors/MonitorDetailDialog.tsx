import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  PauseCircle,
  Play,
  Settings,
  Trash2,
  XCircle,
} from 'lucide-react';
import { Alert, Button, Spinner, cn } from '@apivator/ui';
import type { MonitorDto, MonitorRunPointDto } from '@apivator/core';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Dialog } from '../../components/ui/Dialog';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { fullTime, timeAgo } from '../activity/activity';
import { useT, formatPercent } from '../../i18n';
import { methodColor } from '../requests/methodColors';
import { MonitorSettingsDialog } from './MonitorSettingsDialog';
import { ResponseChart } from './ResponseChart';
import { describeSchedule } from './monitorSchedule';
import { monitorRunsQueryKey, monitorStats, monitorsQueryKey } from './useMonitors';

const PERIODS = [
  { days: 1, key: 'detail.periodDay' },
  { days: 7, key: 'detail.periodWeek' },
  { days: 30, key: 'detail.periodMonth' },
] as const;

export function MonitorState({ monitor }: { monitor: MonitorDto }) {
  const t = useT('monitors');
  if (monitor.lastError)
    return (
      <span className="flex items-center gap-1 text-danger">
        <PauseCircle className="h-3.5 w-3.5" aria-hidden="true" /> {t('state.stopped')}
      </span>
    );
  if (!monitor.enabled)
    return (
      <span className="flex items-center gap-1 text-fg-subtle">
        <PauseCircle className="h-3.5 w-3.5" aria-hidden="true" /> {t('state.off')}
      </span>
    );
  if (monitor.health === 'Failing')
    return (
      <span className="flex items-center gap-1 text-danger">
        <XCircle className="h-3.5 w-3.5" aria-hidden="true" /> {t('state.failing')}
      </span>
    );
  if (monitor.health === 'Healthy')
    return (
      <span className="flex items-center gap-1 text-success">
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> {t('state.healthy')}
      </span>
    );
  return (
    <span className="flex items-center gap-1 text-fg-subtle">
      <CircleDashed className="h-3.5 w-3.5" aria-hidden="true" /> {t('state.never')}
    </span>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'danger' | 'success' }) {
  return (
    <div className="rounded-md border border-line px-3 py-2">
      <div className="text-xs text-fg-subtle">{label}</div>
      <div
        className={cn(
          'text-lg font-semibold tabular-nums',
          tone === 'danger' && 'text-danger',
          tone === 'success' && 'text-success',
        )}
      >
        {value}
      </div>
    </div>
  );
}

export function MonitorDetailDialog({
  monitor,
  canEdit,
  onClose,
}: {
  monitor: MonitorDto;
  canEdit: boolean;
  onClose: () => void;
}) {
  const t = useT('monitors');
  const queryClient = useQueryClient();
  const [days, setDays] = useState<number>(7);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runs = useQuery({
    queryKey: monitorRunsQueryKey(monitor.id, days),
    queryFn: () => api.monitors.runs(monitor.id, days),
  });
  const points = runs.data ?? [];
  const stats = monitorStats(points);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: monitorsQueryKey(monitor.workspaceId) }),
      queryClient.invalidateQueries({ queryKey: ['monitor-runs', monitor.id] }),
    ]);
  };

  async function runNow() {
    setRunning(true);
    setError(null);
    try {
      await api.monitors.run(monitor.id);
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
      await refresh();
    } finally {
      setRunning(false);
    }
  }

  return (
    <Dialog title={t('detail.title', { name: monitor.name })} size="xl" onClose={onClose}>
      <div className="flex flex-col gap-4 text-[13px]">
        {monitor.lastError && <Alert tone="error">{monitor.lastError}</Alert>}
        {error && <Alert tone="error">{error}</Alert>}

        <section aria-label={t('detail.status')} className="flex items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1 text-fg-muted">
            <MonitorState monitor={monitor} />
            <span>{monitor.collectionName}</span>
            <span>
              {describeSchedule(monitor.schedule)} ({monitor.timeZone})
            </span>
            {monitor.nextRunAt && <span>{t('detail.next', { time: fullTime(monitor.nextRunAt) })}</span>}
            <span>{t('detail.runsAs', { name: monitor.createdByName })}</span>
          </div>
          {canEdit && (
            <div className="flex shrink-0 items-center gap-1">
              <Button size="sm" onClick={() => void runNow()} loading={running}>
                <Play className="h-3.5 w-3.5" /> {t('detail.runNow')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                <Settings className="h-3.5 w-3.5" /> {t('detail.settings')}
              </Button>
              <Button size="sm" variant="ghost" className="text-danger" onClick={() => setDeleting(true)}>
                <Trash2 className="h-3.5 w-3.5" /> {t('detail.delete')}
              </Button>
            </div>
          )}
        </section>

        <div className="flex items-center gap-1" role="group" aria-label={t('detail.period')}>
          {PERIODS.map((p) => (
            <button
              key={p.days}
              type="button"
              aria-pressed={days === p.days}
              onClick={() => setDays(p.days)}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs',
                days === p.days ? 'bg-accent/10 font-medium text-accent' : 'text-fg-muted hover:bg-muted',
              )}
            >
              {t(p.key)}
            </button>
          ))}
        </div>

        {runs.isLoading ? (
          <Spinner className="mx-auto h-4 w-4 text-fg-subtle" />
        ) : runs.error ? (
          <Alert tone="error">{errorMessage(runs.error)}</Alert>
        ) : points.length === 0 ? (
          <p className="py-6 text-center text-fg-muted">
            {monitor.nextRunAt
              ? t('detail.emptyWithNext', { time: fullTime(monitor.nextRunAt) })
              : t('detail.empty')}
          </p>
        ) : (
          <>
            <div className="grid grid-cols-4 gap-2">
              <Stat
                label={t('detail.successRate')}
                value={stats.successRate === null ? '–' : formatPercent(stats.successRate)}
                tone={stats.successRate !== null && stats.successRate < 100 ? 'danger' : 'success'}
              />
              <Stat label={t('detail.runs')} value={`${stats.healthy} / ${stats.runs}`} />
              <Stat
                label={t('detail.avgResponse')}
                value={stats.avgResponseMs === null ? '–' : `${Math.round(stats.avgResponseMs)} ms`}
              />
              <Stat
                label={t('detail.consecutiveFailures')}
                value={String(monitor.consecutiveFailures)}
                tone={monitor.consecutiveFailures ? 'danger' : undefined}
              />
            </div>
            <ResponseChart points={points} />
            <RunList points={points} />
          </>
        )}
      </div>

      {editing && (
        <MonitorSettingsDialog
          workspaceId={monitor.workspaceId}
          monitor={monitor}
          onSaved={() => {
            setEditing(false);
            void refresh();
          }}
          onClose={() => setEditing(false)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={t('detail.deleteTitle')}
          confirmLabel={t('detail.deleteConfirm')}
          onConfirm={async () => {
            await api.monitors.remove(monitor.id);
            await refresh();
            onClose();
          }}
          onClose={() => setDeleting(false)}
        >
          {t('detail.deleteBody', { name: monitor.name })}
        </ConfirmDialog>
      )}
    </Dialog>
  );
}

/** Son çalıştırmalar (yeniden eskiye); tıklanınca başarısız istekler ve testler açılır. */
function RunList({ points }: { points: MonitorRunPointDto[] }) {
  const t = useT('monitors');
  const [open, setOpen] = useState<string | null>(null);
  const recent = [...points].reverse().slice(0, 30);
  return (
    <section aria-label={t('runs.title')} className="flex flex-col gap-1">
      <h3 className="text-xs font-medium text-fg-muted">{t('runs.title')}</h3>
      <ul className="divide-y divide-line rounded-md border border-line">
        {recent.map((p) => {
          const expanded = open === p.id;
          return (
            <li key={p.id}>
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setOpen(expanded ? null : p.id)}
                className="flex w-full items-center gap-3 px-3 py-1.5 text-start hover:bg-muted/60"
              >
                {expanded ? (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
                )}
                {p.healthy ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-label={t('runs.success')} />
                ) : (
                  <XCircle className="h-4 w-4 shrink-0 text-danger" aria-label={t('runs.failure')} />
                )}
                <span className="w-40 shrink-0 text-fg-muted" title={fullTime(p.startedAt)}>
                  {timeAgo(p.startedAt)}
                </span>
                <span className="min-w-0 flex-1 truncate text-fg-subtle">
                  {p.origin === 'Monitor' ? t('runs.scheduled') : t('runs.manual')}
                  {p.status !== 'Completed' && ` · ${t('runs.incomplete')}`}
                  {p.requestErrors > 0 && ` · ${t('runs.requestErrors', { count: p.requestErrors })}`}
                </span>
                <span className="shrink-0 text-xs">
                  <span className="text-success">✓{p.testsPassed}</span>{' '}
                  <span className={p.testsFailed ? 'text-danger' : 'text-fg-subtle'}>✗{p.testsFailed}</span>
                </span>
                <span className="w-28 shrink-0 text-end text-xs text-fg-subtle">
                  {t('runs.summary', { requests: p.totalRequests, ms: Math.round(p.totalTimeMs) })}
                </span>
              </button>
              {expanded && <RunFailures runId={p.id} />}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function RunFailures({ runId }: { runId: string }) {
  const t = useT('monitors');
  const { data, isLoading, error } = useQuery({
    queryKey: ['run', runId],
    queryFn: () => api.runs.get(runId),
  });
  if (isLoading) return <Spinner className="mx-auto my-2 h-4 w-4 text-fg-subtle" />;
  if (error) return <Alert tone="error">{errorMessage(error)}</Alert>;
  const results = data?.results ?? [];
  return (
    <ul className="border-t border-line bg-muted/30 px-9 py-2 text-xs">
      {results.map((r, i) => {
        const failedTests = r.tests.filter((test) => test.status === 'failed');
        return (
          <li key={`${r.requestId}-${i}`} className="py-0.5">
            <span className={cn('inline-block w-14 font-mono font-semibold', methodColor(r.method))}>
              {r.method}
            </span>
            <span className="font-medium">{r.name}</span>{' '}
            <span className={r.error || (r.status ?? 0) >= 400 ? 'text-danger' : 'text-fg-subtle'}>
              {r.error ?? r.status ?? t('runs.noResponse')}
            </span>{' '}
            <span className="text-fg-subtle">{Math.round(r.timeMs)} ms</span>
            {failedTests.map((test) => (
              <div key={test.name} className="ps-14 text-danger">
                ✗ {test.name}
                {test.error ? `: ${test.error}` : ''}
              </div>
            ))}
          </li>
        );
      })}
    </ul>
  );
}
