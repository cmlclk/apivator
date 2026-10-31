import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { ComponentType } from 'react';
import { initI18n, setLanguage } from '../../i18n';
import { useToolsStore } from './toolsStore';
import CurlCodeTool from './tools/CurlCodeTool';
import DiffTool from './tools/DiffTool';
import HarTool from './tools/HarTool';
import JsonFormatTool from './tools/JsonFormatTool';
import PythonIndentTool from './tools/PythonIndentTool';
import RegexTool from './tools/RegexTool';
import SqlInsertTool from './tools/SqlInsertTool';

vi.mock('../../lib/useWorkspaces', () => ({
  useWorkspaces: () => ({ current: { id: 'w1', role: 'Admin' }, workspaces: [] }),
}));

// CodeMirror jsdom'da ölçüm yapamıyor; düz bir metin alanı yeterli.
vi.mock('../requests/CodeEditor', () => ({
  CodeEditor: ({ value, label }: { value: string; label: string }) => (
    <textarea aria-label={label} value={value} readOnly />
  ),
}));

function renderTool(Tool: ComponentType) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Tool />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const setInput = (toolId: string, value: string, name = 'input') =>
  useToolsStore.getState().setInput(toolId, name, value);

beforeEach(async () => {
  localStorage.clear();
  useToolsStore.setState({ favorites: [], recent: [], inputs: {}, volatile: {}, rememberInputs: true });
  await setLanguage('en');
});

afterEach(() => initI18n('tr'));

describe('veri araçları (İngilizce)', () => {
  it('JSON biçimlendirici İngilizce çizilir', () => {
    setInput('json-format', '{"a":1}');
    const { container } = renderTool(JsonFormatTool);
    expect(screen.getByText('Indent')).toBeInTheDocument();
    expect(screen.getByText('Sort keys')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply to input' })).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/Girinti|Anahtarları|Girdiye|Geçerli/);
  });

  it('Fark aracı İngilizce çizilir', () => {
    setInput('diff', 'a\nb');
    setInput('diff', 'a\nc', 'right');
    const { container } = renderTool(DiffTool);
    expect(screen.getByText('Comparison')).toBeInTheDocument();
    expect(screen.getByText('Ignore whitespace')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Left: pick from history' })).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/Karşılaştırma|Boşlukları|geçmişten|Sol|Sağ/);
  });

  it('Regex aracı İngilizce çizilir', () => {
    setInput('regex', '\\d+', 'pattern');
    setInput('regex', 'a1 b22');
    const { container } = renderTool(RegexTool);
    expect(screen.getByText('Flags')).toBeInTheDocument();
    expect(screen.getByText('2 matches')).toBeInTheDocument();
    expect(screen.getByText('JavaScript vs .NET syntax differences')).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/Bayraklar|eşleşme|Eşleşme|Test metni/);
  });

  it('Python girinti aracı İngilizce çizilir', () => {
    setInput('python-indent', 'if x:\n\ty = 1\n');
    const { container } = renderTool(PythonIndentTool);
    expect(screen.getByText('Indentation')).toBeInTheDocument();
    expect(screen.getByText('Remove trailing whitespace')).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/Girinti|Boşluk|Sekme|Düzenlenmiş/);
  });

  it('cURL → kod aracı İngilizce çizilir', () => {
    setInput('curl-code', "curl 'https://api.example.com/v1/users' --proxy http://p:8080");
    const { container } = renderTool(CurlCodeTool);
    expect(screen.getByRole('combobox', { name: 'Language' })).toBeInTheDocument();
    expect(screen.getByText('cURL command')).toBeInTheDocument();
    expect(screen.getByText('Options with no equivalent were skipped:')).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/Dil|komutu|Yeni istekte/);
  });

  it('HAR aracı İngilizce çizilir', () => {
    const { container } = renderTool(HarTool);
    expect(screen.getByRole('button', { name: 'Open HAR file' })).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/dosyası aç/);
  });

  it('CSV / Excel → SQL INSERT aracı İngilizce çizilir', () => {
    setInput('sql-insert', 'ad;yas\nAli;30');
    const { container } = renderTool(SqlInsertTool);
    expect(screen.getByText('Dialect')).toBeInTheDocument();
    expect(screen.getByText('Infer types')).toBeInTheDocument();
    expect(screen.getByText('Transaction block')).toBeInTheDocument();
    expect(screen.getByText('Columns (2 columns, 1 row)')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'SQL' })).toHaveValue(
      `INSERT INTO "my_table" ("ad", "yas") VALUES ('Ali', 30);\n`,
    );
    expect(container).not.toHaveTextContent(/Lehçe|Tablo|Kolonlar|İşlem/);
  });
});
