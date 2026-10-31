import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { ComponentType } from 'react';
import { useToolsStore } from './toolsStore';
import { useTabs } from '../requests/tabsStore';
import CurlCodeTool from './tools/CurlCodeTool';
import HarTool from './tools/HarTool';

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
  useTabs.setState({ tabs: [] });
});

describe('cURL → kod aracı', () => {
  const CURL = `curl -X POST 'https://api.ornek.com/v1/users' -H 'Content-Type: application/json' --data-raw '{"ad":"Ayşe"}' --proxy http://p:8080`;

  it('seçilen dilde kod üretir ve atlanan seçenekleri gösterir', async () => {
    setInput('curl-code', CURL);
    const user = renderTool(CurlCodeTool);
    expect(field('JavaScript fetch kodu').value).toContain('https://api.ornek.com/v1/users');
    expect(screen.getByText('Proxy ayarı atlandı.')).toBeInTheDocument();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Dil' }), 'python');
    const code = screen.getAllByRole('textbox').at(-1) as HTMLTextAreaElement;
    expect(code.value).toContain('import requests');
    expect(useToolsStore.getState().inputs['curl-code']?.language).toBe('python');
  });

  it('geçersiz komutta Türkçe hata', () => {
    setInput('curl-code', "curl 'https://x");
    renderTool(CurlCodeTool);
    expect(screen.getByRole('alert')).toHaveTextContent('cURL komutu çözülemedi: Kapanmamış tek tırnak.');
    expect(screen.getByRole('button', { name: /Yeni istekte aç/ })).toBeDisabled();
  });

  it('isteği yeni sekmede açar', async () => {
    setInput('curl-code', CURL);
    const user = renderTool(CurlCodeTool);
    await user.click(screen.getByRole('button', { name: /Yeni istekte aç/ }));
    const tab = useTabs.getState().tabs.at(-1)!;
    expect(tab.draft.method).toBe('POST');
    expect(tab.draft.url).toBe('https://api.ornek.com/v1/users');
    expect(tab.notice?.details).toEqual(['Proxy ayarı atlandı.']);
  });
});

const HAR = JSON.stringify({
  log: {
    version: '1.2',
    creator: { name: 'Firefox', version: '130' },
    entries: [
      {
        startedDateTime: '2026-10-29T10:00:00.000Z',
        time: 50,
        request: {
          method: 'GET',
          url: 'https://api.ornek.com/v1/users?page=2',
          headers: [{ name: 'Accept', value: 'application/json' }],
          queryString: [{ name: 'page', value: '2' }],
          cookies: [],
        },
        response: {
          status: 200,
          statusText: 'OK',
          headers: [{ name: 'Content-Type', value: 'application/json' }],
          content: { size: 9, mimeType: 'application/json', text: btoa('{"id":7}'), encoding: 'base64' },
        },
        timings: { blocked: -1, dns: 5, connect: 10, send: 1, wait: 30, receive: 4 },
      },
      {
        startedDateTime: '2026-10-29T10:00:01.500Z',
        time: 12,
        request: { method: 'POST', url: 'https://api.ornek.com/v1/login', headers: [] },
        response: { status: 401, content: { size: 0, mimeType: 'text/plain', text: '' } },
      },
      {
        startedDateTime: '2026-10-29T10:00:02.000Z',
        time: 3,
        request: { method: 'GET', url: 'https://cdn.ornek.com/logo.png', headers: [] },
        response: {
          status: 200,
          content: { size: 4, mimeType: 'image/png', text: 'iVBORw==', encoding: 'base64' },
        },
      },
    ],
  },
});

const rows = () =>
  within(screen.getByRole('table', { name: 'HAR kayıtları' }))
    .getAllByRole('row')
    .slice(1);

