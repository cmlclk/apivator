import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { initI18n, setLanguage } from '../../i18n';
import { findTool, searchTools, CATEGORY_LABELS } from './registry';
import { ToolsPage } from './ToolsPage';
import { useToolsStore } from './toolsStore';

vi.mock('../../lib/useWorkspaces', () => ({
  useWorkspaces: () => ({ current: { id: 'w1', role: 'Admin' }, workspaces: [] }),
}));

// CodeMirror jsdom'da ölçüm yapamıyor; düz bir metin alanı yeterli.
vi.mock('../requests/CodeEditor', () => ({
  CodeEditor: ({ value, label }: { value: string; label: string }) => (
    <textarea aria-label={label} value={value} readOnly />
  ),
}));

function renderTools(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/tools/:toolId?" element={<ToolsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  localStorage.clear();
  useToolsStore.setState({ favorites: [], recent: [], inputs: {}, volatile: {}, rememberInputs: true });
  await setLanguage('en');
});

afterEach(() => initI18n('tr'));

describe('araçlar (İngilizce)', () => {
  it('ana sayfa ve katalog İngilizce çizilir', () => {
    const { container } = renderTools('/tools');
    expect(screen.getByRole('heading', { name: 'Developer tools' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Security and identity', level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Tools' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear all inputs' })).toBeInTheDocument();
    expect(screen.getByText('Smart paste')).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/Geliştirici|Araçlar|Güvenlik|Akıllı|temizle/);
  });

  it('arama etkin dildeki ad ve anahtar kelimelerle yapılır', async () => {
    const user = userEvent.setup();
    renderTools('/tools');
    await user.type(screen.getByRole('textbox', { name: 'Search tools' }), 'compare');
    const nav = screen.getByRole('complementary', { name: 'Tools' });
    expect(within(nav).getByRole('link', { name: 'Text / JSON diff' })).toBeInTheDocument();
    await user.clear(screen.getByRole('textbox', { name: 'Search tools' }));
    await user.type(screen.getByRole('textbox', { name: 'Search tools' }), 'zzz');
    expect(screen.getByText('No matching tools.')).toBeInTheDocument();
    expect(searchTools('compare').map((t) => t.id)).toContain('diff');
    expect(searchTools('karşılaştır')).toEqual([]);
    expect(findTool('base64')?.description).toBe(
      'Encode or decode text and files as Base64; URL-safe, image preview.',
    );
    expect(CATEGORY_LABELS.encoding).toBe('Encoding / decoding');
  });

  it('ortak araç düzeni ve kodlama aracı İngilizce çizilir', async () => {
    const { container } = renderTools('/tools/hex');
    expect(await screen.findByRole('heading', { name: 'Hex ↔ text', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add to favorites' })).toBeInTheDocument();
    expect(await screen.findByText('Operation')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Text → hex' })).toBeInTheDocument();
    expect(screen.getByText('Separator')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Swap' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Load from file' }).length).toBeGreaterThan(0);
    expect(container).not.toHaveTextContent(/İşlem|Ayraç|Yer değiştir|Temizle|Favorilere/);
  });

  it('Base64 aracı İngilizce çizilir', async () => {
    const { container } = renderTools('/tools/base64');
    expect(await screen.findByText('Source')).toBeInTheDocument();
    expect(screen.getByText('URL-safe (-_ , unpadded)')).toBeInTheDocument();
    expect(screen.getByText('Wrap lines at 76 characters')).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/Kaynak|dolgusuz|karakterde/);
  });
});
