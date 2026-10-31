import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { ExecuteResponse } from '@apivator/core';
import { useToolsStore } from './toolsStore';
import { useConsole } from '../console/consoleStore';
import { useTabs, type RequestTab } from '../requests/tabsStore';
import { jsonPointerOffset } from './jsonPointerOffset';
import PythonIndentTool from './tools/PythonIndentTool';
import DiffTool from './tools/DiffTool';

vi.mock('../../lib/useWorkspaces', () => ({
  useWorkspaces: () => ({ current: { id: 'w1', role: 'Admin' }, workspaces: [] }),
}));

// CodeMirror jsdom'da ölçüm yapamıyor; düz bir metin alanı yeterli.
vi.mock('../requests/CodeEditor', () => ({
  CodeEditor: ({
    value,
    onChange,
    label,
  }: {
    value: string;
    onChange?: (v: string) => void;
    label: string;
  }) => <textarea aria-label={label} value={value} onChange={(e) => onChange?.(e.target.value)} />,
}));

function renderTool(element: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{element}</MemoryRouter>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

const field = (name: string) => screen.getByRole('textbox', { name }) as HTMLTextAreaElement;

function response(body: string, status = 200, extra: Partial<ExecuteResponse> = {}): ExecuteResponse {
  return {
    status,
    statusText: 'OK',
    headers: [],
    body,
    bodyEncoding: 'text',
    size: body.length,
    truncated: false,
    timeMs: 12,
    finalUrl: null,
    error: null,
    ...extra,
  };
}

const fetchSpy = vi.fn(() => Promise.reject(new Error('ağ isteği yapılmamalı')));

beforeEach(() => {
  localStorage.clear();
  useToolsStore.setState({ favorites: [], recent: [], inputs: {}, volatile: {}, rememberInputs: true });
  useConsole.setState({ records: [] });
  useTabs.setState({ tabs: [], activeTabId: null });
  fetchSpy.mockClear();
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Python girinti aracı', () => {
  it('girintiyi düzeltir, sorunları satır numarasıyla ve farkı gösterir', async () => {
    useToolsStore
      .getState()
      .setInput('python-indent', 'input', 'def f(x):\n\tif x:\n        return 1   \n\treturn 2\n');
    const user = renderTool(<PythonIndentTool />);
    // Sekme 8 sütun (Python): 3. satır "if" ile aynı seviyede; karışım TabError olarak bildirilir.
    await waitFor(() =>
      expect(field('Düzenlenmiş').value).toBe('def f(x):\n    if x:\n    return 1\n    return 2\n'),
    );
    const issues = screen.getByRole('list', { name: 'Girinti sorunları' });
    expect(issues).toHaveTextContent('3. satır');
    expect(issues).toHaveTextContent('TabError');
    expect(screen.getByText(/3 satır değişti/)).toBeInTheDocument();
    expect(screen.getByText(/1 boşluk, 2 sekme/)).toBeInTheDocument();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Girdideki sekme' }), '4');
    await waitFor(() =>
      expect(field('Düzenlenmiş').value).toBe('def f(x):\n    if x:\n        return 1\n    return 2\n'),
    );

    await user.selectOptions(screen.getByRole('combobox', { name: 'Girinti' }), 'tabs');
    await waitFor(() =>
      expect(field('Düzenlenmiş').value).toBe('def f(x):\n\tif x:\n\t\treturn 1\n\treturn 2\n'),
    );
    expect(screen.queryByRole('combobox', { name: 'Genişlik' })).not.toBeInTheDocument();
  });

  it('yalnızca satır sonu değişince bunu belirtir', async () => {
    useToolsStore.getState().setInput('python-indent', 'input', 'x = 1\r\n');
    useToolsStore.getState().setInput('python-indent', 'lineEnding', 'lf');
    renderTool(<PythonIndentTool />);
    expect(await screen.findByText(/Yalnızca satır sonları değişti/)).toBeInTheDocument();
  });
});

describe('Fark aracı: geçmişten seçme', () => {
  it('oturumdaki yanıtlar ve açık sekmeler listelenir; seçilen gövde ilgili alana yüklenir', async () => {
    useConsole.getState().add('Kullanıcı', 'GET', 'https://api.ornek.com/users/1', response('{"id":1}'));
    useConsole
      .getState()
      .add('Hata', 'POST', 'https://api.ornek.com/orders', response('{"hata":"yok"}', 404));
    useTabs.setState({
      tabs: [
        {
          id: 'tab1',
          draft: { method: 'PUT', url: 'https://api.ornek.com/items/9' },
          response: response('{"tam":"gövde"}'),
        } as unknown as RequestTab,
      ],
    });
    const user = renderTool(<DiffTool />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Sol: geçmişten seç' }));
    const dialog = screen.getByRole('dialog', { name: 'Sol: geçmişten yanıt seç' });
    const items = within(dialog)
      .getAllByRole('button')
      .filter((b) => b.closest('li'));
    // En yeni önce; açık sekme en sonda.
    expect(items.map((b) => b.textContent)).toEqual([
      expect.stringContaining('api.ornek.com/orders404'),
      expect.stringContaining('api.ornek.com/users/1200'),
      expect.stringContaining('açık sekme'),
    ]);
    await user.click(items[1]!);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(field('Sol (eski)').value).toBe('{"id":1}');

    await user.click(screen.getByRole('button', { name: 'Sağ: geçmişten seç' }));
    await user.type(screen.getByRole('textbox', { name: 'Geçmişte ara' }), 'items');
    const filtered = within(screen.getByRole('list', { name: 'Yanıtlar' })).getAllByRole('button');
    expect(filtered).toHaveLength(1);
    await user.click(filtered[0]!);
    expect(field('Sağ (yeni)').value).toBe('{"tam":"gövde"}');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('kayıt yoksa açıklama gösterir; kısaltılmış gövde işaretlenir', async () => {
    const user = renderTool(<DiffTool />);
    await user.click(screen.getByRole('button', { name: 'Sağ: geçmişten seç' }));
    expect(screen.getByText(/henüz yanıt yok/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Kapat' }));

    useConsole.getState().add('Büyük', 'GET', 'https://ornek.com/buyuk', response('x'.repeat(30_000)));
    await user.click(screen.getByRole('button', { name: 'Sağ: geçmişten seç' }));
    expect(screen.getByText('kısaltılmış')).toBeInTheDocument();
  });
});

describe('jsonPointerOffset', () => {
  const text = '{\n  "a": [1, {"b/c": "x"}],\n  "d": {"e": null}\n}';
  const at = (pointer: string) => {
    const range = jsonPointerOffset(text, pointer);
    return range && text.slice(range.from, range.to);
  };

  it('pointer’ın gösterdiği değeri bulur', () => {
    expect(at('')).toBe(text);
    expect(at('/a/1/b~1c')).toBe('"x"');
    expect(at('/a/0')).toBe('1');
    expect(at('/d')).toBe('{"e": null}');
    expect(at('/d/e')).toBe('null');
    expect(at('/yok')).toBeNull();
    expect(at('/a/5')).toBeNull();
    expect(jsonPointerOffset('{"a": ', '/a')).toBeNull();
  });
});
