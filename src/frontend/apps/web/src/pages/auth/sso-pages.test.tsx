import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ApiError, type AuthResult } from '@apivator/core';
import { LoginPage } from './LoginPage';
import { SsoCallbackPage } from './SsoCallbackPage';
import { SsoLinkPage } from './SsoLinkPage';
import { RegisterPage } from './RegisterPage';
import { useSession } from '../../stores/session';

const api = vi.hoisted(() => ({
  login: vi.fn(),
  ssoDiscover: vi.fn(),
  ssoStart: vi.fn(),
  ssoExchange: vi.fn(),
  ssoLink: vi.fn(),
  register: vi.fn(),
}));

vi.mock('../../lib/api', () => ({
  api: { auth: api, agent: { startOAuth: vi.fn(), oauthResult: vi.fn() } },
}));

const session = {
  accessToken: 'tok',
  user: { id: 'u1', email: 'a@firma.com', displayName: 'A' },
} as unknown as AuthResult;

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <LoginPage />
    </MemoryRouter>,
  );
}

describe('LoginPage SSO', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('location', { ...window.location, assign: vi.fn() });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('offers SSO once the email domain is discovered, keeping the password form', async () => {
    api.ssoDiscover.mockResolvedValue({ available: true, enforced: false, organizationName: 'Firma' });
    renderLogin();
    expect(screen.queryByRole('button', { name: 'SSO ile giriş yap' })).toBeNull();

    await userEvent.type(screen.getByLabelText('E-posta'), 'ayse@firma.com');
    expect(await screen.findByRole('button', { name: 'SSO ile giriş yap' })).toBeInTheDocument();
    expect(screen.getByLabelText('Şifre')).toBeInTheDocument();
    expect(api.ssoDiscover).toHaveBeenLastCalledWith('ayse@firma.com');
  });

  it('hides the password when SSO is enforced and starts the redirect', async () => {
    api.ssoDiscover.mockResolvedValue({ available: true, enforced: true, organizationName: 'Firma' });
    api.ssoStart.mockResolvedValue({ authorizationUrl: 'https://idp.example/authorize?x=1' });
    renderLogin();

    await userEvent.type(screen.getByLabelText('E-posta'), 'ayse@firma.com');
    const button = await screen.findByRole('button', { name: 'SSO ile giriş yap' });
    expect(screen.queryByLabelText('Şifre')).toBeNull();
    expect(screen.getByText(/Firma için şifreyle giriş kapalı/)).toBeInTheDocument();

    await userEvent.click(button);
    await waitFor(() =>
      expect(api.ssoStart).toHaveBeenCalledWith({
        email: 'ayse@firma.com',
        codeChallenge: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      }),
    );
    expect(sessionStorage.getItem('apivator-sso-verifier')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await waitFor(() =>
      expect(window.location.assign).toHaveBeenCalledWith('https://idp.example/authorize?x=1'),
    );
  });

  it('switches to SSO mode when the password login answers auth.sso_required', async () => {
    api.ssoDiscover.mockResolvedValue({ available: false, enforced: false, organizationName: null });
    api.login.mockRejectedValue(new ApiError(403, 'Bu hesap SSO ile giriş yapmalı.', 'auth.sso_required'));
    renderLogin();

    await userEvent.type(screen.getByLabelText('E-posta'), 'ayse@firma.com');
    await userEvent.type(screen.getByLabelText('Şifre'), 'gizli-sifre');
    await userEvent.click(screen.getByRole('button', { name: 'Giriş yap' }));

    expect(await screen.findByText('Bu hesap SSO ile giriş yapmalı.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Şifre')).toBeNull();
    expect(screen.getByRole('button', { name: 'SSO ile giriş yap' })).toBeInTheDocument();
  });
});

