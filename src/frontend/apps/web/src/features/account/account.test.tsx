import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router';
import type { ReactNode } from 'react';
import { ApiError, type PreferencesDto, type ProfileDto, type SessionDto } from '@apivator/core';
import { useSession } from '../../stores/session';
import { useUi } from '../../stores/ui';
import { ProfileTab } from './ProfileTab';
import { SecurityTab } from './SecurityTab';
import { PreferencesTab } from './PreferencesTab';
import { DataTab } from './DataTab';
import { DeleteAccountPage } from '../../pages/auth/DeleteAccountPage';
import { ConfirmEmailChangePage } from '../../pages/auth/ConfirmEmailChangePage';
import { UserMenu } from '../../components/UserMenu';

const api = vi.hoisted(() => ({
  profile: vi.fn(),
  updateProfile: vi.fn(),
  changeEmail: vi.fn(),
  cancelEmailChange: vi.fn(),
  confirmEmailChange: vi.fn(),
  changePassword: vi.fn(),
  sessions: vi.fn(),
  revokeSession: vi.fn(),
  revokeOtherSessions: vi.fn(),
  preferences: vi.fn(),
  updatePreferences: vi.fn(),
  deletionCheck: vi.fn(),
  requestDeletion: vi.fn(),
  confirmDeletion: vi.fn(),
  exportData: vi.fn(),
  logout: vi.fn(),
  workspaces: vi.fn(),
  twoFactorStatus: vi.fn(),
  twoFactorSetup: vi.fn(),
  twoFactorEnable: vi.fn(),
  twoFactorDisable: vi.fn(),
  regenerateRecoveryCodes: vi.fn(),
  securityEvents: vi.fn(),
  me: vi.fn(),
}));

vi.mock('../../lib/api', () => ({
  api: {
    account: {
      profile: api.profile,
      updateProfile: api.updateProfile,
      changeEmail: api.changeEmail,
      cancelEmailChange: api.cancelEmailChange,
      confirmEmailChange: api.confirmEmailChange,
      changePassword: api.changePassword,
      sessions: api.sessions,
      revokeSession: api.revokeSession,
      revokeOtherSessions: api.revokeOtherSessions,
      preferences: api.preferences,
      updatePreferences: api.updatePreferences,
      deletionCheck: api.deletionCheck,
      requestDeletion: api.requestDeletion,
      confirmDeletion: api.confirmDeletion,
      exportData: api.exportData,
      twoFactor: {
        status: api.twoFactorStatus,
        setup: api.twoFactorSetup,
        enable: api.twoFactorEnable,
        disable: api.twoFactorDisable,
        regenerateRecoveryCodes: api.regenerateRecoveryCodes,
      },
      securityEvents: api.securityEvents,
    },
    me: api.me,
    auth: { logout: api.logout },
    workspaces: { list: api.workspaces },
  },
}));

const profile: ProfileDto = {
  id: 'u1',
  email: 'ayse@example.com',
  displayName: 'Ayşe Yılmaz',
  emailConfirmed: true,
  pendingEmail: null,
  createdAt: '2026-01-15T10:00:00Z',
  avatarVersion: null,
  organizations: [
    {
      id: 'o0',
      name: 'Ayşe Yılmaz',
      isPersonal: true,
      role: 'Owner',
      memberCount: 1,
      workspaces: [{ id: 'w1', name: 'Kişisel Workspace', type: 'Personal', role: 'Admin' }],
    },
    {
      id: 'o1',
      name: 'Acme',
      isPersonal: false,
      role: 'Member',
      memberCount: 12,
      workspaces: [{ id: 'w2', name: 'Ödeme', type: 'Team', role: 'Editor' }],
    },
  ],
};

const preferences: PreferencesDto = {
  theme: 'system',
  defaultWorkspaceId: null,
  emailMentions: true,
  emailMergeRequests: true,
  emailMonitorAlerts: true,
};

