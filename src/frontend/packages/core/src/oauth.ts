import type { RequestAuth } from './types';

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** RFC 7636: 43–128 karakterlik rastgele code_verifier (32 bayt → 43 karakter). */
export function createCodeVerifier(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

/** Rastgele, tahmin edilemez "state" değeri. */
export function createOAuthState(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(16)));
}

/** S256 code_challenge = BASE64URL(SHA256(verifier)). */
export async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

/** Yetkilendirme sunucusunun giriş sayfası adresi (authorization code + PKCE). */
export function buildAuthorizeUrl(
  auth: RequestAuth,
  options: { redirectUri: string; state: string; challenge: string },
): string {
  const url = new URL(auth.oAuth2AuthUrl);
  const params: Record<string, string> = {
    response_type: 'code',
    client_id: auth.oAuth2ClientId,
    redirect_uri: options.redirectUri,
    state: options.state,
    code_challenge: options.challenge,
    code_challenge_method: 'S256',
  };
  if (auth.oAuth2Scope) params.scope = auth.oAuth2Scope;
  if (auth.oAuth2Audience) params.audience = auth.oAuth2Audience;
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}
