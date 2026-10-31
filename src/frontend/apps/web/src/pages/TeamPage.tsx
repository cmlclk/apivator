import { useEffect, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router';
import {
  ArrowLeft,
  Building2,
  Clock,
  Lock,
  LogOut,
  Mail,
  Plus,
  RotateCw,
  Settings,
  ShieldCheck,
  ShieldOff,
  Trash2,
  KeyRound,
  Users,
  X,
} from 'lucide-react';
import { Alert, Button, Input, Spinner } from '@apivator/ui';
import type { OrganizationDto, OrganizationRole, WorkspaceDto, WorkspaceRole } from '@apivator/core';
import { formatDate, isLanguage, LANGUAGE_NAMES, LANGUAGES, toUpper, useT, type Language } from '../i18n';
import { api } from '../lib/api';
import { errorMessage } from '../lib/errors';
import {
  myInvitationsQueryKey,
  organizationMembersKey,
  organizationsQueryKey,
  organizationTeamsKey,
  ORGANIZATION_ROLE_LABELS,
  selectClass,
  useOrganizations,
  WORKSPACE_ROLE_LABELS,
} from '../lib/teams';
import { useWorkspaces, workspacesQueryKey } from '../lib/useWorkspaces';
import { useSession } from '../stores/session';
import { useUi } from '../stores/ui';
import { SegmentedTabs } from '../components/ui/SegmentedTabs';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { Menu } from '../components/ui/Menu';
import { WorkspaceSettingsDialog } from '../components/WorkspaceSettingsDialog';
import { CreateWorkspaceDialog } from '../components/CreateWorkspaceDialog';
import { AuditTab } from '../features/audit/AuditTab';
import { SsoTab } from '../features/sso/SsoTab';

type Tab = 'members' | 'teams' | 'workspaces' | 'security' | 'sso' | 'audit';
type Confirm = { title: string; label: string; body: string; run: () => Promise<unknown>; done?: string };

function useAct(organizationId: string, setError: (e: string | null) => void) {
  const queryClient = useQueryClient();
  return async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['organizations', organizationId] }),
        queryClient.invalidateQueries({ queryKey: organizationsQueryKey, exact: true }),
        queryClient.invalidateQueries({ queryKey: workspacesQueryKey }),
      ]);
    }
  };
}

function CreateOrganization({
  onCreated,
  onCancel,
  cancelLabel,
  compact,
}: {
  onCreated: (id: string) => void;
  onCancel: () => void;
  cancelLabel?: string;
  compact?: boolean;
}) {
  const t = useT('team');
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const org = await api.organizations.create(name);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: organizationsQueryKey }),
        queryClient.invalidateQueries({ queryKey: workspacesQueryKey }),
      ]);
      setName('');
      onCreated(org.id);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel();
      }}
      className={
        compact ? 'flex flex-col gap-3 rounded-md border border-line bg-surface p-3' : 'flex flex-col gap-3'
      }
    >
      {error && <Alert tone="error">{error}</Alert>}
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <Input
            label={compact ? t('org.newName') : t('org.name')}
            aria-label={t('org.name')}
            placeholder={t('org.namePlaceholder')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </div>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {cancelLabel ?? t('cancel')}
        </Button>
        <Button type="submit" loading={busy} disabled={!name.trim()}>
          {t('org.create')}
        </Button>
      </div>
    </form>
  );
}

