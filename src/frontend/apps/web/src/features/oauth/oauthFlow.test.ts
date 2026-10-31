import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyAuth, oauth2Fingerprint, type RequestAuth, type VariableMap } from '@apivator/core';
import { api } from '../../lib/api';
import { requestNewToken, tokenForSend, validTokens } from './oauthFlow';
import { useOAuthTokens } from './oauthStore';

const auth: RequestAuth = {
  ...emptyAuth('OAuth2'),
  oAuth2GrantType: 'ClientCredentials',
  oAuth2TokenUrl: '{{idp}}/token',
  oAuth2ClientId: 'web',
};
const variables: VariableMap = new Map([
  ['idp', { value: 'https://id.test', scope: 'environment', scopeName: 'Test', isSecret: false }],
]);
const fingerprint = oauth2Fingerprint(auth);

describe('oauthFlow', () => {
  beforeEach(() => {
    useOAuthTokens.setState({ tokens: {} });
    vi.restoreAllMocks();
  });

  it('yeni token alırken değişkenleri çözer, token değişkensiz parmak iziyle saklanır', async () => {
    const token = vi.spyOn(api.oauth2, 'token').mockResolvedValue({
      accessToken: 'abc',
      refreshToken: null,
      tokenType: 'Bearer',
      expiresIn: 3600,
      scope: null,
    });

    await requestNewToken(auth, variables);

    expect(token.mock.calls[0]![0].auth.oAuth2TokenUrl).toBe('https://id.test/token');
    expect(fingerprint).toContain('{{idp}}/token');
    expect(useOAuthTokens.getState().tokens[fingerprint]?.accessToken).toBe('abc');
    expect(validTokens()).toEqual({ [fingerprint]: 'abc' });
  });

  it('geçerli token doğrudan, süresi dolmuş token yenilenerek kullanılır', async () => {
    const now = Date.now();
    useOAuthTokens.getState().save(fingerprint, {
      accessToken: 'eski',
      refreshToken: 'yenile',
      tokenType: 'Bearer',
      scope: null,
      expiresAt: now + 10_000, // 30 sn payın içinde: süresi dolmuş sayılır
      obtainedAt: now,
    });
    expect(validTokens()).toEqual({});
    const refresh = vi.spyOn(api.oauth2, 'token').mockResolvedValue({
      accessToken: 'yeni',
      refreshToken: null,
      tokenType: 'Bearer',
      expiresIn: 600,
      scope: null,
    });

    expect(await tokenForSend(auth, variables)).toBe('yeni');
    expect(refresh.mock.calls[0]![0].refreshToken).toBe('yenile');
    // Sağlayıcı yeni yenileme token'ı göndermediyse eskisi korunur.
    expect(useOAuthTokens.getState().tokens[fingerprint]?.refreshToken).toBe('yenile');

    expect(await tokenForSend(auth, variables)).toBe('yeni');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('yenileme başarısızsa token silinir ve boş döner', async () => {
    useOAuthTokens.getState().save(fingerprint, {
      accessToken: 'eski',
      refreshToken: 'gecersiz',
      tokenType: null,
      scope: null,
      expiresAt: 1,
      obtainedAt: 0,
    });
    vi.spyOn(api.oauth2, 'token').mockRejectedValue(new Error('invalid_grant'));

    expect(await tokenForSend(auth, variables)).toBe('');
    expect(useOAuthTokens.getState().tokens[fingerprint]).toBeUndefined();
  });
});
