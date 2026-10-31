import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import {
  ApiError,
  type CollectionSourceDto,
  type CollectionTreeDto,
  type SourceDiffDto,
} from '@apivator/core';
import { ImportDialog } from './ImportDialog';
import { SourceDialog } from './SourceDialog';
import { accessHeaders } from './access';

const api = vi.hoisted(() => ({
  local: false,
  importExport: { importFromUrl: vi.fn(), importPostman: vi.fn() },
  sources: { get: vi.fn(), schedule: vi.fn(), disconnect: vi.fn(), preview: vi.fn(), apply: vi.fn() },
  requests: { get: vi.fn() },
}));
vi.mock('../../lib/api', () => ({ api }));

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

const source: CollectionSourceDto = {
  url: 'https://api.ornek.test/swagger/v1/swagger.json',
  local: false,
  version: '1.0',
  importedAt: '2026-10-20T10:00:00Z',
  updatedAt: '2026-10-20T10:00:00Z',
  checkIntervalHours: null,
  lastCheckedAt: null,
  lastCheckError: null,
  changeDetectedAt: '2026-10-23T09:00:00Z',
};

const collection = {
  id: 'c1',
  workspaceId: 'w1',
  name: 'Evcil Hayvan API',
  source: { url: source.url, changeDetected: true },
} as CollectionTreeDto;

const diff: SourceDiffDto = {
  hash: 'h2',
  url: source.url,
  fromVersion: '1.0',
  toVersion: '2.0',
  added: [
    {
      key: 'PUT /pets/{petId}',
      method: 'PUT',
      path: '/pets/{petId}',
      name: 'Hayvan güncelle',
      folder: 'pets',
      requestId: null,
      fields: [],
      notes: [],
    },
  ],
  changed: [
    {
      key: 'POST /pets',
      method: 'POST',
      path: '/pets',
      name: 'Hayvan ekle',
      folder: 'pets',
      requestId: 'r2',
      fields: ['Gövde'],
      notes: ['Gövde yerelde değiştirilmiş; uygulanırsa belgedeki örnekle değişir.'],
    },
  ],
  removed: [
    {
      key: 'DELETE /pets/{petId}',
      method: 'DELETE',
      path: '/pets/{petId}',
      name: 'Hayvan sil',
      folder: 'pets',
      requestId: 'r3',
      fields: [],
      notes: [],
    },
  ],
  newVariables: ['storeId'],
  warnings: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  api.local = false;
});

