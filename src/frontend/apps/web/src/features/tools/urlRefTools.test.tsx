import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { ComponentType } from 'react';
import { useToolsStore } from './toolsStore';
import { useTabs } from '../requests/tabsStore';
import UrlParserTool from './tools/UrlParserTool';
import HttpReferenceTool from './tools/HttpReferenceTool';

vi.mock('../../lib/useWorkspaces', () => ({
  useWorkspaces: () => ({ current: { id: 'w1', role: 'Admin' }, workspaces: [] }),
}));

function renderTool(Tool: ComponentType) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Tool />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

const rebuilt = () =>
  screen.getByText('Yeniden kurulan adres').closest('section')!.querySelector('.font-mono')!.textContent;

beforeEach(() => {
  localStorage.clear();
  useToolsStore.setState({ favorites: [], recent: [], inputs: {}, volatile: {}, rememberInputs: true });
  useTabs.setState({ tabs: [] });
});

describe('URL ayrıştırıcı', () => {
  it('shows parts and rebuilds the URL as fields change', async () => {
    useToolsStore.getState().setInput('url-parser', 'input', 'https://çiçek.com.tr:443/a%2Fb?q=1&q=2#x');
    const user = renderTool(UrlParserTool);
    expect(screen.getByLabelText('Host')).toHaveValue('çiçek.com.tr');
    expect(screen.getByText('xn--iek-1lab.com.tr')).toBeInTheDocument();
    expect(screen.getByText(/443 \(varsayılan port/)).toBeInTheDocument();
    expect(screen.getByText('/a/b')).toBeInTheDocument();
    expect(rebuilt()).toBe('https://çiçek.com.tr:443/a%2Fb?q=1&q=2#x');

    await user.clear(screen.getByLabelText('Port'));
    await user.type(screen.getByLabelText('Parametre değer 2'), ' ç');
    expect(rebuilt()).toBe('https://çiçek.com.tr/a%2Fb?q=1&q=2%20%C3%A7#x');

    await user.click(screen.getByLabelText('Parametre 1 etkin'));
    expect(rebuilt()).toBe('https://çiçek.com.tr/a%2Fb?q=2%20%C3%A7#x');

    await user.click(screen.getByRole('checkbox', { name: /punycode/ }));
    expect(rebuilt()).toBe('https://xn--iek-1lab.com.tr/a%2Fb?q=2%20%C3%A7#x');
  });

  it('adds, moves and removes parameters and keeps variables', async () => {
    useToolsStore.getState().setInput('url-parser', 'input', '{{baseUrl}}/users?a=1');
    const user = renderTool(UrlParserTool);
    expect(screen.getByLabelText('Kök (değişken)')).toHaveValue('{{baseUrl}}');
    await user.click(screen.getByRole('button', { name: 'Parametre ekle' }));
    await user.type(screen.getByLabelText('Parametre anahtar 2'), 'tok');
    await user.type(screen.getByLabelText('Parametre değer 2'), '{{{{token}}');
    expect(rebuilt()).toBe('{{baseUrl}}/users?a=1&tok={{token}}');
    await user.click(screen.getByRole('button', { name: 'Parametre 2: yukarı taşı' }));
    expect(rebuilt()).toBe('{{baseUrl}}/users?tok={{token}}&a=1');
    await user.click(screen.getByRole('button', { name: 'Parametre 2: sil' }));
    expect(rebuilt()).toBe('{{baseUrl}}/users?tok={{token}}');

    await user.click(screen.getByRole('button', { name: /Düzenlemeleri sıfırla/ }));
    expect(rebuilt()).toBe('{{baseUrl}}/users?a=1');
  });

  it('opens the rebuilt URL in a new request tab', async () => {
    useToolsStore.getState().setInput('url-parser', 'input', 'https://api.ornek.com/v1?x=1');
    const user = renderTool(UrlParserTool);
    await user.click(screen.getByRole('button', { name: /Yeni istekte aç/ }));
    expect(useTabs.getState().tabs.at(-1)?.draft.url).toBe('https://api.ornek.com/v1?x=1');
  });

  it('shows parse errors', () => {
    useToolsStore.getState().setInput('url-parser', 'input', 'http://x.test:99999/');
    renderTool(UrlParserTool);
    expect(screen.getByRole('alert')).toHaveTextContent(/Geçersiz port/);
  });
});

describe('HTTP başvuru', () => {
  it('searches status codes and shows details', async () => {
    const user = renderTool(HttpReferenceTool);
    await user.type(screen.getByRole('searchbox', { name: 'Ara' }), 'çok fazla');
    const results = screen.getByRole('list', { name: 'Sonuçlar' });
    expect(within(results).getAllByRole('button')).toHaveLength(1);
    const detail = screen.getByRole('region', { name: 'Ayrıntı' });
    expect(detail).toHaveTextContent('429 Too Many Requests');
    expect(detail).toHaveTextContent('Retry-After');
  });

  it('filters by class and switches tabs', async () => {
    const user = renderTool(HttpReferenceTool);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sınıf' }), '5xx');
    expect(screen.getByText(/^\d+ sonuç$/)).toHaveTextContent('11 sonuç');

    await user.click(screen.getByRole('tab', { name: "Header'lar" }));
    await user.type(screen.getByRole('searchbox', { name: 'Ara' }), 'hsts');
    expect(screen.getByRole('region', { name: 'Ayrıntı' })).toHaveTextContent('Strict-Transport-Security');

    await user.click(screen.getByRole('tab', { name: 'MIME tipleri' }));
    await user.type(screen.getByRole('searchbox', { name: 'Ara' }), '.webp');
    expect(screen.getByRole('region', { name: 'Ayrıntı' })).toHaveTextContent('image/webp');
  });
});
