import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LogOut, Shield, Trash2, Users } from 'lucide-react';
import { Alert, Button, Input, Spinner } from '@apivator/ui';
import type { WorkspaceDto, WorkspaceRole } from '@apivator/core';
import { Dialog } from './ui/Dialog';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { api } from '../lib/api';
import { useT } from '../i18n';
import { errorMessage } from '../lib/errors';
import {
  organizationMembersKey,
  organizationTeamsKey,
  selectClass,
  workspaceMembersKey,
  WORKSPACE_ROLE_HINTS,
  WORKSPACE_ROLE_LABELS,
} from '../lib/teams';
import { workspacesQueryKey } from '../lib/useWorkspaces';
import { useSession } from '../stores/session';

const ROLES: WorkspaceRole[] = ['Viewer', 'Editor', 'Admin'];

function RoleSelect({
  value,
  onChange,
  disabled,
  label,
}: {
  value: WorkspaceRole;
  onChange: (role: WorkspaceRole) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as WorkspaceRole)}
      className={selectClass}
    >
      {ROLES.map((r) => (
        <option key={r} value={r} title={WORKSPACE_ROLE_HINTS[r]}>
          {WORKSPACE_ROLE_LABELS[r]}
        </option>
      ))}
    </select>
  );
}

/** Workspace adı, üyeleri (kişi ve takım) ve rolleri; ayrılma ve silme. */
export function WorkspaceSettingsDialog({
  workspace,
  onClose,
}: {
  workspace: WorkspaceDto;
  onClose: () => void;
}) {
  // Döngülerdeki `t` (takım) değişkenleriyle çakışmasın diye `ts`.
  const ts = useT('shell');
  const tc = useT('common');
  const me = useSession((s) => s.user);
  const queryClient = useQueryClient();
  const isAdmin = workspace.role === 'Admin';
  const isTeam = workspace.type === 'Team';
  const [name, setName] = useState(workspace.name);
  const [error, setError] = useState<string | null>(null);
  const [newUser, setNewUser] = useState({ userId: '', role: 'Editor' as WorkspaceRole });
  const [newTeam, setNewTeam] = useState({ teamId: '', role: 'Editor' as WorkspaceRole });
  const [confirm, setConfirm] = useState<'delete' | 'leave' | null>(null);

  const members = useQuery({
    queryKey: workspaceMembersKey(workspace.id),
    queryFn: () => api.workspaces.members(workspace.id),
    enabled: isTeam,
  });
  const orgMembers = useQuery({
    queryKey: organizationMembersKey(workspace.organizationId),
    queryFn: () => api.organizations.members(workspace.organizationId),
    enabled: isTeam && isAdmin,
  });
  const orgTeams = useQuery({
    queryKey: organizationTeamsKey(workspace.organizationId),
    queryFn: () => api.organizations.teams(workspace.organizationId),
    enabled: isTeam && isAdmin,
  });

  async function act(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: workspaceMembersKey(workspace.id) }),
        queryClient.invalidateQueries({ queryKey: workspacesQueryKey }),
      ]);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const data = members.data;
  const direct = new Set(data?.users.map((u) => u.userId));
  const addedTeams = new Set(data?.teams.map((t) => t.teamId));
  const candidates = orgMembers.data?.members.filter((m) => !direct.has(m.userId)) ?? [];
  const teamCandidates = orgTeams.data?.filter((t) => !addedTeams.has(t.id)) ?? [];
  const isDirectMember = !!me && direct.has(me.id);

  return (
    <Dialog title={ts('workspaceSettings.title', { name: workspace.name })} size="lg" onClose={onClose}>
      <div className="flex flex-col gap-6">
        {error && <Alert tone="error">{error}</Alert>}

        {!isTeam ? (
          <Alert tone="info">
            {ts.rich('workspaceSettings.personalInfo', {
              link: (c) => (
                <Link to="/team" className="font-medium text-accent hover:underline" onClick={onClose}>
                  {c}
                </Link>
              ),
            })}
          </Alert>
        ) : (
          <>
            <section className="flex items-end gap-2">
              <div className="flex-1">
                <Input
                  label={tc('fields.name')}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={!isAdmin}
                />
              </div>
              {isAdmin && name.trim() && name.trim() !== workspace.name && (
                <Button
                  variant="secondary"
                  onClick={() => void act(() => api.workspaces.rename(workspace.id, name))}
                >
                  {ts('workspaceSettings.save')}
                </Button>
              )}
            </section>

            {!data ? (
              <div className="flex justify-center py-6 text-fg-subtle">
                <Spinner className="h-5 w-5" />
              </div>
            ) : (
              <>
                <section aria-label={ts('workspaceSettings.people')} className="flex flex-col gap-2">
                  <h3 className="text-[13px] font-semibold">{ts('workspaceSettings.people')}</h3>
                  <ul className="divide-y divide-line rounded-md border border-line">
                    {data.users.map((u) => (
                      <li key={u.userId} className="flex items-center gap-3 px-3 py-2 text-[13px]">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">
                            {u.displayName}
                            {u.userId === me?.id && (
                              <span className="font-normal text-fg-subtle">
                                {' '}
                                {ts('workspaceSettings.you')}
                              </span>
                            )}
                          </span>
                          <span className="block truncate text-xs text-fg-subtle">{u.email}</span>
                        </span>
                        <RoleSelect
                          label={ts('workspaceSettings.roleOf', { name: u.displayName })}
                          value={u.role}
                          disabled={!isAdmin}
                          onChange={(role) =>
                            void act(() => api.workspaces.setUserRole(workspace.id, u.userId, role))
                          }
                        />
                        {isAdmin && u.userId !== me?.id && (
                          <button
                            type="button"
                            aria-label={ts('workspaceSettings.remove', { name: u.displayName })}
                            onClick={() => void act(() => api.workspaces.removeUser(workspace.id, u.userId))}
                            className="rounded p-1.5 text-fg-subtle hover:bg-danger/10 hover:text-danger"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </li>
                    ))}
                    {data.organizationAdmins
                      .filter((a) => !direct.has(a.userId))
                      .map((a) => (
                        <li
                          key={a.userId}
                          className="flex items-center gap-3 px-3 py-2 text-[13px] text-fg-muted"
                        >
                          <Shield className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          <span className="min-w-0 flex-1 truncate">
                            {a.displayName}{' '}
                            <span className="text-xs text-fg-subtle">
                              · {ts('workspaceSettings.orgAdmin')}
                            </span>
                          </span>
                          <span className="text-xs">{ts('workspaceSettings.adminRole')}</span>
                        </li>
                      ))}
                  </ul>
                  {isAdmin &&
                    (candidates.length > 0 ? (
                      <div className="flex items-center gap-2">
                        <select
                          aria-label={ts('workspaceSettings.addPerson')}
                          value={newUser.userId}
                          onChange={(e) => setNewUser((n) => ({ ...n, userId: e.target.value }))}
                          className={`${selectClass} min-w-0 flex-1`}
                        >
                          <option value="">{ts('workspaceSettings.pickPerson')}</option>
                          {candidates.map((m) => (
                            <option key={m.userId} value={m.userId}>
                              {m.displayName} ({m.email})
                            </option>
                          ))}
                        </select>
                        <RoleSelect
                          label={ts('workspaceSettings.newPersonRole')}
                          value={newUser.role}
                          onChange={(role) => setNewUser((n) => ({ ...n, role }))}
                        />
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={!newUser.userId}
                          onClick={() =>
                            void act(async () => {
                              await api.workspaces.setUserRole(workspace.id, newUser.userId, newUser.role);
                              setNewUser((n) => ({ ...n, userId: '' }));
                            })
                          }
                        >
                          {ts('workspaceSettings.add')}
                        </Button>
                      </div>
                    ) : (
                      <p className="text-xs text-fg-subtle">
                        {ts.rich('workspaceSettings.everyoneAdded', {
                          link: (c) => (
                            <Link to="/team" className="text-accent hover:underline" onClick={onClose}>
                              {c}
                            </Link>
                          ),
                        })}
                      </p>
                    ))}
                </section>

                <section aria-label={ts('workspaceSettings.teams')} className="flex flex-col gap-2">
                  <h3 className="text-[13px] font-semibold">{ts('workspaceSettings.teams')}</h3>
                  {data.teams.length === 0 && (
                    <p className="text-xs text-fg-subtle">{ts('workspaceSettings.teamsHint')}</p>
                  )}
                  {data.teams.length > 0 && (
                    <ul className="divide-y divide-line rounded-md border border-line">
                      {data.teams.map((t) => (
                        <li key={t.teamId} className="flex items-center gap-3 px-3 py-2 text-[13px]">
                          <Users className="h-3.5 w-3.5 shrink-0 text-fg-subtle" aria-hidden="true" />
                          <span className="min-w-0 flex-1 truncate">
                            {t.name}{' '}
                            <span className="text-xs text-fg-subtle">
                              · {ts('workspaceSettings.memberCount', { count: t.memberCount })}
                            </span>
                          </span>
                          <RoleSelect
                            label={ts('workspaceSettings.teamRole', { name: t.name })}
                            value={t.role}
                            disabled={!isAdmin}
                            onChange={(role) =>
                              void act(() => api.workspaces.setTeamRole(workspace.id, t.teamId, role))
                            }
                          />
                          {isAdmin && (
                            <button
                              type="button"
                              aria-label={ts('workspaceSettings.removeTeam', { name: t.name })}
                              onClick={() =>
                                void act(() => api.workspaces.removeTeam(workspace.id, t.teamId))
                              }
                              className="rounded p-1.5 text-fg-subtle hover:bg-danger/10 hover:text-danger"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  {isAdmin && teamCandidates.length > 0 && (
                    <div className="flex items-center gap-2">
                      <select
                        aria-label={ts('workspaceSettings.addTeam')}
                        value={newTeam.teamId}
                        onChange={(e) => setNewTeam((n) => ({ ...n, teamId: e.target.value }))}
                        className={`${selectClass} min-w-0 flex-1`}
                      >
                        <option value="">{ts('workspaceSettings.pickTeam')}</option>
                        {teamCandidates.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name} ({ts('workspaceSettings.memberCount', { count: t.members.length })})
                          </option>
                        ))}
                      </select>
                      <RoleSelect
                        label={ts('workspaceSettings.newTeamRole')}
                        value={newTeam.role}
                        onChange={(role) => setNewTeam((n) => ({ ...n, role }))}
                      />
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={!newTeam.teamId}
                        onClick={() =>
                          void act(async () => {
                            await api.workspaces.setTeamRole(workspace.id, newTeam.teamId, newTeam.role);
                            setNewTeam((n) => ({ ...n, teamId: '' }));
                          })
                        }
                      >
                        {ts('workspaceSettings.add')}
                      </Button>
                    </div>
                  )}
                </section>
              </>
            )}

            <section className="flex flex-wrap gap-2 border-t border-line pt-4">
              {isDirectMember && (
                <Button variant="ghost" size="sm" onClick={() => setConfirm('leave')}>
                  <LogOut className="h-3.5 w-3.5" /> {ts('workspaceSettings.leave')}
                </Button>
              )}
              {isAdmin && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="ms-auto text-danger"
                  onClick={() => setConfirm('delete')}
                >
                  <Trash2 className="h-3.5 w-3.5" /> {ts('workspaceSettings.delete')}
                </Button>
              )}
            </section>
          </>
        )}
      </div>

      {confirm && (
        <ConfirmDialog
          title={confirm === 'delete' ? ts('workspaceSettings.delete') : ts('workspaceSettings.leave')}
          confirmLabel={
            confirm === 'delete'
              ? ts('workspaceSettings.confirmDelete')
              : ts('workspaceSettings.confirmLeave')
          }
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            if (confirm === 'delete') await api.workspaces.remove(workspace.id);
            else await api.workspaces.removeUser(workspace.id, me!.id);
            await queryClient.invalidateQueries({ queryKey: workspacesQueryKey });
            onClose();
          }}
        >
          {confirm === 'delete'
            ? ts('workspaceSettings.deleteWarning', { name: workspace.name })
            : ts('workspaceSettings.leaveWarning')}
        </ConfirmDialog>
      )}
    </Dialog>
  );
}
