import { useQuery } from '@tanstack/react-query';
import { create } from 'zustand';
import type { ForkInfoDto } from '@apivator/core';
import { api } from '../../lib/api';

export const workspaceForksQueryKey = (workspaceId: string | undefined) => ['forks', workspaceId] as const;
export const forkCompareQueryKey = (forkId: string) => ['fork-compare', forkId] as const;
export const mergeRequestsQueryKey = (workspaceId: string | undefined) =>
  ['merge-requests', workspaceId] as const;
export const mergeRequestQueryKey = (id: string) => ['merge-request', id] as const;

/** Workspace'teki fork collection'ları: collection kimliği → fork bağı. */
export function useWorkspaceForks(workspaceId: string | undefined) {
  return useQuery({
    queryKey: workspaceForksQueryKey(workspaceId),
    queryFn: async () => {
      const forks = await api.forks.inWorkspace(workspaceId!);
      return new Map<string, ForkInfoDto>(forks.map((f) => [f.forkCollectionId, f]));
    },
    enabled: Boolean(workspaceId),
  });
}

/** Bildirimden ya da listeden açılan merge isteği. */
export const useMergeUi = create<{ openId: string | null; open: (id: string | null) => void }>((set) => ({
  openId: null,
  open: (openId) => set({ openId }),
}));
