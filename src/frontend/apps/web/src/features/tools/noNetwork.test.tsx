import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { INTERMEDIATE_PEM, LEAF_PEM, ROOT_PEM } from '../../../../../packages/core/src/tools/x509.fixtures';
import { TOOLS } from './registry';
import { ToolsPage } from './ToolsPage';
import { useToolsStore } from './toolsStore';

// "Araçlar ağ isteği yapmaz" sözü: kayıttaki her araç açılıp örnek girdiyle çalıştırılır, hiçbir ağ API'si
// çağrılmamalı. Liste TOOLS'tan okunur; yeni araçlar kendiliğinden kapsanır.

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

/** Çoğu aracın ana alanı `input`; JSON hem metin hem JSON araçlarını çalıştırır. */
const SAMPLE = '{"id":1,"name":"Ada","token":"eyJhbGciOiJIUzI1NiJ9.e30.x","url":"https://example.com/a?b=1"}';
/** JSON'u girdi olarak kabul etmeyen araçların anlamlı örnekleri ve çıktıda beklenen metin. */
const SAMPLES: Record<string, { input: string; expected: RegExp; fields?: Record<string, string> }> = {
  'curl-code': {
    input: "curl -X POST 'https://example.com/api' -H 'Content-Type: application/json' -d '{\"a\":1}'",
    expected: /fetch\(/,
  },
  har: {
    input: JSON.stringify({
      log: {
        version: '1.2',
        entries: [
          {
            startedDateTime: '2024-01-01T00:00:00Z',
            time: 12,
            request: { method: 'GET', url: 'https://example.com/v1/users', headers: [] },
            response: { status: 200, content: { mimeType: 'application/json', text: '{"id":1}' } },
          },
        ],
      },
    }),
    // Araç çubuğundaki özet; yalnızca HAR çözülünce görünür.
    expected: /HAR 1\.2/,
  },
  // Zincir: AIA/CRL adresleri gösterilir ama hiçbir zaman istenmez; imza Web Crypto ile yerelde doğrulanır.
  certificate: {
    input: [LEAF_PEM, INTERMEDIATE_PEM, ROOT_PEM].join('\n'),
    expected: /öz-imzalı köke ulaşıyor/,
  },
  'basic-auth': { input: 'Basic YWRhLWxvdmVsYWNlOnMzY3JldA==', expected: /ada-lovelace/ },
  pkce: {
    input: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
    expected: /E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM/,
  },
  bcrypt: {
    input: '$2a$06$If6bvum7DFjUnE9p2uDeDu0YHzrHM6tf.iqN8.yx.jNN1ILEf7h0i',
    expected: /If6bvum7DFjUnE9p2uDeDu/,
  },
  // Üreteçler girdiye bakmaz; varsayılan seçeneklerle gerçek çıktı üretildiği denetlenir.
  uuid: { input: '', expected: /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-/ },
  lorem: { input: '', expected: /^Lorem ipsum dolor sit amet/ },
  random: { input: '', expected: /^\d+\n\d+/ },
  qr: { input: 'https://example.com', expected: /Sürüm \d+ · \d+×\d+ modül/ },
  'fake-data': { input: '', expected: /@(example\.(com|net|org)|ornek\.test)/ },
  // Cron ifadesi `input` değil `expr` alanında; varsayılan ifadenin açıklaması ve çalıştırmaları denetlenir.
  cron: { input: '', expected: /Her 15 dakikada bir/ },
  'number-base': { input: '255', expected: /11111111/ },
  'byte-units': { input: '1 GiB', expected: /1073741824|1\.073\.741\.824|1,073,741,824|1 073 741 824/ },
  color: { input: '#ff0000', expected: /rgb\(255, 0, 0\)/ },
  'url-parser': { input: 'https://çiçek.com.tr:8443/a%20b?q=1', expected: /xn--iek-1lab\.com\.tr/ },
  // Başvuru aracı girdiye bakmaz; yerel tablodan durum kodu listelenir.
  'http-reference': { input: '', expected: /Unavailable For Legal Reasons/ },
  cookie: { input: 'Set-Cookie: sid=abc; Path=/; SameSite=None', expected: /Secure zorunlu/ },
  'user-agent': {
    input:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
    expected: /Microsoft Edge 120/,
  },
  cidr: { input: '192.168.1.0/24', expected: /192\.168\.1\.255/ },
  'case-convert': { input: 'müşteri_adı IŞIK', expected: /müşteriAdıIşık/ },
  slug: { input: 'Çılgın Şehir & Ötesi!', expected: /cilgin-sehir-otesi/ },
  // Adım zinciri ayrı alanda kayıtlı; eksik seçenekler varsayılana döner.
  'line-ops': {
    input: 'çay\nbal\ncam',
    fields: { steps: '[{"kind":"sort"},{"kind":"number"}]' },
    expected: /^1\. bal\n2\. cam\n3\. çay$/,
  },
  'text-stats': { input: 'Işık ışık geldi.', expected: /ışık2/ },
  'byte-view': { input: 'çay', expected: /c3 a7 61 79/ },
  'sql-insert': { input: 'ad;yas\nÇağrı;30', expected: /INSERT INTO "tablo"/ },
};
/** Debounce'lu hesapların (hash, regex) tamamlanması için beklenen süre. */
const SETTLE_MS = 400;

const network = {
  fetch: vi.fn(() => Promise.reject(new Error('Araçlar ağ isteği yapmamalı.'))),
  xhrOpen: vi.fn(),
  xhrSend: vi.fn(),
  sendBeacon: vi.fn(() => false),
  WebSocket: vi.fn(),
  EventSource: vi.fn(),
};

function expectNoNetwork() {
  for (const [name, spy] of Object.entries(network)) {
    expect(spy, `${name} çağrıldı`).not.toHaveBeenCalled();
  }
}

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

beforeEach(() => {
  localStorage.clear();
  useToolsStore.setState({ favorites: [], recent: [], inputs: {}, volatile: {}, rememberInputs: true });
  for (const spy of Object.values(network)) spy.mockClear();
  vi.stubGlobal('fetch', network.fetch);
  vi.stubGlobal('WebSocket', network.WebSocket);
  vi.stubGlobal('EventSource', network.EventSource);
  vi.spyOn(XMLHttpRequest.prototype, 'open').mockImplementation(network.xhrOpen);
  vi.spyOn(XMLHttpRequest.prototype, 'send').mockImplementation(network.xhrSend);
  Object.defineProperty(navigator, 'sendBeacon', { value: network.sendBeacon, configurable: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Araçlar ağ isteği yapmaz', () => {
  it('kayıtta araç var', () => {
    expect(TOOLS.length).toBeGreaterThan(0);
  });

  it('araç ana sayfası', async () => {
    renderTools('/tools');
    expect(await screen.findByRole('heading', { name: 'Geliştirici araçları' })).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    expectNoNetwork();
  });

  it.each(TOOLS.map((tool) => [tool.id, tool] as const))('%s', async (_id, tool) => {
    const sample = SAMPLES[tool.id];
    useToolsStore.getState().setInput(tool.id, 'input', sample?.input ?? SAMPLE);
    for (const [name, value] of Object.entries(sample?.fields ?? {})) {
      useToolsStore.getState().setInput(tool.id, name, value);
    }
    renderTools(`/tools/${tool.id}`);
    const heading = await screen.findByRole('heading', { name: tool.name, level: 1 });
    // Başlığın kardeşi aracın kendisi; tembel yüklenen parça gelene kadar yalnızca boş bir spinner var.
    // Tüm paket paralel koşarken tembel parçalar 5 sn'yi aşabildiğinden süre geniş tutulur.
    await waitFor(() => expect(heading.closest('header')!.nextElementSibling?.textContent).toBeTruthy(), {
      timeout: 10_000,
    });
    expect(screen.queryByText(/Araç açılamadı/)).not.toBeInTheDocument();
    if (sample) {
      // Örnek gerçekten işlendi: çıktı ya metin alanında ya da sayfada (HAR tablosu).
      await waitFor(
        () => {
          const values = screen.getAllByRole('textbox').map((el) => (el as HTMLTextAreaElement).value);
          expect([document.body.textContent ?? '', ...values].some((t) => sample.expected.test(t))).toBe(
            true,
          );
        },
        { timeout: 10_000 },
      );
    }
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    expectNoNetwork();
  });
});