function renderCallback(search: string) {
  window.history.pushState({}, '', `/sso/callback${search}`);
  return render(
    <MemoryRouter initialEntries={['/sso/callback']}>
      <Routes>
        <Route path="/sso/callback" element={<SsoCallbackPage />} />
        <Route path="/login" element={<p>giris sayfasi</p>} />
        <Route path="/" element={<p>ana sayfa</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('SsoCallbackPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    useSession.getState().setSession(null);
  });

  it('exchanges the code, stores the session and goes home', async () => {
    api.ssoExchange.mockResolvedValue(session);
    sessionStorage.setItem('apivator-sso-verifier', 'ver-1');
    renderCallback('?code=abc123');
    expect(await screen.findByText('ana sayfa')).toBeInTheDocument();
    expect(api.ssoExchange).toHaveBeenCalledTimes(1);
    expect(api.ssoExchange).toHaveBeenCalledWith('abc123', 'ver-1');
    expect(window.location.search).toBe('');
    expect(sessionStorage.getItem('apivator-sso-verifier')).toBeNull();
    expect(useSession.getState().status).toBe('authenticated');
  });

  it('shows a Turkish message for a provider error and links back to login', async () => {
    renderCallback('?error=sso_domain_mismatch');
    expect(
      await screen.findByText(/alan adı bu organizasyonun SSO alan adlarıyla eşleşmiyor/),
    ).toBeInTheDocument();
    expect(api.ssoExchange).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('link', { name: 'Girişe dön' }));
    expect(await screen.findByText('giris sayfasi')).toBeInTheDocument();
  });

  it('shows the server message when the code exchange fails', async () => {
    api.ssoExchange.mockRejectedValue(
      new ApiError(400, 'Giriş kodu geçersiz ya da süresi dolmuş.', 'sso.invalid_code'),
    );
    sessionStorage.setItem('apivator-sso-verifier', 'ver-2');
    renderCallback('?code=bad');
    expect(await screen.findByText('Giriş kodu geçersiz ya da süresi dolmuş.')).toBeInTheDocument();
    expect(useSession.getState().status).not.toBe('authenticated');
  });

  it('refuses a code when this browser did not start the login', async () => {
    renderCallback('?code=xyz');
    expect(await screen.findByText('Giriş bu tarayıcıda başlatılmadı; tekrar deneyin.')).toBeInTheDocument();
    expect(api.ssoExchange).not.toHaveBeenCalled();
  });

  it('treats sso_link_sent as information, not a failure', async () => {
    renderCallback('?error=sso_link_sent');
    expect(await screen.findByText(/zaten bir Apivator hesabı var/)).toBeInTheDocument();
    expect(api.ssoExchange).not.toHaveBeenCalled();
  });
});

describe('SsoLinkPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSession.getState().setSession(null);
  });

  function renderLink(search: string) {
    window.history.pushState({}, '', `/sso/link${search}`);
    return render(
      <MemoryRouter initialEntries={['/sso/link']}>
        <Routes>
          <Route path="/sso/link" element={<SsoLinkPage />} />
          <Route path="/" element={<p>ana sayfa</p>} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it('links the account without signing in and points to login', async () => {
    api.ssoLink.mockResolvedValue(undefined);
    renderLink('?token=t1');
    expect(
      await screen.findByText("Hesabınız SSO'ya bağlandı. Şimdi SSO ile giriş yapın."),
    ).toBeInTheDocument();
    expect(api.ssoLink).toHaveBeenCalledWith('t1');
    expect(useSession.getState().status).not.toBe('authenticated');
    expect(screen.getByRole('link', { name: 'Girişe git' })).toBeInTheDocument();
  });

  it('explains an expired link', async () => {
    api.ssoLink.mockRejectedValue(new ApiError(400, 'x', 'sso.invalid_link'));
    renderLink('?token=old');
    expect(await screen.findByText('Bağlantının süresi dolmuş ya da kullanılmış.')).toBeInTheDocument();
  });
});

describe('RegisterPage SSO', () => {
  it('offers SSO login when registration answers auth.sso_required', async () => {
    vi.clearAllMocks();
    api.register.mockRejectedValue(new ApiError(403, 'Bu alan adı SSO kullanıyor.', 'auth.sso_required'));
    render(
      <MemoryRouter initialEntries={['/register']}>
        <RegisterPage />
      </MemoryRouter>,
    );
    await userEvent.type(screen.getByLabelText('Ad soyad'), 'Ayşe');
    await userEvent.type(screen.getByLabelText('E-posta'), 'ayse@firma.com');
    await userEvent.type(screen.getByLabelText('Şifre'), 'Gizli123x');
    await userEvent.click(screen.getByRole('button', { name: 'Kayıt ol' }));
    expect(await screen.findByText('Bu alan adı SSO kullanıyor.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'SSO ile giriş yap' })).toBeInTheDocument();
  });
});