const sessions: SessionDto[] = [
  {
    id: 's1',
    device: 'Chrome · Windows',
    app: 'web',
    ipAddress: '10.0.0.5',
    startedAt: '2026-10-20T10:00:00Z',
    lastUsedAt: new Date().toISOString(),
    current: true,
  },
  {
    id: 's2',
    device: 'Apivator Masaüstü · macOS',
    app: 'desktop',
    ipAddress: '10.0.0.9',
    startedAt: '2026-10-10T10:00:00Z',
    lastUsedAt: '2026-10-22T10:00:00Z',
    current: false,
  },
];

function wrap(children: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>,
  );
}

function wrapRoute(path: string, element: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([{ path: path.split('?')[0], element }], { initialEntries: [path] });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  api.twoFactorStatus.mockResolvedValue({
    enabled: false,
    enabledAt: null,
    recoveryCodesLeft: 0,
    requiredBy: [],
  });
  api.securityEvents.mockResolvedValue([]);
  useSession.setState({
    status: 'authenticated',
    accessToken: 't',
    user: { id: 'u1', email: 'ayse@example.com', displayName: 'Ayşe Yılmaz', emailConfirmed: true },
  });
  api.profile.mockResolvedValue(profile);
  api.preferences.mockResolvedValue(preferences);
  api.sessions.mockResolvedValue(sessions);
  api.workspaces.mockResolvedValue([]);
  api.deletionCheck.mockResolvedValue({ mustTransfer: [], willDelete: [] });
});

describe('profil', () => {
  it('ad değişince üst çubuktaki kullanıcı da güncellenir', async () => {
    api.updateProfile.mockResolvedValue({ ...profile, displayName: 'Ayşe Kaya' });
    wrap(<ProfileTab />);
    const user = userEvent.setup();

    const input = await screen.findByLabelText('Ad soyad');
    await user.clear(input);
    await user.type(input, 'Ayşe Kaya');
    await user.click(screen.getByRole('button', { name: 'Kaydet' }));

    expect(api.updateProfile).toHaveBeenCalledWith('Ayşe Kaya');
    await waitFor(() => expect(useSession.getState().user?.displayName).toBe('Ayşe Kaya'));
  });

  it('üyelikleri rolleriyle listeler', async () => {
    wrap(<ProfileTab />);
    const acme = await screen.findByRole('link', { name: 'Acme' });
    const card = acme.closest('li')!;
    expect(within(card).getByText('Üye')).toBeInTheDocument();
    expect(within(card).getByText('12 kişi')).toBeInTheDocument();
    expect(within(card).getByText('Düzenleyici')).toBeInTheDocument();
  });

  it('e-posta değişikliği şifre ister ve bekleyen adresi gösterir', async () => {
    api.changeEmail.mockResolvedValue(undefined);
    wrap(<ProfileTab />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'E-postayı değiştir' }));
    await user.type(screen.getByLabelText('Yeni e-posta'), 'yeni@example.com');
    const send = screen.getByRole('button', { name: 'Doğrulama bağlantısı gönder' });
    expect(send).toBeDisabled();
    await user.type(screen.getByLabelText('Şifreniz'), 'Sifre1234');

    api.profile.mockResolvedValue({ ...profile, pendingEmail: 'yeni@example.com' });
    await user.click(send);

    expect(api.changeEmail).toHaveBeenCalledWith('yeni@example.com', 'Sifre1234');
    expect(await screen.findByText('yeni@example.com')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Değişikliği iptal et' })).toBeInTheDocument();
  });
});

