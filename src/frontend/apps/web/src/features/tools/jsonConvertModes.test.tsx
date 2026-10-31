import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { useToolsStore } from './toolsStore';
import JsonConvertTool from './tools/JsonConvertTool';

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

function renderTool(mode: string, input: string) {
  const { setInput } = useToolsStore.getState();
  setInput('json-convert', 'mode', mode);
  setInput('json-convert', 'input', input);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <JsonConvertTool />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const field = (name: string) => screen.getByRole('textbox', { name }) as HTMLTextAreaElement;

beforeEach(() => {
  localStorage.clear();
  useToolsStore.setState({ favorites: [], recent: [], inputs: {}, volatile: {}, rememberInputs: true });
});

describe('JSON dönüştürücü yeni modlar', () => {
  it('dönüşümler biçime göre gruplu', () => {
    renderTool('json-csv', '');
    const groups = screen.getAllByRole('group').map((g) => g.getAttribute('label'));
    expect(groups).toEqual(['Tablo', 'Yapılandırma', 'Web']);
    expect(screen.getByRole('option', { name: 'CSV → Excel' })).toBeInTheDocument();
  });

  it('Query string → JSON tam URL kabul eder, sayıları çevirir', () => {
    renderTool('query-json', 'https://ornek.com/ara?q=a+b&f[t][]=x&n=2#x');
    expect(JSON.parse(field('JSON').value)).toEqual({ q: 'a b', f: { t: ['x'] }, n: 2 });
  });

  it('JSON → Query string dizi biçimi seçeneğiyle', () => {
    renderTool('json-query', '{"a":[1,2]}');
    expect(field('Query string').value).toBe('a[]=1&a[]=2');
    expect(screen.getByRole('combobox', { name: 'Diziler' })).toBeInTheDocument();
  });

  it('JSON → TOML null için açık hata', () => {
    renderTool('json-toml', '{"a":null}');
    expect(screen.getByRole('alert')).toHaveTextContent(`TOML'da null yok`);
  });

  it('TOML → JSON', () => {
    renderTool('toml-json', '[sunucu]\nport = 8080');
    expect(JSON.parse(field('JSON').value)).toEqual({ sunucu: { port: 8080 } });
  });

  it('CSV → Excel sayfa özetini gösterir', () => {
    renderTool('csv-xlsx', 'ad;tutar\nAli;1,5\nAyşe;2\n');
    expect(screen.getByText(/2 satır, 2 kolon/)).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Ayırıcı' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Excel olarak/ })).toBeEnabled();
  });

  it('Excel → CSV dosya seçimi ister, başlık seçeneği yok', () => {
    renderTool('xlsx-csv', '');
    expect(screen.getByRole('button', { name: /Dosya seç/ })).toBeInTheDocument();
    expect(screen.queryByText('İlk satır başlık')).not.toBeInTheDocument();
  });
});
