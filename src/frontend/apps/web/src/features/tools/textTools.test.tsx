import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { ComponentType } from 'react';
import { useToolsStore } from './toolsStore';
import LineOpsTool from './tools/LineOpsTool';
import TextStatsTool from './tools/TextStatsTool';
import ByteViewTool from './tools/ByteViewTool';
import { parseSteps } from './tools/lineOpsModel';

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
  }) => (
    // textarea CRLF’yi LF’ye çevirir; ham değer satır sonu testleri için data-value’da.
    <textarea
      aria-label={label}
      data-value={value}
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
    />
  ),
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

const field = (name: string) => screen.getByRole('textbox', { name }) as HTMLTextAreaElement;
const setInput = (toolId: string, value: string, name = 'input') =>
  useToolsStore.getState().setInput(toolId, name, value);
const stored = (toolId: string, name: string) => useToolsStore.getState().inputs[toolId]?.[name];

beforeEach(() => {
  localStorage.clear();
  useToolsStore.setState({ favorites: [], recent: [], inputs: {}, volatile: {}, rememberInputs: true });
});

describe('Satır işlemleri aracı', () => {
  it('adımları sırayla uygular, çıkarılan satırları gösterir, CRLF korunur', async () => {
    setInput('line-ops', 'çay\r\nbal\r\nçay\r\ncam\r\n');
    const user = renderTool(LineOpsTool);
    await user.click(screen.getByRole('button', { name: 'Tekilleştir' }));
    await user.click(screen.getByRole('button', { name: 'Sırala' }));
    expect(field('Çıktı').dataset.value).toBe('bal\r\ncam\r\nçay\r\n');
    expect(screen.getByText('1 satır çıkarıldı')).toBeInTheDocument();
    const stats = screen.getByRole('region', { name: 'Çıktı istatistikleri' });
    expect(within(stats).getByText('Satır').nextSibling).toHaveTextContent('4');

    await user.click(screen.getByRole('button', { name: 'Sırala: yukarı taşı' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Yön' }), 'desc');
    expect(field('Çıktı').dataset.value).toBe('çay\r\ncam\r\nbal\r\n');
    await user.click(screen.getByRole('button', { name: 'Tekilleştir: sil' }));
    expect(field('Çıktı').dataset.value).toBe('çay\r\nçay\r\ncam\r\nbal\r\n');
  });

  it('seçenekli adımlar: önek, filtre ve hata', async () => {
    setInput('line-ops', 'a\nb\nab');
    const user = renderTool(LineOpsTool);
    await user.click(screen.getByRole('button', { name: 'Filtrele' }));
    await user.type(screen.getByRole('textbox', { name: 'Metin' }), 'a');
    await user.click(screen.getByRole('button', { name: 'Önek / sonek' }));
    await user.type(screen.getByRole('textbox', { name: 'Önek' }), '- ');
    expect(field('Çıktı').value).toBe('- a\n- ab');
    await user.click(screen.getByRole('button', { name: 'Böl' }));
    await user.clear(screen.getByRole('textbox', { name: 'Ayraç' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Bölmek için bir ayraç girin.');
  });

  it('çıktıyı girdiye uygular ve geri alır', async () => {
    setInput('line-ops', 'b\na');
    const user = renderTool(LineOpsTool);
    await user.click(screen.getByRole('button', { name: 'Ters çevir' }));
    await user.click(screen.getByRole('button', { name: /Çıktıyı girdiye uygula/ }));
    expect(field('Girdi').value).toBe('a\nb');
    expect(stored('line-ops', 'steps')).toBe('[]');
    await user.click(screen.getByRole('button', { name: /Geri al/ }));
    expect(field('Girdi').value).toBe('b\na');
    expect(field('Çıktı').value).toBe('a\nb');
  });

  it('kayıtlı adımlar doğrulanır', () => {
    expect(parseSteps('bozuk')).toEqual([]);
    expect(parseSteps('{"kind":"sort"}')).toEqual([]);
    expect(
      parseSteps('[{"kind":"nope"},{"kind":"wrap","width":"9"},{"kind":"join","separator":"|"}]'),
    ).toEqual([
      { kind: 'wrap', width: 80 },
      { kind: 'join', separator: '|' },
    ]);
    // Prototip adları işlem ya da seçenek sayılmaz.
    expect(
      parseSteps(
        '[{"kind":"constructor"},{"kind":"toString"},{"kind":"trim","__proto__":{"x":1},"valueOf":1}]',
      ),
    ).toEqual([{ kind: 'trim' }]);
  });
});

describe('Metin sayacı aracı', () => {
  it('sayaçları ve en sık sözcükleri gösterir', () => {
    setInput('text-stats', 'Işık ışık 😀 geldi.\n\nYeni paragraf');
    renderTool(TextStatsTool);
    const stats = screen.getByRole('region', { name: 'İstatistikler' });
    const value = (name: string) => within(stats).getByText(name).nextSibling;
    expect(value('Sözcük')).toHaveTextContent('5');
    expect(value('Paragraf')).toHaveTextContent('2');
    expect(value('Kod noktası')).toHaveTextContent('33');
    expect(value('UTF-16 uzunluğu')).toHaveTextContent('34');
    const top = within(stats).getByRole('list', { name: 'En sık sözcükler' });
    expect(within(top).getAllByRole('listitem')[0]).toHaveTextContent('ışık2');
  });

  it('büyük metni Worker yokken aynı iş parçacığında sayar', async () => {
    setInput('text-stats', 'kelime '.repeat(20_000));
    renderTool(TextStatsTool);
    const stats = await screen.findByRole('region', { name: 'İstatistikler' });
    await vi.waitFor(() => expect(stats).toHaveAttribute('aria-busy', 'false'));
    expect(within(stats).getByText('Sözcük').nextSibling).toHaveTextContent(/20.000/);
  });

  it('büyük metni Worker’da sayar', async () => {
    const posted: unknown[] = [];
    class FakeWorker {
      onmessage: ((e: MessageEvent) => void) | null = null;
      onerror: ((e: ErrorEvent) => void) | null = null;
      postMessage(data: { id: number; text: string }) {
        posted.push(data);
        void import('./tools/textStatsWorker').then(({ runTextStats }) =>
          this.onmessage?.({ data: runTextStats(data) } as MessageEvent),
        );
      }
      terminate() {}
    }
    vi.stubGlobal('Worker', FakeWorker);
    try {
      setInput('text-stats', 'iki söz\n'.repeat(15_000));
      renderTool(TextStatsTool);
      const stats = await screen.findByRole('region', { name: 'İstatistikler' });
      await vi.waitFor(() => expect(stats).toHaveAttribute('aria-busy', 'false'));
      expect(posted).toHaveLength(1);
      expect(within(stats).getByText('Sözcük').nextSibling).toHaveTextContent(/30.000/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('Bayt görünümü aracı', () => {
  it('hex dökümü, görünmez karakter uyarısı ve karakter tablosu', () => {
    setInput('byte-view', 'a b​');
    renderTool(ByteViewTool);
    expect(field('Baytlar').value).toBe(
      '00000000  61 c2 a0 62 e2 80 8b                              |a..b...|',
    );
    expect(screen.getByText(/Görünmez \/ kontrol karakterleri/).parentElement).toHaveTextContent(
      /U\+00A0 NBSP .*×1 \(ilk: 1:2\)/,
    );
    const table = screen.getByRole('table', { name: 'Karakterler' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(5);
    expect(rows[4]).toHaveTextContent('U+200B');
    expect(rows[4]).toHaveTextContent('E2 80 8B');
    expect(rows[4]).toHaveClass('bg-warning/10');
  });

  it('kodlama ve görünüm seçenekleri; Latin-1 uyarısı', async () => {
    setInput('byte-view', 'Hiğ');
    const user = renderTool(ByteViewTool);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Görünüm' }), 'binary');
    expect(field('Baytlar').value).toBe('01001000 01101001 11000100 10011111');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Görünüm' }), 'hex');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Kodlama' }), 'utf-16be');
    expect(field('Baytlar').value).toBe('00 48 00 69 01 1f');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Kodlama' }), 'latin1');
    expect(field('Baytlar').value).toBe('48 69 3f');
    expect(screen.getByText(/Latin-1 karşılığı yok/)).toBeInTheDocument();
  });

  it('yer değiştirince baytları metne çevirir; hatalı girdi', async () => {
    setInput('byte-view', 'çay');
    const user = renderTool(ByteViewTool);
    await user.click(screen.getByRole('button', { name: 'Yer değiştir' }));
    expect(stored('byte-view', 'direction')).toBe('decode');
    expect(field('Metin').value).toBe('çay');
    await user.clear(field('Baytlar'));
    await user.type(field('Baytlar'), 'zz');
    expect(screen.getByRole('alert')).toHaveTextContent('Geçersiz hex karakteri');
  });
});
