import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import type { AuthResult, WorkspaceDto } from '@apivator/core';
import { initI18n, setLanguage } from '../i18n';
import { resetPreferenceSync } from '../features/account/preferences';
import { WORKSPACE_ROLE_LABELS } from '../lib/teams';
import { useSession } from '../stores/session';
import { useUi } from '../stores/ui';
import { renderApp } from '../test/renderWithRouter';

const mocks = vi.hoisted(() => ({ refreshSession: vi.fn() }));

// Canlı kanal bu testin konusu değil; jsdom'da gerçek bağlantı denenmez.
vi.mock('./RealtimeBridge', () => ({ RealtimeBridge: () => null }));

vi.mock('../lib/api', () => ({
  api: {
    refreshSession: mocks.refreshSession,
    auth: { logout: vi.fn(), resendConfirmation: vi.fn() },
    workspaces: { list: vi.fn().mockResolvedValue([]) },
    collections: { list: vi.fn().mockResolvedValue([]) },
    environments: { list: vi.fn().mockResolvedValue([]) },
    invitations: { mine: vi.fn().mockResolvedValue([]) },
    notifications: { list: vi.fn().mockResolvedValue({ items: [], unread: 0 }), markRead: vi.fn() },
    globals: { get: vi.fn().mockResolvedValue({ workspaceId: 'w1', variables: [] }) },
    account: {
      preferences: vi.fn().mockResolvedValue({
        theme: 'system',
        defaultWorkspaceId: null,
        emailMentions: true,
        emailMergeRequests: true,
        emailMonitorAlerts: true,
      }),
      updatePreferences: vi.fn(),
    },
  },
}));

const session: AuthResult = {
  accessToken: 'token',
  accessTokenExpiresAt: '2026-10-20T10:00:00Z',
  refreshToken: 'rt',
  refreshTokenExpiresAt: '2026-11-03T10:00:00Z',
  user: { id: 'u1', email: 'ada@example.com', displayName: 'Ada Lovelace', emailConfirmed: false },
};

const personal: WorkspaceDto = {
  id: 'w1',
  name: 'My Workspace',
  type: 'Personal',
  role: 'Admin',
  organizationId: 'o1',
  organizationName: 'Ada Lovelace',
};

beforeEach(async () => {
  resetPreferenceSync();
  useUi.setState({ theme: 'system', currentWorkspaceId: null });
  useSession.setState({ status: 'loading', accessToken: null, user: null });
  const { api } = await import('../lib/api');
  vi.mocked(api.workspaces.list).mockResolvedValue([personal]);
  mocks.refreshSession.mockImplementation(async () => {
    useSession.getState().setSession(session);
    return session;
  });
  await setLanguage('en');
});

afterEach(() => initI18n('tr'));

describe('uygulama kabuğu (İngilizce)', () => {
  it('kenar çubuğu, başlık çubuğu ve banner İngilizce gelir', async () => {
    renderApp('/');

    expect(await screen.findByRole('heading', { name: 'My Workspace' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Sections' })).toBeInTheDocument();
    for (const label of [
      'Collections',
      'Environments',
      'Mocks',
      'Monitors',
      'Merges',
      'History',
      'Activity',
    ]) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole('link', { name: 'Tools' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Account menu' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Apivator home' })).toBeInTheDocument();
    expect(screen.getByText(/has not been verified yet/)).toBeInTheDocument();

    const text = document.body.textContent ?? '';
    for (const turkish of ['Geçmiş', 'Araçlar', 'Aktivite', 'Monitörler', 'doğrulanmadı', 'Bildirimler']) {
      expect(text).not.toContain(turkish);
    }
  });

  it('dışa açık rol etiketleri etkin dilde çevrilir', () => {
    expect(WORKSPACE_ROLE_LABELS.Editor).toBe('Editor');
    expect(WORKSPACE_ROLE_LABELS.Viewer).toBe('Viewer');
  });
});
