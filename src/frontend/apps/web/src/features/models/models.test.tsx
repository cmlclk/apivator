import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ModelDialog } from './ModelDialog';
import { jsonSamples, parseJsonSample, rootNameFor, type ModelSource } from './sources';
import { useModelPrefs } from './modelPrefs';

const saveFile = vi.hoisted(() => vi.fn());
vi.mock('../../lib/download', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/download')>()),
  saveFile,
}));

const response = {
  data: [
    { id: 1, order_no: 'A-1', total: 12.5, note: null },
    { id: 2, order_no: 'A-2', total: 3, note: 'x', extra: true },
  ],
};

const samples = (value: unknown = response): Extract<ModelSource, { kind: 'samples' }> => ({
  id: 'response',
  label: 'Bu yanıt',
  kind: 'samples',
  rootName: 'OrderListResponse',
  samples: async () => [value],
});

/** Salt okunur CodeMirror içeriği. */
const code = async () => (await screen.findByRole('textbox', { name: 'Üretilen model' })).textContent ?? '';

beforeEach(() => {
  saveFile.mockReset();
  saveFile.mockResolvedValue(true);
  useModelPrefs.setState({
    language: 'csharp',
    namespaces: {},
    decimal: false,
    csharp: { style: 'class', serializer: 'system-text-json' },
    java: { style: 'class', lombok: false },
    typescript: { zod: false },
    python: { style: 'pydantic' },
  });
});

describe('kaynak yardımcıları', () => {
  it('istek gövdesindeki tırnaksız değişkenleri null sayar; tırnaklıları metin bırakır', () => {
    expect(parseJsonSample('{"id": {{id}}, "ad": "{{ad}}"}')).toEqual({ id: null, ad: '{{ad}}' });
    expect(parseJsonSample('bozuk')).toBeUndefined();
    expect(jsonSamples(['{"a":1}', '', null, 'x', '[1]'])).toEqual([{ a: 1 }, [1]]);
  });

  it('istek adından kök sınıf adı', () => {
    expect(rootNameFor('Siparişleri listele', 'Response')).toBe('SiparisleriListeleResponse');
    expect(rootNameFor('2FA doğrula', 'Request')).toBe('N2FADogrulaRequest');
    expect(rootNameFor(undefined, 'Response')).toBe('RootResponse');
    expect(rootNameFor('Login request', 'Request')).toBe('LoginRequest');
  });
});

describe('model penceresi', () => {
  it('yanıttan C# üretir; dil ve seçenek değişince kod yenilenir ve tercih hatırlanır', async () => {
    render(<ModelDialog sources={[samples()]} onClose={vi.fn()} />);
    const user = userEvent.setup();

    await waitFor(async () => expect(await code()).toContain('public sealed class OrderListResponse'));
    expect(await code()).toContain('[JsonPropertyName("order_no")]');
    expect(await code()).toContain('public sealed class DataModel');

    await user.selectOptions(screen.getByLabelText('C# stili'), 'record');
    await waitFor(async () => expect(await code()).toContain('public sealed record DataModel('));

    await user.type(screen.getByLabelText('Namespace'), 'Acme.Api');
    await waitFor(async () => expect(await code()).toContain('namespace Acme.Api;'));

    await user.selectOptions(screen.getByLabelText('Model dili'), 'go');
    await waitFor(async () => expect(await code()).toContain('package models'));
    expect(useModelPrefs.getState().language).toBe('go');
    expect(useModelPrefs.getState().namespaces.csharp).toBe('Acme.Api');
  });

  it('Java her tip için ayrı dosya: sekmeler ve ZIP indirme', async () => {
    useModelPrefs.setState({ language: 'java' });
    render(<ModelDialog sources={[samples()]} onClose={vi.fn()} />);
    const user = userEvent.setup();

    const tabs = await screen.findByRole('tablist', { name: 'Dosyalar' });
    expect(
      within(tabs)
        .getAllByRole('tab')
        .map((t) => t.textContent),
    ).toEqual(['OrderListResponse.java', 'DataModel.java']);
    await user.click(within(tabs).getByRole('tab', { name: 'DataModel.java' }));
    await waitFor(async () => expect(await code()).toContain('public class DataModel {'));

    await user.click(screen.getByRole('button', { name: 'ZIP olarak indir' }));
    await waitFor(() => expect(saveFile).toHaveBeenCalledOnce());
    expect(saveFile.mock.calls[0]![0].fileName).toBe('OrderListResponse.zip');
  });

  it('kök adı değiştirilebilir; tek dosya olarak indirilir', async () => {
    useModelPrefs.setState({ language: 'typescript' });
    render(<ModelDialog sources={[samples([{ id: 1 }])]} onClose={vi.fn()} />);
    const user = userEvent.setup();

    await waitFor(async () => expect(await code()).toContain('export interface OrderListResponse'));
    const root = screen.getByLabelText('Kök sınıf adı');
    await user.clear(root);
    await user.type(root, 'Urun');
    await waitFor(async () => expect(await code()).toContain('export interface Urun {'));
    expect(await code()).toContain('export type Root = Urun[];');

    await user.click(screen.getByRole('button', { name: 'Dosya olarak indir' }));
    await waitFor(() => expect(saveFile).toHaveBeenCalledOnce());
    expect(saveFile.mock.calls[0]![0].fileName).toBe('Urun.ts');
  });

  it('şema kaynağı (gRPC mesajı) ve kaynak değiştirme', async () => {
    useModelPrefs.setState({ language: 'python' });
    const schema: ModelSource = {
      id: 'out',
      label: 'Yanıt mesajı (Urun)',
      kind: 'schema',
      rootName: 'Urun',
      schema: {
        title: 'Urun',
        $ref: '#/$defs/Urun',
        $defs: { Urun: { type: 'object', properties: { ad: { type: 'string' } }, required: ['ad'] } },
      },
    };
    render(<ModelDialog sources={[schema, samples()]} onClose={vi.fn()} />);
    const user = userEvent.setup();

    await waitFor(async () => expect(await code()).toContain('class Urun(BaseModel):'));
    await user.selectOptions(screen.getByLabelText('Model kaynağı'), 'response');
    await waitFor(async () => expect(await code()).toContain('class OrderListResponse(BaseModel):'));
    expect(screen.getByLabelText('Kök sınıf adı')).toHaveValue('OrderListResponse');
  });

  it('örnek yoksa ve şema bozuksa anlaşılır hata', async () => {
    render(<ModelDialog sources={[{ ...samples(), samples: async () => [] }]} onClose={vi.fn()} />);
    expect(await screen.findByText('Bu kaynakta JSON örnek yok.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dosya olarak indir' })).toBeDisabled();
  });
});
