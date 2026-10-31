import { describe, expect, it } from 'vitest';
import { emptyAuth, type CollectionTreeDto } from '@apivator/core';
import { dropPosition, planMove } from './dragDrop';

const folder = (id: string, parentFolderId: string | null, sortOrder: number) => ({
  id,
  parentFolderId,
  name: id,
  sortOrder,
  auth: emptyAuth(),
  scripts: { preRequest: '', postResponse: '' },
});
const request = (id: string, folderId: string | null, sortOrder: number) => ({
  id,
  folderId,
  name: id,
  method: 'GET',
  sortOrder,
});

const c1: CollectionTreeDto = {
  id: 'c1',
  workspaceId: 'w',
  name: 'C1',
  description: null,
  auth: emptyAuth('None'),
  variables: [],
  scripts: { preRequest: '', postResponse: '' },
  folders: [folder('f1', null, 0), folder('f2', null, 1), folder('f1a', 'f1', 0)],
  requests: [request('r1', null, 0), request('r2', null, 1), request('r3', null, 2), request('rf', 'f1', 0)],
  examples: [],
};
const c2: CollectionTreeDto = { ...c1, id: 'c2', name: 'C2', folders: [], requests: [request('x', null, 0)] };
const all = [c1, c2];

describe('dropPosition', () => {
  it('only lets requests go inside folders', () => {
    const target = { kind: 'folder' as const, collectionId: 'c1', folder: c1.folders[0]! };
    expect(dropPosition({ kind: 'request', id: 'r1', collectionId: 'c1' }, target, 0.1)).toBe('inside');
    expect(dropPosition({ kind: 'folder', id: 'f2', collectionId: 'c1' }, target, 0.1)).toBe('before');
    expect(dropPosition({ kind: 'folder', id: 'f2', collectionId: 'c1' }, target, 0.5)).toBe('inside');
    expect(
      dropPosition(
        { kind: 'folder', id: 'f2', collectionId: 'c1' },
        { kind: 'request', collectionId: 'c1', request: c1.requests[0]! },
        0.5,
      ),
    ).toBeNull();
  });
});

describe('planMove', () => {
  const drag = (id: string) => ({ kind: 'request' as const, id, collectionId: 'c1' });
  const onRequest = (id: string, collection = c1) => ({
    kind: 'request' as const,
    collectionId: collection.id,
    request: collection.requests.find((r) => r.id === id)!,
  });

  it('reorders requests among siblings', () => {
    expect(planMove(drag('r3'), onRequest('r1'), 'before', all)).toEqual({
      kind: 'request',
      id: 'r3',
      collectionId: 'c1',
      folderId: null,
      index: 0,
    });
    expect(planMove(drag('r1'), onRequest('r2'), 'after', all)).toMatchObject({ index: 1 });
    // Kendi yerine bırakmak değişiklik değildir.
    expect(planMove(drag('r1'), onRequest('r2'), 'before', all)).toBeNull();
    expect(planMove(drag('r1'), onRequest('r1'), 'after', all)).toBeNull();
  });

  it('moves requests into folders and other collections', () => {
    expect(
      planMove(drag('r1'), { kind: 'folder', collectionId: 'c1', folder: c1.folders[0]! }, 'inside', all),
    ).toEqual({
      kind: 'request',
      id: 'r1',
      collectionId: 'c1',
      folderId: 'f1',
      index: 1,
    });
    expect(planMove(drag('r1'), onRequest('x', c2), 'before', all)).toMatchObject({
      collectionId: 'c2',
      index: 0,
    });
    expect(planMove(drag('r1'), { kind: 'collection', collectionId: 'c2' }, 'inside', all)).toMatchObject({
      collectionId: 'c2',
      folderId: null,
      index: 1,
    });
  });

  it('moves folders but never into themselves', () => {
    const f1 = { kind: 'folder' as const, id: 'f1', collectionId: 'c1' };
    const onFolder = (id: string) => ({
      kind: 'folder' as const,
      collectionId: 'c1',
      folder: c1.folders.find((f) => f.id === id)!,
    });
    expect(planMove(f1, onFolder('f2'), 'after', all)).toEqual({
      kind: 'folder',
      id: 'f1',
      collectionId: 'c1',
      parentFolderId: null,
      index: 1,
    });
    expect(planMove(f1, onFolder('f2'), 'inside', all)).toMatchObject({ parentFolderId: 'f2', index: 0 });
    expect(planMove(f1, onFolder('f1a'), 'inside', all)).toBeNull();
    expect(planMove(f1, onFolder('f1'), 'inside', all)).toBeNull();
    expect(planMove(f1, onFolder('f2'), 'before', all)).toBeNull();
  });
});
