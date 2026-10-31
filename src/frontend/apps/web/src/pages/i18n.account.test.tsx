import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { ProfileDto } from '@apivator/core';
import { initI18n, setLanguage } from '../i18n';
import { AccountPage } from '../features/account/AccountPage';
import { LoginPage } from './auth/LoginPage';

const api = vi.hoisted(() => ({ profile: vi.fn() }));

vi.mock('../lib/api', () => ({
  api: {
    account: { profile: api.profile },
    auth: { ssoDiscover: vi.fn() },
  },
}));

const profile: ProfileDto = {
  id: 'u1',
  email: 'ayse@example.com',
  displayName: 'Ayse',
  emailConfirmed: true,
  pendingEmail: null,
  createdAt: '2026-01-15T10:00:00Z',
  avatarVersion: null,
  organizations: [],
};

const TURKISH = /[ğüşıöçĞÜŞİÖÇ]/;

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('English UI for auth and account', () => {
  beforeEach(async () => {
    api.profile.mockResolvedValue(profile);
    await setLanguage('en');
  });

  afterEach(() => initI18n('tr'));

  it('renders the login page in English', () => {
    const { container } = renderWithClient(<LoginPage />);
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByText('Forgot password')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign up' })).toBeInTheDocument();
    // Dil seçicideki "Türkçe" dilin kendi adıdır; geri kalan metinde Türkçe kalmamalı.
    expect(container.textContent?.replace('Türkçe', '')).not.toMatch(TURKISH);
  });

  it('renders the account page in English', async () => {
    const { container } = renderWithClient(<AccountPage />);
    expect(screen.getByRole('heading', { name: 'Account settings' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Security' })).toBeInTheDocument();
    expect(await screen.findByText('Member since: January 15, 2026')).toBeInTheDocument();
    expect(screen.getByText('verified')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(TURKISH);
  });
});
