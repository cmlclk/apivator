import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, GitPullRequest } from 'lucide-react';
import { Alert, Spinner, cn } from '@apivator/ui';
import type { MergeRequestStatus } from '@apivator/core';
import { useT } from '../../i18n';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { useWorkspaces } from '../../lib/useWorkspaces';
import { timeAgo } from '../activity/activity';
import { MergeRequestDialog, StatusChip } from './MergeRequestDialog';
import { mergeRequestsQueryKey, useMergeUi } from './useForks';

const FILTERS = ['Open', 'Merged', 'all'] as const satisfies readonly (MergeRequestStatus | 'all')[];

/** Kenar çubuğundaki "Merge'ler": bu workspace'teki collection'lara açılan istekler. */
export function MergeRequestsPanel() {
  const t = useT('forks');
  const { current } = useWorkspaces();
  const workspaceId = current?.id;
  const [filter, setFilter] = useState<MergeRequestStatus | 'all'>('Open');
  const openId = useMergeUi((s) => s.openId);
  const open = useMergeUi((s) => s.open);
  const { data, isLoading, error } = useQuery({
    queryKey: mergeRequestsQueryKey(workspaceId),
    queryFn: () => api.mergeRequests.list(workspaceId!),
    enabled: Boolean(workspaceId),
  });
  const shown = (data ?? []).filter((m) => filter === 'all' || m.status === filter);

  return (
    <section
      aria-label={t('panel.title')}
      className="flex w-72 shrink-0 flex-col border-e border-line bg-surface"
    >
      <header className="flex h-11 shrink-0 items-center border-b border-line px-3">
        <h2 className="text-sm font-semibold">{t('panel.title')}</h2>
      </header>
      <div
        className="flex gap-1 border-b border-line px-2 py-1.5"
        role="group"
        aria-label={t('panel.statusLabel')}
      >
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
            className={cn(
              'rounded-md px-2 py-0.5 text-xs',
              filter === f ? 'bg-accent/10 font-medium text-accent' : 'text-fg-muted hover:bg-muted',
            )}
          >
            {t(`panel.filters.${f}`)}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-1">
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
        {data && shown.length === 0 && (
          <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
            <GitPullRequest className="h-8 w-8 text-fg-subtle/60" aria-hidden="true" />
            <p className="text-sm text-fg-muted">
              {filter === 'Open' ? t('panel.emptyOpen') : t('panel.emptyFiltered')}
            </p>
          </div>
        )}
        {shown.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => open(m.id)}
            className="flex w-full flex-col gap-0.5 px-3 py-1.5 text-start text-[13px] text-fg-muted hover:bg-muted hover:text-fg"
          >
            <span className="flex items-center gap-1.5">
              <span className="min-w-0 flex-1 truncate font-medium text-fg">{m.title}</span>
              <StatusChip status={m.status} />
            </span>
            <span className="flex items-center gap-1.5 truncate text-xs text-fg-subtle">
              {m.sourceName} ← {m.forkName ?? t('panel.deletedFork')} · {m.authorName} ·{' '}
              {timeAgo(m.updatedAt)}
              {m.approvals.length > 0 && (
                <span className="flex items-center gap-0.5 text-success">
                  <Check className="h-3 w-3" aria-label={t('panel.approval')} />
                  {m.approvals.length}
                </span>
              )}
            </span>
          </button>
        ))}
      </div>

      {openId && <MergeRequestDialog id={openId} onClose={() => open(null)} />}
    </section>
  );
}
