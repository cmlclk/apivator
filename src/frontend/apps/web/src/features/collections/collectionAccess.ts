import type { CollectionAccessSubject, CollectionTreeDto, WorkspaceRole } from '@apivator/core';
import { translate } from '../../i18n';

export const collectionAccessKey = (id: string) => ['collections', id, 'access'] as const;

export interface AccessRow {
  kind: CollectionAccessSubject;
  subjectId: string;
  name: string;
  email: string | null;
  role: WorkspaceRole;
  workspaceRole: WorkspaceRole | null;
}

/** Collection'ı düzenleyebilir mi? Sunucu rolü vermediyse (eski sürüm) workspace rolü geçerlidir. */
export function canEditCollection(
  collection: Pick<CollectionTreeDto, 'role'> | null | undefined,
  workspaceRole: WorkspaceRole | null | undefined,
): boolean {
  return (collection?.role ?? workspaceRole ?? 'Viewer') !== 'Viewer';
}

/** Kayıt satırındaki açıklama: workspace rolü ile bu collection'daki rolün farkı. */
export function effectiveNote(row: AccessRow, restricted: boolean): string {
  const role = (r: WorkspaceRole) => translate('collections', `access.roles.${r}`);
  const here = role(row.role);
  if (row.kind === 'Team') {
    return row.workspaceRole
      ? translate('collections', 'access.note.teamInWorkspace', { ws: role(row.workspaceRole), here })
      : translate('collections', 'access.note.teamNotInWorkspace', { here });
  }
  const email = row.email ? `${row.email} · ` : '';
  if (!row.workspaceRole) return translate('collections', 'access.note.noAccess', { email });
  const ws = role(row.workspaceRole);
  if (row.workspaceRole === row.role && !restricted)
    return translate('collections', 'access.note.sameRole', { email, ws });
  return translate('collections', 'access.note.differentRole', { email, ws, here });
}
