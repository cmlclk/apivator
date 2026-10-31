import {
  SSO_LINK_SENT,
  codeChallenge,
  createCodeVerifier,
  createOAuthState,
  type AuthResult,
} from '@apivator/core';
import { translate, type MessageKey } from '../../i18n';
import { api } from '../../lib/api';
import { UserError } from '../../lib/errors';
import { isDesktop, openExternal } from '../../lib/desktop';

const SSO_ERROR_KEYS: Record<string, MessageKey<'sso'>> = {
  sso_expired: 'errors.expired',
  sso_denied: 'errors.denied',
  sso_provider_error: 'errors.providerError',
  sso_not_available: 'errors.notAvailable',
  sso_invalid_response: 'errors.invalidResponse',
  sso_no_email: 'errors.noEmail',
  sso_email_unverified: 'errors.emailUnverified',
  sso_domain_mismatch: 'errors.domainMismatch',
  sso_login_failed: 'errors.loginFailed',
  sso_not_member: 'errors.notMember',
};

/** Kimlik sağlayıcı dönüşündeki hata kodunun (?error=sso_<neden>) etkin dildeki karşılığı. */
export function ssoErrorMessage(code: string): string {
  return translate('sso', SSO_ERROR_KEYS[code] ?? 'errors.loginFailed');
}

/** Dönüşteki ?error=sso_link_sent hata değildir: hesap bağlama e-postası gönderilmiştir. */
export const ssoLinkSentMessage = () => translate('sso', 'linkSent');

/** Web: kimlik sağlayıcıdan dönüşte /sso/callback sayfası ana sayfa yerine buraya yönlendirir. */
export const SSO_REDIRECT_KEY = 'apivator-sso-redirect';
/** Web: girişi başlatan tarayıcıya bağlayan PKCE doğrulayıcısı (giriş kodu onsuz harcanamaz). */
export const SSO_VERIFIER_KEY = 'apivator-sso-verifier';

/** Kimlik sağlayıcıdan gelen adres yalnızca https olabilir (javascript: vb. kendi kaynağımızda çalışmasın). */
function assertHttps(value: string): string {
  let protocol = '';
  try {
    protocol = new URL(value).protocol;
  } catch {
    // geçersiz adres aşağıda reddedilir
  }
  if (protocol !== 'https:' && !(protocol === 'http:' && import.meta.env.DEV)) {
    throw new UserError(translate('sso', 'login.invalidAuthority'));
  }
  return value;
}

const LOGIN_TIMEOUT_MS = 5 * 60_000;
const POLL_INTERVAL_MS = 1000;

/** Masaüstü: giriş sistem tarayıcısında açılır, sonuç yerel ajanın loopback adresine döner (OAuth2 akışıyla aynı). */
async function loginInBrowser(email: string): Promise<AuthResult> {
  const verifier = createCodeVerifier();
  const state = createOAuthState();
  const { redirectUri } = await api.agent.startOAuth(state);
  const { authorizationUrl } = await api.auth.ssoStart({
    email,
    codeChallenge: await codeChallenge(verifier),
    returnUrl: redirectUri,
    state,
  });
  await openExternal(assertHttps(authorizationUrl));

  const deadline = Date.now() + LOGIN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    const result = await api.agent.oauthResult(state);
    if (result.status === 'pending') continue;
    if (result.error === SSO_LINK_SENT) throw new UserError(ssoLinkSentMessage());
    if (result.error) throw new UserError(ssoErrorMessage(result.error));
    if (!result.code) throw new UserError(ssoErrorMessage(''));
    return api.auth.ssoExchange(result.code, verifier);
  }
  throw new UserError(translate('sso', 'login.timeout'));
}

/**
 * SSO girişini başlatır. Masaüstünde oturumu döner; web'de tarayıcı kimlik sağlayıcıya yönlenir ve null döner
 * (oturum /sso/callback sayfasında kurulur).
 */
export async function startSsoLogin(email: string, redirect: string | null): Promise<AuthResult | null> {
  if (isDesktop()) return loginInBrowser(email);
  const verifier = createCodeVerifier();
  const { authorizationUrl } = await api.auth.ssoStart({
    email,
    codeChallenge: await codeChallenge(verifier),
  });
  try {
    sessionStorage.setItem(SSO_VERIFIER_KEY, verifier);
    if (redirect) sessionStorage.setItem(SSO_REDIRECT_KEY, redirect);
    else sessionStorage.removeItem(SSO_REDIRECT_KEY);
  } catch {
    throw new UserError(translate('sso', 'login.storageBlocked'));
  }
  window.location.assign(assertHttps(authorizationUrl));
  return null;
}
