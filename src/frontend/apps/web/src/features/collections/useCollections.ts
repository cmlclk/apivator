import { useQuery } from '@tanstack/react-query';
import type { CollectionTreeDto, ExampleSummaryDto, FolderDto, RequestSummaryDto } from '@apivator/core';
import { api } from '../../lib/api';

export const collectionsQueryKey = (workspaceId: string | undefined) => ['collections', workspaceId] as const;

export function useCollections(workspaceId: string | undefined) {
  return useQuery({
    queryKey: collectionsQueryKey(workspaceId),
    queryFn: () => api.collections.list(workspaceId!),
    enabled: Boolean(workspaceId),
  });
}

export type TreeNode =
  | { kind: 'folder'; folder: FolderDto; children: TreeNode[] }
  | { kind: 'request'; request: RequestSummaryDto; examples: ExampleSummaryDto[] };

/** Düz klasör/istek listelerinden ağaç kurar: önce klasörler, sonra istekler, kendi sıralarıyla. */
export function buildTree(collection: CollectionTreeDto, parentId: string | null = null): TreeNode[] {
  const folders = collection.folders
    .filter((f) => f.parentFolderId === parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map<TreeNode>((folder) => ({ kind: 'folder', folder, children: buildTree(collection, folder.id) }));
  const requests = collection.requests
    .filter((r) => r.folderId === parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map<TreeNode>((request) => ({
      kind: 'request',
      request,
      examples: (collection.examples ?? []).filter((e) => e.requestId === request.id),
    }));
  return [...folders, ...requests];
}

/** Silinen klasörün altındaki tüm isteklerin Id'leri (açık sekmeleri kapatmak için). */
export function requestIdsUnder(collection: CollectionTreeDto, folderId: string): string[] {
  const nested = collection.folders.filter((f) => f.parentFolderId === folderId).map((f) => f.id);
  return [
    ...collection.requests.filter((r) => r.folderId === folderId).map((r) => r.id),
    ...nested.flatMap((id) => requestIdsUnder(collection, id)),
  ];
}
