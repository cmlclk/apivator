import { describe, expect, it } from 'vitest';
import { emptyAuth, emptyScripts, type CollectionTreeDto } from '@apivator/core';
import { runOrder } from './runOrder';

const folder = (id: string, parentFolderId: string | null, name: string, sortOrder: number) => ({
  id,
  parentFolderId,
  name,
  sortOrder,
  auth: emptyAuth(),
  scripts: emptyScripts(),
});
const request = (id: string, folderId: string | null, sortOrder: number) => ({
  id,
  folderId,
  name: id,
  method: 'GET',
  sortOrder,
});

const collection: CollectionTreeDto = {
  id: 'c',
  workspaceId: 'w',
  name: 'C',
  description: null,
  auth: emptyAuth('None'),
  variables: [],
  scripts: emptyScripts(),
  folders: [folder('f2', null, 'İkinci', 1), folder('f1', null, 'Birinci', 0), folder('f1a', 'f1', 'Alt', 0)],
  requests: [
    request('kok', null, 0),
    request('r-f1', 'f1', 1),
    request('r-f1a', 'f1a', 0),
    request('r-f2', 'f2', 0),
  ],
  examples: [],
};

describe('runOrder', () => {
  it('visits folders depth-first before requests at each level', () => {
    expect(runOrder(collection).map((i) => [i.request.id, i.path])).toEqual([
      ['r-f1a', 'Birinci / Alt'],
      ['r-f1', 'Birinci'],
      ['r-f2', 'İkinci'],
      ['kok', ''],
    ]);
    expect(runOrder(collection, 'f1').map((i) => i.request.id)).toEqual(['r-f1a', 'r-f1']);
  });

  it('skips WebSocket and SSE requests', () => {
    const withStreams: CollectionTreeDto = {
      ...collection,
      requests: [
        ...collection.requests,
        { ...request('ws', null, 1), kind: 'WebSocket' },
        { ...request('sse', null, 2), kind: 'Sse' },
      ],
    };
    expect(runOrder(withStreams).map((i) => i.request.id)).not.toContain('ws');
    expect(runOrder(withStreams).map((i) => i.request.id)).not.toContain('sse');
  });
});
