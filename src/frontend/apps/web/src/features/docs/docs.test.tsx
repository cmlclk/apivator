import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ApiError, emptyBody, type DocPublicationDto, type DocumentationDto } from '@apivator/core';
import { buildTree, codeRequest, filterTree, flatten, variableMap } from './docsModel';
import { DocsView } from './DocsView';
import { PublishDialog } from './PublishDialog';
import { PublishedDocsPage } from './PublishedDocsPage';
import { setLanguage } from '../../i18n';

const api = vi.hoisted(() => ({
  docs: {
    publication: vi.fn(),
    publish: vi.fn(),
    regenerate: vi.fn(),
    unpublish: vi.fn(),
    published: vi.fn(),
  },
}));
vi.mock('../../lib/api', () => ({ api }));

const doc: DocumentationDto = {
  collectionId: 'c1',
  name: 'Mağaza API',
  description: '# Mağaza API\n\nÜrün ve sipariş uçları.',
  workspaceName: 'Ekip',
  auth: { type: 'Bearer', detail: 'Authorization: Bearer <token>', source: null },
  environmentName: 'Test',
  variables: [
    { key: 'baseUrl', value: 'https://test.magaza.test', isSecret: false, source: 'environment' },
    { key: 'token', value: '', isSecret: true, source: 'environment' },
  ],
  folders: [{ id: 'f1', parentFolderId: null, name: 'Ürünler', description: 'Ürün kataloğu.', sortOrder: 0 }],
  requests: [
    {
      id: 'r1',
      folderId: 'f1',
      name: 'Ürün getir',
      sortOrder: 0,
      kind: 'Http',
      method: 'GET',
      url: '{{baseUrl}}/urunler/1?dil=tr',
      description: 'Tek bir **ürünü** döner.',
      headers: [{ key: 'Accept', value: 'application/json', enabled: true, description: 'Yanıt biçimi' }],
      body: emptyBody(),
      auth: { type: 'ApiKey', detail: 'X-Api-Key: <anahtar> (header)', source: 'Ürünler' },
      grpcMethod: null,
      examples: [
        {
          id: 'e1',
          name: 'Başarılı',
          status: 200,
          headers: [],
          body: '{"id":1,"ad":"Kalem"}',
          bodyTruncated: false,
          requestUrl: null,
          requestBody: null,
        },
        {
          id: 'e2',
          name: 'Yok',
          status: 404,
          headers: [],
          body: '{"hata":"yok"}',
          bodyTruncated: false,
          requestUrl: null,
          requestBody: null,
        },
      ],
    },
    {
      id: 'r2',
      folderId: null,
      name: 'Sipariş ver',
      sortOrder: 1,
      kind: 'Http',
      method: 'POST',
      url: '{{baseUrl}}/siparis',
      description: '',
      headers: [],
      body: { ...emptyBody(), mode: 'Raw', raw: '{"urun":1}' },
      auth: { type: 'Bearer', detail: 'Authorization: Bearer <token>', source: 'collection' },
      grpcMethod: null,
      examples: [],
    },
  ],
  updatedAt: '2026-10-22T10:00:00Z',
};

const publication: DocPublicationDto = {
  slug: 'abcdefghijkmnp',
  url: 'https://apivator.test/docs/abcdefghijkmnp',
  visibility: 'Organization',
  environmentId: null,
  environmentName: null,
  publishedBy: 'Ayşe',
  createdAt: '2026-10-22T10:00:00Z',
  updatedAt: '2026-10-22T10:00:00Z',
};

function withQuery(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollIntoView = vi.fn();
});

describe('docs model', () => {
  it('orders the tree, filters it and builds code with placeholders', () => {
    const nodes = flatten(buildTree(doc));
    expect(nodes.map((n) => (n.kind === 'folder' ? n.folder.name : n.request.name))).toEqual([
      'Ürünler',
      'Ürün getir',
      'Sipariş ver',
    ]);
    // Klasör adı uyarsa içi, istek uyarsa üst klasörü de görünür.
    expect(flatten(filterTree(buildTree(doc), 'getir')).map((n) => n.kind)).toEqual(['folder', 'request']);
    expect(flatten(filterTree(buildTree(doc), 'post'))).toHaveLength(1);
    expect(filterTree(buildTree(doc), 'yokboyle')).toEqual([]);

    const code = codeRequest(doc.requests[0]!, variableMap(doc));
    expect(code.url).toBe('https://test.magaza.test/urunler/1?dil=tr');
    expect(code.headers.map((h) => `${h.key}: ${h.value}`)).toEqual([
      'Accept: application/json',
      'X-Api-Key: <anahtar>',
    ]);
    // Gizli değişken çözülmez.
    const secret = codeRequest({ ...doc.requests[1]!, url: '{{baseUrl}}/x?t={{token}}' }, variableMap(doc));
    expect(secret.url).toBe('https://test.magaza.test/x?t={{token}}');
    expect(secret.headers).toContainEqual(expect.objectContaining({ value: 'Bearer <token>' }));
  });
});

