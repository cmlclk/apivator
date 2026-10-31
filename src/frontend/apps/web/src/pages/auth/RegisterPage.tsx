import { useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Alert, Button, Input } from '@apivator/ui';
import { ApiError } from '@apivator/core';
import { AuthLayout } from '../../components/AuthLayout';
import { useT } from '../../i18n';
import { api } from '../../lib/api';
import { errorMessage, fieldError } from '../../lib/errors';
import { useSession } from '../../stores/session';
import { safeRedirect } from '../../lib/safeRedirect';
import { startSsoLogin } from '../../features/sso/ssoLogin';

export function RegisterPage() {
  const t = useT('auth');
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const setSession = useSession((s) => s.setSession);
  // Davet bağlantısından gelindiyse e-posta dolu gelir ve kayıttan sonra davete dönülür.
  const [form, setForm] = useState({ displayName: '', email: params.get('email') ?? '', password: '' });
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);

  const update = (field: keyof typeof form) => (e: ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      setSession(await api.auth.register(form));
      navigate(safeRedirect(params.get('redirect')), { replace: true });
    } catch (e) {
      setError(e);
    } finally {
      setSubmitting(false);
    }
  }

  /** Bu alan adında SSO açık: hesap şifreyle değil kurumsal girişle açılır. */
  const ssoRequired = error instanceof ApiError && error.code === 'auth.sso_required';

  async function onSso() {
    setSubmitting(true);
    try {
      const session = await startSsoLogin(form.email.trim(), params.get('redirect'));
      if (session) {
        setSession(session);
        navigate(safeRedirect(params.get('redirect')), { replace: true });
      }
    } catch (e) {
      setError(e);
    } finally {
      setSubmitting(false);
    }
  }

  const hasFieldErrors = error instanceof ApiError && Object.keys(error.fieldErrors).length > 0;

  return (
    <AuthLayout
      title={t('register.title')}
      subtitle={t.rich('register.haveAccount', {
        link: (c) => (
          <Link
            to={
              params.get('redirect')
                ? `/login?redirect=${encodeURIComponent(params.get('redirect')!)}`
                : '/login'
            }
            className="font-medium text-accent hover:underline"
          >
            {c}
          </Link>
        ),
      })}
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        {error !== null && !hasFieldErrors && <Alert tone="error">{errorMessage(error)}</Alert>}
        <Input
          label={t('fields.displayName')}
          autoComplete="name"
          autoFocus
          required
          value={form.displayName}
          onChange={update('displayName')}
          error={fieldError(error, 'displayName')}
        />
        <Input
          label={t('fields.email')}
          type="email"
          autoComplete="email"
          required
          value={form.email}
          onChange={update('email')}
          error={fieldError(error, 'email')}
        />
        <Input
          label={t('fields.password')}
          type="password"
          autoComplete="new-password"
          required
          value={form.password}
          onChange={update('password')}
          error={fieldError(error, 'password')}
          hint={t('passwordHint')}
        />
        <Button
          type="submit"
          loading={submitting}
          disabled={!form.displayName || !form.email || !form.password}
        >
          {t('register.submit')}
        </Button>
        {ssoRequired && (
          <Button type="button" variant="secondary" loading={submitting} onClick={() => void onSso()}>
            {t('register.sso')}
          </Button>
        )}
      </form>
    </AuthLayout>
  );
}
