import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { ComponentType } from 'react';
import { aesEncrypt, hexToBytes, toHex, utf8Encode } from '@apivator/core/tools';
import { useToolsStore } from './toolsStore';
import AesTool from './tools/AesTool';
import KeyPairTool from './tools/KeyPairTool';

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
const setField = (toolId: string, name: string, value: string, remember = true) =>
  useToolsStore.getState().setInput(toolId, name, value, remember);
const SLOW = { timeout: 5000 };
const KEY = '000102030405060708090a0b0c0d0e0f';
const IV = 'cafebabefacedbaddecaf888';

beforeEach(() => {
  localStorage.clear();
  useToolsStore.setState({ favorites: [], recent: [], inputs: {}, volatile: {}, rememberInputs: true });
});

describe('AES aracı', () => {
  it('GCM ile şifreler (ayrı düzen, hex); çözmeye aktarınca metni geri verir', async () => {
    setField('aes', 'keySize', '128');
    setField('aes', 'iv', IV, false);
    setField('aes', 'layout', 'separate');
    setField('aes', 'dataFormat', 'hex');
    setField('aes', 'key', KEY, false);
    setField('aes', 'input', 'merhaba dünya', false);
    const user = renderTool(AesTool);

    const expected = toHex(
      await aesEncrypt(
        { mode: 'AES-GCM', key: hexToBytes(KEY), iv: hexToBytes(IV) },
        utf8Encode('merhaba dünya'),
      ),
    );
    await waitFor(() => expect(field('Şifreli veri')).toHaveValue(expected), SLOW);

    await user.click(screen.getByRole('button', { name: 'Çözmeye aktar' }));
    await waitFor(() => expect(field('Düz metin')).toHaveValue('merhaba dünya'), SLOW);
  });

  it('birleşik düzende IV başa eklenir; yanlış anahtarla anlaşılır hata', async () => {
    setField('aes', 'keySize', '128');
    setField('aes', 'iv', IV, false);
    setField('aes', 'dataFormat', 'hex');
    setField('aes', 'key', KEY, false);
    setField('aes', 'input', 'abc', false);
    const user = renderTool(AesTool);
    await waitFor(() => expect(field('Şifreli veri').value.startsWith(IV)).toBe(true), SLOW);

    await user.click(screen.getByRole('button', { name: 'Çözmeye aktar' }));
    await waitFor(() => expect(field('Düz metin')).toHaveValue('abc'), SLOW);
    // Birleşik çözmede IV verinin içinden okunur; alan gösterilmez.
    expect(screen.queryByRole('textbox', { name: 'IV' })).toBeNull();

    const keyInput = screen.getByRole('textbox', { name: 'AES anahtarı' });
    await user.clear(keyInput);
    await user.type(keyInput, 'ff'.repeat(16));
    expect(await screen.findByText(/GCM doğrulama etiketi eşleşmedi/, undefined, SLOW)).toBeInTheDocument();
    // Tuş tuş yazma tam takım paralel koşarken 5 sn varsayılanını aşabiliyor.
  }, 15_000);

  it('anahtar boyu uyuşmazlığını söyler; anahtar ve metin diske yazılmaz', async () => {
    setField('aes', 'keySize', '256');
    setField('aes', 'key', KEY, false);
    setField('aes', 'input', 'gizli metin', false);
    renderTool(AesTool);
    expect(
      await screen.findByText(/Anahtar 32 bayt \(256 bit\) olmalı; 16 bayt verildi/),
    ).toBeInTheDocument();
    await waitFor(() => expect(localStorage.getItem('apivator-tools')).toBeTruthy());
    const saved = localStorage.getItem('apivator-tools')!;
    expect(saved).not.toContain(KEY);
    expect(saved).not.toContain('gizli metin');
  });

  it('paroladan PBKDF2-SHA256 ile anahtar türetir ve gösterir', async () => {
    setField('aes', 'keySource', 'passphrase');
    setField('aes', 'salt', '73616c74'); // "salt"
    setField('aes', 'iterations', '1');
    setField('aes', 'showDerived', '1');
    const user = renderTool(AesTool);
    await user.type(screen.getByLabelText('Parola'), 'passwd');
    expect(
      await screen.findByText(
        '55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc',
        undefined,
        SLOW,
      ),
    ).toBeInTheDocument();
    expect(localStorage.getItem('apivator-tools') ?? '').not.toContain('passwd');
  }, 15_000);

  it('modu değiştirince IV yeni uzunlukta üretilir', async () => {
    const user = renderTool(AesTool);
    const iv = () => (screen.getByRole('textbox', { name: 'IV' }) as HTMLInputElement).value;
    await waitFor(() => expect(iv()).toMatch(/^[0-9a-f]{24}$/));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Mod' }), 'AES-CBC');
    expect(iv()).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('Anahtar çifti aracı', () => {
  it('ECDSA çifti üretir; PEM, JWK ve parmak izi; özel anahtar kaydedilmez', async () => {
    setField('key-pair', 'algorithm', 'ECDSA');
    setField('key-pair', 'curve', 'P-384');
    const user = renderTool(KeyPairTool);
    await user.click(screen.getByRole('button', { name: /Anahtar çifti üret/ }));

    await screen.findByRole('textbox', { name: 'Özel anahtar (PEM)' }, SLOW);
    const privatePem = field('Özel anahtar (PEM)').value;
    expect(privatePem).toMatch(/^-----BEGIN PRIVATE KEY-----/);
    expect(field('Açık anahtar (PEM)').value).toMatch(/^-----BEGIN PUBLIC KEY-----/);
    expect(screen.getAllByRole('button', { name: 'Dosyaya indir' })).toHaveLength(2);
    expect(screen.getByText(/parmak izi/)).toBeInTheDocument();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Biçim' }), 'jwk');
    expect(JSON.parse(field('Özel anahtar (JWK)').value)).toMatchObject({ kty: 'EC', crv: 'P-384' });

    expect(localStorage.getItem('apivator-tools') ?? '').not.toContain(privatePem.split('\n')[1]);
  });

  it('RSA-OAEP: üretilen anahtarla kısa metni şifreler ve çözer', async () => {
    const user = renderTool(KeyPairTool);
    await user.click(screen.getByRole('button', { name: /Anahtar çifti üret/ }));
    await screen.findByRole('textbox', { name: 'Özel anahtar (PEM)' }, SLOW);

    await user.click(screen.getByRole('button', { name: /RSA-OAEP ile kısa metin/ }));
    await user.click(screen.getByRole('button', { name: 'Üretilen anahtarı kullan' }));
    await user.type(screen.getByRole('textbox', { name: 'RSA-OAEP girdisi' }), 'merhaba');
    await user.click(screen.getByRole('button', { name: 'Şifrele' }));
    const ciphertext = (await screen.findByLabelText('RSA-OAEP sonucu', undefined, SLOW)).textContent!;
    expect(ciphertext.length).toBeGreaterThan(300);

    await user.selectOptions(screen.getByRole('combobox', { name: 'İşlem' }), 'decrypt');
    await user.click(screen.getByRole('button', { name: 'Üretilen anahtarı kullan' }));
    const input = screen.getByRole('textbox', { name: 'RSA-OAEP girdisi' });
    await user.clear(input);
    await user.click(input);
    await user.paste(ciphertext);
    await user.click(screen.getByRole('button', { name: 'Çöz' }));
    await waitFor(() => expect(screen.getByLabelText('RSA-OAEP sonucu')).toHaveTextContent('merhaba'), SLOW);
  });
});
