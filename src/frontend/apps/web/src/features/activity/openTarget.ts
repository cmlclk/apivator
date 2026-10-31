import type { CommentTarget } from '@apivator/core';
import { api } from '../../lib/api';
import { useUi } from '../../stores/ui';
import { useTabs } from '../requests/tabsStore';
import { useCommentsPanel } from './activity';
import { useMergeUi } from '../forks/useForks';
import { loadRequest } from '../../lib/offlineCache';

/**
 * Bildirimden, etkinlik akışından ya da e-postadaki bağlantıdan gelinen kaydı açar: workspace seçilir, istekse
 * sekmesi açılır; istenirse yorum paneli de açılır. Kayıt artık yoksa false döner.
 */
export async function openTarget(
  workspaceId: string,
  type: CommentTarget,
  id: string,
  options: { comments?: boolean; commentId?: string | null } = {},
): Promise<boolean> {
  useUi.getState().setCurrentWorkspaceId(workspaceId);
  if (type === 'MergeRequest') {
    // Yorumlar merge isteği penceresinin içinde.
    useUi.getState().setSidebarSection('merges');
    useMergeUi.getState().open(id);
    return true;
  }
  try {
    if (type === 'Request') {
      const request = await loadRequest(id);
      useTabs.getState().openSaved(workspaceId, request);
      useUi.getState().setSidebarSection('collections');
      if (options.comments)
        useCommentsPanel.getState().open({ type, id, name: request.name }, options.commentId);
      return true;
    }
    const collection = (await api.collections.list(workspaceId)).find((c) => c.id === id);
    if (!collection) return false;
    useUi.getState().setSidebarSection('collections');
    if (options.comments)
      useCommentsPanel.getState().open({ type, id, name: collection.name }, options.commentId);
    return true;
  } catch {
    return false;
  }
}
