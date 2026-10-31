import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { MockServerDto, MonitorDto } from '@apivator/core';
import { initI18n, setLanguage } from '../../i18n';
import { MockDetailDialog } from '../mocks/MockDetailDialog';
import { MockSettingsDialog } from '../mocks/MockSettingsDialog';
import { streamingLabel } from '../grpc/grpcDefinitions';
import { MonitorDetailDialog } from './MonitorDetailDialog';
import { MonitorSettingsDialog } from './MonitorSettingsDialog';

const mocks = vi.hoisted(() => ({
  runs: vi.fn(),
  routes: vi.fn(),
  calls: vi.fn(),
  collections: vi.fn(),
  environments: vi.fn(),
}));

vi.mock('../../lib/api', () => ({
  api: {
    monitors: { runs: mocks.runs },
    mocks: { routes: mocks.routes, calls: mocks.calls },
    collections: { list: mocks.collections },
    environments: { list: mocks.environments },
    runs: { get: vi.fn() },
  },
}));

const monitor = {
  id: 'm1',
  workspaceId: 'w1',
  collectionId: 'c1',
  collectionName: 'Health',
  environmentId: null,
  name: 'Live health',
  schedule: '*/15 * * * *',
  timeZone: 'Europe/Istanbul',
  enabled: true,
  notifyEmails: [],
  webhookUrl: null,
  webhookKind: 'Slack',
  notifyMode: 'Changes',
  createdById: 'u1',
  createdByName: 'Ada',
  nextRunAt: null,
  lastRunAt: null,
  lastRunId: null,
  health: 'Failing',
  consecutiveFailures: 1,
  lastError: null,
  createdAt: '2026-10-20T10:00:00Z',
} as MonitorDto;

const mock = {
  id: 'k1',
  workspaceId: 'w1',
  collectionId: 'c1',
  collectionName: 'Shop',
  environmentId: null,
  name: 'Shop mock',
  path: '/mock/abc',
  isPrivate: true,
  delayMs: 300,
  enabled: true,
} as unknown as MockServerDto;

function renderWithQuery(ui: React.ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

beforeEach(async () => {
  mocks.runs.mockResolvedValue([]);
  mocks.routes.mockResolvedValue([]);
  mocks.calls.mockResolvedValue([]);
  mocks.collections.mockResolvedValue([{ id: 'c1', name: 'Shop' }]);
  mocks.environments.mockResolvedValue([]);
  await setLanguage('en');
});
afterEach(() => initI18n('tr'));

describe('monitors / mocks / grpc in English', () => {
  it('renders the monitor detail dialog in English', async () => {
    renderWithQuery(<MonitorDetailDialog monitor={monitor} canEdit onClose={vi.fn()} />);
    expect(screen.getByText('Monitor: Live health')).toBeInTheDocument();
    expect(screen.getByText('Failing')).toBeInTheDocument();
    expect(screen.getByText('Runs as Ada')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Run now/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '30 days' })).toBeInTheDocument();
    expect(await screen.findByText(/No runs in this period/)).toBeInTheDocument();
    expect(screen.queryByText(/Şimdi|Ayarlar|gün|Başarısız/)).not.toBeInTheDocument();
  });

  it('renders the monitor settings dialog in English', async () => {
    renderWithQuery(<MonitorSettingsDialog workspaceId="w1" onSaved={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('New monitor')).toBeInTheDocument();
    expect(screen.getByLabelText('How often')).toBeInTheDocument();
    expect(screen.getByLabelText('Time zone')).toBeInTheDocument();
    expect(screen.getByText('Notifications')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument();
    expect(screen.queryByText(/Yeni monitör|Bildirimler|Oluştur|Vazgeç/)).not.toBeInTheDocument();
  });

  it('renders the mock dialogs in English', async () => {
    renderWithQuery(<MockDetailDialog mock={mock} canEdit onClose={vi.fn()} />);
    expect(screen.getByText('Mock: Shop mock')).toBeInTheDocument();
    expect(screen.getByText('Private (requires API key)')).toBeInTheDocument();
    expect(screen.getByText('300 ms delay')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Endpoints' })).toBeInTheDocument();
    expect(await screen.findByText(/has no example responses yet/)).toBeInTheDocument();
    expect(screen.queryByText(/Gizli|gecikme|Uç noktalar|Ayarlar/)).not.toBeInTheDocument();
  });

  it('renders the mock settings dialog in English', () => {
    renderWithQuery(<MockSettingsDialog workspaceId="w1" onSaved={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('New mock')).toBeInTheDocument();
    expect(screen.getByLabelText('Delay (ms)')).toBeInTheDocument();
    expect(screen.getByText('Private')).toBeInTheDocument();
    expect(screen.queryByText(/Yeni mock|Gecikme|Gizli/)).not.toBeInTheDocument();
  });

  it('translates exported label helpers at call time', () => {
    expect(
      streamingLabel({ clientStreaming: true, serverStreaming: true } as Parameters<
        typeof streamingLabel
      >[0]),
    ).toBe('Bidirectional streaming');
  });
});
