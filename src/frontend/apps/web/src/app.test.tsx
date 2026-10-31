import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError, type AuthResult, type WorkspaceDto } from '@apivator/core';
import { renderApp } from './test/renderWithRouter';
import { useSession } from './stores/session';
import { safeRedirect } from './lib/safeRedirect';
import { useUi } from './stores/ui';
import { resetPreferenceSync } from './features/account/preferences';

const mocks = vi.hoisted(() => ({
  refreshSession: vi.fn(),
  login: vi.fn(),
  loginTwoFactor: vi.fn(),
  register: vi.fn(),
  listWorkspaces: vi.fn(),
  preferences: vi.fn(),
}));

// Canlı kanal bu testlerin konusu değil; jsdom'da gerçek bağlantı denenmez.
vi.mock('./components/RealtimeBridge', () => ({ RealtimeBridge: () => null }));

vi.mock('./lib/api', () => ({
  api: {
    refreshSession: mocks.refreshSession,
    auth: {
      login: mocks.login,
      loginTwoFactor: mocks.loginTwoFactor,
      register: mocks.register,
      logout: vi.fn(),
      resendConfirmation: vi.fn(),
    },
    workspaces: { list: mocks.listWorkspaces },
    collections: { list: vi.fn().mockResolvedValue([]) },
    environments: { list: vi.fn().mockResolvedValue([]) },
    invitations: { mine: vi.fn().mockResolvedValue([]) },
    notifications: { list: vi.fn().mockResolvedValue({ items: [], unread: 0 }), markRead: vi.fn() },
    globals: { get: vi.fn().mockResolvedValue({ workspaceId: 'w1', variables: [] }) },
    account: { preferences: mocks.preferences, updatePreferences: vi.fn() },
  },
}));

const session: AuthResult = {
  accessToken: 'token',
  accessTokenExpiresAt: '2026-10-20T10:00:00Z',
  refreshToken: 'rt',
  refreshTokenExpiresAt: '2026-11-03T10:00:00Z',
  user: { id: 'u1', email: 'ayse@example.com', displayName: 'Ayşe Yılmaz', emailConfirmed: false },
};

const personal: WorkspaceDto = {
  id: 'w1',
  name: 'Kişisel Workspace',
  type: 'Personal',
  role: 'Admin',
  organizationId: 'o1',
  organizationName: 'Ayşe Yılmaz',
};

beforeEach(() => {
  vi.clearAllMocks();
  resetPreferenceSync();
  useUi.setState({ theme: 'system', currentWorkspaceId: null });
  useSession.setState({ status: 'loading', accessToken: null, user: null });
  mocks.listWorkspaces.mockResolvedValue([personal]);
  mocks.preferences.mockResolvedValue({
    theme: 'system',
    defaultWorkspaceId: null,
    emailMentions: true,
    emailMergeRequests: true,
    emailMonitorAlerts: true,
  });
  // Gerçek istemci gibi: refresh sonucu oturum deposuna yazılır.
  mocks.refreshSession.mockImplementation(async () => {
    useSession.getState().setSession(null);
    return null;
  });
});

describe('oturum ve yönlendirme', () => {
  it('oturum yoksa giriş sayfasına yönlendirir', async () => {
    renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Giriş yap' })).toBeInTheDocument();
    expect(mocks.refreshSession).toHaveBeenCalledOnce();
  });

  it('refresh cookie geçerliyse workspace açılır', async () => {
    mocks.refreshSession.mockImplementation(async () => {
      useSession.getState().setSession(session);
      return session;
    });

    renderApp('/');

    expect(await screen.findByRole('heading', { name: 'Kişisel Workspace' })).toBeInTheDocument();
    expect(screen.getByText(/adresi henüz doğrulanmadı/)).toBeInTheDocument();
  });
});

describe('tercihler', () => {
  it('sunucudaki tema ve varsayılan workspace açılışta uygulanır', async () => {
    const team: WorkspaceDto = { ...personal, id: 'w2', name: 'Ödeme Ekibi', type: 'Team' };
    mocks.listWorkspaces.mockResolvedValue([personal, team]);
    mocks.preferences.mockResolvedValue({
      theme: 'dark',
      defaultWorkspaceId: 'w2',
      emailMentions: true,
      emailMergeRequests: true,
      emailMonitorAlerts: true,
    });
    mocks.refreshSession.mockImplementation(async () => {
      useSession.getState().setSession(session);
      return session;
    });

    renderApp('/');

    expect(await screen.findByRole('heading', { name: 'Ödeme Ekibi' })).toBeInTheDocument();
    expect(useUi.getState().theme).toBe('dark');
    expect(document.documentElement).toHaveClass('dark');
  });
});

