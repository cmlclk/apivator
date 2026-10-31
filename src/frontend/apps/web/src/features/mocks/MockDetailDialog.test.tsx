import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { MockServerDto } from '@apivator/core';
import { MockDetailDialog } from './MockDetailDialog';

const api = vi.hoisted(() => ({
  routes: vi.fn(),
  calls: vi.fn(),
  clearCalls: vi.fn(),
}));

vi.mock('../../lib/api', () => ({
  api: { mocks: { routes: api.routes, calls: api.calls, clearCalls: api.clearCalls } },
}));

const mock: MockServerDto = {
  id: 'm1',
  workspaceId: 'w1',
  collectionId: 'c1',
  collectionName: 'Kullanıcılar API',
  environmentId: null,
  name: 'Kullanıcı mock',
  key: 'abcdefghijkmnpqr',
  path: '/mock/abcdefghijkmnpqr',
  isPrivate: true,
  delayMs: 300,
  enabled: true,
  createdAt: '2026-10-21T10:00:00Z',
  updatedAt: '2026-10-21T10:00:00Z',
};

function setup(canEdit = true) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MockDetailDialog mock={mock} canEdit={canEdit} onClose={vi.fn()} />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

beforeEach(() => {
  vi.clearAllMocks();
  api.routes.mockResolvedValue([
    {
      exampleId: 'e1',
      requestId: 'r1',
      requestName: 'Kullanıcı getir',
      exampleName: 'Bulundu',
      method: 'GET',
      path: '/users/:id',
      status: 200,
    },
  ]);
  api.calls.mockResolvedValue([
    {
      id: 'k2',
      at: new Date().toISOString(),
      method: 'POST',
      path: '/orders',
      status: 404,
      exampleId: null,
      matchedName: null,
      error: 'Eşleşen örnek yok.',
      durationMs: 305,
      requestHeaders: [{ key: 'x-api-key', value: '•••', enabled: true }],
      requestBody: '{"a":1}',
    },
    {
      id: 'k1',
      at: new Date().toISOString(),
      method: 'GET',
      path: '/users/7',
      status: 200,
      exampleId: 'e1',
      matchedName: 'Kullanıcı getir / Bulundu',
      error: null,
      durationMs: 302,
      requestHeaders: [],
      requestBody: '',
    },
  ]);
  api.clearCalls.mockResolvedValue(undefined);
});

describe('MockDetailDialog', () => {
  it('adresi, gizlilik ve gecikmeyi, sunulan uç noktaları gösterir', async () => {
    setup();
    expect(screen.getByText(`${window.location.origin}/mock/abcdefghijkmnpqr`)).toBeInTheDocument();
    expect(screen.getByText('Gizli (API anahtarı ister)')).toBeInTheDocument();
    expect(screen.getByText('300 ms gecikme')).toBeInTheDocument();
    expect(await screen.findByText('/users/:id')).toBeInTheDocument();
    expect(screen.getByText('Kullanıcı getir / Bulundu')).toBeInTheDocument();
  });

  it('çağrıları eşleşmeyle ya da nedeniyle listeler, ayrıntıyı açar ve temizler', async () => {
    const user = setup();
    await user.click(screen.getByRole('tab', { name: /Çağrılar/ }));

    const list = await screen.findByRole('list');
    expect(within(list).getByText('Eşleşen örnek yok.')).toBeInTheDocument();
    expect(within(list).getByText('Kullanıcı getir / Bulundu')).toBeInTheDocument();

    await user.click(within(list).getByText('/orders'));
    expect(screen.getByText('•••')).toBeInTheDocument();
    expect(screen.getByText('{"a":1}')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Temizle/ }));
    expect(api.clearCalls).toHaveBeenCalledWith('m1');
  });

  it('görüntüleyici ayarları değiştiremez', () => {
    setup(false);
    expect(screen.queryByRole('button', { name: /Ayarlar/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Sil/ })).not.toBeInTheDocument();
  });

  it("kullanım sekmesi gizli mock için anahtar header'ını içeren komutu gösterir", async () => {
    const user = setup();
    await screen.findByText('/users/:id');
    await user.click(screen.getByRole('tab', { name: 'Kullanım' }));
    expect(
      screen.getAllByText(
        (_, el) => el?.tagName === 'PRE' && /x-api-key: \$APIVATOR_API_KEY/.test(el.textContent ?? ''),
      ).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText(/x-mock-response-code: 404/, { selector: 'code' })).toBeInTheDocument();
  });
});
