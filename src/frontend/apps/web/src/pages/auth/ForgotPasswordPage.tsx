import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Alert, Button, Input } from '@apivator/ui';
import { AuthLayout } from '../../components/AuthLayout';
import { useT } from '../../i18n';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';

export function ForgotPasswordPage() {
  const t = useT('auth');
  // Hesap güvenliği e-postalarındaki "Şifremi sıfırla" bağlantısı adresi hazır getirir.
  const [params] = useSearchParams();
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.auth.forgotPassword(email);
      setSent(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout title={t('forgot.title')} subtitle={t('forgot.subtitle')}>
      {sent ? (
        <div className="flex flex-col gap-4">
          <Alert tone="success">{t('forgot.sent')}</Alert>
          <Link to="/login" className="text-sm font-medium text-accent hover:underline">
            {t('backToLogin')}
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          {error && <Alert tone="error">{error}</Alert>}
          <Input
            label={t('fields.email')}
            type="email"
            autoComplete="email"
            autoFocus
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Button type="submit" loading={submitting} disabled={!email}>
            {t('forgot.submit')}
          </Button>
          <Link to="/login" className="text-center text-sm text-fg-muted hover:text-accent">
            {t('backToLogin')}
          </Link>
        </form>
      )}
    </AuthLayout>
  );
}
