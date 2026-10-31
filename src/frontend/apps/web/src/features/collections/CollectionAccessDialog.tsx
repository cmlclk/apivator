import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, Trash2, UserPlus, Users } from 'lucide-react';
import { Alert, Button, Spinner, cn } from '@apivator/ui';
import type { CollectionTreeDto, WorkspaceDto, WorkspaceRole } from '@apivator/core';
import { Dialog } from '../../components/ui/Dialog';
import { toUpper, useT } from '../../i18n';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import {
  organizationTeamsKey,
  selectClass,
  WORKSPACE_ROLE_LABELS,
  workspaceMembersKey,
} from '../../lib/teams';
import { collectionAccessKey, effectiveNote, type AccessRow } from './collectionAccess';
import { collectionsQueryKey } from './useCollections';

const ASSIGNABLE: WorkspaceRole[] = ['Viewer', 'Editor'];

/**
 * Collection düzeyinde roller: workspace yöneticisi, kişilere ya da takımlara bu collection için Görüntüleyici veya
 * Düzenleyici rolü verir ve isterse düzenlemeyi yalnızca listedekilere kısıtlar. Diğer üyeler listeyi görür.
 */
export function CollectionAccessDialog({
  collection,
  workspace,
  onClose,
}: {
  collection: CollectionTreeDto;
  workspace: WorkspaceDto;
  onClose: () => void;
}) {
  const t = useT('collections');
  const queryClient = useQueryClient();
  const access = useQuery({
    queryKey: collectionAccessKey(collection.id),
    queryFn: () => api.collections.access(collection.id),
  });
  const canManage = access.data?.canManage ?? false;
  const personal = workspace.type === 'Personal';
  const members = useQuery({
    queryKey: workspaceMembersKey(workspace.id),
    queryFn: () => api.workspaces.members(workspace.id),
    enabled: canManage && !personal,
  });
  const teams = useQuery({
    queryKey: organizationTeamsKey(workspace.organizationId),
    queryFn: () => api.organizations.teams(workspace.organizationId),
    enabled: canManage && !personal,
  });

  const [restricted, setRestricted] = useState(false);
  const [rows, setRows] = useState<AccessRow[]>([]);
  const [pick, setPick] = useState('');
  const [pickRole, setPickRole] = useState<WorkspaceRole>('Editor');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!access.data) return;
    setRestricted(access.data.editingRestricted);
    setRows(
      access.data.entries.map((e) => ({
        kind: e.kind,
        subjectId: e.subjectId,
        name: e.name,
        email: e.email,
        role: e.role,
        workspaceRole: e.workspaceRole,
      })),
    );
  }, [access.data]);

  /** Eklenebilecekler: yönetici olmayan workspace üyeleri ve organizasyonun takımları (listede olmayanlar). */
  const candidates = useMemo(() => {
    const taken = new Set(rows.map((r) => `${r.kind}:${r.subjectId}`));
    const adminIds = new Set([
      ...(members.data?.organizationAdmins ?? []).map((u) => u.userId),
      ...(members.data?.users ?? []).filter((u) => u.role === 'Admin').map((u) => u.userId),
    ]);
    const teamRole = new Map((members.data?.teams ?? []).map((t) => [t.teamId, t.role] as const));
    return {
      users: (members.data?.users ?? [])
        .filter((u) => !adminIds.has(u.userId) && !taken.has(`User:${u.userId}`))
        .map((u) => ({ id: u.userId, name: u.displayName, email: u.email, role: u.role })),
      teams: (teams.data ?? [])
        .filter((t) => !taken.has(`Team:${t.id}`))
        .map((t) => ({ id: t.id, name: t.name, role: teamRole.get(t.id) ?? null, count: t.members.length })),
    };
  }, [members.data, teams.data, rows]);

  function add() {
    const [kind, id] = pick.split(':') as ['User' | 'Team', string];
    if (!id) return;
    if (kind === 'User') {
      const u = candidates.users.find((c) => c.id === id);
      if (!u) return;
      setRows((r) => [
        ...r,
        { kind, subjectId: id, name: u.name, email: u.email, role: pickRole, workspaceRole: u.role },
      ]);
    } else {
      const team = candidates.teams.find((c) => c.id === id);
      if (!team) return;
      setRows((r) => [
        ...r,
        { kind, subjectId: id, name: team.name, email: null, role: pickRole, workspaceRole: team.role },
      ]);
    }
    setPick('');
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.collections.updateAccess(
        collection.id,
        restricted,
        rows.map((r) => ({
          userId: r.kind === 'User' ? r.subjectId : null,
          teamId: r.kind === 'Team' ? r.subjectId : null,
          role: r.role,
        })),
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: collectionAccessKey(collection.id) }),
        queryClient.invalidateQueries({ queryKey: collectionsQueryKey(workspace.id) }),
      ]);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const dirty =
    access.data !== undefined &&
    (restricted !== access.data.editingRestricted ||
      JSON.stringify(rows.map((r) => [r.kind, r.subjectId, r.role])) !==
        JSON.stringify(access.data.entries.map((e) => [e.kind, e.subjectId, e.role])));

  return (
    <Dialog
      title={t('access.title', { name: collection.name })}
      size="lg"
      onClose={onClose}
      footer={
        canManage && !personal ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              {t('access.cancel')}
            </Button>
            <Button onClick={() => void save()} loading={busy} disabled={!dirty}>
              {t('access.save')}
            </Button>
          </>
        ) : (
          <Button variant="secondary" onClick={onClose}>
            {t('access.close')}
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-4 text-[13px]">
        {access.isLoading && <Spinner className="mx-auto h-4 w-4 text-fg-subtle" />}
        {access.error && <Alert tone="error">{errorMessage(access.error)}</Alert>}
        {error && <Alert tone="error">{error}</Alert>}

        {personal ? (
          <Alert tone="info">{t('access.personalNotice')}</Alert>
        ) : (
          access.data && (
            <>
              <p className="text-fg-muted">{t('access.intro')}</p>
              <p>
                {t('access.myRole')}{' '}
                <strong className="font-medium">{WORKSPACE_ROLE_LABELS[access.data.myRole]}</strong>
              </p>

              <label
                className={cn(
                  'flex items-start gap-2 rounded-md border border-line p-3',
                  restricted && 'border-warning/50 bg-warning/5',
                )}
              >
                <input
                  type="checkbox"
                  checked={restricted}
                  disabled={!canManage}
                  onChange={(e) => setRestricted(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  <span className="flex items-center gap-1.5 font-medium">
                    <Lock className="h-3.5 w-3.5" aria-hidden="true" /> {t('access.restrict')}
                  </span>
                  <span className="block text-xs text-fg-subtle">{t('access.restrictHint')}</span>
                </span>
              </label>

              <section aria-label={t('access.rolesLabel')} className="flex flex-col gap-2">
                <h3 className="font-semibold">{t('access.subjects')}</h3>
                {rows.length === 0 ? (
                  <p className="rounded-md border border-dashed border-line p-4 text-center text-fg-subtle">
                    {t('access.empty')}
                  </p>
                ) : (
                  <ul className="divide-y divide-line rounded-md border border-line">
                    {rows.map((r, i) => (
                      <li key={`${r.kind}:${r.subjectId}`} className="flex items-center gap-3 px-3 py-2">
                        {r.kind === 'Team' ? (
                          <Users className="h-4 w-4 shrink-0 text-fg-subtle" aria-label={t('access.team')} />
                        ) : (
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[11px] font-semibold text-accent">
                            {toUpper(r.name.slice(0, 1))}
                          </span>
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{r.name}</span>
                          <span className="block truncate text-xs text-fg-subtle">
                            {effectiveNote(r, restricted)}
                          </span>
                        </span>
                        <select
                          value={r.role}
                          disabled={!canManage}
                          aria-label={t('access.rowRole', { name: r.name })}
                          onChange={(e) =>
                            setRows((all) =>
                              all.map((x, j) =>
                                j === i ? { ...x, role: e.target.value as WorkspaceRole } : x,
                              ),
                            )
                          }
                          className={selectClass}
                        >
                          {ASSIGNABLE.map((role) => (
                            <option key={role} value={role}>
                              {WORKSPACE_ROLE_LABELS[role]}
                            </option>
                          ))}
                        </select>
                        {canManage && (
                          <button
                            type="button"
                            onClick={() => setRows((all) => all.filter((_, j) => j !== i))}
                            aria-label={t('access.rowRemove', { name: r.name })}
                            className="rounded p-1 text-fg-subtle hover:bg-danger/10 hover:text-danger"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                {canManage && (
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={pick}
                      onChange={(e) => setPick(e.target.value)}
                      aria-label={t('access.pickLabel')}
                      className={cn(selectClass, 'min-w-0 flex-1')}
                    >
                      <option value="">{t('access.pickPlaceholder')}</option>
                      {candidates.users.length > 0 && (
                        <optgroup label={t('access.groupMembers')}>
                          {candidates.users.map((u) => (
                            <option key={u.id} value={`User:${u.id}`}>
                              {u.name} ({u.email}) · {WORKSPACE_ROLE_LABELS[u.role]}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {candidates.teams.length > 0 && (
                        <optgroup label={t('access.groupTeams')}>
                          {candidates.teams.map((team) => (
                            <option key={team.id} value={`Team:${team.id}`}>
                              {t('access.teamOption', { name: team.name, count: team.count })}
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                    <select
                      value={pickRole}
                      onChange={(e) => setPickRole(e.target.value as WorkspaceRole)}
                      aria-label={t('access.pickRole')}
                      className={selectClass}
                    >
                      {ASSIGNABLE.map((role) => (
                        <option key={role} value={role}>
                          {WORKSPACE_ROLE_LABELS[role]}
                        </option>
                      ))}
                    </select>
                    <Button size="sm" variant="secondary" onClick={add} disabled={!pick}>
                      <UserPlus className="h-3.5 w-3.5" /> {t('access.add')}
                    </Button>
                  </div>
                )}
                {canManage && <p className="text-xs text-fg-subtle">{t('access.footnote')}</p>}
              </section>
            </>
          )
        )}
      </div>
    </Dialog>
  );
}
