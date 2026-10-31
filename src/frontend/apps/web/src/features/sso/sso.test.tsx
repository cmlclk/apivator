import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { OrganizationDto, SsoSettingsDto } from '@apivator/core';
import { SsoTab } from './SsoTab';

const sso = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
  setState: vi.fn(),
  addDomain: vi.fn(),
  verifyDomain: vi.fn(),
  removeDomain: vi.fn(),
}));

vi.mock('../../lib/api', () => ({ api: { organizations: { sso } } }));

const owner: OrganizationDto = {
  id: 'org-1',
  name: 'Ekip',
  isPersonal: false,
  role: 'Owner',
  memberCount: 3,
};

function settings(overrides: Partial<SsoSettingsDto> = {}): SsoSettingsDto {
  return {
    configured: false,
    enabled: false,
    enforced: false,
    authority: null,
    clientId: null,
    hasClientSecret: false,
    autoProvision: true,
    defaultRole: 'Member',
    redirectUri: 'https://app.firma.com/api/auth/sso/callback',
    domains: [],
    ...overrides,
  };
}

const pendingDomain = {
  id: 'd1',
  domain: 'firma.com',
  verified: false,
  verifiedAt: null,
  recordName: '_apivator.firma.com',
  recordValue: 'apivator-verify=abc',
};

function renderTab(organization = owner) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SsoTab organization={organization} />
    </QueryClientProvider>,
  );
}

describe('SsoTab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the redirect URI and provider hints', async () => {
    sso.get.mockResolvedValue(settings());
    renderTab();
    expect(await screen.findByLabelText('Redirect URI')).toHaveTextContent(
      'https://app.firma.com/api/auth/sso/callback',
    );
    expect(screen.getByText(/login\.microsoftonline\.com/)).toBeInTheDocument();
    expect(screen.getByText('https://accounts.google.com')).toBeInTheDocument();
  });

  it('saves the connection and keeps the stored secret when left empty', async () => {
    sso.get.mockResolvedValue(
      settings({ configured: true, authority: 'https://idp', clientId: 'c1', hasClientSecret: true }),
    );
    sso.update.mockResolvedValue(
      settings({ configured: true, authority: 'https://idp2', clientId: 'c1', hasClientSecret: true }),
    );
    renderTab();

    const authority = await screen.findByLabelText('Issuer (Authority)');
    expect(screen.getByLabelText('Client secret')).toHaveAttribute('placeholder', '••• kayıtlı');
    await userEvent.clear(authority);
    await userEvent.type(authority, 'https://idp2');
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));

    await waitFor(() =>
      expect(sso.update).toHaveBeenCalledWith('org-1', {
        authority: 'https://idp2',
        clientId: 'c1',
        clientSecret: null,
        autoProvision: true,
        defaultRole: 'Member',
      }),
    );
    expect(await screen.findByText('Bağlantı bilgileri kaydedildi.')).toBeInTheDocument();
  });

  it('adds and verifies a domain, showing the TXT record', async () => {
    sso.get.mockResolvedValue(settings({ domains: [pendingDomain] }));
    sso.addDomain.mockResolvedValue(settings({ domains: [pendingDomain] }));
    sso.verifyDomain.mockResolvedValue(settings({ domains: [{ ...pendingDomain, verified: true }] }));
    renderTab();

    expect(await screen.findByText('_apivator.firma.com')).toBeInTheDocument();
    expect(screen.getByText('apivator-verify=abc')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Alan adı'), 'baska.com');
    await userEvent.click(screen.getByRole('button', { name: 'Ekle' }));
    await waitFor(() => expect(sso.addDomain).toHaveBeenCalledWith('org-1', 'baska.com'));

    await userEvent.click(screen.getByRole('button', { name: 'Doğrula' }));
    await waitFor(() => expect(sso.verifyDomain).toHaveBeenCalledWith('org-1', 'd1'));
    expect(await screen.findByText('Doğrulandı')).toBeInTheDocument();
  });

  it('disables the toggles until a domain is verified', async () => {
    sso.get.mockResolvedValue(settings({ configured: true, domains: [pendingDomain] }));
    renderTab();
    expect(await screen.findByLabelText(/SSO'yu aç/)).toBeDisabled();
    expect(screen.getByLabelText(/SSO zorunlu/)).toBeDisabled();
  });

  it('enables SSO once a domain is verified', async () => {
    const verified = settings({ configured: true, domains: [{ ...pendingDomain, verified: true }] });
    sso.get.mockResolvedValue(verified);
    sso.setState.mockResolvedValue({ ...verified, enabled: true });
    renderTab();
    await userEvent.click(await screen.findByLabelText(/SSO'yu aç/));
    await waitFor(() =>
      expect(sso.setState).toHaveBeenCalledWith('org-1', { enabled: true, enforced: false }),
    );
    await waitFor(() => expect(screen.getByLabelText(/SSO zorunlu/)).toBeEnabled());
  });

  it('is read-only for admins who are not the owner', async () => {
    sso.get.mockResolvedValue(
      settings({ configured: true, authority: 'https://idp', clientId: 'c1', domains: [pendingDomain] }),
    );
    renderTab({ ...owner, role: 'Admin' });
    expect(await screen.findByText(/yalnızca organizasyon sahibi/)).toBeInTheDocument();
    expect(screen.getByLabelText('Issuer (Authority)')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Kaydet' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Doğrula' })).toBeNull();
    expect(screen.queryByLabelText('Alan adı')).toBeNull();
  });
});
