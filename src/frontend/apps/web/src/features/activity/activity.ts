import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { ActivityDto, ChangeAction, ChangeTarget, CommentTarget } from '@apivator/core';
import { create } from 'zustand';
import { currentLocale, dateFormatter, formatDateTime, translate } from '../../i18n';
import { api } from '../../lib/api';

export const activityQueryKey = (workspaceId: string | undefined) => ['activity', workspaceId] as const;
export const versionsQueryKey = (kind: 'request' | 'environment', id: string) =>
  ['versions', kind, id] as const;
export const commentsQueryKey = (targetType: CommentTarget, targetId: string) =>
  ['comments', targetType, targetId] as const;
export const commentCountsQueryKey = (workspaceId: string | undefined) =>
  ['comment-counts', workspaceId] as const;
export const peopleQueryKey = (workspaceId: string | undefined) => ['people', workspaceId] as const;
export const notificationsQueryKey = ['notifications'] as const;

export function useActivity(workspaceId: string | undefined) {
  return useInfiniteQuery({
    queryKey: activityQueryKey(workspaceId),
    queryFn: ({ pageParam }) => api.activity.feed(workspaceId!, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextBefore ?? undefined,
    enabled: !!workspaceId,
  });
}

export function useCommentCounts(workspaceId: string | undefined) {
  return useQuery({
    queryKey: commentCountsQueryKey(workspaceId),
    queryFn: () => api.comments.counts(workspaceId!),
    enabled: !!workspaceId,
    select: (rows) => new Map(rows.map((r) => [r.targetId, r.open])),
  });
}

export function useNotifications(enabled = true) {
  return useQuery({
    queryKey: notificationsQueryKey,
    queryFn: api.notifications.list,
    enabled,
    staleTime: 30_000,
  });
}

/** Etkinlik cümlesinin anahtarı: ayrıntı (eski ad, sürüm, hedef) varsa ona özel cümle seçilir. */
export function sentenceKey(item: Pick<ActivityDto, 'action' | 'detail'>) {
  const detailed = !!item.detail;
  switch (item.action) {
    case 'Restored':
      return detailed ? 'sentence.RestoredVersion' : 'sentence.Restored';
    case 'Renamed':
      return detailed ? 'sentence.RenamedFrom' : 'sentence.Renamed';
    case 'Moved':
      return detailed ? 'sentence.MovedDetail' : 'sentence.Moved';
    default:
      return `sentence.${item.action}` as const;
  }
}

/** Hedef türünün çevrilmiş adı (cümlede kullanılır). */
export const targetLabel = (target: ChangeTarget) => translate('activity', `targets.${target}`);

/** Etiketler erişim anında çevrilir (dil değişince güncel kalır). */
export const ACTION_LABELS: Record<ChangeAction, string> = {
  get Created() {
    return translate('activity', 'actions.Created');
  },
  get Updated() {
    return translate('activity', 'actions.Updated');
  },
  get Renamed() {
    return translate('activity', 'actions.Renamed');
  },
  get Moved() {
    return translate('activity', 'actions.Moved');
  },
  get Deleted() {
    return translate('activity', 'actions.Deleted');
  },
  get Restored() {
    return translate('activity', 'actions.Restored');
  },
};

const relativeFormats = new Map<string, Intl.RelativeTimeFormat>();
function relativeFormat() {
  const locale = currentLocale();
  let format = relativeFormats.get(locale);
  if (!format)
    relativeFormats.set(locale, (format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })));
  return format;
}
const dateTimeOptions: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' };

/** "3 dakika önce", "dün"; bir haftadan eskiyse tarih. */
export function timeAgo(iso: string, now = Date.now()) {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return translate('activity', 'time.justNow');
  if (abs < 3600) return relativeFormat().format(Math.round(seconds / 60), 'minute');
  if (abs < 86_400) return relativeFormat().format(Math.round(seconds / 3600), 'hour');
  if (abs < 7 * 86_400) return relativeFormat().format(Math.round(seconds / 86_400), 'day');
  return formatDateTime(iso, dateTimeOptions);
}

export const fullTime = (iso: string) => formatDateTime(iso, dateTimeOptions);

/** Gün başlıklarıyla gruplama (en yeni önce gelen listeler için). */
export function groupByDay<T extends { createdAt: string }>(items: T[], now = new Date()) {
  const key = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const today = key(now);
  const yesterday = key(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const format = dateFormatter({ day: 'numeric', month: 'long', year: 'numeric' });
  const groups: { label: string; items: T[] }[] = [];
  for (const item of items) {
    const date = new Date(item.createdAt);
    const k = key(date);
    const label =
      k === today
        ? translate('activity', 'time.today')
        : k === yesterday
          ? translate('activity', 'time.yesterday')
          : format.format(date);
    const last = groups.at(-1);
    if (last?.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}

export interface CommentsTarget {
  type: CommentTarget;
  id: string;
  name: string;
}

interface CommentsPanelState {
  target: CommentsTarget | null;
  /** Bildirimden gelindiyse vurgulanacak yorum. */
  focusCommentId: string | null;
  open: (target: CommentsTarget, focusCommentId?: string | null) => void;
  close: () => void;
}

/** Sağdaki yorum paneli (istek ya da collection için). */
export const useCommentsPanel = create<CommentsPanelState>((set) => ({
  target: null,
  focusCommentId: null,
  open: (target, focusCommentId = null) => set({ target, focusCommentId }),
  close: () => set({ target: null, focusCommentId: null }),
}));
