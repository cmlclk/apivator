import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { ComponentType } from 'react';
import { useToolsStore } from './toolsStore';
import CaseConvertTool, { ALL_STYLES_LIMIT } from './tools/CaseConvertTool';
import SlugTool from './tools/SlugTool';

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

beforeEach(() => {
  localStorage.clear();
  useToolsStore.setState({ favorites: [], recent: [], inputs: {}, volatile: {}, rememberInputs: true });
});

describe('Ad dönüşümü aracı', () => {
  it('tüm biçimleri listeler; harf kuralı ve ASCII seçenekleri', async () => {
    setInput('case-convert', 'müşteri_adı IŞIK');
    const user = renderTool(CaseConvertTool);
    expect(screen.getByTestId('case-camel')).toHaveTextContent('müşteriAdıIşık');
    expect(screen.getByTestId('case-constant')).toHaveTextContent('MÜŞTERİ_ADI_IŞIK');
    expect(screen.getByTestId('case-kebab')).toHaveTextContent('müşteri-adı-ışık');
    expect(screen.getByRole('button', { name: 'snake_case: kopyala' })).toBeInTheDocument();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Harf kuralı' }), 'en');
    expect(screen.getByTestId('case-kebab')).toHaveTextContent('müşteri-adı-işik');

    await user.click(screen.getByRole('checkbox', { name: "ASCII'ye çevir" }));
    expect(screen.getByTestId('case-pascal')).toHaveTextContent('MusteriAdiIsik');
  });

  it('tek biçim modunda çok satırlı çıktı', async () => {
    setInput('case-convert', 'firstName\nXMLHttpRequest');
    const user = renderTool(CaseConvertTool);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Görünüm' }), 'single');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Biçim' }), 'snake');
    expect(field('Çıktı')).toHaveValue('first_name\nxml_http_request');

    await user.click(screen.getByRole('checkbox', { name: 'Satır satır' }));
    expect(field('Çıktı')).toHaveValue('first_name_xml_http_request');
  });
});

describe('Ad dönüşümü aracı: büyük metin', () => {
  it('tüm biçimler listesi baş kısımla sınırlı; tek biçim metnin tamamını çevirir', async () => {
    const line = 'firstName\n';
    setInput('case-convert', line.repeat(ALL_STYLES_LIMIT / line.length + 100));
    const user = renderTool(CaseConvertTool);
    expect(screen.getByText(/yalnızca ilk 20\.000 karakter/)).toBeInTheDocument();
    const lines = (id: string) => screen.getByTestId(id).textContent!.split('\n').length;
    expect(lines('case-snake')).toBeLessThanOrEqual(ALL_STYLES_LIMIT / line.length + 1);

    await user.selectOptions(screen.getByRole('combobox', { name: 'Görünüm' }), 'single');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Biçim' }), 'snake');
    expect(screen.queryByText(/yalnızca ilk/)).not.toBeInTheDocument();
    expect(field('Çıktı').value.split('\n')).toHaveLength(ALL_STYLES_LIMIT / line.length + 101);
    expect(field('Çıktı').value.endsWith('first_name\n')).toBe(true);
  });
});

describe('Slug aracı', () => {
  it('her satıra slug; ayırıcı, uzunluk ve dolgu kelimeleri', async () => {
    setInput('slug', 'Çılgın Şehir ve Ötesi!\nİkinci Başlık');
    const user = renderTool(SlugTool);
    expect(field('Slug')).toHaveValue('cilgin-sehir-ve-otesi\nikinci-baslik');

    await user.click(screen.getByRole('checkbox', { name: 'Dolgu kelimelerini çıkar' }));
    expect(field('Slug')).toHaveValue('cilgin-sehir-otesi\nikinci-baslik');

    await user.selectOptions(screen.getByRole('combobox', { name: 'Ayırıcı' }), '_');
    await user.type(screen.getByRole('spinbutton', { name: 'En fazla uzunluk' }), '13');
    expect(field('Slug')).toHaveValue('cilgin_sehir\nikinci_baslik');
  });
});
