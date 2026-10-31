import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { useTabs } from '../requests/tabsStore';
import { OpenInToolsMenu, OutputActions } from './OutputActions';
import { ToolsPage } from './ToolsPage';
import { useToolsStore } from './toolsStore';

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

// Kayıtlı girdiyle çöken bir aracı taklit eder (hata sınırı testi).
vi.mock('./tools/UuidTool', async () => {
  const { useToolsStore: store } = await import('./toolsStore');
  return {
    default: function CrashingTool() {
      const input = store((s) => s.inputs.uuid?.input);
      if (input === 'boom') throw new Error('bozuk girdi');
      return <p>UUID aracı çalışıyor</p>;
    },
  };
});

const JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

/** Veri yönlendiricisi jsdom'da gezinirken undici Request hatası verir; bildirimsel yönlendirici yeterli. */
function Location() {
  return <output aria-label="Adres">{useLocation().pathname}</output>;
}

function renderTools(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Location />
        <Routes>
          <Route path="/" element={<p>İstek çalışma alanı</p>} />
          <Route path="/tools/:toolId?" element={<ToolsPage />} />
          <Route path="/yanit" element={<OpenInToolsMenu getText={() => '{"a":1}'} />} />
          <Route path="/cikti" element={<OutputActions text='{"a":1}' />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  useToolsStore.setState({ favorites: [], recent: [], inputs: {}, volatile: {}, rememberInputs: true });
});

