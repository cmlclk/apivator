import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useParams } from 'react-router';
import type { ComponentType } from 'react';
import { useToolsStore } from './toolsStore';
import CookieTool from './tools/CookieTool';
import UserAgentTool from './tools/UserAgentTool';
import CidrTool from './tools/CidrTool';

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

function ToolRoute() {
  return <p>Araç: {useParams().toolId}</p>;
}

function renderTool(Tool: ComponentType) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Routes>
          <Route path="/" element={<Tool />} />
          <Route path="/tools/:toolId" element={<ToolRoute />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

const setInput = (toolId: string, value: string, name = 'input') =>
  useToolsStore.getState().setInput(toolId, name, value);
const JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';

beforeEach(() => {
  localStorage.clear();
  useToolsStore.setState({ favorites: [], recent: [], inputs: {}, volatile: {}, rememberInputs: true });
});

describe('Çerez aracı', () => {
  it('Set-Cookie satırlarını ayrıştırır, uyarıları gösterir', () => {
    setInput(
      'cookie',
      'Set-Cookie: SID=31d4d96e407aad42; Path=/; Secure; HttpOnly\nSet-Cookie: x=1; SameSite=None',
    );
    renderTool(CookieTool);
    expect(screen.getByText('Çerez: SID')).toBeInTheDocument();
    expect(screen.getByText('Çerez: x')).toBeInTheDocument();
    expect(screen.getByText(/SameSite=None için Secure zorunlu/)).toBeInTheDocument();
    expect(screen.getAllByText('Yalnızca bu ana makine (host-only)')).toHaveLength(2);
  });

  it('Cookie başlığı; JWT değeri JWT aracında açılır', async () => {
    setInput('cookie', `Cookie: auth=${JWT}; lang=tr; lang=en`);
    const user = renderTool(CookieTool);
    expect(screen.getByText(/Cookie başlığı: 3 çerez/)).toBeInTheDocument();
    expect(screen.getByText(/Yinelenen ad: lang/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /JWT çözücüde aç/ }));
    expect(screen.getByText('Araç: jwt')).toBeInTheDocument();
    expect(useToolsStore.getState().inputs.jwt?.input).toBe(JWT);
  });

  it('Set-Cookie oluşturucu', async () => {
    const user = renderTool(CookieTool);
    await user.type(screen.getByLabelText('Oluştur: Ad'), 'sid');
    await user.type(screen.getByLabelText('Oluştur: Değer'), 'abc');
    expect(
      screen.getByText('Set-Cookie: sid=abc; Path=/; Secure; HttpOnly; SameSite=Lax'),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText('Oluştur: Değer'), ' x');
    expect(screen.getByText(/Yüzde kodla/, { selector: '[role=alert]' })).toBeInTheDocument();
  });

  it('girdiler diske yazılmaz', () => {
    setInput('cookie', 'Cookie: gizli=deger123');
    setInput('cidr', '10.0.0.0/8');
    const saved = localStorage.getItem('apivator-tools') ?? '';
    expect(saved).toContain('10.0.0.0/8');
    expect(saved).not.toContain('deger123');
  });
});

describe('User-Agent aracı', () => {
  it('tarayıcı, motor, işletim sistemi ve notlar', () => {
    setInput(
      'user-agent',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
    );
    renderTool(UserAgentTool);
    expect(screen.getByText('Microsoft Edge 130.0.0.0')).toBeInTheDocument();
    expect(screen.getByText('Blink 130.0.0.0')).toBeInTheDocument();
    expect(screen.getByText('Windows 10 / 11')).toBeInTheDocument();
    expect(screen.getByText(/ayırt edilemez/)).toBeInTheDocument();
  });

  it('bot ve geçerli tarayıcı düğmesi', async () => {
    setInput('user-agent', 'curl/8.10.1');
    const user = renderTool(UserAgentTool);
    expect(screen.getByText('curl 8.10.1 · HTTP istemcisi / kütüphane')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Bu tarayıcının UA/ }));
    expect(screen.getByLabelText('User-Agent')).toHaveValue(navigator.userAgent);
  });
});

describe('CIDR aracı', () => {
  it('IPv4 bilgileri, içerme denetimi ve bölme', async () => {
    setInput('cidr', '192.168.1.10/24');
    const user = renderTool(CidrTool);
    expect(screen.getByText('IPv4 · 192.168.1.0/24')).toBeInTheDocument();
    expect(screen.getByText('192.168.1.255')).toBeInTheDocument();
    expect(screen.getByText('Özel ağ (RFC 1918)')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Denetlenecek adres'), '192.168.2.1');
    expect(screen.getByText('192.168.2.1 192.168.1.0/24 dışında.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Alt ağ sayısı'), '4');
    expect(screen.getByText(/4 alt ağ × 64 adres/)).toBeInTheDocument();
    expect(screen.getByText('192.168.1.192/26')).toBeInTheDocument();
  });

  it('aralık → CIDR listesi ve hata', async () => {
    setInput('cidr', '10.0.0.0 - 10.0.0.5');
    const user = renderTool(CidrTool);
    expect(screen.getByText('10.0.0.0/30')).toBeInTheDocument();
    expect(screen.getByText('10.0.0.4/31')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('IP adresi, CIDR ya da aralık'));
    await user.type(screen.getByLabelText('IP adresi, CIDR ya da aralık'), '10.0.0.01');
    expect(screen.getByRole('alert')).toHaveTextContent(/Baştaki sıfır/);
  });

  it('IPv6 büyük sayılar', () => {
    setInput('cidr', '2001:db8::/32');
    renderTool(CidrTool);
    // Toplam ve kullanılabilir adres aynı (IPv6'da yayın yok).
    expect(screen.getAllByText('79228162514264337593543950336 (2^96)')).toHaveLength(2);
  });
});
