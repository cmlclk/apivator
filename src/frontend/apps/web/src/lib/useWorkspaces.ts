import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { useUi } from '../stores/ui';

export const workspacesQueryKey = ['workspaces'] as const;

/** Kullanıcının workspace'leri ve seçili olanı. Seçim geçersizse ilk workspace'e düşer. */
export function useWorkspaces() {
  const query = useQuery({ queryKey: workspacesQueryKey, queryFn: api.workspaces.list });
  const currentId = useUi((s) => s.currentWorkspaceId);
  const setCurrentId = useUi((s) => s.setCurrentWorkspaceId);

  const workspaces = query.data ?? [];
  const current = workspaces.find((w) => w.id === currentId) ?? workspaces[0];

  useEffect(() => {
    if (current && current.id !== currentId) setCurrentId(current.id);
  }, [current, currentId, setCurrentId]);

  return { ...query, workspaces, current };
}