describe('adresten içe aktarma', () => {
  it('sürüm seçtirir, seçileni içe aktarır ve erişim header’larını gönderir', async () => {
    api.importExport.importFromUrl
      .mockResolvedValueOnce({
        result: null,
        choices: [
          { name: 'Siparişler V1', url: 'https://x.test/swagger/v1/swagger.json' },
          { name: 'Siparişler V2', url: 'https://x.test/swagger/v2/swagger.json' },
        ],
      })
      .mockResolvedValueOnce({
        result: {
          kind: 'collection',
          id: 'c9',
          name: 'Siparişler',
          folders: 2,
          requests: 8,
          variables: 3,
          examples: 1,
          warnings: [],
        },
        choices: null,
      });
    const user = userEvent.setup();
    wrap(<ImportDialog workspaceId="w1" onClose={vi.fn()} />);

    await user.click(screen.getByRole('tab', { name: 'Adres (Swagger)' }));
    expect(screen.getByText(/localhost ve iç ağdaki servisler için masaüstü/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Adres'), 'https://x.test/swagger');
    await user.click(screen.getByText('Erişim'));
    await user.type(screen.getByLabelText('Bearer token'), 'gizli');
    await user.click(screen.getByRole('button', { name: 'İçe aktar' }));

    expect(api.importExport.importFromUrl).toHaveBeenCalledWith('w1', 'https://x.test/swagger', [
      { key: 'Authorization', value: 'Bearer gizli', enabled: true },
    ]);
    const choices = await screen.findByRole('group', { name: 'Bu adreste 2 belge var; birini seçin' });
    await user.click(within(choices).getByLabelText(/Siparişler V2/));
    await user.click(screen.getByRole('button', { name: 'Bu belgeyi içe aktar' }));

    expect(api.importExport.importFromUrl).toHaveBeenLastCalledWith(
      'w1',
      'https://x.test/swagger/v2/swagger.json',
      expect.any(Array),
    );
    expect(await screen.findByText('Collection “Siparişler” eklendi')).toBeInTheDocument();
    expect(screen.getByText('2 klasör, 8 istek, 3 değişken, 1 örnek yanıt')).toBeInTheDocument();
  });

  it('hata pencerede kalır, adres korunur', async () => {
    api.importExport.importFromUrl.mockRejectedValueOnce(
      new ApiError(400, 'Bu adreste OpenAPI/Swagger belgesi bulunamadı.', 'spec.not_found'),
    );
    api.local = true;
    const user = userEvent.setup();
    wrap(<ImportDialog workspaceId="w1" onClose={vi.fn()} />);
    await user.click(screen.getByRole('tab', { name: 'Adres (Swagger)' }));
    expect(screen.getByText(/Belge bu bilgisayardan çekilir/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Adres'), 'localhost:5000');
    await user.click(screen.getByRole('button', { name: 'İçe aktar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('belgesi bulunamadı');
    expect(screen.getByLabelText('Adres')).toHaveValue('localhost:5000');
  });

  it('erişim bilgisinden header listesi', () => {
    expect(
      accessHeaders({
        token: 'Basic abc',
        headers: [
          { key: ' X-Key ', value: '1' },
          { key: '', value: 'x' },
        ],
      }),
    ).toEqual([
      { key: 'Authorization', value: 'Basic abc', enabled: true },
      { key: 'X-Key', value: '1', enabled: true },
    ]);
  });
});

describe('kaynaktan güncelleme', () => {
  it('farkı gösterir; silmeler seçili gelmez; seçilenler uygulanır', async () => {
    api.sources.get.mockResolvedValue(source);
    api.sources.preview.mockResolvedValue(diff);
    api.sources.apply.mockResolvedValue({
      added: 1,
      updated: 0,
      removed: 1,
      variables: 1,
      source: { ...source, version: '2.0' },
    });
    const user = userEvent.setup();
    wrap(<SourceDialog collection={collection} canEdit onClose={vi.fn()} />);

    expect(await screen.findByText(source.url)).toBeInTheDocument();
    expect(screen.getByText(/Otomatik kontrol kaynak belgede değişiklik buldu/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Değişiklikleri getir' }));
    expect(api.sources.preview).toHaveBeenCalledWith('c1', source.url, []);

    expect(await screen.findByText(/Sürüm 1.0 → 2.0/)).toBeInTheDocument();
    expect(screen.getByText('storeId')).toBeInTheDocument();
    expect(screen.getByText(/Gövde yerelde değiştirilmiş/)).toBeInTheDocument();
    expect(screen.getByLabelText('PUT /pets/{petId}')).toBeChecked();
    expect(screen.getByLabelText('POST /pets')).toBeChecked();
    expect(screen.getByLabelText('DELETE /pets/{petId}')).not.toBeChecked();

    // Değişeni bırak, silmeyi seç.
    await user.click(screen.getByLabelText('POST /pets'));
    await user.click(screen.getByLabelText('DELETE /pets/{petId}'));
    await user.click(screen.getByRole('button', { name: 'Seçilenleri uygula (2)' }));

    expect(api.sources.apply).toHaveBeenCalledWith('c1', 'h2', ['PUT /pets/{petId}', 'DELETE /pets/{petId}']);
    expect(await screen.findByText('1 uç eklendi, 1 uç silindi, 1 değişken eklendi.')).toBeInTheDocument();
  });

  it('otomatik kontrol aralığını kaydeder; düzenleyici değilse güncelleyemez', async () => {
    api.sources.get.mockResolvedValue({ ...source, changeDetectedAt: null });
    api.sources.schedule.mockResolvedValue({ ...source, checkIntervalHours: 6, changeDetectedAt: null });
    const user = userEvent.setup();
    const { unmount } = wrap(<SourceDialog collection={collection} canEdit onClose={vi.fn()} />);

    await user.selectOptions(await screen.findByRole('combobox'), '6');
    await waitFor(() => expect(api.sources.schedule).toHaveBeenCalledWith('c1', 6));
    unmount();

    wrap(<SourceDialog collection={collection} canEdit={false} onClose={vi.fn()} />);
    expect(await screen.findByText(source.url)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Değişiklikleri getir' })).toBeDisabled();
    expect(screen.getByText(/düzenleyici olmalısınız/)).toBeInTheDocument();
  });
});
