import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { emptyBody, type DocumentationDto } from '@apivator/core';
import { initI18n, setLanguage, translate } from '../../i18n';
import { sentenceKey } from '../activity/activity';
import { DocsView } from './DocsView';
import { PublishDialog } from './PublishDialog';

const api = vi.hoisted(() => ({
  docs: { publication: vi.fn(), publish: vi.fn(), regenerate: vi.fn(), unpublish: vi.fn() },
}));
vi.mock('../../lib/api', () => ({ api }));

const doc: DocumentationDto = {
  collectionId: 'c1',
  name: 'Shop API',
  description: null,
  workspaceName: 'Team',
  auth: { type: 'Bearer', detail: 'Authorization: Bearer <token>', source: null },
  environmentName: 'Test',
  variables: [{ key: 'token', value: '', isSecret: true, source: 'environment' }],
  folders: [],
  requests: [
    {
      id: 'r1',
      folderId: null,
      name: 'Get product',
      sortOrder: 0,
      kind: 'Http',
      method: 'GET',
      url: '/products/1',
      description: '',
      headers: [],
      body: emptyBody(),
      auth: { type: 'Bearer', detail: null, source: 'collection' },
      grpcMethod: null,
      examples: [],
    },
  ],
  updatedAt: '2026-10-22T10:00:00Z',
} as unknown as DocumentationDto;

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  api.docs.publication.mockResolvedValue(null);
});
afterEach(() => initI18n('tr'));

describe('docs i18n (en)', () => {
  it('renders the documentation view in English', async () => {
    await setLanguage('en', { explicit: false });
    render(<DocsView doc={doc} />);
    expect(screen.getByText(/Team · 1 request · Environment: Test · Last modified/)).toBeInTheDocument();
    expect(screen.getByLabelText('Search documentation')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Introduction' })).toBeInTheDocument();
    expect(screen.getByText('secret')).toBeInTheDocument();
    expect(screen.getByText(/inherited from the collection/)).toBeInTheDocument();
    expect(screen.getByText('No description.')).toBeInTheDocument();
    expect(screen.queryByText(/istek|Giriş|Değişkenler/)).not.toBeInTheDocument();
  });

  it('renders the publish dialog in English', async () => {
    await setLanguage('en', { explicit: false });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <PublishDialog
          collectionId="c1"
          collectionName="Shop API"
          environments={[]}
          isAdmin={false}
          canEdit
          onClose={() => {}}
        />
      </QueryClientProvider>,
    );
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Who can see it?')).toBeInTheDocument();
    expect(within(dialog).getByRole('radio', { name: /Public/ })).toBeDisabled();
    expect(within(dialog).queryByText(/Yayınla|Kimler/)).not.toBeInTheDocument();
  });

  it('builds activity sentences in English word order', async () => {
    await setLanguage('en', { explicit: false });
    expect(sentenceKey({ action: 'Created', detail: null })).toBe('sentence.Created');
    expect(translate('activity', 'targets.Request')).toBe('request');
  });
});
