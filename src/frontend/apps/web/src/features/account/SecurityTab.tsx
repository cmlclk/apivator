import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Globe, LogOut, Monitor, Terminal } from 'lucide-react';
import { Alert, Button, Input, Spinner } from '@apivator/ui';
import type { SessionDto } from '@apivator/core';
import { useT } from '../../i18n';
import { api } from '../../lib/api';
import { errorMessage, fieldError } from '../../lib/errors';
import { fullTime, timeAgo } from '../activity/activity';
import { sessionsQueryKey } from './preferences';
import { SecurityHistory } from './SecurityHistory';
import { TwoFactorSection } from './TwoFactorSection';

function PasswordForm() {
  const t = useT('account');
  const queryClient = useQueryClient();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);

  const mismatch = repeat.length > 0 && next !== repeat;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (mismatch) return;
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      await api.account.changePassword({ currentPassword: current, newPassword: next });
      setCurrent('');
      setNext('');
      setRepeat('');
      setDone(true);
      await queryClient.invalidateQueries({ queryKey: sessionsQueryKey });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const generic =
    error && !fieldError(error, 'currentPassword') && !fieldError(error, 'newPassword')
      ? errorMessage(error)
      : null;

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" aria-label={t('security.password.formLabel')}>
      {done && <Alert tone="success">{t('security.password.done')}</Alert>}
      {generic && <Alert tone="error">{generic}</Alert>}
      <Input
        label={t('security.password.current')}
        type="password"
        autoComplete="current-password"
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
        error={fieldError(error, 'currentPassword')}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label={t('security.password.new')}
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          error={fieldError(error, 'newPassword')}
          hint={t('security.passwordHint')}
        />
        <Input
          label={t('security.password.repeat')}
          type="password"
          autoComplete="new-password"
          value={repeat}
          onChange={(e) => setRepeat(e.target.value)}
          error={mismatch ? t('security.password.mismatch') : undefined}
        />
      </div>
      <div className="flex justify-end">
        <Button type="submit" loading={busy} disabled={!current || !next || !repeat || mismatch}>
          {t('security.password.submit')}
        </Button>
      </div>
    </form>
  );
}

const appIcons = { web: Globe, desktop: Monitor, cli: Terminal };

function SessionRow({ session, onRevoke }: { session: SessionDto; onRevoke: () => Promise<void> }) {
  const t = useT('account');
  const [busy, setBusy] = useState(false);
  const Icon = appIcons[session.app] ?? Globe;
  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <Icon className="h-5 w-5 shrink-0 text-fg-subtle" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-[13px] font-medium">
          <span className="truncate">{session.device}</span>
          {session.current && (
            <span className="rounded bg-success/15 px-1.5 py-0.5 text-[11px] font-semibold text-success">
              {t('security.sessions.thisDevice')}
            </span>
          )}
        </span>
        <span className="block truncate text-xs text-fg-subtle">
          {session.ipAddress ? `${session.ipAddress} · ` : ''}
          <span title={fullTime(session.lastUsedAt)}>
            {session.current
              ? t('security.sessions.active')
              : t('security.sessions.lastUsed', { time: timeAgo(session.lastUsedAt) })}
          </span>
          {' · '}
          <span title={fullTime(session.startedAt)}>
            {t('security.sessions.signedIn', { time: timeAgo(session.startedAt) })}
          </span>
        </span>
      </span>
      {!session.current && (
        <Button
          size="sm"
          variant="ghost"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onRevoke();
            } finally {
              setBusy(false);
            }
          }}
        >
          <LogOut className="h-3.5 w-3.5" /> {t('security.sessions.revoke')}
        </Button>
      )}
    </li>
  );
}

function Sessions() {
  const t = useT('account');
  const queryClient = useQueryClient();
  const { data: sessions, isLoading } = useQuery({
    queryKey: sessionsQueryKey,
    queryFn: api.account.sessions,
  });
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>, done?: string) {
    setError(null);
    setMessage(null);
    try {
      await action();
      if (done) setMessage(done);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      await queryClient.invalidateQueries({ queryKey: sessionsQueryKey });
    }
  }

  const others = (sessions ?? []).filter((s) => !s.current).length;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] text-fg-muted">{t('security.sessions.intro')}</p>
      {error && <Alert tone="error">{error}</Alert>}
      {message && <Alert tone="success">{message}</Alert>}
      {isLoading ? (
        <Spinner className="mx-auto h-4 w-4 text-fg-subtle" />
      ) : (
        <ul
          className="divide-y divide-line rounded-md border border-line"
          aria-label={t('security.sessions.list')}
        >
          {(sessions ?? []).map((s) => (
            <SessionRow key={s.id} session={s} onRevoke={() => run(() => api.account.revokeSession(s.id))} />
          ))}
        </ul>
      )}
      {others > 0 && (
        <div className="flex justify-end">
          <Button
            variant="secondary"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              await run(async () => {
                const { revoked } = await api.account.revokeOtherSessions();
                return revoked;
              }, t('security.sessions.revokedOthers'));
              setBusy(false);
            }}
          >
            <LogOut className="h-3.5 w-3.5" /> {t('security.sessions.revokeOthers', { count: others })}
          </Button>
        </div>
      )}
    </div>
  );
}

export function SecurityTab() {
  const t = useT('account');
  return (
    <div className="flex flex-col gap-4">
      <section
        aria-label={t('security.password.title')}
        className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4"
      >
        <h2 className="text-sm font-semibold">{t('security.password.title')}</h2>
        <PasswordForm />
      </section>
      <section
        aria-label={t('security.twoFactorTitle')}
        className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4"
      >
        <h2 className="text-sm font-semibold">{t('security.twoFactorTitle')}</h2>
        <TwoFactorSection />
      </section>
      <section
        aria-label={t('security.sessions.title')}
        className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4"
      >
        <h2 className="text-sm font-semibold">{t('security.sessions.title')}</h2>
        <Sessions />
      </section>
      <section
        aria-label={t('security.historyTitle')}
        className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4"
      >
        <h2 className="text-sm font-semibold">{t('security.historyTitle')}</h2>
        <SecurityHistory />
      </section>
    </div>
  );
}
