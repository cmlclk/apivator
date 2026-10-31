import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Clock, Search, Trash2, X } from 'lucide-react';
import { Alert, Button, Spinner, cn } from '@apivator/ui';
import { formatDuration, historyTable, type HistoryEntryDto } from '@apivator/core';
import { formatDateTime, useT } from '../../i18n';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { useWorkspaces } from '../../lib/useWorkspaces';
import { methodColor, methodLabel } from '../requests/methodColors';
import { useTabs } from '../requests/tabsStore';
import { displayUrl, groupByDay, historyQueryKey, useHistory } from './useHistory';
import { ExportTablesMenu } from '../export/ExportTablesMenu';

function statusColor(status: number | null) {
  if (status === null) return 'text-danger';
  if (status >= 400) return 'text-danger';
  if (status >= 300) return 'text-warning';
  return 'text-success';
}

export function HistoryPanel() {
  const t = useT('history');
  const { current } = useWorkspaces();
  const workspaceId = current?.id;
  const queryClient = useQueryClient();
  const { data, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useHistory(workspaceId);
  const [filter, setFilter] = useState('');
  const [clearing, setClearing] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const entries = useMemo(() => data?.pages.flat() ?? [], [data]);
  const groups = useMemo(() => {
    const term = filter.trim().toLowerCase();
    const visible = term
      ? entries.filter((e) => e.url.toLowerCase().includes(term) || e.method.toLowerCase() === term)
      : entries;
    return groupByDay(visible);
  }, [entries, filter]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: historyQueryKey(workspaceId) });

  const open = (entry: HistoryEntryDto) => {
    if (!workspaceId) return;
    useTabs
      .getState()
      .newTab(workspaceId, { name: displayUrl(entry.url) || t('untitledTab'), draft: entry.definition });
  };

  const remove = async (entry: HistoryEntryDto) => {
    await api.history.remove(entry.id);
    await refresh();
  };

  return (
    <section aria-label={t('title')} className="flex w-72 shrink-0 flex-col border-e border-line bg-surface">
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-line px-3">
        <h2 className="text-sm font-semibold">{t('title')}</h2>
        <span className="flex-1" />
        {entries.length > 0 && (
          <ExportTablesMenu
            iconOnly
            tables={() => [historyTable(groups.flatMap((g) => g.entries))]}
            baseName={t('exportName', { date: new Date().toISOString().slice(0, 10) })}
            onError={setExportError}
          />
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setClearing(true)}
          disabled={!entries.length}
          title={t('clear')}
          aria-label={t('clear')}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </header>

      {entries.length > 0 && (
        <div className="relative border-b border-line px-2 py-1.5">
          <Search className="pointer-events-none absolute top-1/2 start-4 h-3.5 w-3.5 -translate-y-1/2 text-fg-subtle" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t('searchPlaceholder')}
            aria-label={t('searchLabel')}
            className="h-7 w-full rounded-md bg-muted pe-2 ps-7 text-xs placeholder:text-fg-subtle focus:ring-1 focus:ring-accent focus:outline-none"
          />
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {isLoading && (
          <div className="flex justify-center py-6 text-fg-subtle">
            <Spinner className="h-4 w-4" />
          </div>
        )}
        {error && (
          <Alert tone="error" className="m-2 text-xs">
            {errorMessage(error)}
          </Alert>
        )}
        {exportError && (
          <Alert tone="error" className="m-2 text-xs">
            {exportError}
          </Alert>
        )}

        {!isLoading && !error && entries.length === 0 && (
          <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
            <Clock className="h-8 w-8 text-fg-subtle/60" aria-hidden="true" />
            <p className="text-sm text-fg-muted">{t('empty')}</p>
          </div>
        )}

        {entries.length > 0 && groups.length === 0 && (
          <p className="px-4 py-6 text-center text-xs text-fg-subtle">{t('noMatch')}</p>
        )}

        {groups.map((group) => (
          <div key={group.label} role="group" aria-label={group.label}>
            <h3 className="sticky top-0 z-10 bg-surface px-3 pt-3 pb-1 text-[11px] font-semibold tracking-wide text-fg-subtle uppercase">
              {group.label}
            </h3>
            {group.entries.map((entry) => (
              <div
                key={entry.id}
                role="button"
                tabIndex={0}
                onClick={() => open(entry)}
                onKeyDown={(e) => e.key === 'Enter' && open(entry)}
                title={`${entry.method} ${entry.url}\n${formatDateTime(entry.executedAt)}`}
                className="group flex h-8 cursor-pointer items-center gap-2 px-3 text-[13px] text-fg-muted hover:bg-muted hover:text-fg"
              >
                <span
                  className={cn(
                    'w-9 shrink-0 font-mono text-[10.5px] font-semibold',
                    methodColor(entry.method),
                  )}
                >
                  {methodLabel(entry.method)}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{displayUrl(entry.url)}</span>
                <span className="flex shrink-0 items-center gap-1.5 text-[11px] group-hover:hidden">
                  <span className={statusColor(entry.status)}>{entry.status ?? 'ERR'}</span>
                  {entry.timeMs !== null && (
                    <span className="text-fg-subtle">{formatDuration(entry.timeMs)}</span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void remove(entry);
                  }}
                  aria-label={t('deleteEntry')}
                  title={t('deleteEntry')}
                  className="hidden rounded p-0.5 text-fg-subtle group-hover:block hover:bg-line hover:text-fg"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        ))}

        {hasNextPage && !filter && (
          <div className="flex justify-center py-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void fetchNextPage()}
              disabled={isFetchingNextPage}
            >
              {isFetchingNextPage ? <Spinner className="h-3.5 w-3.5" /> : null} {t('older')}
            </Button>
          </div>
        )}
      </div>

      {clearing && workspaceId && (
        <ConfirmDialog
          title={t('clear')}
          confirmLabel={t('clearConfirm')}
          onConfirm={async () => {
            await api.history.clear(workspaceId);
            await refresh();
          }}
          onClose={() => setClearing(false)}
        >
          <p>{t('clearBody')}</p>
        </ConfirmDialog>
      )}
    </section>
  );
}
