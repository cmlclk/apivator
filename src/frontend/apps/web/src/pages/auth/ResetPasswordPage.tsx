import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Alert, Button, Input } from '@apivator/ui';
import { ApiError } from '@apivator/core';
import { AuthLayout } from '../../components/AuthLayout';
import { useT } from '../../i18n';
import { api } from '../../lib/api';
import { errorMessage, fieldError } from '../../lib/errors';

export function ResetPasswordPage() {
  const t = useT('auth');
  const [params] = useSearchParams();
  const email = params.get('email') ?? '';
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.auth.resetPassword({ email, token, newPassword: password });
      setDone(true);
    } catch (e) {
      setError(e);
    } finally {
      setSubmitting(false);
    }
  }

  if (!email || !token) {
    return (
      <AuthLayout title={t('reset.invalidTitle')}>
        <Alert tone="error">{t('reset.invalid')}</Alert>
        <Link
          to="/forgot-password"
          className="mt-4 inline-block text-sm font-medium text-accent hover:underline"
        >
          {t('requestNewLink')}
        </Link>
      </AuthLayout>
    );
  }

  const passwordError = fieldError(error, 'password');

  return (
    <AuthLayout title={t('reset.title')} subtitle={email}>
      {done ? (
        <div className="flex flex-col gap-4">
          <Alert tone="success">{t('reset.done')}</Alert>
          <Link to="/login" className="text-sm font-medium text-accent hover:underline">
            {t('reset.doneLogin')}
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          {error !== null && !passwordError && (
            <Alert tone="error">
              {errorMessage(error)}
              {error instanceof ApiError && error.code === 'auth.invalid_token' && (
                <>
                  {' '}
                  <Link to="/forgot-password" className="font-medium underline">
                    {t('requestNewLink')}
                  </Link>
                </>
              )}
            </Alert>
          )}
          <Input
            label={t('fields.newPassword')}
            type="password"
            autoComplete="new-password"
            autoFocus
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={passwordError}
            hint={t('passwordHint')}
          />
          <Button type="submit" loading={submitting} disabled={!password}>
            {t('reset.submit')}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
