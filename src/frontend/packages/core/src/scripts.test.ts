import { describe, expect, it } from 'vitest';
import { emptyAuth, type CollectionTreeDto } from './index';
import { scopeChanges, scriptChain, variableChanges } from './scripts';
import { buildVariableMap, scopeValues } from './variables';

const s = (preRequest: string, postResponse = '') => ({ preRequest, postResponse });

describe('scriptChain', () => {
  it('orders collection, folders (outer to inner) and request', () => {
    const collection: CollectionTreeDto = {
      id: 'c',
      workspaceId: 'w',
      name: 'C',
      description: null,
      auth: emptyAuth('None'),
      variables: [],
      scripts: s('col', 'col-test'),
      folders: [
        {
          id: 'outer',
          parentFolderId: null,
          name: 'o',
          sortOrder: 0,
          auth: emptyAuth(),
          scripts: s('outer'),
        },
        {
          id: 'inner',
          parentFolderId: 'outer',
          name: 'i',
          sortOrder: 0,
          auth: emptyAuth(),
          scripts: s('', 'inner-test'),
        },
      ],
      requests: [],
      examples: [],
    };
    expect(scriptChain(collection, 'inner', s('req', 'req-test'))).toEqual({
      preRequest: ['col', 'outer', 'req'],
      postResponse: ['col-test', 'inner-test', 'req-test'],
    });
    expect(scriptChain(undefined, null, s('  ', 'x'))).toEqual({ preRequest: [], postResponse: ['x'] });
  });
});

describe('variable changes', () => {
  it('reports set and unset keys', () => {
    expect(variableChanges({ a: '1', b: '2' }, { a: '1', b: '3', c: '4' })).toEqual({
      set: { b: '3', c: '4' },
      unset: [],
    });
    expect(variableChanges({ a: '1' }, {})).toEqual({ set: {}, unset: ['a'] });
    expect(variableChanges({ a: '1' }, { a: '1' })).toBeNull();
    expect(
      scopeChanges(
        { environment: { a: '1' }, collection: null },
        { environment: { a: '2' }, collection: { x: '1' } },
      ),
    ).toEqual({
      environment: { set: { a: '2' }, unset: [] },
    });
  });

  it('includes script-created current values in the map and payload', () => {
    const scope = {
      kind: 'environment' as const,
      name: 'Test',
      variables: [
        { key: 'base', value: 'http://a', enabled: true, isSecret: false },
        { key: 'off', value: 'x', enabled: false, isSecret: false },
      ],
      current: { base: 'http://b', token: 'abc' },
    };
    expect(scopeValues(scope)).toEqual({ base: 'http://b', token: 'abc' });
    expect(buildVariableMap([scope]).get('token')?.value).toBe('abc');
  });
});
