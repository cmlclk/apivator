import { useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Building2, Camera, CheckCircle2, Lock, Mail, Trash2 } from 'lucide-react';
import { Alert, Button, Input, Spinner } from '@apivator/ui';
import type { ProfileDto } from '@apivator/core';
import { Avatar } from '../../components/Avatar';
import { formatDate, useT } from '../../i18n';
import { api } from '../../lib/api';
import { errorMessage, fieldError } from '../../lib/errors';
import { ORGANIZATION_ROLE_LABELS, WORKSPACE_ROLE_LABELS } from '../../lib/teams';
import { useSession } from '../../stores/session';
import { prepareAvatar } from './avatar';
import { profileQueryKey, useProfile } from './preferences';
import { isLocalMode } from '../../lib/localMode';

/** Profil değişince üst çubuktaki kullanıcı bilgisi de güncellenir. */
function useSyncUser() {
  const queryClient = useQueryClient();
  return (profile: Partial<ProfileDto>) => {
    const { user, setUser } = useSession.getState();
    if (user) {
      setUser({
        ...user,
        ...(profile.displayName !== undefined && { displayName: profile.displayName }),
        ...(profile.email !== undefined && { email: profile.email }),
        ...(profile.avatarVersion !== undefined && { avatarVersion: profile.avatarVersion }),
      });
    }
    const current = queryClient.getQueryData<ProfileDto>(profileQueryKey);
    if (current) queryClient.setQueryData(profileQueryKey, { ...current, ...profile });
  };
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function AvatarEditor({ profile }: { profile: ProfileDto }) {
  const t = useT('account');
  const sync = useSyncUser();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const image = await prepareAvatar(file);
      const { avatarVersion } = await api.account.setAvatar(image);
      sync({ avatarVersion });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await api.account.removeAvatar();
      sync({ avatarVersion: null });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-4">
      <Avatar
        userId={profile.id}
        name={profile.displayName}
        version={profile.avatarVersion}
        className="h-16 w-16 text-xl"
      />
      <div className="flex flex-col gap-1.5">
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" loading={busy} onClick={() => input.current?.click()}>
            <Camera className="h-3.5 w-3.5" />{' '}
            {profile.avatarVersion ? t('profile.avatar.change') : t('profile.avatar.upload')}
          </Button>
          {profile.avatarVersion && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void remove()}>
              <Trash2 className="h-3.5 w-3.5" /> {t('profile.avatar.remove')}
            </Button>
          )}
        </div>
        <p className="text-xs text-fg-subtle">{t('profile.avatar.hint')}</p>
        {error && <p className="text-xs text-danger">{error}</p>}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        aria-label={t('profile.avatar.choose')}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
      />
    </div>
  );
}

