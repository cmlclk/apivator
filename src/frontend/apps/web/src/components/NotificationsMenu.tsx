import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  AtSign,
  Bell,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  MessageSquareReply,
  RefreshCw,
} from 'lucide-react';
import { cn } from '@apivator/ui';
import type { NotificationDto } from '@apivator/core';
import { api } from '../lib/api';
import { notificationsQueryKey, timeAgo, useNotifications } from '../features/activity/activity';
import { openTarget } from '../features/activity/openTarget';
import { sourceQueryKey, useSourceUi } from '../features/importExport/sourceUi';
import { collectionsQueryKey } from '../features/collections/useCollections';
import { useDismiss } from './useDismiss';
import { useT, type MessageKey } from '../i18n';

const verbKeys = {
  Mention: 'notifications.verbs.mention',
  Reply: 'notifications.verbs.reply',
  MergeRequestOpened: 'notifications.verbs.mergeRequestOpened',
  MergeRequestMerged: 'notifications.verbs.mergeRequestMerged',
  MergeRequestDeclined: 'notifications.verbs.mergeRequestDeclined',
  SourceChanged: 'notifications.verbs.sourceChanged',
} as const satisfies Record<NotificationDto['kind'], MessageKey<'shell'>>;

/** Yorum, merge isteği ve kaynak belge bildirimleri; tıklayınca ilgili yorum ya da istek açılır. */
export function NotificationsMenu() {
  const t = useT('shell');
  const { data } = useNotifications();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);
  const unread = data?.unread ?? 0;

  // Kaynak belge değişikliği bildirimi gelince collection ağacındaki rozet de hemen görünsün.
  const seenSourceChanges = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!data) return;
    const changes = data.items.filter((n) => n.kind === 'SourceChanged' && !n.read);
    if (seenSourceChanges.current) {
      for (const n of changes.filter((c) => !seenSourceChanges.current!.has(c.id))) {
        void queryClient.invalidateQueries({ queryKey: collectionsQueryKey(n.workspaceId) });
        void queryClient.invalidateQueries({ queryKey: sourceQueryKey(n.targetId) });
      }
    } else if (changes.length > 0) {
      void queryClient.invalidateQueries({ queryKey: ['collections'] });
    }
    seenSourceChanges.current = new Set(changes.map((n) => n.id));
  }, [data, queryClient]);

  const markRead = async (ids?: string[]) => {
    await api.notifications.markRead(ids);
    await queryClient.invalidateQueries({ queryKey: notificationsQueryKey });
  };

  const go = async (n: NotificationDto) => {
    close();
    if (!n.read) void markRead([n.id]);
    navigate('/');
    if (n.kind === 'SourceChanged') {
      // Kaynak değişikliği: collection'ın kaynak penceresi açılır.
      if (await openTarget(n.workspaceId, n.targetType, n.targetId)) useSourceUi.getState().open(n.targetId);
      return;
    }
    await openTarget(n.workspaceId, n.targetType, n.targetId, { comments: true, commentId: n.commentId });
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={unread ? t('notifications.titleUnread', { count: unread }) : t('notifications.title')}
        title={t('notifications.title')}
        className="relative flex h-8 w-8 items-center justify-center rounded-md text-fg-muted hover:bg-muted hover:text-fg"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute top-0.5 end-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={t('notifications.title')}
          className="absolute top-full end-0 z-20 mt-1 w-96 rounded-lg border border-line bg-surface shadow-lg"
        >
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <h2 className="text-sm font-semibold">{t('notifications.title')}</h2>
            {unread > 0 && (
              <button
                type="button"
                onClick={() => void markRead()}
                className="text-xs text-accent hover:underline"
              >
                {t('notifications.markAllRead')}
              </button>
            )}
          </div>
          <ul className="max-h-[60vh] overflow-y-auto py-1">
            {(data?.items.length ?? 0) === 0 && (
              <li className="px-4 py-8 text-center text-[13px] text-fg-muted">{t('notifications.empty')}</li>
            )}
            {data?.items.map((n) => {
              const Icon = {
                Mention: AtSign,
                Reply: MessageSquareReply,
                MergeRequestOpened: GitPullRequest,
                MergeRequestMerged: GitMerge,
                MergeRequestDeclined: GitPullRequestClosed,
                SourceChanged: RefreshCw,
              }[n.kind];
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => void go(n)}
                    className={cn(
                      'flex w-full gap-2.5 px-3 py-2 text-start text-[12.5px] hover:bg-muted',
                      !n.read && 'bg-accent/5',
                    )}
                  >
                    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-fg-subtle" aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block">
                        <strong className="font-medium">{n.actorName}</strong> {t(verbKeys[n.kind])} ·{' '}
                        <span className="font-medium">{n.targetName}</span>
                      </span>
                      <span className="line-clamp-2 text-fg-muted">{n.preview}</span>
                      <span className="text-[11px] text-fg-subtle">{timeAgo(n.createdAt)}</span>
                    </span>
                    {!n.read && (
                      <span
                        className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent"
                        aria-label={t('notifications.unread')}
                      />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
