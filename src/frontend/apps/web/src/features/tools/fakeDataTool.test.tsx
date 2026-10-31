import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { createFakeContext, ibanValid, luhnValid, tcknValid } from '@apivator/core/tools';
import { useToolsStore } from './toolsStore';
import FakeDataTool from './tools/FakeDataTool';
import {
  FAKE_CHUNK,
  formatRecords,
  generateRecords,
  parseSchema,
  type FakeRecord,
} from './tools/fakeDataFormat';

vi.mock('../../lib/useWorkspaces', () => ({
  useWorkspaces: () => ({ current: { id: 'w1', role: 'Admin' }, workspaces: [] }),
}));

// CodeMirror jsdom'da ölçüm yapamıyor; düz bir metin alanı yeterli.
vi.mock('../requests/CodeEditor', () => ({
  CodeEditor: ({ value, label }: { value: string; label: string }) => (
    <textarea aria-label={label} value={value} readOnly />
  ),
}));

const output = () => screen.getByRole('textbox', { name: /^Sahte veri \(/ }) as HTMLTextAreaElement;
const setField = (name: string, value: string) => useToolsStore.getState().setInput('fake-data', name, value);

function renderTool() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <FakeDataTool />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

beforeEach(() => {
  localStorage.clear();
  useToolsStore.setState({ favorites: [], recent: [], inputs: {}, volatile: {}, rememberInputs: true });
});

describe('şema ve biçimler', () => {
  it('şemayı ayrıştırır; hataları satır numarasıyla bildirir', () => {
    expect(parseSchema('ad: firstName\n# yorum\n\nposta:email')).toEqual({
      fields: [
        { name: 'ad', generator: 'firstName' },
        { name: 'posta', generator: 'email' },
      ],
      errors: [],
    });
    const bad = parseSchema('ad: yok\n: email\nx: tckn\nx: iban');
    expect(bad.errors).toEqual([
      '1. satır: bilinmeyen üreteç "yok".',
      '2. satır: alan adı eksik (alan: üreteç).',
      '4. satır: "x" alanı tekrar ediyor.',
    ]);
  });

  const fields = [
    { name: 'ad', generator: 'firstName' as const },
    { name: 'fiyat', generator: 'price' as const },
    { name: 'aktif', generator: 'boolean' as const },
  ];
  const records: FakeRecord[] = [{ ad: 'O\'Neil; "x"', fiyat: 12.5, aktif: true }];

  it('CSV: noktalı virgül, ondalık virgül, tırnaklama', () => {
    expect(formatRecords(records, fields, 'csv')).toBe('ad;fiyat;aktif\r\n"O\'Neil; ""x""";12,5;true\r\n');
  });

  it('SQL INSERT: tanımlayıcı ve değer kaçışları', () => {
    expect(formatRecords(records, fields, 'sql', 'app.kullanici')).toBe(
      `INSERT INTO "app"."kullanici" ("ad", "fiyat", "aktif") VALUES ('O''Neil; "x"', 12.5, TRUE);`,
    );
  });

  it('parça parça üretir, iptalde null döner', async () => {
    const progress: number[] = [];
    const ctx = createFakeContext({ seed: 'p' });
    const result = await generateRecords(fields, FAKE_CHUNK * 2 + 1, ctx, {
      onProgress: (n) => progress.push(n),
    });
    expect(result).toHaveLength(FAKE_CHUNK * 2 + 1);
    expect(progress).toEqual([FAKE_CHUNK, FAKE_CHUNK * 2, FAKE_CHUNK * 2 + 1]);

    const controller = new AbortController();
    const pending = generateRecords(fields, 10_000, ctx, { signal: controller.signal });
    controller.abort();
    expect(await pending).toBeNull();
  });
});

describe('sahte veri aracı', () => {
  it('varsayılan şemayla geçerli TCKN, IBAN ve güvenli e-posta üretir', async () => {
    setField('count', '25');
    renderTool();
    await waitFor(() => expect(output().value).not.toBe(''));
    const rows = JSON.parse(output().value) as Record<string, string>[];
    expect(rows).toHaveLength(25);
    for (const row of rows) {
      expect(tcknValid(row.tckn!)).toBe(true);
      expect(ibanValid(row.iban!)).toBe(true);
      expect(row.eposta).toMatch(/@(example\.(com|net|org)|ornek\.test)$/);
    }
  });

  it('aynı tohum aynı çıktıyı verir; CSV ve SQL biçimleri', async () => {
    setField('count', '5');
    setField('seed', 'apivator');
    setField('schema', 'kart: creditCard\nad: fullName');
    const user = renderTool();
    await waitFor(() => expect(output().value).not.toBe(''));
    const first = output().value;
    for (const row of JSON.parse(first) as { kart: string }[]) expect(luhnValid(row.kart)).toBe(true);
    expect(screen.getByRole('button', { name: /Yeniden üret/ })).toBeDisabled();

    await user.selectOptions(screen.getByLabelText('Biçim'), 'csv');
    expect(output().value.split(/\r?\n/)[0]).toBe('kart;ad');
    await user.selectOptions(screen.getByLabelText('Biçim'), 'sql');
    await user.clear(screen.getByLabelText('Tablo adı'));
    await user.type(screen.getByLabelText('Tablo adı'), 'musteri');
    expect(output().value).toMatch(/^INSERT INTO "musteri" \("kart", "ad"\) VALUES \('\d{16}', '/);

    await user.selectOptions(screen.getByLabelText('Biçim'), 'json');
    expect(output().value).toBe(first);
  });

  it('şema hatasını gösterir; alan ekler', async () => {
    setField('schema', 'x: bilinmeyen');
    const user = renderTool();
    expect(screen.getByRole('alert')).toHaveTextContent('bilinmeyen üreteç');
    await user.clear(screen.getByLabelText(/Şema/));
    await user.selectOptions(screen.getByLabelText('Alan ekle'), 'tckn');
    expect(screen.getByLabelText(/Şema/)).toHaveValue('tckn: tckn');
    await waitFor(() => expect(output().value).toContain('"tckn"'));
  });

  it('doğrulayıcı TCKN, Luhn ve IBAN sonucunu gösterir; girdi diske yazılmaz', async () => {
    const user = renderTool();
    await user.type(screen.getByLabelText('Doğrulanacak numara'), '10000000146');
    const result = () => screen.getByRole('list', { name: 'Doğrulama sonucu' });
    expect(result()).toHaveTextContent('TCKN: geçerli');
    expect(result()).toHaveTextContent('IBAN: geçersiz');
    await user.clear(screen.getByLabelText('Doğrulanacak numara'));
    await user.type(screen.getByLabelText('Doğrulanacak numara'), 'GB82 WEST 1234 5698 7654 32');
    expect(result()).toHaveTextContent('IBAN: geçerli');
    expect(localStorage.getItem('apivator-tools') ?? '').not.toContain('WEST');
  });
});
