import { useEffect } from 'react';
import { Outlet } from 'react-router';
import { Spinner } from '@apivator/ui';
import { api } from '../lib/api';
import { useSession } from '../stores/session';
import { applyTheme, useUi } from '../stores/ui';
import { useT } from '../i18n';

/** Uygulama açılırken refresh cookie ile oturumu geri yükler ve temayı uygular. */
export function SessionBoot() {
  const t = useT('shell');
  const status = useSession((s) => s.status);
  const theme = useUi((s) => s.theme);

  useEffect(() => {
    if (useSession.getState().status === 'loading') void api.refreshSession();
  }, []);

  useEffect(() => {
    applyTheme(theme);
    if (theme !== 'system' || !window.matchMedia) return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = () => applyTheme('system');
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, [theme]);

  if (status === 'loading') {
    return (
      <div className="flex h-full items-center justify-center text-fg-subtle" aria-label={t('boot.loading')}>
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  return <Outlet />;
}
