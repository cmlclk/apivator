import {
  buildAuthorizeUrl,
  codeChallenge,
  createCodeVerifier,
  createOAuthState,
  emptyBody,
  oauth2Fingerprint,
  resolveRequest,
  type OAuth2TokenDto,
  type RequestAuth,
  type VariableMap,
} from '@apivator/core';
import { translate } from '../../i18n';
import { api } from '../../lib/api';
import { UserError } from '../../lib/errors';
import { isDesktop, openExternal } from '../../lib/desktop';
import { isTokenValid, useOAuthTokens, type StoredToken } from './oauthStore';

export const OAUTH_MESSAGE = 'apivator-oauth-callback';
export const OAUTH_CHANNEL = 'apivator-oauth';
const LOGIN_TIMEOUT_MS = 5 * 60_000;

export interface OAuthCallbackMessage {
  type: typeof OAUTH_MESSAGE;
  state: string | null;
  code: string | null;
  error: string | null;
  errorDescription: string | null;
}

export function defaultRedirectUri(): string {
  // Masaüstünde dönüş adresini yerel ajan açar; port her açılışta değişebilir.
  if (isDesktop()) return 'http://127.0.0.1:<port>/oauth/callback';
  return `${window.location.origin}/oauth/callback`;
}

const POLL_INTERVAL_MS = 1000;

/**
 * Masaüstü (RFC 8252): giriş sistem tarayıcısında açılır, sağlayıcı yerel ajanın loopback adresine döner,
 * sonucu ajandan alırız. Yönlendirme adresi her zaman ajanınkidir; ayarlardaki adres kullanılmaz.
 */
async function authorizeInBrowser(
  auth: RequestAuth,
): Promise<{ code: string; verifier: string; redirectUri: string }> {
  if (!auth.oAuth2AuthUrl) throw new UserError(translate('oauth', 'flow.authUrlEmpty'));
  const verifier = createCodeVerifier();
  const state = createOAuthState();
  const { redirectUri } = await api.agent.startOAuth(state);
  let url: string;
  try {
    url = buildAuthorizeUrl(auth, { redirectUri, state, challenge: await codeChallenge(verifier) });
  } catch {
    throw new UserError(translate('oauth', 'flow.authUrlInvalid'));
  }
  await openExternal(url);

  const deadline = Date.now() + LOGIN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    const result = await api.agent.oauthResult(state);
    if (result.status === 'pending') continue;
    if (result.error)
      throw new UserError(
        result.errorDescription || translate('oauth', 'flow.denied', { error: result.error }),
      );
    if (!result.code) throw new UserError(translate('oauth', 'flow.noCode'));
    return { code: result.code, verifier, redirectUri };
  }
  throw new UserError(translate('oauth', 'flow.timeout'));
}

/** Auth ayarlarındaki {{değişken}}'leri çözer (token isteği tarayıcıdan başlatıldığında). */
export function resolveAuthVariables(auth: RequestAuth, variables: VariableMap): RequestAuth {
  return resolveRequest({ url: '', headers: [], body: emptyBody(), auth }, variables).auth;
}

function store(fingerprint: string, dto: OAuth2TokenDto, previousRefresh?: string | null): StoredToken {
  const now = Date.now();
  const token: StoredToken = {
    accessToken: dto.accessToken,
    // Sağlayıcı yenileme token'ını her seferinde göndermeyebilir; eskisi geçerli kalır.
    refreshToken: dto.refreshToken ?? previousRefresh ?? null,
    tokenType: dto.tokenType,
    scope: dto.scope,
    expiresAt: dto.expiresIn ? now + dto.expiresIn * 1000 : null,
    obtainedAt: now,
  };
  useOAuthTokens.getState().save(fingerprint, token);
  return token;
}

