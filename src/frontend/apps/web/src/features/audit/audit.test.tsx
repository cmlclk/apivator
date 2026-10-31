import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AuditEntryDto, AuditPageDto, OrganizationDto } from '@apivator/core';
import { AuditTab } from './AuditTab';

const api = vi.hoisted(() => ({ audit: vi.fn(), exportAudit: vi.fn(), saveFile: vi.fn() }));

vi.mock('../../lib/api', () => ({
  api: { organizations: { audit: api.audit, exportAudit: api.exportAudit } },
}));
vi.mock('../../lib/download', () => ({ saveFile: api.saveFile }));

const organization: OrganizationDto = {
  id: 'org-1',
  name: 'Ekip',
  isPersonal: false,
  role: 'Owner',
  memberCount: 3,
};

function entry(overrides: Partial<AuditEntryDto>): AuditEntryDto {
  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    action: 'member.role_changed',
    actorId: 'u1',
    actorName: 'Ayşe',
    actorEmail: 'ayse@firma.com',
    viaApiKey: false,
    ipAddress: '10.0.0.5',
    device: 'Chrome · Windows',
    targetType: 'member',
    targetId: 'u2',
    targetName: 'Bora',
    workspaceId: null,
    workspaceName: null,
    data: { from: 'Member', to: 'Admin' },
    ...overrides,
  };
}

function page(items: AuditEntryDto[], nextCursor: string | null = null): AuditPageDto {
  return { items, nextCursor, retentionDays: 365 };
}

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuditTab organization={organization} />
    </QueryClientProvider>,
  );
}

describe('AuditTab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists entries in Turkish, expands details and loads older pages', async () => {
    api.audit
      .mockResolvedValueOnce(page([entry({})], 'next-1'))
      .mockResolvedValueOnce(page([entry({ action: 'team.created', targetName: 'Backend', data: {} })]));
    renderTab();

    expect(await screen.findByText('üyenin rolünü değiştirdi')).toBeInTheDocument();
    expect(screen.getByText(/365 gün saklanır/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Ayşe üyenin rolünü değiştirdi/ }));
    expect(screen.getByText('Önce')).toBeInTheDocument();
    expect(screen.getByText('Admin')).toBeInTheDocument();
    expect(screen.getByText('Ayşe (ayse@firma.com)')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Daha eski kayıtlar' }));
    expect(await screen.findByText('takım oluşturdu')).toBeInTheDocument();
    expect(api.audit).toHaveBeenLastCalledWith('org-1', expect.anything(), 'next-1');
  });

  it('filters by category and search, and exports with the same filter', async () => {
    api.audit.mockResolvedValue(page([]));
    api.exportAudit.mockResolvedValue({ blob: new Blob(['x']), fileName: 'denetim.csv' });
    renderTab();
    expect(await screen.findByText('Bu filtreye uyan kayıt yok.')).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Olay türü'), 'api_key');
    await userEvent.type(screen.getByLabelText('Kişi ya da hedef ara'), 'deniz{Enter}');
    await waitFor(() =>
      expect(api.audit).toHaveBeenLastCalledWith(
        'org-1',
        expect.objectContaining({ action: 'api_key', q: 'deniz' }),
        undefined,
      ),
    );

    await userEvent.click(screen.getByRole('button', { name: /CSV/ }));
    await waitFor(() =>
      expect(api.saveFile).toHaveBeenCalledWith({ blob: expect.any(Blob), fileName: 'denetim.csv' }),
    );
    expect(api.exportAudit).toHaveBeenCalledWith(
      'org-1',
      'csv',
      expect.objectContaining({ action: 'api_key', q: 'deniz' }),
    );
  });
});
