import { describe, expect, it } from 'vitest';
import type { WorkspaceDto } from '@apivator/core';
import { groupWorkspaces } from './teams';

const ws = (id: string, org: string, type: WorkspaceDto['type']): WorkspaceDto =>
  ({ id, name: id, organizationId: org, organizationName: org, type, role: 'Admin' }) as WorkspaceDto;

describe('groupWorkspaces', () => {
  it('kişiseli öne alır ve takım workspace’lerini organizasyona göre gruplar', () => {
    const groups = groupWorkspaces([
      ws('b1', 'Beta', 'Team'),
      ws('a1', 'Alfa', 'Team'),
      ws('me', 'Ayşe', 'Personal'),
      ws('b2', 'Beta', 'Team'),
    ]);
    expect(groups.map((g) => g.name)).toEqual(['Ayşe', 'Alfa', 'Beta']);
    expect(groups[0]!.personal).toBe(true);
    expect(groups[2]!.items.map((w) => w.id)).toEqual(['b1', 'b2']);
  });
});
