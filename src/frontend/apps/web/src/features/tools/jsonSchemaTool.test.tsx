import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { useToolsStore } from './toolsStore';
import JsonSchemaTool from './tools/JsonSchemaTool';

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

const TOOL = 'json-schema';

function renderTool() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <JsonSchemaTool />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

const field = (name: string) => screen.getByRole('textbox', { name }) as HTMLTextAreaElement;
const set = (name: string, value: string) => useToolsStore.getState().setInput(TOOL, name, value);
const outputJson = async (name: string) => {
  await waitFor(() => expect(field(name).value).not.toBe(''));
  return JSON.parse(field(name).value) as Record<string, unknown>;
};

beforeEach(() => {
  localStorage.clear();
  useToolsStore.setState({ favorites: [], recent: [], inputs: {}, volatile: {}, rememberInputs: true });
});

describe('JSON Schema aracı', () => {
  it('JSON örneğinden şema çıkarır; seçenekler çıktıyı değiştirir', async () => {
    set('input', '{"id": 1, "eposta": "ayse@ornek.com"}');
    const user = renderTool();
    expect(await outputJson('JSON Schema')).toEqual({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: { id: { type: 'integer' }, eposta: { type: 'string', format: 'email' } },
      required: ['id', 'eposta'],
    });

    await user.selectOptions(screen.getByRole('combobox', { name: 'Şema sürümü' }), '07');
    await user.click(screen.getByRole('checkbox', { name: 'Biçimleri tanı (format)' }));
    await user.click(screen.getByRole('checkbox', { name: 'Ek alanlara izin verme' }));
    await user.type(screen.getByRole('textbox', { name: 'Şema başlığı' }), 'Kişi');
    await waitFor(() =>
      expect(JSON.parse(field('JSON Schema').value)).toEqual({
        $schema: 'http://json-schema.org/draft-07/schema#',
        title: 'Kişi',
        type: 'object',
        properties: { id: { type: 'integer' }, eposta: { type: 'string' } },
        required: ['id', 'eposta'],
        additionalProperties: false,
      }),
    );
  });

  it('geçersiz JSON için satır/sütunlu hata gösterir', async () => {
    set('input', '{"a": }');
    renderTool();
    expect(await screen.findByRole('alert')).toHaveTextContent('1. satır');
    expect(field('JSON Schema')).toHaveValue('');
  });

  it('şemadan örnek veri üretir; zorunlu alan ve rastgele seçenekleri', async () => {
    set('mode', 'sample');
    set(
      'input',
      JSON.stringify({
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'integer', minimum: 5 }, name: { type: 'string' } },
      }),
    );
    const user = renderTool();
    expect(await outputJson('Örnek veri')).toEqual({ id: 5, name: 'Ayşe Yılmaz' });

    await user.click(screen.getByRole('checkbox', { name: 'Yalnızca zorunlu alanlar' }));
    await waitFor(() => expect(JSON.parse(field('Örnek veri').value)).toEqual({ id: 5 }));

    await user.click(screen.getByRole('checkbox', { name: 'Rastgele' }));
    const seed = screen.getByRole('textbox', { name: 'Tohum' });
    await user.clear(seed);
    await user.type(seed, '42');
    await waitFor(() => expect(JSON.parse(field('Örnek veri').value).id).toBeGreaterThanOrEqual(5));
  });

  it('OpenAPI belgesinde şema seçilebilir; YAML okunur', async () => {
    set('mode', 'sample');
    set(
      'input',
      [
        'openapi: 3.0.0',
        'components:',
        '  schemas:',
        '    Pet:',
        '      type: object',
        '      properties:',
        '        tur: { type: string, enum: [kedi, köpek] }',
        '    Kisi:',
        '      type: object',
        '      properties:',
        '        dogum: { type: string, format: date }',
      ].join('\n'),
    );
    const user = renderTool();
    expect(await outputJson('Örnek veri')).toEqual({ tur: 'kedi' });
    await user.selectOptions(screen.getByRole('combobox', { name: 'OpenAPI şeması' }), 'Kisi');
    await waitFor(() => expect(JSON.parse(field('Örnek veri').value)).toEqual({ dogum: '2024-01-15' }));
  });

  it('harici $ref için açık hata verir', async () => {
    set('mode', 'sample');
    set('input', '{"$ref": "https://ornek.com/s.json"}');
    renderTool();
    expect(await screen.findByRole('alert')).toHaveTextContent('Harici $ref');
  });

  it('yer değiştir: çıkarılan şema girdiye geçer ve örnek üretilir', async () => {
    set('input', '{"ad": "Ali"}');
    const user = renderTool();
    await outputJson('JSON Schema');
    await user.click(screen.getByRole('button', { name: 'Çıktıyı girdiye al ve işlemi değiştir' }));
    expect(await outputJson('Örnek veri')).toEqual({ ad: 'Ayşe' });
    expect(field('Şema').value).toContain('"$schema"');
  });

  it('doğrula: hatalar yollarıyla listelenir, düzeltilince "uygun" yazar', async () => {
    set('mode', 'validate');
    set(
      'input',
      JSON.stringify({
        type: 'object',
        required: ['ad'],
        properties: { yas: { type: 'integer' }, eposta: { type: 'string', format: 'email' } },
      }),
    );
    set('data', '{"yas": "otuz", "eposta": "yok"}');
    const user = renderTool();
    const list = await screen.findByRole('list', { name: 'Doğrulama hataları' });
    expect(list).toHaveTextContent('Zorunlu alan eksik: "ad"');
    expect(list).toHaveTextContent('/yas');
    expect(list).toHaveTextContent('#/properties/yas/type');
    expect(list).toHaveTextContent('"email" biçimine uymuyor.');
    expect(screen.getByText('3 hata')).toBeInTheDocument();
    // Biçim denetimi kapatılınca format yalnızca açıklama olur.
    await user.click(screen.getByRole('checkbox', { name: 'Biçimleri denetle (format)' }));
    await waitFor(() => expect(screen.getByText('2 hata')).toBeInTheDocument());
    set('data', '{"ad": "Ada", "yas": 30}');
    expect(await screen.findByText('Veri şemaya uygun.')).toBeInTheDocument();
  });

  it('doğrula: bozuk veri ve harici $ref açık hata verir; diğer kiplerin girdisi korunur', async () => {
    set('mode', 'validate');
    set('input', '{"type": "object"}');
    set('data', '{"a": }');
    const user = renderTool();
    expect(await screen.findByRole('alert')).toHaveTextContent(/^Veri: 1\. satır/);
    set('input', '{"$ref": "https://ornek.com/s.json"}');
    set('data', '{}');
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Harici $ref'));
    await user.selectOptions(screen.getByRole('combobox', { name: 'İşlem' }), 'sample');
    expect(field('Şema').value).toBe('{"$ref": "https://ornek.com/s.json"}');
  });
});
