import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Activity, RotateCcw } from 'lucide-react';
import { Alert, Button, Spinner, cn } from '@apivator/ui';
import type { ActivityDto } from '@apivator/core';
import { useT } from '../../i18n';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { initials, presenceColor } from '../../lib/presence';
import { useWorkspaces } from '../../lib/useWorkspaces';
import { useUi } from '../../stores/ui';
import { collectionsQueryKey } from '../collections/useCollections';
import { useTabs } from '../requests/tabsStore';
import {
  activityQueryKey,
  fullTime,
  groupByDay,
  sentenceKey,
  targetLabel,
  timeAgo,
  useActivity,
} from './activity';
import { openTarget } from './openTarget';

/** Workspace'te kim neyi değiştirdi (en yeni önce). Toplu işlemlerin (içe aktarma, kopyalama) içi gösterilmez. */
export function ActivityPanel() {
  const t = useT('activity');
  const { current } = useWorkspaces();
  const workspaceId = current?.id;
  const canEdit = current?.role !== 'Viewer';
  const queryClient = useQueryClient();
  const { data, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useActivity(workspaceId);
  const [actionError, setActionError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);

  const items = useMemo(() => data?.pages.flatMap((p) => p.items) ?? [], [data]);
  const groups = useMemo(() => groupByDay(items), [items]);
  // Aynı istek için daha yeni bir kayıt (ör. geri getirildi) varsa eski silme kaydı geri getirilemez.
  const latestByTarget = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of items) if (!map.has(item.targetId)) map.set(item.targetId, item.id);
    return map;
  }, [items]);

  const open = (item: ActivityDto) => {
    if (!workspaceId || item.action === 'Deleted') return;
    if (item.targetType === 'Request') void openTarget(workspaceId, 'Request', item.targetId);
    else if (item.targetType === 'Environment') useUi.getState().setSidebarSection('environments');
    else useUi.getState().setSidebarSection('collections');
  };

  const restore = async (item: ActivityDto) => {
    if (!workspaceId) return;
    setActionError(null);
    setRestoring(item.id);
    try {
      const request = await api.activity.restoreDeleted(item.id);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: collectionsQueryKey(workspaceId) }),
        queryClient.invalidateQueries({ queryKey: activityQueryKey(workspaceId) }),
      ]);
      useTabs.getState().openSaved(workspaceId, request);
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setRestoring(null);
    }
  };

  return (
    <section
      aria-label={t('panel.title')}
      className="flex w-72 shrink-0 flex-col border-e border-line bg-surface"
    >
      <header className="flex h-11 shrink-0 items-center border-b border-line px-3">
        <h2 className="text-sm font-semibold">{t('panel.title')}</h2>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {isLoading && (
          <div className="flex justify-center py-6 text-fg-subtle">
            <Spinner className="h-4 w-4" />
          </div>
        )}
        {(error || actionError) && (
          <Alert tone="error" className="m-2 text-xs">
            {actionError ?? errorMessage(error)}
          </Alert>
        )}
        {!isLoading && !error && items.length === 0 && (
          <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
            <Activity className="h-8 w-8 text-fg-subtle/60" aria-hidden="true" />
            <p className="text-sm text-fg-muted">{t('panel.empty')}</p>
          </div>
        )}

        {groups.map((group) => (
          <div key={group.label} role="group" aria-label={group.label}>
            <h3 className="sticky top-0 z-10 bg-surface px-3 pt-3 pb-1 text-[11px] font-semibold tracking-wide text-fg-subtle uppercase">
              {group.label}
            </h3>
            <ul>
              {group.items.map((item) => {
                const clickable = item.action !== 'Deleted' && item.targetType !== 'Example';
                return (
                  <li
                    key={item.id}
                    className={cn(
                      'flex gap-2.5 px-3 py-2 text-[12.5px] leading-snug',
                      clickable && 'cursor-pointer hover:bg-muted',
                    )}
                    onClick={clickable ? () => open(item) : undefined}
                    title={fullTime(item.createdAt)}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white',
                        presenceColor(item.userId ?? item.userName),
                      )}
                    >
                      {initials(item.userName)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="text-fg">
                        {t.rich(
                          sentenceKey(item),
                          {
                            b: (c) => <strong className="font-medium">{c}</strong>,
                            m: (c) => <span className="text-fg-muted">{c}</span>,
                            n: (c) => <span className="font-medium break-words">{c}</span>,
                          },
                          {
                            user: item.userName,
                            target: targetLabel(item.targetType),
                            name: item.targetName,
                            detail: item.detail ?? '',
                          },
                        )}
                      </span>
                      <span className="mt-0.5 flex items-center gap-2 text-[11px] text-fg-subtle">
                        {timeAgo(item.createdAt)}
                        {item.restorable && canEdit && latestByTarget.get(item.targetId) === item.id && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-5 px-1.5 text-[11px]"
                            loading={restoring === item.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              void restore(item);
                            }}
                          >
                            <RotateCcw className="h-3 w-3" /> {t('panel.restore')}
                          </Button>
                        )}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

        {hasNextPage && (
          <div className="flex justify-center py-2">
            <Button
              variant="ghost"
              size="sm"
              loading={isFetchingNextPage}
              onClick={() => void fetchNextPage()}
            >
              {t('panel.older')}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