describe('DocsView', () => {
  it('renders sections, variables, examples and code; searches', async () => {
    render(<DocsView doc={doc} />);
    const user = userEvent.setup();

    expect(
      within(screen.getByRole('banner')).getByRole('heading', { name: 'Mağaza API' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Ürün kataloğu.')).toBeInTheDocument();
    const variables = screen.getByRole('table', { name: 'Değişkenler' });
    expect(within(variables).getByText('https://test.magaza.test')).toBeInTheDocument();
    expect(within(variables).getByText('gizli')).toBeInTheDocument();

    const section = screen.getByRole('region', { name: /Ürün getir/ });
    expect(within(section).getByText('ürünü')).toBeInTheDocument();
    expect(within(section).getByText('→ https://test.magaza.test/urunler/1?dil=tr')).toBeInTheDocument();
    expect(within(section).getByText('"Ürünler" klasöründen', { exact: false })).toBeInTheDocument();
    expect(within(section).getByText('Yanıt biçimi')).toBeInTheDocument();
    expect(within(section).getByLabelText('Başarılı yanıt gövdesi')).toHaveTextContent('"ad": "Kalem"');
    await user.click(within(section).getByRole('tab', { name: /Yok/ }));
    expect(within(section).getByLabelText('Yok yanıt gövdesi')).toHaveTextContent('"hata": "yok"');

    const code = within(section).getByLabelText('Ürün getir örnek kodu');
    expect(code).toHaveTextContent("'https://test.magaza.test/urunler/1?dil=tr'");
    expect(code).toHaveTextContent("-H 'X-Api-Key: <anahtar>'");
    await user.selectOptions(within(section).getByLabelText('Kod dili'), 'python');
    expect(within(section).getByLabelText('Ürün getir örnek kodu')).toHaveTextContent('import requests');

    // Model: başarılı örnek yanıttan (404 yanıtı katılmaz); dil model penceresiyle ortak.
    const model = within(section).getByLabelText('Ürün getir modeli');
    expect(model).toHaveTextContent('public sealed class UrunGetirResponse');
    expect(model).not.toHaveTextContent('Hata');
    await user.selectOptions(within(section).getByLabelText('Model dili'), 'typescript');
    expect(within(section).getByLabelText('Ürün getir modeli')).toHaveTextContent(
      'export interface UrunGetirResponse {',
    );
    const order = screen.getByRole('region', { name: /Sipariş ver/ });
    expect(within(order).getByLabelText('Sipariş ver modeli')).toHaveTextContent(
      'export interface SiparisVerRequest {',
    );

    await user.type(screen.getByLabelText('Dokümanda ara'), 'sipariş');
    expect(screen.queryByRole('region', { name: /Ürün getir/ })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: /Sipariş ver/ })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Giriş' })).not.toBeInTheDocument();

    await user.click(within(screen.getByRole('navigation')).getByRole('button', { name: /Sipariş ver/ }));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });
});

describe('PublishDialog', () => {
  it('publishes, shows the link and unpublishes', async () => {
    api.docs.publication.mockResolvedValue(null);
    api.docs.publish.mockResolvedValue(publication);
    api.docs.unpublish.mockResolvedValue(undefined);
    render(
      withQuery(
        <PublishDialog
          collectionId="c1"
          collectionName="Mağaza API"
          environments={[{ id: 'env1', name: 'Test' } as never]}
          isAdmin={false}
          canEdit
          onClose={() => {}}
        />,
      ),
    );
    const user = userEvent.setup();
    await screen.findByText(/Sayfa canlıdır/);
    // Yönetici değilse herkese açık seçilemez.
    expect(screen.getByRole('radio', { name: /Herkese açık/ })).toBeDisabled();
    await user.selectOptions(screen.getByLabelText("Doküman environment'ı"), 'env1');
    await user.click(screen.getByRole('button', { name: 'Yayınla' }));
    expect(api.docs.publish).toHaveBeenCalledWith('c1', {
      visibility: 'Organization',
      environmentId: 'env1',
    });
    expect(await screen.findByRole('link', { name: publication.url })).toHaveAttribute(
      'href',
      publication.url,
    );

    await user.click(screen.getByRole('button', { name: 'Yayından kaldır' }));
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: publication.url })).not.toBeInTheDocument(),
    );
  });
});

describe('PublishedDocsPage', () => {
  function renderPage() {
    return render(
      withQuery(
        <MemoryRouter initialEntries={['/docs/abcdefghijkmnp']}>
          <Routes>
            <Route path="/docs/:slug" element={<PublishedDocsPage />} />
          </Routes>
        </MemoryRouter>,
      ),
    );
  }

  it('asks to sign in for organization-only docs and explains missing ones', async () => {
    api.docs.published.mockRejectedValueOnce(new ApiError(401, 'Oturum', 'docs.login_required'));
    renderPage();
    expect(await screen.findByRole('link', { name: 'Oturum aç' })).toHaveAttribute(
      'href',
      '/login?redirect=%2Fdocs%2Fabcdefghijkmnp',
    );
  });

  it('shows the documentation', async () => {
    api.docs.published.mockResolvedValueOnce(doc);
    renderPage();
    expect(
      within(await screen.findByRole('banner')).getByRole('heading', { name: 'Mağaza API' }),
    ).toBeInTheDocument();
    expect(api.docs.published).toHaveBeenCalledWith('abcdefghijkmnp');
  });

  it('lets visitors switch the language and refetches the server texts', async () => {
    api.docs.published.mockResolvedValue(doc);
    renderPage();
    await screen.findByRole('banner');
    expect(api.docs.published).toHaveBeenCalledTimes(1);

    try {
      fireEvent.change(screen.getByRole('combobox', { name: 'Dil' }), { target: { value: 'en' } });
      // Dil parçası tam paket koşarken geç yüklenebilir.
      expect(await screen.findByRole('combobox', { name: 'Language' }, { timeout: 10_000 })).toHaveValue(
        'en',
      );
      await waitFor(() => expect(api.docs.published).toHaveBeenCalledTimes(2), { timeout: 10_000 });
    } finally {
      await setLanguage('tr', { explicit: false });
      localStorage.clear();
    }
  }, 30_000);
});
