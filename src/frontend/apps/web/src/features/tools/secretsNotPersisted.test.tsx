import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { ComponentType } from 'react';
import { LEAF_PKCS8_PEM } from '../../../../../packages/core/src/tools/x509.fixtures';
import { openInTool } from './openInTool';
import { useToolsStore } from './toolsStore';
import AesTool from './tools/AesTool';
import BasicAuthTool from './tools/BasicAuthTool';
import BcryptTool from './tools/BcryptTool';
import CertificateTool from './tools/CertificateTool';
import KeyPairTool from './tools/KeyPairTool';
import PasswordTool from './tools/PasswordTool';
import PkceTool from './tools/PkceTool';

// Güvenlik araçlarına girilen ya da onların ürettiği gizli değerler (parola, anahtar, özel anahtar, kimlik
// bilgisi, verifier, üretilen şifre) hiçbir yolla yerel depolamaya yazılmamalı.

vi.mock('../../lib/useWorkspaces', () => ({
  useWorkspaces: () => ({ current: { id: 'w1', role: 'Admin' }, workspaces: [] }),
}));

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

const SLOW = { timeout: 5000 };
/** Tam takım paralel koşarken arayüz etkileşimleri yavaşlıyor. */
const TEST_TIMEOUT = 15_000;
/** Her test sonunda depoda aranacak gizli değerler. */
let secrets: string[] = [];

function storageText(): string {
  const dump = (storage: Storage) =>
    Array.from({ length: storage.length }, (_, i) => `${storage.key(i)}=${storage.getItem(storage.key(i)!)}`);
  return [...dump(localStorage), ...dump(sessionStorage)].join('\n');
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  secrets = [];
  useToolsStore.setState({ favorites: [], recent: [], inputs: {}, volatile: {}, rememberInputs: true });
});

afterEach(() => {
  // Tercihler yine de yazılmış olmalı (depolama çalışıyor); gizli değerler yazılmamalı.
  const saved = storageText();
  expect(saved).toContain('apivator-tools');
  for (const secret of secrets) expect(saved, `depoda gizli değer: ${secret}`).not.toContain(secret);
  cleanup();
});

describe('Gizli değerler diske yazılmaz', { timeout: TEST_TIMEOUT }, () => {
  it('bcrypt: üretme ve doğrulama parolaları', async () => {
    useToolsStore.getState().setInput('bcrypt', 'cost', '4');
    const user = renderTool(BcryptTool);
    await user.type(screen.getByLabelText('Parola'), 'Bcrypt-Gizli-1');
    await user.click(screen.getByRole('button', { name: 'Üret' }));
    await screen.findByLabelText('bcrypt özeti', { selector: 'code' }, SLOW);
    await user.click(screen.getByRole('button', { name: 'Doğrulamada kullan' }));
    await user.type(screen.getByLabelText('Doğrulanacak parola'), '-ek');
    secrets = ['Bcrypt-Gizli-1'];
  });

  it('AES: ham anahtar, düz metin, parola ve IV', async () => {
    useToolsStore.getState().setInput('aes', 'keySize', '128');
    useToolsStore.getState().setInput('aes', 'iterations', '1');
    const user = renderTool(AesTool);
    await user.type(screen.getByLabelText('AES anahtarı'), '00112233445566778899aabbccddeeff');
    await user.type(screen.getByRole('textbox', { name: 'Düz metin' }), 'aes-duz-metin-gizli');
    await waitFor(
      () => expect(screen.getByRole('textbox', { name: 'Şifreli veri' })).not.toHaveValue(''),
      SLOW,
    );
    const iv = (screen.getByRole('textbox', { name: 'IV' }) as HTMLInputElement).value;
    expect(iv).toMatch(/^[0-9a-f]{24}$/);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Anahtar' }), 'passphrase');
    await user.type(screen.getByLabelText('Parola'), 'aes-parola-gizli');
    secrets = ['00112233445566778899aabbccddeeff', 'aes-duz-metin-gizli', 'aes-parola-gizli', iv];
  });

  it('anahtar çifti: üretilen özel anahtar ve RSA-OAEP alanları', async () => {
    useToolsStore.getState().setInput('key-pair', 'algorithm', 'ECDSA');
    const user = renderTool(KeyPairTool);
    await user.click(screen.getByRole('button', { name: /Anahtar çifti üret/ }));
    const privatePem = (
      (await screen.findByRole('textbox', { name: 'Özel anahtar (PEM)' }, SLOW)) as HTMLTextAreaElement
    ).value;
    await user.click(screen.getByRole('button', { name: /RSA-OAEP ile kısa metin/ }));
    await user.type(screen.getByRole('textbox', { name: 'RSA-OAEP anahtarı' }), 'oaep-anahtar-gizli');
    await user.type(screen.getByRole('textbox', { name: 'RSA-OAEP girdisi' }), 'oaep-metin-gizli');
    secrets = [privatePem.split('\n')[1]!, 'oaep-anahtar-gizli', 'oaep-metin-gizli'];
  });

  it('sertifika: "Araçlarda aç" / akıllı yapıştırmayla gelen özel anahtar', async () => {
    openInTool(() => undefined, 'certificate', LEAF_PKCS8_PEM);
    renderTool(CertificateTool);
    expect(await screen.findByText(/Özel anahtarlar gizlidir/, {}, SLOW)).toBeInTheDocument();
    secrets = ['PRIVATE KEY', LEAF_PKCS8_PEM.split('\n')[1]!];
  });

  it('Basic auth: kullanıcı, parola ve akıllı yapıştırılan başlık', async () => {
    openInTool(() => undefined, 'basic-auth', 'Basic YmFzaWMta3VsbGFuaWNpOmJhc2ljLXBhcm9sYQ==');
    const user = renderTool(BasicAuthTool);
    expect(screen.getByText('basic-kullanici')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Kullanıcı adı'), 'yeni-kullanici-gizli');
    await user.type(screen.getByLabelText('Parola'), 'yeni-parola-gizli');
    secrets = ['YmFzaWMta3VsbGFuaWNpOmJhc2ljLXBhcm9sYQ', 'yeni-kullanici-gizli', 'yeni-parola-gizli'];
  });

  it('PKCE: üretilen ve yazılan code_verifier', async () => {
    const user = renderTool(PkceTool);
    const field = screen.getByLabelText('code_verifier') as HTMLInputElement;
    const generated = field.value;
    expect(generated).toHaveLength(64);
    await user.clear(field);
    await user.type(field, 'pkce-verifier-gizli-0123456789-0123456789-abcdef');
    secrets = [generated, 'pkce-verifier-gizli-0123456789-0123456789-abcdef'];
  });

  it('şifre ve token üretici: üretilen tüm değerler', async () => {
    const user = renderTool(PasswordTool);
    const output = () => (screen.getByRole('textbox', { name: /Üretilenler/ }) as HTMLTextAreaElement).value;
    const values = output().split('\n');
    await user.selectOptions(screen.getByLabelText('Tür'), 'token');
    values.push(...output().split('\n'));
    expect(values).toHaveLength(10);
    secrets = values;
  });
});
