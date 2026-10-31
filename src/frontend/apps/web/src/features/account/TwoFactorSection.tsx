import { lazy, Suspense, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, ShieldOff } from 'lucide-react';
import { Alert, Button, Input, Spinner } from '@apivator/ui';
import { Dialog } from '../../components/ui/Dialog';
import { formatDate, useT } from '../../i18n';
import { api } from '../../lib/api';
import { errorMessage, fieldError } from '../../lib/errors';
import { useSession } from '../../stores/session';
import { fullTime } from '../activity/activity';
import { RecoveryCodes } from './RecoveryCodes';
import { securityEventsQueryKey, twoFactorQueryKey } from './preferences';

const TwoFactorSetupDialog = lazy(() =>
  import('./TwoFactorSetupDialog').then((m) => ({ default: m.TwoFactorSetupDialog })),
);

/** Oturumdaki kullanıcıyı (2FA durumu) ve 2FA'ya bağlı listeleri (organizasyon workspace'leri) tazeler. */
async function refreshAfterChange(queryClient: ReturnType<typeof useQueryClient>) {
  try {
    useSession.getState().setUser(await api.me());
  } catch {
    // ekrandaki durum zaten güncellendi
  }
  // Kurulum anahtarı yeniden istenmez (açıldıktan sonra sunucu reddeder).
  await queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'two-factor-setup' });
}

function DisableDialog({ onClose }: { onClose: () => void }) {
  const t = useT('account');
  const queryClient = useQueryClient();
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.account.twoFactor.disable(password, code);
      await refreshAfterChange(queryClient);
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const generic =
    error && !fieldError(error, 'password') && !fieldError(error, 'code') ? errorMessage(error) : null;
  return (
    <Dialog title={t('twoFactor.disable.title')} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <p className="text-[13px] text-fg-muted">{t('twoFactor.disable.body')}</p>
        {generic && <Alert tone="error">{generic}</Alert>}
        <Input
          label={t('twoFactor.disable.password')}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={fieldError(error, 'password')}
        />
        <Input
          label={t('twoFactor.disable.code')}
          autoComplete="one-time-code"
          placeholder={t('twoFactor.disable.placeholder')}
          className="font-mono"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          error={fieldError(error, 'code')}
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button type="submit" variant="danger" loading={busy} disabled={!password || !code}>
            {t('twoFactor.disable.submit')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function RegenerateDialog({ email, onClose }: { email: string; onClose: () => void }) {
  const t = useT('account');
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [codes, setCodes] = useState<string[] | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setCodes((await api.account.twoFactor.regenerateRecoveryCodes(code)).codes);
      await queryClient.invalidateQueries({ queryKey: twoFactorQueryKey });
      await queryClient.invalidateQueries({ queryKey: securityEventsQueryKey });
    } catch (e) {
      setError(e);
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title={t('twoFactor.regenerate.title')} size="lg" onClose={onClose}>
      {codes ? (
        <div className="flex flex-col gap-3">
          <Alert tone="success">{t('twoFactor.regenerate.done')}</Alert>
          <RecoveryCodes codes={codes} email={email} />
          <div className="flex justify-end">
            <Button onClick={onClose}>{t('twoFactor.regenerate.ok')}</Button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <p className="text-[13px] text-fg-muted">{t('twoFactor.regenerate.body')}</p>
          {Boolean(error) && !fieldError(error, 'code') && <Alert tone="error">{errorMessage(error)}</Alert>}
          <Input
            label={t('twoFactor.codeLabel')}
            autoComplete="one-time-code"
            inputMode="numeric"
            placeholder="123456"
            className="font-mono tracking-widest"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            error={fieldError(error, 'code')}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              {t('cancel')}
            </Button>
            <Button type="submit" loading={busy} disabled={code.replace(/\D/g, '').length !== 6}>
              {t('twoFactor.regenerate.submit')}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

/** İki adımlı doğrulama: durum, kurulum, yedek kodlar ve kapatma. */
export function TwoFactorSection() {
  const t = useT('account');
  const queryClient = useQueryClient();
  const email = useSession((s) => s.user?.email ?? '');
  const {
    data: status,
    isLoading,
    error,
  } = useQuery({
    queryKey: twoFactorQueryKey,
    queryFn: api.account.twoFactor.status,
  });
  const [dialog, setDialog] = useState<'setup' | 'disable' | 'regenerate' | null>(null);

  if (isLoading) return <Spinner className="mx-auto h-4 w-4 text-fg-subtle" />;
  if (error || !status) return <Alert tone="error">{errorMessage(error)}</Alert>;

  const required = status.requiredBy.length > 0;
  return (
    <div className="flex flex-col gap-3">
      {status.enabled ? (
        <div className="flex flex-wrap items-center gap-3">
          <ShieldCheck className="h-5 w-5 text-success" aria-hidden="true" />
          <div className="min-w-0 flex-1 text-[13px]">
            <p className="font-medium">{t('twoFactor.on')}</p>
            <p className="text-xs text-fg-muted">
              {status.enabledAt && (
                <span title={fullTime(status.enabledAt)}>
                  {t('twoFactor.since', { date: formatDate(status.enabledAt) })} ·{' '}
                </span>
              )}
              {t('twoFactor.codesLeft', { count: status.recoveryCodesLeft })}
            </p>
          </div>
          <Button size="sm" variant="secondary" onClick={() => setDialog('regenerate')}>
            {t('twoFactor.regenerate.title')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setDialog('disable')}
            disabled={required}
            title={required ? t('twoFactor.requiredBy', { names: status.requiredBy.join(', ') }) : undefined}
          >
            {t('twoFactor.off')}
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <ShieldOff className="h-5 w-5 text-fg-subtle" aria-hidden="true" />
          <p className="min-w-0 flex-1 text-[13px] text-fg-muted">{t('twoFactor.offBody')}</p>
          <Button size="sm" onClick={() => setDialog('setup')}>
            {t('twoFactor.setup')}
          </Button>
        </div>
      )}
      {status.enabled && status.recoveryCodesLeft <= 3 && (
        <Alert tone="warning">{t('twoFactor.lowCodes')}</Alert>
      )}
      {required && (
        <p className={status.enabled ? 'text-xs text-fg-subtle' : 'text-xs text-warning'}>
          {t(status.enabled ? 'twoFactor.requiredEnabled' : 'twoFactor.requiredDisabled', {
            names: status.requiredBy.join(', '),
          })}
        </p>
      )}
      {dialog === 'setup' && (
        <Suspense fallback={null}>
          <TwoFactorSetupDialog
            email={email}
            onClose={() => setDialog(null)}
            onEnabled={() => void refreshAfterChange(queryClient)}
          />
        </Suspense>
      )}
      {dialog === 'disable' && <DisableDialog onClose={() => setDialog(null)} />}
      {dialog === 'regenerate' && <RegenerateDialog email={email} onClose={() => setDialog(null)} />}
    </div>
  );
}