/** Authorization code + PKCE: giriş sayfasını açılır pencerede açar, dönen kodu bekler. */
async function authorizeInPopup(
  auth: RequestAuth,
): Promise<{ code: string; verifier: string; redirectUri: string }> {
  if (!auth.oAuth2AuthUrl) throw new UserError(translate('oauth', 'flow.authUrlEmpty'));
  const redirectUri = auth.oAuth2RedirectUri || defaultRedirectUri();
  if (new URL(redirectUri, window.location.href).origin !== window.location.origin) {
    throw new UserError(translate('oauth', 'flow.redirectMismatch', { uri: defaultRedirectUri() }));
  }
  const verifier = createCodeVerifier();
  const state = createOAuthState();
  let url: string;
  try {
    url = buildAuthorizeUrl(auth, { redirectUri, state, challenge: await codeChallenge(verifier) });
  } catch {
    throw new UserError(translate('oauth', 'flow.authUrlInvalid'));
  }

  const popup = window.open(url, 'apivator-oauth', 'width=520,height=700');
  if (!popup) throw new UserError(translate('oauth', 'flow.popupBlocked'));

  const code = await new Promise<string>((resolve, reject) => {
    // Bazı sağlayıcılar window.opener'ı kopardığı için BroadcastChannel da dinlenir.
    const channel = 'BroadcastChannel' in window ? new BroadcastChannel(OAUTH_CHANNEL) : null;
    const cleanup = () => {
      window.removeEventListener('message', onWindowMessage);
      channel?.close();
      clearInterval(closedTimer);
      clearTimeout(timeout);
    };
    const handle = (data: unknown) => {
      const message = data as Partial<OAuthCallbackMessage> | null;
      if (message?.type !== OAUTH_MESSAGE || message.state !== state) return;
      cleanup();
      popup.close();
      if (message.error)
        reject(
          new UserError(
            message.errorDescription || translate('oauth', 'flow.denied', { error: message.error }),
          ),
        );
      else if (!message.code) reject(new UserError(translate('oauth', 'flow.noCode')));
      else resolve(message.code);
    };
    const onWindowMessage = (event: MessageEvent) => {
      if (event.origin === window.location.origin) handle(event.data);
    };
    window.addEventListener('message', onWindowMessage);
    if (channel) channel.onmessage = (event) => handle(event.data);
    const closedTimer = setInterval(() => {
      if (popup.closed) {
        cleanup();
        reject(new UserError(translate('oauth', 'flow.popupClosed')));
      }
    }, 500);
    const timeout = setTimeout(() => {
      cleanup();
      popup.close();
      reject(new UserError(translate('oauth', 'flow.timeout')));
    }, LOGIN_TIMEOUT_MS);
  });

  return { code, verifier, redirectUri };
}

/**
 * "Yeni token al": ayarlar (değişkenleri çözülmemiş) parmak izi için kullanılır, çözülmüş hâli istek için.
 * Authorization code akışı açılır pencerede yürür; diğerleri doğrudan sunucu üzerinden alınır.
 */
export async function requestNewToken(auth: RequestAuth, variables: VariableMap): Promise<StoredToken> {
  const resolved = resolveAuthVariables(auth, variables);
  if (!resolved.oAuth2TokenUrl) throw new UserError(translate('oauth', 'flow.tokenUrlEmpty'));
  if (resolved.oAuth2GrantType === 'AuthorizationCode') {
    const { code, verifier, redirectUri } = isDesktop()
      ? await authorizeInBrowser(resolved)
      : await authorizeInPopup(resolved);
    const dto = await api.oauth2.token({ auth: resolved, code, codeVerifier: verifier, redirectUri });
    return store(oauth2Fingerprint(auth), dto);
  }
  return store(oauth2Fingerprint(auth), await api.oauth2.token({ auth: resolved }));
}

/**
 * Gönderimden önce kullanılacak token. Süresi dolmuşsa yenileme token'ıyla tazelenir. Bulunamazsa boş döner:
 * client credentials / password akışında sunucu token'ı kendisi alır.
 */
export async function tokenForSend(auth: RequestAuth, variables: VariableMap): Promise<string> {
  const fingerprint = oauth2Fingerprint(auth);
  const stored = useOAuthTokens.getState().tokens[fingerprint];
  if (stored && isTokenValid(stored)) return stored.accessToken;
  if (stored?.refreshToken) {
    try {
      const dto = await api.oauth2.token({
        auth: resolveAuthVariables(auth, variables),
        refreshToken: stored.refreshToken,
      });
      return store(fingerprint, dto, stored.refreshToken).accessToken;
    } catch {
      // Yenileme başarısız: token silinir, kullanıcıdan yeniden giriş istenir.
      useOAuthTokens.getState().remove(fingerprint);
    }
  }
  return '';
}

/** Runner için: bu tarayıcıdaki geçerli tüm token'lar (sunucu parmak iziyle eşleştirir). */
export function validTokens(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [fingerprint, token] of Object.entries(useOAuthTokens.getState().tokens)) {
    if (isTokenValid(token)) result[fingerprint] = token.accessToken;
  }
  return result;
}
