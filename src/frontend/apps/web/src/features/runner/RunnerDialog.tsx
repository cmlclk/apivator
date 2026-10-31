import { useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileSpreadsheet, Play } from 'lucide-react';
import {
  DataFileError,
  parseDataFile,
  scopeValues,
  type CollectionTreeDto,
  type ExecutionVariables,
  type RunEvent,
  type RunSummaryDto,
} from '@apivator/core';
import { Alert, Button, Input, cn } from '@apivator/ui';
import { Dialog } from '../../components/ui/Dialog';
import { useT } from '../../i18n';
import { SegmentedTabs } from '../../components/ui/SegmentedTabs';
import { validTokens } from '../oauth/oauthFlow';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { useVariableScopes } from '../environments/useVariables';
import { methodColor } from '../requests/methodColors';
import { applyVariableChanges } from '../requests/useRequestActions';
import { runOrder, runsQueryKey } from './runOrder';
import { RunHistory } from './RunHistory';
import { RunResults, type RunView } from './RunResults';

interface DataFileState {
  name: string;
  rows: Record<string, string>[];
  columns: string[];
}

/** Collection (ya da klasör) runner'ı: istekleri sırayla, iterasyonlarla ve veri dosyasıyla çalıştırır. */
export function RunnerDialog({
  workspaceId,
  collection,
  folderId,
  onClose,
}: {
  workspaceId: string;
  collection: CollectionTreeDto;
  folderId: string | null;
  onClose: () => void;
}) {
  const t = useT('runner');
  const queryClient = useQueryClient();
  const items = useMemo(() => runOrder(collection, folderId), [collection, folderId]);
  const folderName = folderId ? collection.folders.find((f) => f.id === folderId)?.name : null;
  const title = folderName
    ? t('dialog.titleFolder', { name: collection.name, folder: folderName })
    : t('dialog.title', { name: collection.name });
  const scopes = useVariableScopes(workspaceId, collection);

  const [tab, setTab] = useState<'run' | 'history'>('run');
  const [selected, setSelected] = useState<Set<string>>(() => new Set(items.map((i) => i.request.id)));
  const [iterations, setIterations] = useState('1');
  const [delayMs, setDelayMs] = useState('0');
  const [data, setData] = useState<DataFileState | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);
  const [keepVariables, setKeepVariables] = useState(true);
  const [run, setRun] = useState<RunView | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const history = useQuery({
    queryKey: runsQueryKey(workspaceId, collection.id),
    queryFn: () => api.runs.list(workspaceId, collection.id),
    enabled: tab === 'history',
  });

  const iterationCount = Math.max(1, Math.min(1000, Number.parseInt(iterations, 10) || 1));
  const effectiveIterations = data ? Math.min(iterationCount, data.rows.length) : iterationCount;
  const chosen = items.filter((i) => selected.has(i.request.id));

  const loadDataFile = async (file: File) => {
    setDataError(null);
    try {
      const parsed = parseDataFile(file.name, await file.text());
      if (!parsed.rows.length) throw new DataFileError(t('data.empty'));
      setData({ name: file.name, ...parsed });
      setIterations(String(parsed.rows.length));
    } catch (e) {
      setData(null);
      setDataError(e instanceof DataFileError ? e.message : errorMessage(e));
    }
  };

  const start = async () => {
    setStartError(null);
    const scope = (kind: 'environment' | 'collection' | 'global') => {
      const found = scopes.scopes.find((s) => s.kind === kind);
      return found ? scopeValues(found) : null;
    };
    const variables: ExecutionVariables = {
      environment: scope('environment'),
      collection: scope('collection'),
      globals: scope('global'),
      environmentName: scopes.environmentName,
    };
    const controller = new AbortController();
    abort.current = controller;
    let finalVariables: ExecutionVariables | null = null;
    setRun({
      runId: null,
      iterations: effectiveIterations,
      plannedPerIteration: chosen.length,
      results: [],
      logs: {},
      warnings: [],
      summary: null,
      message: null,
      running: true,
      fromHistory: false,
    });

    const onEvent = (event: RunEvent) => {
      if (event.type === 'done') finalVariables = event.variables ?? null;
      setRun((prev) => {
        if (!prev) return prev;
        switch (event.type) {
          case 'start':
            return {
              ...prev,
              runId: event.runId ?? null,
              iterations: event.iterations ?? prev.iterations,
              plannedPerIteration: event.requests?.length ?? prev.plannedPerIteration,
            };
          case 'result':
            return {
              ...prev,
              results: [...prev.results, event.result!],
              logs: event.console?.length
                ? { ...prev.logs, [prev.results.length]: event.console }
                : prev.logs,
            };
          case 'warning':
            return { ...prev, warnings: [...prev.warnings, event.message ?? ''] };
          case 'done':
            return { ...prev, summary: event.summary ?? null, message: event.message ?? null };
          default:
            return prev;
        }
      });
    };

    try {
      await api.runs.start(
        {
          collectionId: collection.id,
          folderId,
          requestIds: chosen.length === items.length ? null : chosen.map((i) => i.request.id),
          iterations: effectiveIterations,
          delayMs: Math.max(0, Math.min(60000, Number.parseInt(delayMs, 10) || 0)),
          data: data?.rows ?? null,
          variables,
          // Authorization code token'ları yalnızca tarayıcıda; sunucu ayar parmak iziyle eşleştirir.
          oAuth2Tokens: validTokens(),
        },
        onEvent,
        controller.signal,
      );
      if (keepVariables && finalVariables) applyVariableChanges(variables, finalVariables, scopes.keys);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        setRun((prev) => (prev ? { ...prev, message: t('stoppedMessage'), aborted: true } : prev));
      } else {
        setStartError(errorMessage(e));
      }
    } finally {
      abort.current = null;
      setRun((prev) => (prev ? { ...prev, running: false } : prev));
      void queryClient.invalidateQueries({ queryKey: runsQueryKey(workspaceId, collection.id) });
    }
  };

  const openReport = async (summary: RunSummaryDto) => {
    const detail = await api.runs.get(summary.id);
    setRun({
      runId: summary.id,
      iterations: summary.iterations,
      plannedPerIteration: 0,
      results: detail.results,
      logs: {},
      warnings: [],
      summary: detail.summary,
      message: null,
      running: false,
      fromHistory: true,
    });
    setTab('run');
  };

  const close = () => {
    abort.current?.abort();
    onClose();
  };

  return (
    <Dialog title={title} size="xl" onClose={close}>
      <div className="mb-3 border-b border-line">
        <SegmentedTabs
          label={t('dialog.tabsLabel')}
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'run', label: t('dialog.tabRun') },
            { id: 'history', label: t('dialog.tabHistory') },
          ]}
        />
      </div>

      {tab === 'history' && (
        <RunHistory
          loading={history.isLoading}
          error={history.error ? errorMessage(history.error) : null}
          runs={history.data ?? []}
          onOpen={(r) => void openReport(r)}
          onDelete={async (r) => {
            await api.runs.remove(r.id);
            await queryClient.invalidateQueries({ queryKey: runsQueryKey(workspaceId, collection.id) });
          }}
        />
      )}

      {tab === 'run' && !run && (
        <div className="grid gap-5 md:grid-cols-[1fr_18rem]">
          <section aria-label={t('select.section')} className="min-w-0">
            <div className="mb-2 flex items-center justify-between text-xs">
              <span className="font-medium text-fg-muted">
                {t('select.count', { chosen: chosen.length, total: items.length })}
              </span>
              <span className="flex gap-2">
                <button
                  type="button"
                  className="text-accent hover:underline"
                  onClick={() => setSelected(new Set(items.map((i) => i.request.id)))}
                >
                  {t('select.all')}
                </button>
                <button
                  type="button"
                  className="text-accent hover:underline"
                  onClick={() => setSelected(new Set())}
                >
                  {t('select.none')}
                </button>
              </span>
            </div>
            {items.length === 0 ? (
              <p className="rounded-md border border-dashed border-line p-6 text-center text-sm text-fg-subtle">
                {t('select.empty')}
              </p>
            ) : (
              <ul className="max-h-[50vh] divide-y divide-line overflow-y-auto rounded-md border border-line">
                {items.map(({ request, path }) => (
                  <li key={request.id}>
                    <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[13px] hover:bg-muted">
                      <input
                        type="checkbox"
                        checked={selected.has(request.id)}
                        onChange={(e) => {
                          const next = new Set(selected);
                          if (e.target.checked) next.add(request.id);
                          else next.delete(request.id);
                          setSelected(next);
                        }}
                        className="accent-[var(--app-accent)]"
                      />
                      <span
                        className={cn(
                          'w-12 shrink-0 font-mono text-[11px] font-semibold',
                          methodColor(request.method),
                        )}
                      >
                        {request.method}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{request.name}</span>
                      {path && (
                        <span className="max-w-[40%] shrink-0 truncate text-xs text-fg-subtle">{path}</span>
                      )}
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label={t('settings.section')} className="space-y-4 text-sm">
            <label className="flex flex-col gap-1 text-xs text-fg-muted">
              {t('settings.iterations')}
              <Input
                inputMode="numeric"
                value={iterations}
                onChange={(e) => setIterations(e.target.value.replace(/\D/g, '').slice(0, 4))}
              />
              {data && iterationCount > data.rows.length && (
                <span className="text-fg-subtle">{t('data.rowLimit', { rows: data.rows.length })}</span>
              )}
            </label>
            <label className="flex flex-col gap-1 text-xs text-fg-muted">
              {t('settings.delay')}
              <Input
                inputMode="numeric"
                value={delayMs}
                onChange={(e) => setDelayMs(e.target.value.replace(/\D/g, '').slice(0, 5))}
              />
            </label>
            <div className="space-y-1 text-xs text-fg-muted">
              <span>{t('data.fileLabel')}</span>
              <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-line px-3 py-2 hover:bg-muted">
                <FileSpreadsheet className="h-4 w-4 text-fg-subtle" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-fg">
                  {data ? data.name : t('data.pickFile')}
                </span>
                <input
                  type="file"
                  accept=".csv,.json,text/csv,application/json"
                  hidden
                  aria-label={t('data.fileAria')}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void loadDataFile(file);
                    e.target.value = '';
                  }}
                />
              </label>
              {data && (
                <p className="text-fg-subtle">
                  {t('data.summary', { rows: data.rows.length, columns: data.columns.join(', ') })}{' '}
                  <button type="button" className="text-accent hover:underline" onClick={() => setData(null)}>
                    {t('data.remove')}
                  </button>
                </p>
              )}
              {dataError && <p className="text-danger">{dataError}</p>}
            </div>
            <label className="flex items-start gap-2 text-xs text-fg-muted">
              <input
                type="checkbox"
                checked={keepVariables}
                onChange={(e) => setKeepVariables(e.target.checked)}
                className="mt-0.5 accent-[var(--app-accent)]"
              />
              <span>
                {t('settings.keepVariables')}
                <span className="block text-fg-subtle">{t('settings.keepVariablesHint')}</span>
              </span>
            </label>
            <p className="text-xs text-fg-subtle">
              {t('settings.environment', { name: scopes.environmentName ?? t('settings.environmentNone') })}
            </p>
            {api.local && <p className="text-xs text-fg-subtle">{t('settings.local')}</p>}
            {startError && <Alert tone="error">{startError}</Alert>}
            <Button
              className="w-full justify-center"
              disabled={chosen.length === 0}
              onClick={() => void start()}
            >
              <Play className="h-4 w-4" />{' '}
              {t('settings.start', { requests: chosen.length, iterations: effectiveIterations })}
            </Button>
          </section>
        </div>
      )}

      {tab === 'run' && run && (
        <RunResults
          run={run}
          onStop={() => abort.current?.abort()}
          onBack={() => setRun(null)}
          onRerun={() => void start()}
        />
      )}
    </Dialog>
  );
}
