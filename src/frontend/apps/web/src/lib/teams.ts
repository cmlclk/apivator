import { useQuery } from '@tanstack/react-query';
import type { OrganizationRole, WorkspaceDto, WorkspaceRole } from '@apivator/core';
import { compareText, translate } from '../i18n';
import { api } from './api';

export const organizationsQueryKey = ['organizations'] as const;
export const myInvitationsQueryKey = ['my-invitations'] as const;
export const organizationMembersKey = (id: string) => ['organizations', id, 'members'] as const;
export const organizationTeamsKey = (id: string) => ['organizations', id, 'teams'] as const;
export const workspaceMembersKey = (id: string) => ['workspaces', id, 'members'] as const;

// Etiketler erişim anında çevrilir (getter): dil değişince bayatlamaz, dışarıya aynı API sunulur.
export const ORGANIZATION_ROLE_LABELS: Record<OrganizationRole, string> = {
  get Owner() {
    return translate('common', 'roles.organization.owner');
  },
  get Admin() {
    return translate('common', 'roles.organization.admin');
  },
  get Member() {
    return translate('common', 'roles.organization.member');
  },
};

export const WORKSPACE_ROLE_LABELS: Record<WorkspaceRole, string> = {
  get Admin() {
    return translate('common', 'roles.workspace.admin');
  },
  get Editor() {
    return translate('common', 'roles.workspace.editor');
  },
  get Viewer() {
    return translate('common', 'roles.workspace.viewer');
  },
};

export const WORKSPACE_ROLE_HINTS: Record<WorkspaceRole, string> = {
  get Admin() {
    return translate('common', 'roles.workspaceHints.admin');
  },
  get Editor() {
    return translate('common', 'roles.workspaceHints.editor');
  },
  get Viewer() {
    return translate('common', 'roles.workspaceHints.viewer');
  },
};

export function useOrganizations() {
  return useQuery({ queryKey: organizationsQueryKey, queryFn: api.organizations.list });
}

export function useMyInvitations() {
  return useQuery({ queryKey: myInvitationsQueryKey, queryFn: api.invitations.mine, staleTime: 60_000 });
}

export const selectClass =
  'h-8 rounded-md border border-line bg-surface px-2 text-[13px] text-fg disabled:opacity-60';

/** Kişisel workspace önce, sonra organizasyonlara göre gruplanmış takım workspace'leri. */
export function groupWorkspaces(workspaces: WorkspaceDto[]) {
  const groups = new Map<string, { name: string; personal: boolean; items: WorkspaceDto[] }>();
  for (const w of workspaces) {
    const key = w.type === 'Personal' ? `personal:${w.organizationId}` : w.organizationId;
    const group = groups.get(key) ?? { name: w.organizationName, personal: w.type === 'Personal', items: [] };
    group.items.push(w);
    groups.set(key, group);
  }
  return [...groups.values()].sort(
    (a, b) => Number(b.personal) - Number(a.personal) || compareText(a.name, b.name),
  );
}