describe('ToolsPage', () => {
  it('/tools ana sayfası kategorileri ve araçları listeler', () => {
    renderTools('/tools');
    expect(screen.getByRole('heading', { name: 'Geliştirici araçları' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Güvenlik ve kimlik', level: 2 })).toBeInTheDocument();
    const nav = screen.getByRole('complementary', { name: 'Araçlar' });
    expect(within(nav).getByRole('link', { name: 'JWT çözücü' })).toHaveAttribute('href', '/tools/jwt');
    expect(screen.getByText(/girdiler sunucuya gönderilmez/)).toBeInTheDocument();
  });

  it('kenar çubuğu araçları Türkçe alfabetik sırayla listeler', () => {
    renderTools('/tools');
    const nav = screen.getByRole('complementary', { name: 'Araçlar' });
    const names = within(nav)
      .getAllByRole('link')
      .map((link) => link.textContent ?? '');
    expect(names.length).toBeGreaterThan(40);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'tr', { numeric: true })));
  });

  it('kenar çubuğunda arama sonuçları süzer', async () => {
    const user = userEvent.setup();
    renderTools('/tools');
    const nav = screen.getByRole('complementary', { name: 'Araçlar' });
    await user.type(within(nav).getByRole('textbox', { name: 'Araç ara' }), 'md5');
    expect(within(nav).getByText('Sonuçlar')).toBeInTheDocument();
    expect(
      within(nav)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toContain('Hash ve HMAC');
    expect(within(nav).queryByRole('link', { name: 'Base64' })).not.toBeInTheDocument();

    await user.clear(within(nav).getByRole('textbox', { name: 'Araç ara' }));
    await user.type(within(nav).getByRole('textbox', { name: 'Araç ara' }), 'kahve');
    expect(within(nav).getByText('Eşleşen araç yok.')).toBeInTheDocument();
  });

  it('/tools/base64 aracı açar, son kullanılanlara ekler, favori düğmesi çalışır', async () => {
    const user = userEvent.setup();
    renderTools('/tools/base64');
    expect(await screen.findByRole('heading', { name: 'Base64', level: 1 })).toBeInTheDocument();
    expect(useToolsStore.getState().recent).toEqual(['base64']);

    await user.click(screen.getByRole('button', { name: 'Favorilere ekle' }));
    expect(useToolsStore.getState().favorites).toEqual(['base64']);
    expect(screen.getByRole('button', { name: 'Favorilerden çıkar' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const nav = screen.getByRole('complementary', { name: 'Araçlar' });
    expect(within(nav).getByText('Favoriler')).toBeInTheDocument();
  });

  it('Temizle aracın girdilerini siler', async () => {
    const user = userEvent.setup();
    useToolsStore.getState().setInput('url', 'input', 'a b');
    useToolsStore.getState().setInput('jwt', 'input', JWT);
    renderTools('/tools/url');
    await screen.findByRole('heading', { name: 'URL kodlama', level: 1 });
    await user.click(screen.getByRole('button', { name: /Temizle/ }));
    expect(useToolsStore.getState().inputs.url).toBeUndefined();
    expect(useToolsStore.getState().inputs.jwt).toEqual({ input: JWT });
  });

  it('bilinmeyen araçta bilgi ve tüm araçlar bağlantısı', () => {
    renderTools('/tools/yok');
    expect(screen.getByText(/Bu araç bulunamadı/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Tüm araçlar' })).toHaveAttribute('href', '/tools');
  });

  it('girdileri hatırlama kapatılınca kayıtlı girdiler silinir', async () => {
    const user = userEvent.setup();
    useToolsStore.getState().setInput('url', 'input', 'a b');
    renderTools('/tools');
    await user.click(screen.getByRole('checkbox', { name: /son girdileri bu cihazda hatırla/i }));
    expect(useToolsStore.getState().rememberInputs).toBe(false);
    expect(useToolsStore.getState().inputs).toEqual({});
  });

  it('akıllı yapıştırma JWT önerir ve aracı girdisiyle açar', async () => {
    const user = userEvent.setup();
    renderTools('/tools');
    await user.click(screen.getByRole('textbox', { name: /Akıllı yapıştırma/ }));
    await user.paste(`Bearer ${JWT}`);
    const suggestion = await screen.findByRole('button', { name: /JWT çözücü/ });
    await user.click(suggestion);
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'Adres' })).toHaveTextContent('/tools/jwt'),
    );
    expect(useToolsStore.getState().inputs.jwt?.input).toBe(JWT);
  });

  it('akıllı yapıştırma tanınmayan metinde bilgi verir', async () => {
    const user = userEvent.setup();
    renderTools('/tools');
    await user.type(screen.getByRole('textbox', { name: /Akıllı yapıştırma/ }), 'merhaba');
    expect(screen.getByText(/Tanınan bir biçim yok/)).toBeInTheDocument();
  });
});

describe('hata sınırı', () => {
  it('çöken araçta "Araç açılamadı"; girdiler temizlenip yeniden denenir', async () => {
    const user = userEvent.setup();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    useToolsStore.getState().setInput('uuid', 'input', 'boom');
    renderTools('/tools/uuid');
    expect(await screen.findByText(/Araç açılamadı: bozuk girdi/)).toBeInTheDocument();
    // Kenar çubuğu ayakta kalır.
    expect(screen.getByRole('complementary', { name: 'Araçlar' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /girdilerini temizle ve yeniden dene/ }));
    expect(await screen.findByText('UUID aracı çalışıyor')).toBeInTheDocument();
    expect(useToolsStore.getState().inputs.uuid).toBeUndefined();
    vi.mocked(console.error).mockRestore();
  });
});

describe('araçlara ve isteklere aktarma', () => {
  it('"Araçlarda aç" metni seçilen aracın girdisine yazar ve araca gider', async () => {
    const user = userEvent.setup();
    renderTools('/yanit');
    await user.click(screen.getByRole('button', { name: /Araçlarda aç/ }));
    await user.click(screen.getByRole('menuitem', { name: 'JSON biçimlendirici' }));
    expect(screen.getByRole('status', { name: 'Adres' })).toHaveTextContent('/tools/json-format');
    expect(useToolsStore.getState().inputs['json-format']?.input).toBe('{"a":1}');
  });

  it('"Yeni istekte kullan" çıktıyı JSON gövdeli yeni sekmede açar', async () => {
    const user = userEvent.setup();
    useTabs.setState({ tabs: [], activeTabId: null });
    renderTools('/cikti');
    await user.click(screen.getByRole('button', { name: 'Çıktıyı kullan' }));
    await user.click(screen.getByRole('menuitem', { name: /Yeni istekte kullan/ }));
    expect(screen.getByText('İstek çalışma alanı')).toBeInTheDocument();
    const [tab] = useTabs.getState().tabs;
    expect(tab?.draft.body).toMatchObject({ mode: 'Raw', rawLanguage: 'Json', raw: '{"a":1}' });
  });
});
