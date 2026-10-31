import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { ComponentType } from 'react';
import { useToolsStore } from './toolsStore';
import Base64Tool from './tools/Base64Tool';
import HashTool from './tools/HashTool';
import UrlTool from './tools/UrlTool';
import UuidTool from './tools/UuidTool';
import DiffTool from './tools/DiffTool';
import JsonConvertTool from './tools/JsonConvertTool';
import JsonFormatTool from './tools/JsonFormatTool';
import ModelTool from './tools/ModelTool';
import { useModelPrefs } from '../models/modelPrefs';
import JsonPathTool from './tools/JsonPathTool';
import JwtTool from './tools/JwtTool';
import RegexTool from './tools/RegexTool';
import TimestampTool from './tools/TimestampTool';

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

describe('Base64 aracı', () => {
  it('metni kodlar; yer değiştirince çözer', async () => {
    const user = renderTool(Base64Tool);
    await user.type(field('Metin'), 'Merhaba dünya');
    expect(field('Base64')).toHaveValue('TWVyaGFiYSBkw7xueWE=');

    await user.click(screen.getByRole('button', { name: 'Yer değiştir' }));
    expect(field('Base64')).toHaveValue('TWVyaGFiYSBkw7xueWE=');
    expect(field('Çözülmüş metin')).toHaveValue('Merhaba dünya');
  });

  it('URL-safe seçeneği', async () => {
    setInput('base64', 'ûÿ');
    const user = renderTool(Base64Tool);
    const standard = field('Base64').value;
    await user.click(screen.getByRole('checkbox', { name: /URL-safe/ }));
    expect(field('Base64').value).not.toMatch(/[+/=]/);
    expect(field('Base64').value).not.toBe(standard);
  });

  it('geçersiz Base64 çözülürken hata gösterir', () => {
    setInput('base64', 'decode', 'direction');
    setInput('base64', 'Zm9v!YmFy');
    renderTool(Base64Tool);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});

describe('URL aracı', () => {
  it('kodlar ve çözer', async () => {
    const user = renderTool(UrlTool);
    await user.type(field('Metin'), 'a b&ç');
    expect(field('Kodlanmış metin')).toHaveValue('a%20b%26%C3%A7');

    await user.selectOptions(screen.getByRole('combobox', { name: /İşlem/ }), 'decode');
    expect(field('Çözülmüş metin')).toHaveValue('a b&ç');
  });

  it('bozuk % dizisinde hata', () => {
    setInput('url', 'decode', 'direction');
    setInput('url', '%E0%A4%A');
    renderTool(UrlTool);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});

describe('Hash aracı', () => {
  it('"abc" için MD5 ve SHA-256 gösterir', async () => {
    const user = renderTool(HashTool);
    await user.type(field('Metin'), 'abc');
    expect(await screen.findByText('900150983cd24fb0d6963f7d28e17f72')).toBeInTheDocument();
    expect(
      screen.getByText('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'),
    ).toBeInTheDocument();
  });

  it('HMAC anahtarı diske yazılmaz', async () => {
    setInput('hash', 'hmac', 'mode');
    setInput('hash', 'what do ya want for nothing?');
    const user = renderTool(HashTool);
    await user.type(screen.getByRole('textbox', { name: 'HMAC anahtarı' }), 'Jefe');
    expect(
      await screen.findByText('5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843'),
    ).toBeInTheDocument();
    expect(localStorage.getItem('apivator-tools')).not.toContain('Jefe');
  });
});

describe('UUID aracı', () => {
  it('varsayılan 10 adet v4 üretir', () => {
    renderTool(UuidTool);
    const ids = (screen.getByRole('textbox', { name: /Üretilen UUID/ }) as HTMLTextAreaElement).value.split(
      '\n',
    );
    expect(ids).toHaveLength(10);
    for (const id of ids)
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('v7 seçilince sürüm 7 ve inceleme zamanı gösterir', async () => {
    const user = renderTool(UuidTool);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Tür' }), '7');
    await waitFor(() =>
      expect((screen.getByRole('textbox', { name: /Üretilen UUID/ }) as HTMLTextAreaElement).value).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7/,
      ),
    );
    await user.type(
      screen.getByRole('textbox', { name: 'İncelenecek kimlik' }),
      '017F22E2-79B0-7CC3-98C4-DC0C0C07398F',
    );
    expect(screen.getByText(/2022-02-22T19:22:22\.000Z/)).toBeInTheDocument();
  });

  it('geçersiz UUID uyarısı', async () => {
    const user = renderTool(UuidTool);
    await user.type(screen.getByRole('textbox', { name: 'İncelenecek kimlik' }), 'merhaba');
    expect(screen.getByText('Geçerli bir UUID ya da ULID değil.')).toBeInTheDocument();
  });
});

const JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

describe('JWT aracı', () => {
  it('header ve payload çözer, imzayı doğrular', async () => {
    setInput('jwt', JWT);
    const user = renderTool(JwtTool);
    expect(screen.getByText('alg: HS256')).toBeInTheDocument();
    expect(field('Payload').value).toContain('John Doe');
    await user.type(screen.getByRole('textbox', { name: 'Doğrulama anahtarı' }), 'your-256-bit-secret');
    expect(await screen.findByText('İmza geçerli')).toBeInTheDocument();
    expect(localStorage.getItem('apivator-tools')).not.toContain('your-256-bit-secret');
  });

  it('yanlış anahtarda imza geçersiz; bozuk tokenda hata', async () => {
    setInput('jwt', JWT);
    const user = renderTool(JwtTool);
    await user.type(screen.getByRole('textbox', { name: 'Doğrulama anahtarı' }), 'yanlış');
    expect(await screen.findByText(/İmza geçersiz/)).toBeInTheDocument();
    await user.clear(field('JWT'));
    await user.type(field('JWT'), 'abc');
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});

describe('JSON biçimlendirici', () => {
  it('biçimlendirir ve küçültür', async () => {
    setInput('json-format', '{"b":1,"a":[1,2]}');
    const user = renderTool(JsonFormatTool);
    expect(field('Sonuç')).toHaveValue('{\n  "b": 1,\n  "a": [\n    1,\n    2\n  ]\n}');
    await user.selectOptions(screen.getByRole('combobox', { name: /Girinti/ }), '0');
    expect(field('Sonuç')).toHaveValue('{"b":1,"a":[1,2]}');
  });

  it('geçersiz JSON için satır/sütun', () => {
    setInput('json-format', '{\n  "a": }');
    renderTool(JsonFormatTool);
    expect(screen.getByRole('alert')).toHaveTextContent('2. satır, 8. sütun');
  });
});

describe('JSONPath aracı', () => {
  it('ifadenin eşleşmelerini gösterir; hatalı ifadede hata', async () => {
    setInput(
      'jsonpath',
      JSON.stringify({
        kitaplar: [
          { id: 1, fiyat: 8 },
          { id: 2, fiyat: 12 },
        ],
      }),
    );
    const user = renderTool(JsonPathTool);
    const expression = screen.getByRole('textbox', { name: 'JSONPath ifadesi' });
    await user.clear(expression);
    await user.click(expression);
    await user.paste('$.kitaplar[?(@.fiyat < 10)].id');
    expect(JSON.parse(field('Sonuç JSON').value)).toEqual([1]);
    expect(screen.getByText('1 eşleşme')).toBeInTheDocument();

    await user.clear(expression);
    await user.click(expression);
    await user.paste('$.kitaplar[');
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});

describe('Fark aracı', () => {
  it('JSON yapısal farkı özetler', async () => {
    setInput('diff', 'json', 'mode');
    setInput('diff', '{"a":1,"b":2}');
    setInput('diff', '{"b":3,"c":4}', 'right');
    renderTool(DiffTool);
    expect(screen.getByText('1 eklendi, 1 silindi, 1 değişti')).toBeInTheDocument();
  });

  it('aynı JSON için fark yok', () => {
    setInput('diff', 'json', 'mode');
    setInput('diff', '{"a":1,"b":2}');
    setInput('diff', '{"b":2,"a":1}', 'right');
    renderTool(DiffTool);
    expect(screen.getByText('Fark yok')).toBeInTheDocument();
  });

  it('metin farkında eklenen/silinen satırlar', () => {
    setInput('diff', 'bir\niki\nüç');
    setInput('diff', 'bir\nIKI\nüç\ndört', 'right');
    renderTool(DiffTool);
    expect(screen.getByText('+2')).toBeInTheDocument();
    expect(screen.getByText('−1')).toBeInTheDocument();
  });
});

describe('JSON dönüştürücü', () => {
  it('JSON → CSV (varsayılan ; ayırıcı)', () => {
    setInput(
      'json-convert',
      JSON.stringify([
        { id: 1, ad: 'Ali' },
        { id: 2, ad: 'Ayşe' },
      ]),
    );
    renderTool(JsonConvertTool);
    expect(field('CSV').value.trim().split(/\r?\n/)).toEqual(['id;ad', '1;Ali', '2;Ayşe']);
  });

  it('JSON → YAML', async () => {
    setInput('json-convert', 'json-yaml', 'mode');
    setInput('json-convert', '{"ad":"Çağrı"}');
    renderTool(JsonConvertTool);
    expect(field('YAML').value).toContain('ad: Çağrı');
  });
});

describe('JSON → model', () => {
  it('JSON örneğinden C# sınıfı üretir; nesne dizisinde eksik alan opsiyonel olur', async () => {
    useModelPrefs.getState().set({ language: 'csharp' });
    setInput('json-model', 'User', 'rootName');
    setInput('json-model', JSON.stringify([{ id: 1, name: 'Ali' }, { id: 2 }]));
    renderTool(ModelTool);
    const output = (await screen.findByRole('textbox', { name: /.cs$/ })) as HTMLTextAreaElement;
    expect(output.value).toContain('class User');
    expect(output.value).toContain('public string? Name');
  });

  it('geçersiz JSON için hata', async () => {
    setInput('json-model', '{ bozuk');
    renderTool(ModelTool);
    expect(await screen.findByRole('alert')).toHaveTextContent('Geçerli bir JSON değil');
  });
});

describe('Regex aracı', () => {
  it('eşleşmeleri ve grupları listeler', async () => {
    setInput('regex', '(\\d{4})-(\\d{2})', 'pattern');
    setInput('regex', 'a 2026-10 b 2025-01');
    renderTool(RegexTool);
    expect(await screen.findByText('2 eşleşme')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Eşleşme listesi' })).toHaveTextContent('2026-10');
  });

  it('geçersiz ifadede hata', async () => {
    setInput('regex', '(abc', 'pattern');
    setInput('regex', 'abc');
    renderTool(RegexTool);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});

describe('Zaman damgası aracı', () => {
  it('saniyeyi UTC ve RFC 1123 olarak gösterir', () => {
    setInput('timestamp', 'UTC', 'zone');
    setInput('timestamp', '1793271900');
    renderTool(TimestampTool);
    expect(screen.getByText('2026-10-29T11:05:00.000Z')).toBeInTheDocument();
    expect(screen.getByText('Thu, 29 Oct 2026 11:05:00 GMT')).toBeInTheDocument();
  });

  it('tanınmayan girdide hata', () => {
    setInput('timestamp', 'merhaba');
    renderTool(TimestampTool);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
