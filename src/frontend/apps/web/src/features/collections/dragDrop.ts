import type { CollectionTreeDto, FolderDto, RequestSummaryDto } from '@apivator/core';

export type DragItem =
  | { kind: 'request'; id: string; collectionId: string }
  | { kind: 'folder'; id: string; collectionId: string };

export type DropTarget =
  | { kind: 'collection'; collectionId: string }
  | { kind: 'folder'; collectionId: string; folder: FolderDto }
  | { kind: 'request'; collectionId: string; request: RequestSummaryDto };

export type DropPosition = 'before' | 'after' | 'inside';

export type MovePlan =
  | { kind: 'request'; id: string; collectionId: string; folderId: string | null; index: number }
  | { kind: 'folder'; id: string; collectionId: string; parentFolderId: string | null; index: number };

/**
 * İmlecin satır içindeki dikey konumuna (0 üst, 1 alt) göre bırakma yeri. Klasörler isteklerden önce
 * listelendiği için istek bir klasörün önüne/arkasına değil ancak içine bırakılabilir.
 */
export function dropPosition(drag: DragItem, target: DropTarget, ratio: number): DropPosition | null {
  if (target.kind === 'collection') return 'inside';
  if (target.kind === 'request') {
    if (drag.kind === 'folder') return null;
    return ratio < 0.5 ? 'before' : 'after';
  }
  if (drag.kind === 'request') return 'inside';
  if (ratio < 0.25) return 'before';
  if (ratio > 0.75) return 'after';
  return 'inside';
}

function isInside(collection: CollectionTreeDto, folderId: string | null, ancestorId: string): boolean {
  let current = folderId;
  while (current) {
    if (current === ancestorId) return true;
    current = collection.folders.find((f) => f.id === current)?.parentFolderId ?? null;
  }
  return false;
}

const bySort = <T extends { sortOrder: number }>(a: T, b: T) => a.sortOrder - b.sortOrder;

/** Bırakmanın sonucunda sunucuya gönderilecek taşıma; anlamsız ya da değişiklik yaratmayan bırakmada null. */
export function planMove(
  drag: DragItem,
  target: DropTarget,
  position: DropPosition,
  collections: CollectionTreeDto[],
): MovePlan | null {
  const collection = collections.find((c) => c.id === target.collectionId);
  const source = collections.find((c) => c.id === drag.collectionId);
  if (!collection || !source) return null;

  if (drag.kind === 'request') {
    const current = source.requests.find((r) => r.id === drag.id);
    if (!current) return null;

    let folderId: string | null;
    let anchor: RequestSummaryDto | null = null;
    if (target.kind === 'request') {
      if (target.request.id === drag.id) return null;
      folderId = target.request.folderId;
      anchor = target.request;
    } else {
      folderId = target.kind === 'folder' ? target.folder.id : null;
    }

    const siblings = collection.requests
      .filter((r) => r.folderId === folderId && r.id !== drag.id)
      .sort(bySort);
    const index = anchor
      ? siblings.findIndex((r) => r.id === anchor.id) + (position === 'after' ? 1 : 0)
      : siblings.length;

    if (source.id === collection.id && current.folderId === folderId) {
      const before = collection.requests.filter((r) => r.folderId === folderId).sort(bySort);
      if (before.findIndex((r) => r.id === drag.id) === index) return null;
    }
    return { kind: 'request', id: drag.id, collectionId: collection.id, folderId, index };
  }

  if (target.kind === 'request') return null;
  const current = source.folders.find((f) => f.id === drag.id);
  if (!current) return null;

  let parentFolderId: string | null;
  let anchor: FolderDto | null = null;
  if (target.kind === 'collection') {
    parentFolderId = null;
  } else if (position === 'inside') {
    parentFolderId = target.folder.id;
  } else {
    parentFolderId = target.folder.parentFolderId;
    anchor = target.folder;
  }

  if (target.kind === 'folder' && target.folder.id === drag.id) return null;
  // Klasör kendi içine ya da alt klasörlerinden birine taşınamaz.
  if (collection.id === source.id && parentFolderId && isInside(collection, parentFolderId, drag.id))
    return null;

  const siblings = collection.folders
    .filter((f) => f.parentFolderId === parentFolderId && f.id !== drag.id)
    .sort(bySort);
  const index = anchor
    ? siblings.findIndex((f) => f.id === anchor.id) + (position === 'after' ? 1 : 0)
    : siblings.length;

  if (source.id === collection.id && current.parentFolderId === parentFolderId) {
    const before = collection.folders.filter((f) => f.parentFolderId === parentFolderId).sort(bySort);
    if (before.findIndex((f) => f.id === drag.id) === index) return null;
  }
  return { kind: 'folder', id: drag.id, collectionId: collection.id, parentFolderId, index };
}