describe('giriş', () => {
  it('başarılı girişten sonra workspace sayfasına gider', async () => {
    mocks.login.mockResolvedValue(session);
    renderApp('/login');
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('E-posta'), 'ayse@example.com');
    await user.type(screen.getByLabelText('Şifre'), 'Sifre1234');
    await user.click(screen.getByRole('button', { name: 'Giriş yap' }));

    expect(mocks.login).toHaveBeenCalledWith({ email: 'ayse@example.com', password: 'Sifre1234' });
    expect(await screen.findByRole('heading', { name: 'Kişisel Workspace' })).toBeInTheDocument();
  });

  it('iki adımlı doğrulamada kod ister; yedek koda geçilebilir; süre dolunca başa döner', async () => {
    mocks.login.mockResolvedValue({
      twoFactorRequired: true,
      challengeToken: 'ch1',
      expiresAt: '2026-10-20T10:05:00Z',
    });
    mocks.loginTwoFactor
      .mockRejectedValueOnce(new ApiError(401, 'Kod hatalı ya da süresi dolmuş.', 'auth.invalid_code'))
      .mockResolvedValueOnce(session);
    renderApp('/login');
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('E-posta'), 'ayse@example.com');
    await user.type(screen.getByLabelText('Şifre'), 'Sifre1234');
    await user.click(screen.getByRole('button', { name: 'Giriş yap' }));

    expect(await screen.findByRole('heading', { name: 'İki adımlı doğrulama' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Doğrulama kodu'), '123456');
    await user.click(screen.getByRole('button', { name: 'Doğrula' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Kod hatalı');
    expect(mocks.loginTwoFactor).toHaveBeenLastCalledWith('ch1', '123456');

    await user.click(screen.getByRole('button', { name: /yedek kod kullan/ }));
    await user.type(screen.getByLabelText('Yedek kod'), 'abcde-fghjk');
    await user.click(screen.getByRole('button', { name: 'Doğrula' }));
    expect(mocks.loginTwoFactor).toHaveBeenLastCalledWith('ch1', 'abcde-fghjk');
    expect(await screen.findByRole('heading', { name: 'Kişisel Workspace' })).toBeInTheDocument();
  });

  it('ikinci adımın süresi dolunca şifre ekranına döner', async () => {
    mocks.login.mockResolvedValue({
      twoFactorRequired: true,
      challengeToken: 'ch1',
      expiresAt: '2026-10-20T10:05:00Z',
    });
    mocks.loginTwoFactor.mockRejectedValueOnce(
      new ApiError(401, 'Giriş adımının süresi doldu.', 'auth.challenge_expired'),
    );
    renderApp('/login');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('E-posta'), 'ayse@example.com');
    await user.type(screen.getByLabelText('Şifre'), 'Sifre1234');
    await user.click(screen.getByRole('button', { name: 'Giriş yap' }));
    await user.type(await screen.findByLabelText('Doğrulama kodu'), '123456');
    await user.click(screen.getByRole('button', { name: 'Doğrula' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('süresi doldu');
    expect(screen.getByLabelText('Şifre')).toHaveValue('');
    expect(screen.getByLabelText('E-posta')).toHaveValue('ayse@example.com');
  });

  it('hatalı girişte sunucunun mesajını gösterir', async () => {
    mocks.login.mockRejectedValue(
      new ApiError(401, 'E-posta veya şifre hatalı.', 'auth.invalid_credentials'),
    );
    renderApp('/login');
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('E-posta'), 'ayse@example.com');
    await user.type(screen.getByLabelText('Şifre'), 'yanlis');
    await user.click(screen.getByRole('button', { name: 'Giriş yap' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('E-posta veya şifre hatalı.');
  });
});

describe('kayıt', () => {
  it('alan hatalarını ilgili alanın altında gösterir', async () => {
    mocks.register.mockRejectedValue(
      new ApiError(400, 'Gönderilen bilgiler geçersiz.', 'validation', {
        password: ['Şifre en az bir rakam içermeli.'],
      }),
    );
    renderApp('/register');
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Ad soyad'), 'Ayşe');
    await user.type(screen.getByLabelText('E-posta'), 'ayse@example.com');
    await user.type(screen.getByLabelText('Şifre'), 'sifresiz');
    await user.click(screen.getByRole('button', { name: 'Kayıt ol' }));

    await waitFor(() => expect(screen.getByLabelText('Şifre')).toHaveAttribute('aria-invalid', 'true'));
    expect(screen.getByText('Şifre en az bir rakam içermeli.')).toBeInTheDocument();
  });
});

describe('safeRedirect', () => {
  it.each([
    ['/workspaces/1', '/workspaces/1'],
    ['//evil.com', '/'],
    ['https://evil.com', '/'],
    [null, '/'],
  ])('%s → %s', (input, expected) => {
    expect(safeRedirect(input)).toBe(expected);
  });
});
