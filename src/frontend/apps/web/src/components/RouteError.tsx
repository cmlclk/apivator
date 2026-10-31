import { isRouteErrorResponse, useRouteError } from 'react-router';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@apivator/ui';
import { Logo } from './Logo';
import { useT } from '../i18n';

/** Beklenmeyen hatalarda gösterilen sayfa; geliştirici ekranı yerine kullanıcıya ne yapacağını söyler. */
export function RouteError() {
  const t = useT('shell');
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : String(error);

  function resetTabs() {
    try {
      localStorage.removeItem('apivator-tabs');
    } catch {
      // tarayıcı depolaması kapalıysa yapacak bir şey yok
    }
    window.location.assign('/');
  }

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl border border-line bg-surface p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <Logo className="h-6 w-6" />
          <span className="text-sm font-semibold">Apivator</span>
        </div>
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-danger" aria-hidden="true" />
          <div>
            <h1 className="font-semibold">{t('routeError.title')}</h1>
            <p className="mt-1 text-sm text-fg-muted">{t('routeError.hint')}</p>
            <pre className="mt-3 max-h-32 overflow-auto rounded-md bg-muted p-2 font-mono text-xs text-fg-muted">
              {message}
            </pre>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={resetTabs}>
            {t('routeError.resetTabs')}
          </Button>
          <Button onClick={() => window.location.reload()}>{t('routeError.reload')}</Button>
        </div>
      </div>
    </div>
  );
}