function InviteForm({
  organization,
  workspaces,
}: {
  organization: OrganizationDto;
  workspaces: WorkspaceDto[];
}) {
  const queryClient = useQueryClient();
  const t = useT('team');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<OrganizationRole>('Member');
  const [workspaceId, setWorkspaceId] = useState('');
  const [workspaceRole, setWorkspaceRole] = useState<WorkspaceRole>('Editor');
  // Seçilmediyse organizasyonun varsayılan dili kullanılır.
  const [language, setLanguage] = useState<Language | null>(null);
  const inviteLanguage = language ?? languageOf(organization);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const invitation = await api.organizations.invite(organization.id, {
        email,
        role,
        workspaceId: workspaceId || null,
        workspaceRole: workspaceId ? workspaceRole : null,
        language: inviteLanguage,
      });
      setMessage({ tone: 'success', text: t('inviteForm.sent', { email: invitation.email }) });
      setEmail('');
      await queryClient.invalidateQueries({ queryKey: organizationMembersKey(organization.id) });
    } catch (e) {
      setMessage({ tone: 'error', text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      aria-label={t('inviteForm.label')}
      className="flex flex-col gap-2 rounded-md border border-line p-3"
    >
      <h3 className="text-[13px] font-semibold">{t('inviteForm.title')}</h3>
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="email"
          required
          aria-label={t('inviteForm.emailLabel')}
          placeholder="ad@sirket.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={`${selectClass} min-w-56 flex-1`}
        />
        <select
          aria-label={t('inviteForm.orgRole')}
          value={role}
          onChange={(e) => setRole(e.target.value as OrganizationRole)}
          className={selectClass}
        >
          <option value="Member">{t('roles.member')}</option>
          <option value="Admin">{t('roles.admin')}</option>
        </select>
        <select
          aria-label={t('inviteForm.workspace')}
          value={workspaceId}
          onChange={(e) => setWorkspaceId(e.target.value)}
          className={selectClass}
        >
          <option value="">{t('inviteForm.noWorkspace')}</option>
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        <select
          aria-label={t('inviteForm.language')}
          value={inviteLanguage}
          onChange={(e) => isLanguage(e.target.value) && setLanguage(e.target.value)}
          className={selectClass}
        >
          {LANGUAGES.map((l) => (
            <option key={l} value={l}>
              {LANGUAGE_NAMES[l]}
            </option>
          ))}
        </select>
        {workspaceId && (
          <select
            aria-label={t('inviteForm.workspaceRole')}
            value={workspaceRole}
            onChange={(e) => setWorkspaceRole(e.target.value as WorkspaceRole)}
            className={selectClass}
          >
            {(['Viewer', 'Editor', 'Admin'] as const).map((r) => (
              <option key={r} value={r}>
                {WORKSPACE_ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        )}
        <Button type="submit" size="sm" loading={busy} disabled={!email.trim()}>
          <Mail className="h-3.5 w-3.5" /> {t('inviteForm.submit')}
        </Button>
      </div>
      <p className="text-xs text-fg-subtle">{t('inviteForm.hint')}</p>
    </form>
  );
}

function MembersTab({
  organization,
  workspaces,
  isAdmin,
  setConfirm,
}: {
  organization: OrganizationDto;
  workspaces: WorkspaceDto[];
  isAdmin: boolean;
  setConfirm: (c: Confirm) => void;
}) {
  const t = useT('team');
  const me = useSession((s) => s.user);
  const [error, setError] = useState<string | null>(null);
  const act = useAct(organization.id, setError);
  const { data } = useQuery({
    queryKey: organizationMembersKey(organization.id),
    queryFn: () => api.organizations.members(organization.id),
  });
  const isOwner = organization.role === 'Owner';

  if (!data) return <Spinner className="mx-auto my-8 h-5 w-5 text-fg-subtle" />;
  const pending = data.invitations.filter((i) => i.status === 'Pending' || i.status === 'Expired');

  function changeRole(userId: string, name: string, role: OrganizationRole) {
    if (role === 'Owner') {
      setConfirm({
        title: t('members.transfer.title'),
        label: t('members.transfer.label'),
        body: t('members.transfer.body', { name }),
        run: () => api.organizations.changeRole(organization.id, userId, role),
      });
    } else void act(() => api.organizations.changeRole(organization.id, userId, role));
  }

  return (
    <div className="flex flex-col gap-5">
      {error && <Alert tone="error">{error}</Alert>}
      <ul aria-label={t('members.list')} className="divide-y divide-line rounded-md border border-line">
        {data.members.map((m) => {
          const self = m.userId === me?.id;
          const canEdit = isAdmin && !self && m.role !== 'Owner' && (isOwner || m.role !== 'Admin');
          return (
            <li key={m.userId} className="flex items-center gap-3 px-3 py-2 text-[13px]">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[11px] font-semibold text-accent">
                {toUpper(m.displayName.slice(0, 1))}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  {m.displayName}
                  {self && <span className="font-normal text-fg-subtle"> {t('members.you')}</span>}
                </span>
                <span className="block truncate text-xs text-fg-subtle">{m.email}</span>
              </span>
              {m.twoFactorEnabled != null &&
                (m.twoFactorEnabled ? (
                  <span title={t('members.twoFactorOn')} aria-label={t('members.twoFactorOnLabel')}>
                    <ShieldCheck className="h-4 w-4 text-success" />
                  </span>
                ) : (
                  <span title={t('members.twoFactorOff')} aria-label={t('members.twoFactorOffLabel')}>
                    <ShieldOff className="h-4 w-4 text-fg-subtle" />
                  </span>
                ))}
              <span className="hidden text-xs text-fg-subtle sm:block">
                {formatDate(m.joinedAt, { dateStyle: 'medium' })}
              </span>
              {canEdit ? (
                <select
                  aria-label={t('members.roleOf', { name: m.displayName })}
                  value={m.role}
                  onChange={(e) => changeRole(m.userId, m.displayName, e.target.value as OrganizationRole)}
                  className={selectClass}
                >
                  <option value="Member">{t('roles.member')}</option>
                  <option value="Admin">{t('roles.admin')}</option>
                  {isOwner && <option value="Owner">{t('members.owner')}</option>}
                </select>
              ) : (
                <span className="w-24 text-end text-xs text-fg-muted">
                  {ORGANIZATION_ROLE_LABELS[m.role]}
                </span>
              )}
              {isAdmin && !self && (m.role !== 'Owner' || isOwner) ? (
                <Menu
                  label={t('members.securityActions', { name: m.displayName })}
                  items={[
                    {
                      label: t('members.revokeSessions.menu'),
                      icon: LogOut,
                      onSelect: () =>
                        setConfirm({
                          title: t('members.revokeSessions.title'),
                          label: t('members.revokeSessions.label'),
                          body: t('members.revokeSessions.body', { name: m.displayName }),
                          run: () => api.organizations.revokeMemberSessions(organization.id, m.userId),
                          done: t('members.revokeSessions.done', { name: m.displayName }),
                        }),
                    },
                    {
                      label: t('members.passwordReset.menu'),
                      icon: KeyRound,
                      onSelect: () =>
                        setConfirm({
                          title: t('members.passwordReset.title'),
                          label: t('members.passwordReset.label'),
                          body: t('members.passwordReset.body', { email: m.email }),
                          run: () => api.organizations.sendMemberPasswordReset(organization.id, m.userId),
                          done: t('members.passwordReset.done', { email: m.email }),
                        }),
                    },
                  ]}
                />
              ) : (
                isAdmin && <span className="w-[26px]" />
              )}
              {canEdit ? (
                <button
                  type="button"
                  aria-label={t('members.remove.aria', { name: m.displayName })}
                  onClick={() =>
                    setConfirm({
                      title: t('members.remove.title'),
                      label: t('members.remove.label'),
                      body: t('members.remove.body', { name: m.displayName }),
                      run: () => api.organizations.removeMember(organization.id, m.userId),
                    })
                  }
                  className="rounded p-1.5 text-fg-subtle hover:bg-danger/10 hover:text-danger"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              ) : (
                <span className="w-[26px]" />
              )}
            </li>
          );
        })}
      </ul>

      {isAdmin && <InviteForm organization={organization} workspaces={workspaces} />}

      {isAdmin && pending.length > 0 && (
        <section aria-label={t('members.pending.title')} className="flex flex-col gap-2">
          <h3 className="text-[13px] font-semibold">{t('members.pending.title')}</h3>
          <ul className="divide-y divide-line rounded-md border border-line">
            {pending.map((i) => (
              <li key={i.id} className="flex items-center gap-3 px-3 py-2 text-[13px]">
                <Clock className="h-3.5 w-3.5 shrink-0 text-fg-subtle" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{i.email}</span>
                  <span className="block truncate text-xs text-fg-subtle">
                    {ORGANIZATION_ROLE_LABELS[i.role]}
                    {i.workspaceName &&
                      ` · ${t('members.pending.withWorkspace', {
                        workspace: i.workspaceName,
                        role: WORKSPACE_ROLE_LABELS[i.workspaceRole!],
                      })}`}{' '}
                    ·{' '}
                    {i.status === 'Expired' ? (
                      <span className="text-danger">{t('members.pending.expired')}</span>
                    ) : (
                      t('members.pending.until', { date: formatDate(i.expiresAt, { dateStyle: 'medium' }) })
                    )}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void act(() => api.invitations.resend(i.id))}
                >
                  <RotateCw className="h-3.5 w-3.5" /> {t('members.pending.resend')}
                </Button>
                <button
                  type="button"
                  aria-label={t('members.pending.revoke', { email: i.email })}
                  onClick={() => void act(() => api.invitations.revoke(i.id))}
                  className="rounded p-1.5 text-fg-subtle hover:bg-danger/10 hover:text-danger"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!isOwner && me && (
        <div className="border-t border-line pt-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              setConfirm({
                title: t('members.leave.title'),
                label: t('members.leave.label'),
                body: t('members.leave.body', { name: organization.name }),
                run: () => api.organizations.removeMember(organization.id, me.id),
              })
            }
          >
            <LogOut className="h-3.5 w-3.5" /> {t('members.leave.title')}
          </Button>
        </div>
      )}
    </div>
  );
}

function TeamsTab({
  organization,
  isAdmin,
  setConfirm,
}: {
  organization: OrganizationDto;
  isAdmin: boolean;
  setConfirm: (c: Confirm) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const t = useT('team');
  const [name, setName] = useState('');
  const [adding, setAdding] = useState<Record<string, string>>({});
  const act = useAct(organization.id, setError);
  const teams = useQuery({
    queryKey: organizationTeamsKey(organization.id),
    queryFn: () => api.organizations.teams(organization.id),
  });
  const members = useQuery({
    queryKey: organizationMembersKey(organization.id),
    queryFn: () => api.organizations.members(organization.id),
    enabled: isAdmin,
  });

  if (!teams.data) return <Spinner className="mx-auto my-8 h-5 w-5 text-fg-subtle" />;

  return (
    <div className="flex flex-col gap-4">
      {error && <Alert tone="error">{error}</Alert>}
      <p className="text-[13px] text-fg-muted">{t('teams.intro')}</p>
      {isAdmin && (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              await api.organizations.createTeam(organization.id, name);
              setName('');
            });
          }}
        >
          <input
            aria-label={t('teams.nameLabel')}
            placeholder={t('teams.namePlaceholder')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={`${selectClass} w-64`}
          />
          <Button type="submit" size="sm" variant="secondary" disabled={!name.trim()}>
            <Plus className="h-3.5 w-3.5" /> {t('teams.create')}
          </Button>
        </form>
      )}
      {teams.data.length === 0 && (
        <p className="py-6 text-center text-[13px] text-fg-subtle">{t('teams.empty')}</p>
      )}
      {teams.data.map((team) => {
        const inTeam = new Set(team.members.map((m) => m.userId));
        const candidates = members.data?.members.filter((m) => !inTeam.has(m.userId)) ?? [];
        return (
          <section
            key={team.id}
            aria-label={t('teams.section', { name: team.name })}
            className="rounded-md border border-line"
          >
            <header className="flex items-center gap-2 border-b border-line px-3 py-2">
              <Users className="h-4 w-4 text-fg-subtle" aria-hidden="true" />
              <h3 className="flex-1 text-[13px] font-semibold">
                {team.name}{' '}
                <span className="font-normal text-fg-subtle">
                  {t('teams.count', { count: team.members.length })}
                </span>
              </h3>
              {isAdmin && (
                <button
                  type="button"
                  aria-label={t('teams.remove.aria', { name: team.name })}
                  onClick={() =>
                    setConfirm({
                      title: t('teams.remove.title'),
                      label: t('teams.remove.label'),
                      body: t('teams.remove.body', { name: team.name }),
                      run: () => api.teams.remove(team.id),
                    })
                  }
                  className="rounded p-1.5 text-fg-subtle hover:bg-danger/10 hover:text-danger"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </header>
            <div className="flex flex-wrap items-center gap-1.5 p-3">
              {team.members.length === 0 && (
                <span className="text-xs text-fg-subtle">{t('teams.noMembers')}</span>
              )}
              {team.members.map((m) => (
                <span
                  key={m.userId}
                  title={m.email}
                  className="flex items-center gap-1 rounded-full bg-muted py-0.5 ps-2.5 pe-1 text-xs"
                >
                  {m.displayName}
                  {isAdmin && (
                    <button
                      type="button"
                      aria-label={t('teams.removeMember', { name: m.displayName })}
                      onClick={() => void act(() => api.teams.removeMember(team.id, m.userId))}
                      className="rounded-full p-0.5 text-fg-subtle hover:bg-danger/10 hover:text-danger"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </span>
              ))}
              {isAdmin && candidates.length > 0 && (
                <select
                  aria-label={t('teams.addMember', { name: team.name })}
                  value={adding[team.id] ?? ''}
                  onChange={(e) => {
                    const userId = e.target.value;
                    setAdding((a) => ({ ...a, [team.id]: '' }));
                    if (userId) void act(() => api.teams.addMember(team.id, userId));
                  }}
                  className={`${selectClass} h-7 text-xs`}
                >
                  <option value="">{t('teams.addMemberOption')}</option>
                  {candidates.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.displayName}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function SecurityTab({ organization }: { organization: OrganizationDto }) {
  const t = useT('team');
  const queryClient = useQueryClient();
  const me = useSession((s) => s.user);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { data } = useQuery({
    queryKey: organizationMembersKey(organization.id),
    queryFn: () => api.organizations.members(organization.id),
  });
  // Sunucu yanıtına kadar seçilen değer gösterilir; hata olursa geri döner.
  const [pending, setPending] = useState<boolean | null>(null);
  const required = pending ?? organization.requireTwoFactor ?? false;
  const withoutTwoFactor = (data?.members ?? []).filter((m) => m.twoFactorEnabled === false);
  const total = data?.members.length ?? 0;
  const myTwoFactor = me?.twoFactorEnabled ?? false;

  async function toggle(next: boolean) {
    setBusy(true);
    setError(null);
    setPending(next);
    try {
      await api.organizations.setSecurity(organization.id, next);
      await queryClient.invalidateQueries({ queryKey: organizationsQueryKey });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(null);
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <Alert tone="error">{error}</Alert>}
      <section className="flex flex-col gap-3 rounded-lg border border-line p-4">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-1"
            checked={required}
            disabled={busy || (!myTwoFactor && !required)}
            onChange={(e) => void toggle(e.target.checked)}
          />
          <span>
            <span className="block text-sm font-medium">{t('security.require')}</span>
            <span className="block text-[13px] text-fg-muted">{t('security.requireHint')}</span>
          </span>
        </label>
        {!myTwoFactor && (
          <Alert tone="info">
            {t.rich('security.enableFirst', {
              link: (c) => (
                <Link to="/account?tab=security" className="font-medium text-accent hover:underline">
                  {c}
                </Link>
              ),
            })}
          </Alert>
        )}
        {data && (
          <p className="text-[13px] text-fg-muted">
            {withoutTwoFactor.length > 0
              ? t('security.summaryOff', {
                  enabled: total - withoutTwoFactor.length,
                  total,
                  names: withoutTwoFactor.map((m) => m.displayName).join(', '),
                })
              : t('security.summary', { enabled: total - withoutTwoFactor.length, total })}
          </p>
        )}
      </section>
      <p className="text-xs text-fg-subtle">{t('security.note')}</p>
    </div>
  );
}

function WorkspacesTab({ workspaces, onCreate }: { workspaces: WorkspaceDto[]; onCreate: () => void }) {
  const t = useT('team');
  const setCurrent = useUi((s) => s.setCurrentWorkspaceId);
  const navigate = useNavigate();
  const [settings, setSettings] = useState<WorkspaceDto | null>(null);
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Button size="sm" variant="secondary" onClick={onCreate}>
          <Plus className="h-3.5 w-3.5" /> {t('workspaces.create')}
        </Button>
      </div>
      {workspaces.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-fg-subtle">{t('workspaces.empty')}</p>
      ) : (
        <ul className="divide-y divide-line rounded-md border border-line">
          {workspaces.map((w) => (
            <li key={w.id} className="flex items-center gap-3 px-3 py-2 text-[13px]">
              <Users className="h-3.5 w-3.5 shrink-0 text-fg-subtle" aria-hidden="true" />
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-start font-medium hover:text-accent"
                title={t('workspaces.switchTo')}
                onClick={() => {
                  setCurrent(w.id);
                  navigate('/');
                }}
              >
                {w.name}
              </button>
              <span className="text-xs text-fg-subtle">{WORKSPACE_ROLE_LABELS[w.role]}</span>
              <button
                type="button"
                aria-label={t('workspaces.settings', { name: w.name })}
                onClick={() => setSettings(w)}
                className="rounded p-1.5 text-fg-subtle hover:bg-muted hover:text-fg"
              >
                <Settings className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {settings && <WorkspaceSettingsDialog workspace={settings} onClose={() => setSettings(null)} />}
    </div>
  );
}

function languageOf(organization: OrganizationDto): Language {
  return isLanguage(organization.defaultLanguage) ? organization.defaultLanguage : 'tr';
}

/** Organizasyon e-postalarının ve yeni üyelerin başlangıç dili (yalnızca yöneticiler). */
function OrganizationLanguage({ organization }: { organization: OrganizationDto }) {
  const t = useT('team');
  const [error, setError] = useState<string | null>(null);
  const act = useAct(organization.id, setError);
  return (
    <label className="flex items-center gap-1.5 text-xs text-fg-muted" title={t('org.languageHint')}>
      {t('org.language')}
      <select
        value={languageOf(organization)}
        onChange={(e) => {
          const next = e.target.value;
          if (isLanguage(next)) void act(() => api.organizations.setLanguage(organization.id, next));
        }}
        className={selectClass}
      >
        {LANGUAGES.map((l) => (
          <option key={l} value={l}>
            {LANGUAGE_NAMES[l]}
          </option>
        ))}
      </select>
      {error && <span className="text-danger">{error}</span>}
    </label>
  );
}

function OrganizationNameEditor({ organization }: { organization: OrganizationDto }) {
  const t = useT('team');
  const [name, setName] = useState(organization.name);
  const [error, setError] = useState<string | null>(null);
  const act = useAct(organization.id, setError);
  useEffect(() => setName(organization.name), [organization.name]);
  const changed = name.trim() && name.trim() !== organization.name;
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (changed) void act(() => api.organizations.rename(organization.id, name));
      }}
    >
      <input
        aria-label={t('org.name')}
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="h-9 min-w-0 rounded-md border border-transparent bg-transparent px-1.5 text-lg font-semibold hover:border-line focus:border-line focus:bg-surface"
      />
      {changed && (
        <Button type="submit" size="sm" variant="secondary">
          {t('org.save')}
        </Button>
      )}
      {error && <span className="text-xs text-danger">{error}</span>}
    </form>
  );
}

/** Organizasyonlar: üyeler ve davetler, takımlar, workspace'ler. */
export function TeamPage() {
  const t = useT('team');
  const { data: organizations, isLoading } = useOrganizations();
  const { workspaces } = useWorkspaces();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('members');
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creatingOrg, setCreatingOrg] = useState(false);
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);

  const teamOrgs = (organizations ?? []).filter((o) => !o.isPersonal);
  const selected = teamOrgs.find((o) => o.id === params.get('org')) ?? teamOrgs[0];
  const selectOrg = (id: string) => setParams({ org: id }, { replace: true });

  if (isLoading || !organizations) {
    return (
      <div className="flex flex-1 items-center justify-center text-fg-subtle">
        <Spinner className="h-5 w-5" />
      </div>
    );
  }

  if (!selected) {
    return (
      <div className="flex flex-1 items-start justify-center overflow-auto p-8">
        <div className="flex w-full max-w-lg flex-col gap-4 rounded-xl border border-line bg-surface p-6">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="-ms-1 flex w-fit items-center gap-1.5 rounded-md px-1 py-0.5 text-[13px] text-fg-muted hover:bg-muted hover:text-fg"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> {t('org.backToRequests')}
          </button>
          <Building2 className="h-8 w-8 text-accent" aria-hidden="true" />
          <h1 className="text-lg font-semibold">{t('org.empty.title')}</h1>
          <p className="text-[13px] text-fg-muted">
            {t.rich('org.empty.body', {
              lock: () => <Lock className="inline h-3 w-3" aria-hidden="true" />,
            })}
          </p>
          <CreateOrganization
            onCreated={selectOrg}
            onCancel={() => navigate('/')}
            cancelLabel={t('org.empty.back')}
          />
        </div>
      </div>
    );
  }

  const isAdmin = selected.role === 'Admin' || selected.role === 'Owner';
  const orgWorkspaces = workspaces.filter((w) => w.organizationId === selected.id);

  return (
    <div className="flex-1 overflow-auto">
      <div className="mx-auto flex max-w-4xl flex-col gap-5 p-6">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            aria-label={t('org.backToRequests')}
            title={t('org.backToRequests')}
            onClick={() => navigate('/')}
            className="rounded-md p-1.5 text-fg-subtle hover:bg-muted hover:text-fg"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <Building2 className="h-5 w-5 text-fg-subtle" aria-hidden="true" />
          {isAdmin ? (
            <OrganizationNameEditor key={selected.id} organization={selected} />
          ) : (
            <h1 className="text-lg font-semibold">{selected.name}</h1>
          )}
          <span className="rounded bg-muted px-2 py-0.5 text-xs text-fg-muted">
            {ORGANIZATION_ROLE_LABELS[selected.role]} · {t('people', { count: selected.memberCount })}
          </span>
          <div className="flex-1" />
          {isAdmin && <OrganizationLanguage key={selected.id} organization={selected} />}
          {teamOrgs.length > 1 && (
            <select
              aria-label={t('org.select')}
              value={selected.id}
              onChange={(e) => selectOrg(e.target.value)}
              className={selectClass}
            >
              {teamOrgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          )}
          <Button size="sm" variant="ghost" onClick={() => setCreatingOrg((c) => !c)}>
            <Plus className="h-3.5 w-3.5" /> {t('org.add')}
          </Button>
        </div>
        {creatingOrg && (
          <CreateOrganization
            compact
            onCancel={() => setCreatingOrg(false)}
            onCreated={(id) => {
              setCreatingOrg(false);
              selectOrg(id);
            }}
          />
        )}

        <div className="border-b border-line">
          <SegmentedTabs
            label={t('org.sections')}
            value={tab}
            onChange={setTab}
            tabs={[
              { id: 'members', label: t('tabs.members'), badge: selected.memberCount },
              { id: 'teams', label: t('tabs.teams') },
              { id: 'workspaces', label: t('tabs.workspaces'), badge: orgWorkspaces.length },
              ...(isAdmin
                ? [
                    { id: 'security' as const, label: t('tabs.security') },
                    { id: 'sso' as const, label: t('tabs.sso') },
                    { id: 'audit' as const, label: t('tabs.audit') },
                  ]
                : []),
            ]}
          />
        </div>

        {tab === 'members' && (
          <MembersTab
            key={selected.id}
            organization={selected}
            workspaces={orgWorkspaces}
            isAdmin={isAdmin}
            setConfirm={setConfirm}
          />
        )}
        {tab === 'teams' && (
          <TeamsTab key={selected.id} organization={selected} isAdmin={isAdmin} setConfirm={setConfirm} />
        )}
        {tab === 'workspaces' && (
          <WorkspacesTab workspaces={orgWorkspaces} onCreate={() => setCreatingWorkspace(true)} />
        )}
        {tab === 'security' && isAdmin && <SecurityTab key={selected.id} organization={selected} />}
        {tab === 'sso' && isAdmin && <SsoTab key={selected.id} organization={selected} />}
        {tab === 'audit' && isAdmin && <AuditTab key={selected.id} organization={selected} />}
        {notice && (
          <Alert tone="success" className="fixed end-6 bottom-6 z-40 shadow-lg">
            {notice}
          </Alert>
        )}
      </div>

      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          confirmLabel={confirm.label}
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            await confirm.run();
            if (confirm.done) {
              setNotice(confirm.done);
              setTimeout(() => setNotice(null), 4000);
            }
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: ['organizations'] }),
              queryClient.invalidateQueries({ queryKey: workspacesQueryKey }),
              queryClient.invalidateQueries({ queryKey: myInvitationsQueryKey }),
            ]);
          }}
        >
          {confirm.body}
        </ConfirmDialog>
      )}
      {creatingWorkspace && (
        <CreateWorkspaceDialog organizationId={selected.id} onClose={() => setCreatingWorkspace(false)} />
      )}
    </div>
  );
}
