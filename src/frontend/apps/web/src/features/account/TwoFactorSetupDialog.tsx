import { useMemo, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import qrcode from 'qrcode-generator';
import { Alert, Button, Input, Spinner } from '@apivator/ui';
import { Dialog } from '../../components/ui/Dialog';
import { CopyButton } from '../../components/ui/CopyButton';
import { useT } from '../../i18n';
import { api } from '../../lib/api';
import { errorMessage, fieldError } from '../../lib/errors';
import { RecoveryCodes } from './RecoveryCodes';

/** otpauth adresinin QR kodu (SVG; dış servis yok). */
function QrCode({ value }: { value: string }) {
  const t = useT('account');
  const path = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(value);
    qr.make();
    const count = qr.getModuleCount();
    const parts: string[] = [];
    for (let row = 0; row < count; row++)
      for (let col = 0; col < count; col++)
        if (qr.isDark(row, col)) parts.push(`M${col + 4},${row + 4}h1v1h-1z`);
    return { d: parts.join(''), size: count + 8 };
  }, [value]);
  return (
    <svg
      role="img"
      aria-label={t('twoFactor.setupDialog.qr')}
      viewBox={`0 0 ${path.size} ${path.size}`}
      className="h-44 w-44 shrink-0 rounded-md bg-white"
      shapeRendering="crispEdges"
    >
      <path d={path.d} fill="#000" />
    </svg>
  );
}

/**
 * İki adımlı doğrulama kurulumu: QR kodu (ya da anahtar) authenticator uygulamasına eklenir, üretilen kod
 * doğrulanınca açılır ve yedek kodlar bir kez gösterilir.
 */
export function TwoFactorSetupDialog({
  email,
  onClose,
  onEnabled,
}: {
  email: string;
  onClose: () => void;
  onEnabled: () => void;
}) {
  const t = useT('account');
  // React Query aynı anda gelen iki isteği (StrictMode) teke indirir.
  const { data: setup, error: setupError } = useQuery({
    queryKey: ['two-factor-setup'],
    queryFn: api.account.twoFactor.setup,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  });
  const loadError = setupError ? errorMessage(setupError) : null;
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api.account.twoFactor.enable(code);
      setCodes(result.codes);
      onEnabled();
    } catch (e) {
      setError(e);
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  if (codes) {
    return (
      <Dialog
        title={t('twoFactor.setupDialog.codesTitle')}
        size="lg"
        onClose={() => saved && onClose()}
        footer={
          <Button onClick={onClose} disabled={!saved}>
            {t('twoFactor.setupDialog.ok')}
          </Button>
        }
      >
        <div className="flex flex-col gap-3">
          <Alert tone="success">{t('twoFactor.setupDialog.enabled')}</Alert>
          <p className="text-[13px] text-fg-muted">
            {t.rich('twoFactor.setupDialog.codesBody', {
              b: (c) => <strong className="text-fg">{c}</strong>,
            })}
          </p>
          <RecoveryCodes codes={codes} email={email} />
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
            {t('twoFactor.setupDialog.savedCheck')}
          </label>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog title={t('twoFactor.setupDialog.title')} size="lg" onClose={onClose}>
      {loadError ? (
        <Alert tone="error">{loadError}</Alert>
      ) : !setup ? (
        <div className="flex justify-center py-10">
          <Spinner className="h-5 w-5 text-accent" />
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <ol className="flex list-decimal flex-col gap-1 ps-5 text-[13px] text-fg-muted">
            <li>{t('twoFactor.setupDialog.step1')}</li>
            <li>{t('twoFactor.setupDialog.step2')}</li>
            <li>{t('twoFactor.setupDialog.step3')}</li>
          </ol>
          <div className="flex flex-wrap items-center gap-5">
            <QrCode value={setup.otpAuthUri} />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="text-xs font-medium text-fg-muted">{t('twoFactor.setupDialog.keyHint')}</span>
              <div className="flex items-center gap-1.5">
                <code
                  className="rounded bg-muted px-2 py-1 font-mono text-[13px] break-all"
                  aria-label={t('twoFactor.setupDialog.key')}
                >
                  {setup.secret.match(/.{1,4}/g)!.join(' ')}
                </code>
                <CopyButton text={setup.secret} label={t('twoFactor.setupDialog.copyKey')} compact />
              </div>
              <span className="text-xs text-fg-subtle">{t('twoFactor.setupDialog.meta', { email })}</span>
            </div>
          </div>
          {Boolean(error) && !fieldError(error, 'code') && <Alert tone="error">{errorMessage(error)}</Alert>}
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <Input
                label={t('twoFactor.codeLabel')}
                autoFocus
                autoComplete="one-time-code"
                inputMode="numeric"
                placeholder="123456"
                maxLength={7}
                className="font-mono tracking-widest"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                error={fieldError(error, 'code')}
              />
            </div>
            <Button type="submit" loading={busy} disabled={code.replace(/\D/g, '').length !== 6}>
              {t('twoFactor.setupDialog.submit')}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
