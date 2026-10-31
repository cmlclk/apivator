import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { ComponentType } from 'react';
import { initI18n, setLanguage } from '../../i18n';
import { useToolsStore } from './toolsStore';
import ByteUnitsTool from './tools/ByteUnitsTool';
import CaseConvertTool from './tools/CaseConvertTool';
import CidrTool from './tools/CidrTool';
import CookieTool from './tools/CookieTool';
import CronTool from './tools/CronTool';
import HttpReferenceTool from './tools/HttpReferenceTool';
import LineOpsTool from './tools/LineOpsTool';
import NumberBaseTool from './tools/NumberBaseTool';
import SlugTool from './tools/SlugTool';
import TextStatsTool from './tools/TextStatsTool';
import TimestampTool from './tools/TimestampTool';
import UrlParserTool from './tools/UrlParserTool';

vi.mock('../../lib/useWorkspaces', () => ({
  useWorkspaces: () => ({ current: { id: 'w1', role: 'Admin' }, workspaces: [] }),
}));

function renderTool(Tool: ComponentType) {
  return render(
    <MemoryRouter>
      <Tool />
    </MemoryRouter>,
  );
}

const setInput = (toolId: string, value: string, name = 'input') =>
  useToolsStore.getState().setInput(toolId, name, value);

beforeEach(async () => {
  localStorage.clear();
  useToolsStore.setState({ favorites: [], recent: [], inputs: {}, volatile: {}, rememberInputs: true });
  await setLanguage('en');
});

afterEach(() => initI18n('tr'));

describe('zaman, metin ve ağ araçları (İngilizce)', () => {
  it('Cron aracı İngilizce çizilir', () => {
    setInput('cron', '*/2 * * * *', 'expr');
    const { container } = renderTool(CronTool);
    expect(screen.getByRole('textbox', { name: 'Cron expression' })).toBeInTheDocument();
    expect(screen.getByText('Time zone')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Fields' })).toBeInTheDocument();
    expect(
      screen.getByText(/runs more often than every 5 minutes \(shortest interval 2 minutes\)/),
    ).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/Saat dilimi|Alanlar|çalıştırma|sık çalışıyor/);
  });

  it('Zaman damgası aracı İngilizce çizilir', () => {
    setInput('timestamp', '1761746700');
    const { container } = renderTool(TimestampTool);
    expect(screen.getByText(/Input interpreted as Unix seconds/)).toBeInTheDocument();
    expect(screen.getByText('Unix (milliseconds)')).toBeInTheDocument();
    expect(screen.getByText('Time between two dates')).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/Girdi|yorumlandı|Okunur|İki tarih/);
  });

  it('Sayı tabanı aracı İngilizce çizilir', () => {
    setInput('number-base', '255');
    const { container } = renderTool(NumberBaseTool);
    expect(screen.getByText('Input base')).toBeInTheDocument();
    expect(screen.getAllByText('Binary (2)').length).toBeGreaterThan(1);
    expect(screen.getByText('The value needs 8 bits.')).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/Girdi tabanı|İkili|Değer|gerektirir/);
  });

  it('Bayt birimleri aracı İngilizce çizilir', () => {
    setInput('byte-units', '1536 KiB');
    const { container } = renderTool(ByteUnitsTool);
    expect(screen.getByText('Decimal places')).toBeInTheDocument();
    expect(screen.getByText('Transfer time')).toBeInTheDocument();
    expect(screen.getByText('Byte — SI (1000)')).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/Ondalık|Aktarım|Bayt —/);
  });

  it('URL ayrıştırıcı İngilizce çizilir', () => {
    setInput('url-parser', 'https://example.com:8443/a/b?x=1#top');
    const { container } = renderTool(UrlParserTool);
    expect(screen.getByText('Rebuilt URL')).toBeInTheDocument();
    expect(screen.getByText('Absolute URL')).toBeInTheDocument();
    expect(screen.getByText('Path segments')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open in new request/ })).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/Yeniden kurulan|Mutlak|Yol parçaları|Yeni istekte/);
  });

  it('HTTP başvurusu İngilizce çizilir', () => {
    const { container } = renderTool(HttpReferenceTool);
    expect(screen.getByRole('tab', { name: 'Status codes' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '4xx Client error' })).toBeInTheDocument();
    expect(screen.getByText(/\d+ results/)).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/Durum kodları|sonuç|Tümü|İstemci hatası/);
  });

  it('Çerez aracı İngilizce çizilir', () => {
    setInput('cookie', 'Set-Cookie: SID=abc; Path=/; Secure; HttpOnly');
    const { container } = renderTool(CookieTool);
    expect(screen.getByText('Cookie: SID')).toBeInTheDocument();
    expect(screen.getByText('Build Set-Cookie', { selector: 'h3' })).toBeInTheDocument();
    expect(screen.getByText('Not specified (Lax is assumed)')).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/Çerez|oluştur|Belirtilmemiş|Evet|Hayır/);
  });

  it('CIDR aracı İngilizce çizilir', () => {
    setInput('cidr', '192.168.1.10/24');
    const { container } = renderTool(CidrTool);
    expect(screen.getByText('First usable')).toBeInTheDocument();
    expect(screen.getByText('Is the address in this block?')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Split into subnets' })).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/İlk kullanılabilir|Alt ağlara|Adres bu blokta/);
  });

  it('Ad dönüşümü ve slug İngilizce çizilir', () => {
    const { container, unmount } = renderTool(CaseConvertTool);
    expect(screen.getByText('All styles')).toBeInTheDocument();
    expect(screen.getByText('Keep conjunctions lowercase in Title Case')).toBeInTheDocument();
    expect(screen.getByText('UPPERCASE')).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/Tüm biçimler|BÜYÜK HARF|Satır satır/);
    unmount();

    const slug = renderTool(SlugTool);
    expect(screen.getByText('Maximum length')).toBeInTheDocument();
    expect(screen.getByText('Stop-word list')).toBeInTheDocument();
    expect(slug.container).not.toHaveTextContent(/Ayırıcı|Dolgu|En fazla/);
  });

  it('Satır işlemleri ve metin istatistikleri İngilizce çizilir', () => {
    setInput('line-ops', 'b\na\nb');
    setInput('line-ops', JSON.stringify([{ kind: 'sort' }, { kind: 'unique' }]), 'steps');
    const { container, unmount } = renderTool(LineOpsTool);
    expect(screen.getByText('Add step:')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply output to input' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Steps' })).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/Adım ekle|Çıktıyı|Tekilleştir|Sırala/);
    unmount();

    setInput('text-stats', 'Hello world. Bye.');
    const stats = renderTool(TextStatsTool);
    expect(screen.getAllByText('Words').length).toBeGreaterThan(0);
    expect(screen.getByText('Reading time')).toBeInTheDocument();
    expect(stats.container).not.toHaveTextContent(/Sözcük|Okuma süresi|Paragraf/);
  });
});
