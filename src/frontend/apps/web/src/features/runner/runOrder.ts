import type { CollectionTreeDto, RequestSummaryDto } from '@apivator/core';

export interface RunItem {
  request: RequestSummaryDto;
  /** Collection içindeki klasör yolu (ör. "Müşteriler / Yönetim"); kökteyse boş. */
  path: string;
}

/** Runner'ın çalıştıracağı sıra (sunucuyla aynı): her düzeyde önce klasörler (içleriyle), sonra istekler. */
export function runOrder(collection: CollectionTreeDto, folderId: string | null = null): RunItem[] {
  const result: RunItem[] = [];
  const bySort = <T extends { sortOrder: number }>(a: T, b: T) => a.sortOrder - b.sortOrder;

  const visit = (parentId: string | null, path: string[], depth: number) => {
    if (depth > 50) return;
    for (const folder of collection.folders.filter((f) => f.parentFolderId === parentId).sort(bySort)) {
      visit(folder.id, [...path, folder.name], depth + 1);
    }
    // WebSocket ve SSE istekleri koşuya girmez (sunucudaki motorla aynı kural).
    for (const request of collection.requests
      .filter((r) => r.folderId === parentId && (r.kind ?? 'Http') === 'Http')
      .sort(bySort)) {
      result.push({ request, path: path.join(' / ') });
    }
  };

  visit(folderId, [], 0);
  return result;
}

export const runsQueryKey = (workspaceId: string, collectionId: string) =>
  ['runs', workspaceId, collectionId] as const;
