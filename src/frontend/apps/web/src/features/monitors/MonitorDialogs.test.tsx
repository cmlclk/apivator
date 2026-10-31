import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { MonitorDto, MonitorRunPointDto } from '@apivator/core';
import { MonitorDetailDialog } from './MonitorDetailDialog';
import { MonitorSettingsDialog } from './MonitorSettingsDialog';

const api = vi.hoisted(() => ({
  runs: vi.fn(),
  run: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  collections: vi.fn(),
  environments: vi.fn(),
}));

vi.mock('../../lib/api', () => ({
  api: {
    monitors: { runs: api.runs, run: api.run, create: api.create, update: api.update },
    collections: { list: api.collections },
    environments: { list: api.environments },
    runs: { get: vi.fn() },
  },
}));

const monitor: MonitorDto = {
  id: 'm1',
  workspaceId: 'w1',
  collectionId: 'c1',
  collectionName: 'Sağlık',
  environmentId: null,
  name: 'Canlı sağlık',
  schedule: '*/15 * * * *',
  timeZone: 'Europe/Istanbul',
  enabled: true,
  notifyEmails: [],
  webhookUrl: null,
  webhookKind: 'Slack',
  notifyMode: 'Changes',
  createdById: 'u1',
  createdByName: 'Ayşe',
  nextRunAt: '2026-10-21T12:00:00Z',
  lastRunAt: '2026-10-21T11:45:00Z',
  lastRunId: 'r2',
  health: 'Failing',
  consecutiveFailures: 1,
  lastError: null,
  createdAt: '2026-10-20T10:00:00Z',
};

const point = (id: string, healthy: boolean, ms: number): MonitorRunPointDto => ({
  id,
  startedAt: '2026-10-21T11:00:00Z',
  finishedAt: '2026-10-21T11:00:01Z',
  origin: 'Monitor',
  status: 'Completed',
  healthy,
  totalRequests: 2,
  requestErrors: 0,
  testsPassed: healthy ? 2 : 1,
  testsFailed: healthy ? 0 : 1,
  totalTimeMs: ms,
});

function renderWithQuery(ui: React.ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  api.runs.mockResolvedValue([point('r1', true, 200), point('r2', false, 600)]);
  api.run.mockResolvedValue(point('r3', true, 100));
  api.collections.mockResolvedValue([{ id: 'c1', name: 'Sağlık' }]);
  api.environments.mockResolvedValue([{ id: 'e1', name: 'Canlı' }]);
});

describe('MonitorDetailDialog', () => {
  it('durumu, başarı oranını ve grafiği gösterir; tablo görünümüne geçer', async () => {
    const user = userEvent.setup();
    renderWithQuery(<MonitorDetailDialog monitor={monitor} canEdit onClose={vi.fn()} />);

    expect(screen.getByText('Başarısız')).toBeInTheDocument();
    expect(screen.getByText('Her 15 dakikada bir (Europe/Istanbul)')).toBeInTheDocument();
    expect(await screen.findByText('%50')).toBeInTheDocument();
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
    expect(screen.getByText('200 ms')).toBeInTheDocument(); // (200 + 600) / 4 istek
    expect(screen.getAllByRole('img', { name: /başarısız/ })).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Tablo' }));
    expect(screen.getAllByRole('row')).toHaveLength(3);
  });

  it('dönem değişince geçmişi yeniden ister ve elle çalıştırır', async () => {
    const user = userEvent.setup();
    renderWithQuery(<MonitorDetailDialog monitor={monitor} canEdit onClose={vi.fn()} />);
    await screen.findByText('%50');

    await user.click(screen.getByRole('button', { name: '30 gün' }));
    expect(api.runs).toHaveBeenLastCalledWith('m1', 30);

    await user.click(screen.getByRole('button', { name: /Şimdi çalıştır/ }));
    expect(api.run).toHaveBeenCalledWith('m1');
  });

  it('görüntüleyici çalıştıramaz ve ayar değiştiremez', async () => {
    renderWithQuery(<MonitorDetailDialog monitor={monitor} canEdit={false} onClose={vi.fn()} />);
    await screen.findByText('%50');
    expect(screen.queryByRole('button', { name: /Şimdi çalıştır/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ayarlar/ })).not.toBeInTheDocument();
  });
});

describe('MonitorSettingsDialog', () => {
  it('hazır zamanlama, e-posta listesi ve webhook ile monitör oluşturur', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    api.create.mockResolvedValue(monitor);
    renderWithQuery(
      <MonitorSettingsDialog workspaceId="w1" collectionId="c1" onSaved={onSaved} onClose={vi.fn()} />,
    );
    await screen.findByRole('option', { name: 'Canlı' });

    await user.selectOptions(screen.getByLabelText('Environment'), 'e1');
    await user.selectOptions(screen.getByLabelText('Ne sıklıkla'), '0 9 * * 1-5');
    await user.clear(screen.getByLabelText('Saat dilimi'));
    await user.type(screen.getByLabelText('Saat dilimi'), 'Europe/Istanbul');
    await user.type(screen.getByLabelText('E-posta'), 'a@ornek.com, b@ornek.com');
    await user.type(screen.getByLabelText('Webhook (isteğe bağlı)'), 'https://hooks.slack.com/x');
    await user.click(screen.getByRole('button', { name: 'Oluştur' }));

    expect(api.create).toHaveBeenCalledWith('w1', 'c1', {
      name: 'Sağlık',
      environmentId: 'e1',
      schedule: '0 9 * * 1-5',
      timeZone: 'Europe/Istanbul',
      notifyEmails: ['a@ornek.com', 'b@ornek.com'],
      webhookUrl: 'https://hooks.slack.com/x',
      webhookKind: 'Slack',
      notifyMode: 'Changes',
      enabled: true,
    });
    expect(onSaved).toHaveBeenCalledWith(monitor);
  });

  it('özel cron ifadesini okunur gösterir', async () => {
    const user = userEvent.setup();
    renderWithQuery(<MonitorSettingsDialog workspaceId="w1" onSaved={vi.fn()} onClose={vi.fn()} />);
    await user.selectOptions(screen.getByLabelText('Ne sıklıkla'), 'custom');
    await user.clear(screen.getByLabelText('Cron ifadesi'));
    await user.type(screen.getByLabelText('Cron ifadesi'), '30 8 * * *');
    expect(screen.getByText(/Her gün 08:30/)).toBeInTheDocument();
  });
});