describe('şifre ve oturumlar', () => {
  it('şifreler aynı değilse gönderilmez; hatalı mevcut şifre alanın altında görünür', async () => {
    api.changePassword.mockRejectedValue(
      new ApiError(400, 'Mevcut şifre hatalı.', 'validation', { currentPassword: ['Mevcut şifre hatalı.'] }),
    );
    wrap(<SecurityTab />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('Mevcut şifre'), 'eski');
    await user.type(screen.getByLabelText('Yeni şifre'), 'YeniSifre1');
    await user.type(screen.getByLabelText('Yeni şifre (tekrar)'), 'YeniSifre2');
    expect(screen.getByText('Şifreler aynı değil.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Şifreyi değiştir' })).toBeDisabled();

    await user.clear(screen.getByLabelText('Yeni şifre (tekrar)'));
    await user.type(screen.getByLabelText('Yeni şifre (tekrar)'), 'YeniSifre1');
    await user.click(screen.getByRole('button', { name: 'Şifreyi değiştir' }));

    expect(api.changePassword).toHaveBeenCalledWith({ currentPassword: 'eski', newPassword: 'YeniSifre1' });
    expect(await screen.findByText('Mevcut şifre hatalı.')).toBeInTheDocument();
  });

  it('oturumları gösterir; bu cihaz kapatılamaz, diğeri kapatılır', async () => {
    api.revokeSession.mockResolvedValue(undefined);
    wrap(<SecurityTab />);
    const user = userEvent.setup();

    const list = await screen.findByRole('list', { name: 'Açık oturumlar' });
    const rows = within(list).getAllByRole('listitem');
    expect(within(rows[0]!).getByText('Bu cihaz')).toBeInTheDocument();
    expect(within(rows[0]!).queryByRole('button')).not.toBeInTheDocument();
    expect(within(rows[1]!).getByText('Apivator Masaüstü · macOS')).toBeInTheDocument();

    await user.click(within(rows[1]!).getByRole('button', { name: 'Oturumu kapat' }));
    expect(api.revokeSession).toHaveBeenCalledWith('s2');
    expect(screen.getByRole('button', { name: /Diğer tüm oturumlardan çık \(1\)/ })).toBeInTheDocument();
  });
});

describe('tercihler', () => {
  it('e-posta bildirimi kapatılınca hemen kaydedilir', async () => {
    api.updatePreferences.mockImplementation(async (p: PreferencesDto) => p);
    wrap(<PreferencesTab />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('checkbox', { name: /Merge istekleri/ }));

    expect(api.updatePreferences).toHaveBeenCalledWith({ ...preferences, emailMergeRequests: false });
    expect(await screen.findByText('Kaydedildi.')).toBeInTheDocument();
  });

  it('geçmişte yanıt saklama varsayılan kapalı; açılınca kaydedilir', async () => {
    api.updatePreferences.mockImplementation(async (p: PreferencesDto) => p);
    wrap(<PreferencesTab />);
    const user = userEvent.setup();

    const box = await screen.findByRole('checkbox', { name: /Yanıt gövdelerini geçmişte sakla/ });
    expect(box).not.toBeChecked();
    await user.click(box);

    expect(api.updatePreferences).toHaveBeenCalledWith({ ...preferences, saveHistoryResponses: true });
  });

  it('tema seçimi uygulanır ve kaydedilir', async () => {
    api.updatePreferences.mockImplementation(async (p: PreferencesDto) => p);
    wrap(<PreferencesTab />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('radio', { name: 'Koyu' }));

    expect(useUi.getState().theme).toBe('dark');
    expect(api.updatePreferences).toHaveBeenCalledWith({ ...preferences, theme: 'dark' });
    expect(screen.getByRole('radio', { name: 'Koyu' })).toHaveAttribute('aria-checked', 'true');
  });
});