describe('HAR görüntüleyici', () => {
  it('kayıtları listeler, süzer ve sıralar', async () => {
    setInput('har', HAR);
    const user = renderTool(HarTool);
    expect(screen.getByText(/HAR 1\.2 · Firefox 130/)).toBeInTheDocument();
    expect(rows()).toHaveLength(3);
    expect(rows()[1]).toHaveTextContent('+1,50 sn');

    await user.selectOptions(screen.getByRole('combobox', { name: 'Durum' }), '4xx');
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toHaveTextContent('/v1/login');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Durum' }), '');

    await user.selectOptions(screen.getByRole('combobox', { name: 'Tür' }), 'image');
    expect(rows()).toHaveLength(1);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Tür' }), '');

    await user.type(screen.getByRole('searchbox', { name: 'Adreste ara' }), 'users');
    expect(rows()).toHaveLength(1);
    await user.clear(screen.getByRole('searchbox', { name: 'Adreste ara' }));

    await user.click(screen.getByRole('button', { name: 'Süre' }));
    expect(rows()[0]).toHaveTextContent('logo.png');
    await user.click(screen.getByRole('button', { name: 'Süre' }));
    expect(rows()[0]).toHaveTextContent('/v1/users');
  });

  it('seçili kaydın ayrıntısı: Base64 çözülür, JSON biçimlenir, cURL kopyalanır', async () => {
    setInput('har', HAR);
    const user = renderTool(HarTool);
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    await user.click(screen.getByRole('button', { name: /\/v1\/users\?page=2/ }));

    expect(screen.getByText('Base64 olarak kaydedilmiş içerik çözüldü.')).toBeInTheDocument();
    expect(field('Yanıt gövdesi')).toHaveValue('{\n  "id": 7\n}');

    await user.click(screen.getByRole('tab', { name: 'İstek' }));
    expect(
      within(screen.getByRole('table', { name: 'Sorgu parametreleri' })).getByText('page'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Zamanlama' }));
    expect(screen.getByText('Bekleme (TTFB)')).toBeInTheDocument();
    expect(screen.queryByText('Kuyrukta bekleme')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'cURL olarak kopyala' }));
    expect(writeText).toHaveBeenCalledWith(
      "curl \\\n  'https://api.ornek.com/v1/users?page=2' \\\n  -H 'Accept: application/json'",
    );

    await user.click(screen.getByRole('button', { name: /Yeni istekte aç/ }));
    expect(useTabs.getState().tabs.at(-1)!.draft.url).toBe('https://api.ornek.com/v1/users?page=2');
  });

  it('ikili yanıt gövdesi gösterilmez', async () => {
    setInput('har', HAR);
    const user = renderTool(HarTool);
    await user.click(screen.getByRole('button', { name: /logo\.png/ }));
    expect(screen.getByText(/İkili içerik \(4 B, image\/png\)/)).toBeInTheDocument();
  });

  it('geçersiz HAR ve büyük dosya için Türkçe hata', async () => {
    setInput('har', '{"log": {}}');
    const user = renderTool(HarTool);
    expect(screen.getByRole('alert')).toHaveTextContent('"log.entries" dizisi yok');

    const big = new File(['x'], 'buyuk.har');
    Object.defineProperty(big, 'size', { value: 51 * 1024 * 1024 });
    await user.upload(screen.getByLabelText('HAR dosyası seç'), big);
    expect(screen.getByRole('alert')).toHaveTextContent('Dosya çok büyük: en fazla 50,0 MB açılabilir.');
  });

  it('dosyadan yükler; kapatınca temizlenir', async () => {
    const user = renderTool(HarTool);
    await user.upload(screen.getByLabelText('HAR dosyası seç'), new File([HAR], 'kayit.har'));
    expect(await screen.findByText('kayit.har')).toBeInTheDocument();
    expect(rows()).toHaveLength(3);
    // Dosya içeriği yerel depolamaya yazılmaz.
    expect(useToolsStore.getState().inputs.har?.input ?? '').toBe('');
    await user.click(screen.getByRole('button', { name: /Kapat/ }));
    expect(screen.queryByRole('table', { name: 'HAR kayıtları' })).not.toBeInTheDocument();
  });
});