function NameForm({ profile }: { profile: ProfileDto }) {
  const t = useT('account');
  const sync = useSyncUser();
  const [name, setName] = useState(profile.displayName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const updated = await api.account.updateProfile(name);
      sync({ displayName: updated.displayName });
      setName(updated.displayName);
      setSaved(true);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const unchanged = name.trim() === profile.displayName;
  return (
    <form onSubmit={submit} className="flex items-end gap-2">
      <div className="min-w-0 flex-1">
        <Input
          label={t('profile.name')}
          value={name}
          maxLength={80}
          autoComplete="name"
          onChange={(e) => {
            setName(e.target.value);
            setSaved(false);
          }}
          error={error ? (fieldError(error, 'displayName') ?? errorMessage(error)) : undefined}
          hint={saved ? t('profile.saved') : undefined}
        />
      </div>
      <Button type="submit" loading={busy} disabled={unchanged || !name.trim()}>
        {t('profile.save')}
      </Button>
    </form>
  );
}

function EmailEditor({ profile }: { profile: ProfileDto }) {
  const t = useT('account');
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.account.changeEmail(email.trim(), password);
      setOpen(false);
      setEmail('');
      setPassword('');
      await queryClient.invalidateQueries({ queryKey: profileQueryKey });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    setError(null);
    try {
      await api.account.cancelEmailChange();
      await queryClient.invalidateQueries({ queryKey: profileQueryKey });
    } catch (e) {
      setError(e);
    }
  }

  const generic =
    error && !fieldError(error, 'newEmail') && !fieldError(error, 'password') ? errorMessage(error) : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <Mail className="h-4 w-4 text-fg-subtle" aria-hidden="true" />
        <span className="font-medium">{profile.email}</span>
        {profile.emailConfirmed ? (
          <span className="flex items-center gap-1 text-xs text-success">
            <CheckCircle2 className="h-3.5 w-3.5" /> {t('profile.email.confirmed')}
          </span>
        ) : (
          <span className="text-xs text-warning">{t('profile.email.unconfirmed')}</span>
        )}
        <div className="flex-1" />
        {!open && (
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
            {t('profile.email.change')}
          </Button>
        )}
      </div>

      {profile.pendingEmail && (
        <Alert tone="info">
          <span className="flex flex-wrap items-center gap-2">
            <span>
              {t.rich(
                'profile.email.pending',
                { b: (c) => <strong>{c}</strong> },
                { email: profile.pendingEmail },
              )}
            </span>
            <button
              type="button"
              onClick={() => void cancel()}
              className="text-xs font-medium text-accent hover:underline"
            >
              {t('profile.email.cancelChange')}
            </button>
          </span>
        </Alert>
      )}
      {generic && <Alert tone="error">{generic}</Alert>}

      {open && (
        <form
          onSubmit={submit}
          className="flex flex-col gap-3 rounded-md border border-line p-3"
          aria-label={t('profile.email.formLabel')}
        >
          <Input
            label={t('profile.email.newEmail')}
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={fieldError(error, 'newEmail')}
            autoFocus
          />
          <Input
            label={t('profile.email.password')}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={fieldError(error, 'password')}
            hint={t('profile.email.passwordHint')}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t('cancel')}
            </Button>
            <Button type="submit" loading={busy} disabled={!email.trim() || !password}>
              {t('profile.email.submit')}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

function Memberships({ profile }: { profile: ProfileDto }) {
  const t = useT('account');
  return (
    <ul className="flex flex-col gap-3">
      {profile.organizations.map((org) => (
        <li key={org.id} className="rounded-md border border-line">
          <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-[13px]">
            {org.isPersonal ? (
              <Lock className="h-4 w-4 text-fg-subtle" aria-hidden="true" />
            ) : (
              <Building2 className="h-4 w-4 text-fg-subtle" aria-hidden="true" />
            )}
            {org.isPersonal ? (
              <span className="font-medium">{t('profile.personal')}</span>
            ) : (
              <Link to={`/team?org=${org.id}`} className="font-medium hover:underline">
                {org.name}
              </Link>
            )}
            <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-fg-muted">
              {ORGANIZATION_ROLE_LABELS[org.role]}
            </span>
            {!org.isPersonal && (
              <span className="text-xs text-fg-subtle">{t('people', { count: org.memberCount })}</span>
            )}
          </div>
          {org.workspaces.length > 0 ? (
            <ul className="divide-y divide-line">
              {org.workspaces.map((w) => (
                <li key={w.id} className="flex items-center gap-2 px-3 py-1.5 text-[13px]">
                  <span className="min-w-0 flex-1 truncate">{w.name}</span>
                  <span className="text-xs text-fg-subtle">{WORKSPACE_ROLE_LABELS[w.role]}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-3 py-2 text-xs text-fg-subtle">{t('profile.noWorkspaces')}</p>
          )}
        </li>
      ))}
    </ul>
  );
}

export function ProfileTab() {
  const t = useT('account');
  const { data: profile, isLoading, error } = useProfile();

  if (isLoading) return <Spinner className="mx-auto h-5 w-5 text-fg-subtle" />;
  if (!profile) return <Alert tone="error">{errorMessage(error)}</Alert>;

  return (
    <div className="flex flex-col gap-4">
      <Section title={t('profile.title')}>
        <AvatarEditor profile={profile} />
        <NameForm profile={profile} />
        <p className="text-xs text-fg-subtle">
          {t('profile.memberSince', { date: formatDate(profile.createdAt, { dateStyle: 'long' }) })}
        </p>
      </Section>
      {/* Kişisel kullanımda hesap e-postası ve ekip üyelikleri yok. */}
      {!isLocalMode() && (
        <>
          <Section title={t('profile.emailTitle')}>
            <EmailEditor profile={profile} />
          </Section>
          <Section title={t('profile.membershipsTitle')}>
            <Memberships profile={profile} />
          </Section>
        </>
      )}
    </div>
  );
}