describe('veriler ve hesap', () => {
  it('sahipliği devredilmemiş organizasyon varsa silme kapalıdır', async () => {
    api.deletionCheck.mockResolvedValue({
      mustTransfer: [{ id: 'o1', name: 'Acme', memberCount: 12 }],
      willDelete: [],
    });
    wrap(<DataTab />);

    const link = await screen.findByRole('link', { name: 'Acme' });
    expect(link).toHaveAttribute('href', '/team?org=o1');
    expect(screen.getByLabelText('Şifreniz')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Silme bağlantısını gönder' })).toBeDisabled();
  });

  it('şifre ve SİL onayıyla bağlantı gönderilir', async () => {
    api.requestDeletion.mockResolvedValue(undefined);
    wrap(<DataTab />);
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Şifreniz'), 'Sifre1234');
    const button = screen.getByRole('button', { name: 'Silme bağlantısını gönder' });
    expect(button).toBeDisabled();
    await user.type(screen.getByLabelText('Onaylamak için SİL yazın'), 'sil');
    await user.click(button);

    expect(api.requestDeletion).toHaveBeenCalledWith('Sifre1234');
    expect(await screen.findByText(/Onay bağlantısı e-posta adresinize gönderildi/)).toBeInTheDocument();
  });
});

describe('e-posta bağlantıları', () => {
  it('hesap silme bağlantısı açılınca hemen silmez, düğmeyle onay ister', async () => {
    api.confirmDeletion.mockResolvedValue(undefined);
    api.logout.mockResolvedValue(undefined);
    wrapRoute('/delete-account?userId=u1&token=tok', <DeleteAccountPage />);
    const user = userEvent.setup();

    const button = await screen.findByRole('button', { name: 'Hesabımı kalıcı olarak sil' });
    expect(api.confirmDeletion).not.toHaveBeenCalled();
    await user.click(button);

    expect(api.confirmDeletion).toHaveBeenCalledWith('u1', 'tok');
    expect(await screen.findByText('Hesabınız ve kişisel verileriniz silindi.')).toBeInTheDocument();
    expect(useSession.getState().status).toBe('anonymous');
  });

  it('e-posta değişikliği bağlantısı bir kez onaylanır ve oturumdaki adres güncellenir', async () => {
    api.confirmEmailChange.mockResolvedValue(undefined);
    wrapRoute(
      '/confirm-email-change?userId=u1&email=yeni%40example.com&token=tok',
      <ConfirmEmailChangePage />,
    );

    expect(await screen.findByText(/olarak değişti/)).toBeInTheDocument();
    expect(api.confirmEmailChange).toHaveBeenCalledOnce();
    expect(api.confirmEmailChange).toHaveBeenCalledWith('u1', 'yeni@example.com', 'tok');
    expect(useSession.getState().user?.email).toBe('yeni@example.com');
  });
});

describe('hesap menüsü', () => {
  it('profil görseli varsa onu, yoksa baş harfleri gösterir ve hesap ayarlarına götürür', async () => {
    useSession.setState({
      user: {
        id: 'u1',
        email: 'a@example.com',
        displayName: 'Ayşe Yılmaz',
        emailConfirmed: true,
        avatarVersion: 7,
      },
    });
    const { container } = wrap(<UserMenu />);
    expect(container.querySelector('img')).toHaveAttribute('src', '/api/users/u1/avatar?v=7');

    useSession.setState({
      user: { id: 'u1', email: 'a@example.com', displayName: 'Ayşe Yılmaz', emailConfirmed: true },
    });
    expect(await screen.findByText('AY')).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Hesap menüsü' }));
    expect(screen.getByRole('menuitem', { name: /Hesap ayarları/ })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /API anahtarları/ })).not.toBeInTheDocument();
  });
});

