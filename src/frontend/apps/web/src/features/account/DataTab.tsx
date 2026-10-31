import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Download, MailCheck, Trash2 } from 'lucide-react';
import { Alert, Button, Input, Spinner } from '@apivator/ui';
import { toUpper, useT } from '../../i18n';
import { api } from '../../lib/api';
import { saveFile } from '../../lib/download';
import { errorMessage, fieldError } from '../../lib/errors';

function ExportSection() {
  const t = useT('account');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setBusy(true);
    setError(null);
    try {
      await saveFile(await api.account.exportData());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-label={t('data.export.title')}
      className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4"
    >
      <h2 className="text-sm font-semibold">{t('data.export.title')}</h2>
      <p className="text-[13px] text-fg-muted">{t('data.export.body')}</p>
      {error && <Alert tone="error">{error}</Alert>}
      <div>
        <Button variant="secondary" loading={busy} onClick={() => void download()}>
          <Download className="h-3.5 w-3.5" /> {t('data.export.button')}
        </Button>
      </div>
    </section>
  );
}

function DeleteSection() {
  const t = useT('account');
  const { data: check, isLoading } = useQuery({
    queryKey: ['account', 'deletion'],
    queryFn: api.account.deletionCheck,
  });
  const [password, setPassword] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [sent, setSent] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.account.requestDeletion(password);
      setSent(true);
      setPassword('');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const confirmWord = t('data.delete.confirmWord');
  const blocked = (check?.mustTransfer.length ?? 0) > 0;

  return (
    <section
      aria-label={t('data.delete.title')}
      className="flex flex-col gap-3 rounded-lg border border-danger/40 bg-surface p-4"
    >
      <h2 className="text-sm font-semibold text-danger">{t('data.delete.title')}</h2>
      <p className="text-[13px] text-fg-muted">{t('data.delete.body')}</p>

      {isLoading ? (
        <Spinner className="h-4 w-4 text-fg-subtle" />
      ) : (
        <>
          {blocked && (
            <Alert tone="warning">
              {t.rich('data.delete.mustTransfer', {
                orgs: () =>
                  check!.mustTransfer.map((o, i) => (
                    <span key={o.id}>
                      {i > 0 && ', '}
                      <Link to={`/team?org=${o.id}`} className="font-medium text-accent hover:underline">
                        {o.name}
                      </Link>
                    </span>
                  )),
              })}
            </Alert>
          )}
          {(check?.willDelete.length ?? 0) > 0 && (
            <Alert tone="info">
              {t('data.delete.willDelete', {
                organizations: check!.willDelete.map((o) => o.name).join(', '),
              })}
            </Alert>
          )}
        </>
      )}

      {sent ? (
        <Alert tone="success">
          <span className="flex items-start gap-2">
            <MailCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {t('data.delete.sent')}
          </span>
        </Alert>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-3">
          {error && !fieldError(error, 'password') ? <Alert tone="error">{errorMessage(error)}</Alert> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label={t('data.delete.password')}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={fieldError(error, 'password')}
              disabled={blocked}
            />
            <Input
              label={t('data.delete.confirmLabel', { word: confirmWord })}
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              disabled={blocked}
              autoComplete="off"
            />
          </div>
          <div>
            <Button
              type="submit"
              variant="danger"
              loading={busy}
              disabled={blocked || !password || toUpper(confirmText.trim()) !== toUpper(confirmWord)}
            >
              <Trash2 className="h-3.5 w-3.5" /> {t('data.delete.submit')}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

export function DataTab() {
  return (
    <div className="flex flex-col gap-4">
      <ExportSection />
      <DeleteSection />
    </div>
  );
}
