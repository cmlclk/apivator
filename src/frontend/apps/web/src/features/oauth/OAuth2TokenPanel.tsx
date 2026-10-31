import { useState } from 'react';
import { KeyRound, RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '@apivator/ui';
import { oauth2Fingerprint, type RequestAuth, type VariableMap } from '@apivator/core';
import { useT, type TFunction } from '../../i18n';
import { errorMessage } from '../../lib/errors';
import { requestNewToken } from './oauthFlow';
import { isTokenValid, useOAuthTokens } from './oauthStore';

function remaining(t: TFunction<'oauth'>, expiresAt: number): string {
  const minutes = Math.round((expiresAt - Date.now()) / 60_000);
  if (minutes < 1) return t('panel.lessThanMinute');
  if (minutes < 120) return t('panel.minutes', { count: minutes });
  return t('panel.hours', { count: Math.round(minutes / 60) });
}

/** Bu tarayıcıdaki token'ın durumu; yeni token alma ve silme. */
export function OAuth2TokenPanel({ auth, variables }: { auth: RequestAuth; variables: VariableMap }) {
  const t = useT('oauth');
  const fingerprint = oauth2Fingerprint(auth);
  const token = useOAuthTokens((s) => s.tokens[fingerprint]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = token && isTokenValid(token) ? token : null;
  const serverManaged = auth.oAuth2GrantType !== 'AuthorizationCode';

  async function fetchToken() {
    setBusy(true);
    setError(null);
    try {
      await requestNewToken(auth, variables);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-label={t('panel.title')}
      className="flex flex-col gap-2 rounded-md border border-line bg-surface px-3 py-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <KeyRound className="h-4 w-4 text-fg-subtle" aria-hidden="true" />
        <span className="text-[13px] font-medium text-fg">{t('panel.title')}</span>
        <span className="text-[12.5px] text-fg-muted" role="status">
          {valid
            ? valid.expiresAt
              ? t('panel.validLeft', { time: remaining(t, valid.expiresAt) })
              : t('panel.validNoExpiry')
            : token
              ? token.refreshToken
                ? t('panel.expiredRefresh')
                : t('panel.expired')
              : serverManaged
                ? t('panel.noneAuto')
                : t('panel.none')}
        </span>
        <div className="ms-auto flex gap-2">
          {token && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => useOAuthTokens.getState().remove(fingerprint)}
              aria-label={t('panel.delete')}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button size="sm" variant="secondary" onClick={() => void fetchToken()} disabled={busy}>
            <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} aria-hidden="true" />
            {busy ? t('panel.fetching') : t('panel.fetch')}
          </Button>
        </div>
      </div>
      {valid && (
        <code className="truncate font-mono text-[12px] text-fg-subtle" title={t('panel.localOnlyTitle')}>
          {valid.accessToken.slice(0, 12)}…
          {valid.scope ? ` · ${t('panel.scope', { scope: valid.scope })}` : ''}
        </code>
      )}
      {error && (
        <p role="alert" className="text-[12.5px] text-danger">
          {error}
        </p>
      )}
      <p className="text-xs text-fg-subtle">
        {t('panel.note')}
        {serverManaged && t('panel.noteServer')}
      </p>
    </section>
  );
}
