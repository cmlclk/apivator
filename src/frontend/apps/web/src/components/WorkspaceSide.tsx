import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router';
import { useWorkspaces } from '../lib/useWorkspaces';
import { useCommentsPanel } from '../features/activity/activity';
import { openTarget } from '../features/activity/openTarget';
import { CommentsPanel } from '../features/comments/CommentsPanel';
import { useMonitorUi } from '../features/monitors/useMonitors';
import { useMergeUi } from '../features/forks/useForks';
import { useUi } from '../stores/ui';

/**
 * İstek ekranının sağ tarafı (yorumlar) ve e-postadaki bağlantılar:
 * `/?workspace=…&request=…&comments=1` ilgili isteği ve yorumlarını açar; `/?workspace=…&monitor=…` (monitör
 * bildirimi) monitörün ayrıntısını açar.
 */
export function WorkspaceSide() {
  const { current } = useWorkspaces();
  const target = useCommentsPanel((s) => s.target);
  const [params, setParams] = useSearchParams();
  const previousWorkspace = useRef(current?.id);

  useEffect(() => {
    const workspaceId = params.get('workspace');
    const requestId = params.get('request');
    const collectionId = params.get('collection');
    const monitorId = params.get('monitor');
    const mergeRequestId = params.get('mergeRequest');
    if (workspaceId && mergeRequestId) {
      setParams({}, { replace: true });
      useUi.getState().setCurrentWorkspaceId(workspaceId);
      useUi.getState().setSidebarSection('merges');
      useMergeUi.getState().open(mergeRequestId);
      return;
    }
    if (workspaceId && monitorId) {
      setParams({}, { replace: true });
      useUi.getState().setCurrentWorkspaceId(workspaceId);
      useUi.getState().setSidebarSection('monitors');
      useMonitorUi.getState().open(monitorId);
      return;
    }
    if (!workspaceId || (!requestId && !collectionId)) return;
    setParams({}, { replace: true });
    void openTarget(workspaceId, requestId ? 'Request' : 'Collection', (requestId ?? collectionId)!, {
      comments: params.get('comments') === '1',
    });
  }, [params, setParams]);

  // Başka workspace'e geçilince önceki workspace'in yorum paneli kapanır. (Bildirimden geçişte panel, kayıt
  // yüklendikten sonra yeni workspace'te açılır.)
  useEffect(() => {
    if (previousWorkspace.current && previousWorkspace.current !== current?.id) {
      useCommentsPanel.getState().close();
    }
    previousWorkspace.current = current?.id;
  }, [current?.id]);

  if (!target || !current) return null;
  return <CommentsPanel key={`${target.type}:${target.id}`} target={target} workspaceId={current.id} />;
}
