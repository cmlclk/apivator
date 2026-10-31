import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, Button } from '@apivator/ui';
import { AuthLayout } from '../../components/AuthLayout';
import { useT } from '../../i18n';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { useSession } from '../../stores/session';

/**
 * Hesap silme onayı (e-postadaki bağlantı). Silme bağlantıyı açınca değil düğmeyle yapılır: e-posta
 * güvenlik tarayıcıları bağlantıları önceden açabilir.
 */
export function DeleteAccountPage() {
  const t = useT('auth');
  const [params] = useSearchParams();
  const queryClient = useQueryClient();
  const userId = params.get('userId');
  const token = params.get('token');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function confirm() {
    if (!userId || !token) return;
    setBusy(true);
    setError(null);
    try {
      await api.account.confirmDeletion(userId, token);
      setDone(true);
      // Bu cihazdaki oturum da kapanır (masaüstünde anahtar zincirindeki token silinir).
      const { user, setSession } = useSession.getState();
      if (user?.id === userId) {
        await api.auth.logout().catch(() => undefined);
        setSession(null);
        queryClient.clear();
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title={t('deleteAccount.title')}>
      {!userId || !token ? (
        <Alert tone="error">{t('deleteAccount.invalid')}</Alert>
      ) : done ? (
        <div className="flex flex-col gap-4">
          <Alert tone="success">{t('deleteAccount.done')}</Alert>
          <Link to="/register" className="text-sm font-medium text-accent hover:underline">
            {t('deleteAccount.newAccount')}
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-4 text-sm">
          <p className="text-fg-muted">{t('deleteAccount.warning')}</p>
          {error && <Alert tone="error">{error}</Alert>}
          <Button variant="danger" loading={busy} onClick={() => void confirm()}>
            {t('deleteAccount.submit')}
          </Button>
          <Link to="/" className="text-center text-sm text-fg-muted hover:underline">
            {t('deleteAccount.cancel')}
          </Link>
        </div>
      )}
    </AuthLayout>
  );
}
