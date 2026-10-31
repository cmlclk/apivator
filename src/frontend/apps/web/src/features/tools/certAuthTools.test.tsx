import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { ComponentType } from 'react';
import {
  INTERMEDIATE_PEM,
  LEAF_PEM,
  LEAF_PKCS8_PEM,
  ROOT_PEM,
} from '../../../../../packages/core/src/tools/x509.fixtures';
import { trimInputs, useToolsStore } from './toolsStore';
import CertificateTool from './tools/CertificateTool';
import BasicAuthTool from './tools/BasicAuthTool';
import PkceTool from './tools/PkceTool';
import PasswordTool from './tools/PasswordTool';

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

const setInput = (toolId: string, value: string, name = 'input') =>
  useToolsStore.getState().setInput(toolId, name, value);
const SLOW = { timeout: 5000 };

beforeEach(() => {
  localStorage.clear();
  useToolsStore.setState({ favorites: [], recent: [], inputs: {}, volatile: {}, rememberInputs: true });
});

describe('Sertifika aracı', () => {
  it('yaprak sertifikanın alanlarını ve parmak izini gösterir', async () => {
    setInput('certificate', LEAF_PEM);
    renderTool(CertificateTool);
    expect(await screen.findByText('Sertifika: api.ornek.test', {}, SLOW)).toBeInTheDocument();
    expect(screen.getByText(/Örnek Şirketi Ğüç/)).toBeInTheDocument();
    expect(screen.getByText('0A1B2C3D4E5F')).toBeInTheDocument();
    expect(screen.getByText('DNS: *.ornek.test')).toBeInTheDocument();
    expect(screen.getByText('IP: 2001:db8::1')).toBeInTheDocument();
    expect(screen.getByText('OCSP: http://ocsp.apivator.test')).toBeInTheDocument();
    expect(screen.getByText(/^1E:7C:1F:6C/)).toBeInTheDocument();
    expect(screen.getByText(/^geçerli|süresi dolmuş|henüz geçerli değil/)).toBeInTheDocument();
  });

  it('zincir görünümü: sıra ve imza denetimi', async () => {
    setInput('certificate', [LEAF_PEM, INTERMEDIATE_PEM, ROOT_PEM].join('\n'));
    renderTool(CertificateTool);
    const chain = await screen.findByRole('region', { name: 'Zincir' }, SLOW);
    expect(chain).toHaveTextContent('öz-imzalı köke ulaşıyor');
    expect(chain).toHaveTextContent('1. api.ornek.test');
    expect(chain).toHaveTextContent('3. Apivator Test Kök CA');
    expect(screen.getByText('Sertifika 3: Apivator Test Kök CA')).toBeInTheDocument();
  });

  it('özel anahtarda uyarı; girdi diske yazılmaz', async () => {
    setInput('certificate', LEAF_PKCS8_PEM);
    renderTool(CertificateTool);
    expect(await screen.findByText(/Özel anahtarlar gizlidir/, {}, SLOW)).toBeInTheDocument();
    expect(screen.getByText('EC · P-256')).toBeInTheDocument();
    expect(trimInputs(useToolsStore.getState().inputs).certificate).toBeUndefined();
    expect(localStorage.getItem('apivator-tools') ?? '').not.toContain('PRIVATE KEY');
  });

  it('bozuk girdide Türkçe hata', async () => {
    setInput('certificate', 'bu bir sertifika değil!');
    renderTool(CertificateTool);
    expect(await screen.findByText(/PEM, Base64 DER ya da hex DER değil/, {}, SLOW)).toBeInTheDocument();
  });
});

describe('Basic auth aracı', () => {
  it('kullanıcı ve paroladan başlık üretir; parola diske yazılmaz', async () => {
    const user = renderTool(BasicAuthTool);
    await user.type(screen.getByLabelText('Kullanıcı adı'), 'Aladdin');
    await user.type(screen.getByLabelText('Parola'), 'open sesame');
    expect(screen.getByText('Authorization: Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ==')).toBeInTheDocument();
    expect(localStorage.getItem('apivator-tools') ?? '').not.toContain('sesame');
    expect(useToolsStore.getState().inputs['basic-auth']?.password).toBeUndefined();
  });

  it('akıllı yapıştırılan başlığı çözer; parola gizli başlar', async () => {
    setInput('basic-auth', 'Basic w6dhxJ9yxLE6xZ9pZnJl');
    const user = renderTool(BasicAuthTool);
    expect(screen.getByText('çağrı')).toBeInTheDocument();
    expect(screen.queryByText('şifre')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Göster' }));
    expect(screen.getByText('şifre')).toBeInTheDocument();
    expect(trimInputs(useToolsStore.getState().inputs)['basic-auth']).toBeUndefined();
  });

  it('kullanıcı adında ":" hatası', async () => {
    const user = renderTool(BasicAuthTool);
    await user.type(screen.getByLabelText('Kullanıcı adı'), 'a:b');
    expect(screen.getByText(/":" içeremez/)).toBeInTheDocument();
  });
});

describe('PKCE aracı', () => {
  it('RFC 7636 verifier için S256 ve plain challenge', async () => {
    setInput('pkce', 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk');
    const user = renderTool(PkceTool);
    expect(
      await screen.findByText('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM', {}, SLOW),
    ).toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox'), 'plain');
    await waitFor(() =>
      expect(screen.getAllByText('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk').length).toBeGreaterThan(0),
    );
  });

  it('açılışta 64 karakterlik verifier üretir; geçersiz verifier uyarısı', async () => {
    const user = renderTool(PkceTool);
    const field = screen.getByLabelText('code_verifier') as HTMLInputElement;
    expect(field.value).toMatch(/^[A-Za-z0-9._~-]{64}$/);
    await user.clear(field);
    await user.type(field, 'kisa');
    expect(await screen.findByText(/43–128 karakter olmalı/)).toBeInTheDocument();
  });
});

describe('Şifre ve token aracı', () => {
  const output = () => (screen.getByRole('textbox', { name: /Üretilenler/ }) as HTMLTextAreaElement).value;

  it('varsayılan: 5 adet 20 karakterlik şifre ve entropi', () => {
    renderTool(PasswordTool);
    const lines = output().split('\n');
    expect(lines).toHaveLength(5);
    for (const line of lines) expect(line).toHaveLength(20);
    expect(screen.getByLabelText('Entropi')).toHaveTextContent(/bit entropi · çok güçlü/);
  });

  it('sınıf seçimi, parola cümlesi ve token; sonuçlar diske yazılmaz', async () => {
    const user = renderTool(PasswordTool);
    for (const name of ['A-Z', 'a-z', 'Sembol']) await user.click(screen.getByLabelText(name));
    for (const line of output().split('\n')) expect(line).toMatch(/^\d{20}$/);

    await user.selectOptions(screen.getByLabelText('Tür'), 'passphrase');
    expect(output().split('\n')[0]!.split('-')).toHaveLength(5);

    await user.selectOptions(screen.getByLabelText('Tür'), 'token');
    await user.selectOptions(screen.getByLabelText('Biçim'), 'hex');
    for (const line of output().split('\n')) expect(line).toMatch(/^[0-9a-f]{64}$/);
    const first = output().split('\n')[0]!;
    expect(localStorage.getItem('apivator-tools') ?? '').not.toContain(first);
  });

  it('hiç sınıf seçilmezse hata', async () => {
    const user = renderTool(PasswordTool);
    for (const name of ['A-Z', 'a-z', '0-9', 'Sembol']) await user.click(screen.getByLabelText(name));
    expect(screen.getByText('En az bir karakter sınıfı seçin.')).toBeInTheDocument();
  });
});
