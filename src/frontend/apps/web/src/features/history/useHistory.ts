import { useInfiniteQuery } from '@tanstack/react-query';
import type { ExecuteResponse, HistoryEntryDto, HistoryResponseDto } from '@apivator/core';
import { dateFormatter, translate } from '../../i18n';
import { api } from '../../lib/api';

export const PAGE_SIZE = 100;

/** Geçmişte saklanan yanıt gövdesinin sınırı (sunucudaki `HistoryResponse.MaxBodyLength` ile aynı). */
export const HISTORY_RESPONSE_MAX = 256 * 1024;

/** Geçmişe yazılacak yanıt gövdesi: yalnızca metin gövdeler, sınırda kısaltılmış; gövde yoksa null. */
export function historyResponsePayload(response: ExecuteResponse): HistoryResponseDto | null {
  if (response.bodyEncoding !== 'text' || !response.body) return null;
  const contentType = response.headers.find((h) => h.key.toLowerCase() === 'content-type')?.value ?? null;
  const cut = response.body.length > HISTORY_RESPONSE_MAX;
  let body = cut ? response.body.slice(0, HISTORY_RESPONSE_MAX) : response.body;
  // Vekil çiftini ortadan bölme.
  const last = body.charCodeAt(body.length - 1);
  if (cut && last >= 0xd800 && last <= 0xdbff) body = body.slice(0, -1);
  return { body, contentType, truncated: response.truncated || cut };
}

export const historyQueryKey = (workspaceId: string | undefined) => ['history', workspaceId] as const;

export function useHistory(workspaceId: string | undefined) {
  return useInfiniteQuery({
    queryKey: historyQueryKey(workspaceId),
    queryFn: ({ pageParam }) => api.history.list(workspaceId!, pageParam, PAGE_SIZE),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.length === PAGE_SIZE ? last.at(-1)!.executedAt : undefined),
    enabled: !!workspaceId,
  });
}

export interface HistoryGroup {
  label: string;
  entries: HistoryEntryDto[];
}

function dayKey(date: Date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/** Kayıtları yerel saate göre günlere ayırır: Bugün, Dün, sonra tarih. Sıra korunur (yeniden eskiye). */
export function groupByDay(entries: HistoryEntryDto[], now = new Date()): HistoryGroup[] {
  const today = dayKey(now);
  const yesterday = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const format = dateFormatter({
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const groups: HistoryGroup[] = [];
  for (const entry of entries) {
    const date = new Date(entry.executedAt);
    const key = dayKey(date);
    const label =
      key === today
        ? translate('history', 'today')
        : key === yesterday
          ? translate('history', 'yesterday')
          : format.format(date);
    const last = groups.at(-1);
    if (last?.label === label) last.entries.push(entry);
    else groups.push({ label, entries: [entry] });
  }
  return groups;
}

/** Kenar çubuğunda gösterilecek kısa ad: şema atılır. */
export function displayUrl(url: string) {
  return url.replace(/^https?:\/\//i, '');
}
