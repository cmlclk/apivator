import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { ComponentType } from 'react';
import { initI18n, setLanguage } from '../../i18n';
import { useToolsStore } from './toolsStore';
import AesTool from './tools/AesTool';
import BcryptTool from './tools/BcryptTool';
import CertificateTool from './tools/CertificateTool';
import FakeDataTool from './tools/FakeDataTool';
import HashTool from './tools/HashTool';
import JwtTool from './tools/JwtTool';
import PasswordTool from './tools/PasswordTool';
import QrTool from './tools/QrTool';
import UuidTool from './tools/UuidTool';

vi.mock('../../lib/useWorkspaces', () => ({
  useWorkspaces: () => ({ current: { id: 'w1', role: 'Admin' }, workspaces: [] }),
}));

// CodeMirror jsdom'da ölçüm yapamıyor; düz bir metin alanı yeterli.
vi.mock('../requests/CodeEditor', () => ({
  CodeEditor: ({ value, label }: { value: string; label: string }) => (
    <textarea aria-label={label} value={value} readOnly />
  ),
}));

function renderTool(Tool: ComponentType) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Tool />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  localStorage.clear();
  useToolsStore.setState({ favorites: [], recent: [], inputs: {}, volatile: {}, rememberInputs: true });
  await setLanguage('en');
});

afterEach(() => initI18n('tr'));

describe('güvenlik araçları (İngilizce)', () => {
  it('JWT aracı İngilizce çizilir', () => {
    const { container } = renderTool(JwtTool);
    expect(screen.getByText(/decoded and verified only on this device/)).toBeInTheDocument();
    expect(screen.getByText('Signature verification')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Verification key' })).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/İmza|Doğrulama|Oluştur|çözülür/);
  });

  it('Hash aracı İngilizce çizilir', () => {
    const { container } = renderTool(HashTool);
    expect(screen.getByText('Text (UTF-8)')).toBeInTheDocument();
    expect(screen.getByText('Uppercase hex')).toBeInTheDocument();
    expect(screen.getByText('Results will appear here.')).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/Kaynak|Büyük harf|Sonuçlar/);
  });

  it('bcrypt aracı İngilizce çizilir', () => {
    const { container } = renderTool(BcryptTool);
    expect(screen.getByRole('heading', { name: 'Generate' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Verify' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '10 (1,024 rounds)' })).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/Üret|Doğrula|Maliyet|tur\)/);
  });

  it('AES aracı İngilizce çizilir', () => {
    const { container } = renderTool(AesTool);
    expect(screen.getByText('Operation')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'AES-GCM (recommended)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Random key/ })).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/İşlem|Şifrele|Anahtar|önerilen/);
  });

  it('sertifika aracı İngilizce çizilir', () => {
    const { container } = renderTool(CertificateTool);
    expect(screen.getByText('Certificate details will appear here.')).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/Sertifika|burada görünecek/);
  });

  it('parola aracı İngilizce çizilir', () => {
    const { container } = renderTool(PasswordTool);
    expect(screen.getByRole('option', { name: 'Passphrase' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Regenerate/ })).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/Şifre|Yeniden|entropi|Uzunluk/);
  });

  it('UUID aracı İngilizce çizilir', () => {
    const { container } = renderTool(UuidTool);
    expect(screen.getByText('Inspect UUID / ULID')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'UUID v4 (random)' })).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/incele|rastgele|Adet|İndir/);
  });

  it('sahte veri aracı İngilizce çizilir', () => {
    const { container } = renderTool(FakeDataTool);
    expect(screen.getByRole('option', { name: 'Full name (fullName)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Turkish' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Regenerate/ })).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/Tohum|Şema|Üreteç|Yeniden/);
  });

  it('QR aracı İngilizce çizilir', () => {
    const { container } = renderTool(QrTool);
    expect(screen.getByText('Enter text or a URL for the QR code.')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'M (15%)' })).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/girin|Hata düzeltme|Kenar/);
  });
});
