import { describe, expect, it } from 'vitest';
import { emptyAuth } from './http';
import { buildAuthorizeUrl, codeChallenge, createCodeVerifier, createOAuthState } from './oauth';

describe('oauth', () => {
  it('S256 challenge değerini base64url (dolgusuz) SHA-256 olarak üretir', async () => {
    expect(await codeChallenge('dBjftJeZ4CVP-mJ92IZ1-pQ6HH2HfrOGIE7Hx7vGUaY')).toBe(
      // Python: base64.urlsafe_b64encode(hashlib.sha256(v).digest()).rstrip('=')
      'wxbKw_rVPJ10521-hGmc1E7ipRpiM4IeUcAqKAVsJZU',
    );
  });

  it('URL güvenli, yeterince uzun ve rastgele değerler üretir', () => {
    const verifier = createCodeVerifier();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(createCodeVerifier()).not.toBe(verifier);
    expect(createOAuthState()).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it('yetkilendirme adresini mevcut sorgu parametrelerini koruyarak kurar', () => {
    const auth = {
      ...emptyAuth('OAuth2'),
      oAuth2AuthUrl: 'https://id.example.com/authorize?tenant=x',
      oAuth2ClientId: 'web',
      oAuth2Scope: 'openid profile',
    };
    const url = new URL(
      buildAuthorizeUrl(auth, { redirectUri: 'http://localhost/cb', state: 's', challenge: 'c' }),
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      tenant: 'x',
      response_type: 'code',
      client_id: 'web',
      redirect_uri: 'http://localhost/cb',
      state: 's',
      code_challenge: 'c',
      code_challenge_method: 'S256',
      scope: 'openid profile',
    });
  });
});