describe('iki adımlı doğrulama ve güvenlik geçmişi', () => {
  it('kurulum: QR ve anahtar gösterilir, kod doğrulanınca yedek kodlar bir kez çıkar', async () => {
    api.twoFactorSetup.mockResolvedValue({
      secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
      otpAuthUri:
        'otpauth://totp/Apivator:ayse%40example.com?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=Apivator',
    });
    api.twoFactorEnable
      .mockRejectedValueOnce(
        new ApiError(400, 'Kod hatalı.', 'validation', { code: ['Kod hatalı ya da süresi dolmuş.'] }),
      )
      .mockResolvedValueOnce({ codes: ['abcde-fghjk', 'mnpqr-stuvw'] });
    api.me.mockResolvedValue({
      id: 'u1',
      email: 'ayse@example.com',
      displayName: 'Ayşe',
      emailConfirmed: true,
      twoFactorEnabled: true,
    });
    wrap(<SecurityTab />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Kur' }));
    expect(await screen.findByRole('img', { name: 'Authenticator QR kodu' })).toBeInTheDocument();
    expect(screen.getByLabelText('Anahtar')).toHaveTextContent('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP');

    await user.type(screen.getByLabelText('Doğrulama kodu'), '111111');
    await user.click(screen.getByRole('button', { name: 'Doğrula ve aç' }));
    expect(await screen.findByText('Kod hatalı ya da süresi dolmuş.')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Doğrulama kodu'), '123456');
    await user.click(screen.getByRole('button', { name: 'Doğrula ve aç' }));
    const codes = await screen.findByRole('list', { name: 'Yedek kodlar' });
    expect(
      within(codes)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['abcde-fghjk', 'mnpqr-stuvw']);
    expect(api.twoFactorEnable).toHaveBeenLastCalledWith('123456');
    await waitFor(() => expect(useSession.getState().user?.twoFactorEnabled).toBe(true));

    // Kodlar kaydedildi onayı olmadan kapanmaz.
    expect(screen.getByRole('button', { name: 'Tamam' })).toBeDisabled();
    await user.click(screen.getByLabelText('Kodları güvenli bir yere kaydettim'));
    await user.click(screen.getByRole('button', { name: 'Tamam' }));
    expect(screen.queryByRole('list', { name: 'Yedek kodlar' })).not.toBeInTheDocument();
  });

  it('açıkken: organizasyon zorunlu kılıyorsa kapatılamaz; az yedek kod uyarısı; geçmiş listelenir', async () => {
    api.twoFactorStatus.mockResolvedValue({
      enabled: true,
      enabledAt: '2026-10-01T10:00:00Z',
      recoveryCodesLeft: 2,
      requiredBy: ['Güvenli A.Ş.'],
    });
    api.securityEvents.mockResolvedValue([
      {
        kind: 'LoginFailed',
        createdAt: new Date().toISOString(),
        device: 'Firefox · Linux',
        ipAddress: '10.0.0.5',
        actorName: null,
        detail: 'Şifre hatalı',
      },
      {
        kind: 'SessionsRevokedByAdmin',
        createdAt: new Date().toISOString(),
        device: null,
        ipAddress: null,
        actorName: 'Can',
        detail: 'Güvenli A.Ş.',
      },
    ]);
    wrap(<SecurityTab />);

    expect(await screen.findByText('Açık')).toBeInTheDocument();
    expect(screen.getByText(/2 yedek kod kaldı/)).toBeInTheDocument();
    expect(screen.getByText('Az yedek kodunuz kaldı. Yeni kodlar oluşturun.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Kapat' })).toBeDisabled();
    expect(
      screen.getByText(/Güvenli A.Ş. organizasyonu iki adımlı doğrulamayı zorunlu kılıyor; kapatılamaz/),
    ).toBeInTheDocument();

    const history = await screen.findByRole('list', { name: 'Güvenlik geçmişi' });
    expect(within(history).getByText('Başarısız giriş')).toBeInTheDocument();
    expect(within(history).getByText('Şifre hatalı · Firefox · Linux · 10.0.0.5')).toBeInTheDocument();
    expect(within(history).getByText('Can (Güvenli A.Ş.)')).toBeInTheDocument();
  });

  it('kapatma şifre ve kod ister', async () => {
    api.twoFactorStatus.mockResolvedValue({
      enabled: true,
      enabledAt: null,
      recoveryCodesLeft: 10,
      requiredBy: [],
    });
    api.twoFactorDisable.mockResolvedValue(undefined);
    api.me.mockResolvedValue({
      id: 'u1',
      email: 'ayse@example.com',
      displayName: 'Ayşe',
      emailConfirmed: true,
      twoFactorEnabled: false,
    });
    wrap(<SecurityTab />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Kapat' }));
    const dialog = screen.getByRole('dialog', { name: 'İki adımlı doğrulamayı kapat' });
    await user.type(within(dialog).getByLabelText('Şifre'), 'Sifre1234');
    await user.type(within(dialog).getByLabelText('Kod'), 'abcde-fghjk');
    await user.click(within(dialog).getByRole('button', { name: 'Doğrulamayı kapat' }));
    expect(api.twoFactorDisable).toHaveBeenCalledWith('Sifre1234', 'abcde-fghjk');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
