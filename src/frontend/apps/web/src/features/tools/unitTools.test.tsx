import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { ComponentType } from 'react';
import { useToolsStore } from './toolsStore';
import NumberBaseTool from './tools/NumberBaseTool';
import ByteUnitsTool from './tools/ByteUnitsTool';
import ColorTool from './tools/ColorTool';

vi.mock('../../lib/useWorkspaces', () => ({
  useWorkspaces: () => ({ current: { id: 'w1', role: 'Admin' }, workspaces: [] }),
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
const stored = (toolId: string, name = 'input') => useToolsStore.getState().inputs[toolId]?.[name];
/** Sonuç satırındaki değer: kopyala düğmesinin etiketinden satırı bulur. */
const rowValue = (label: string) =>
  screen.getByRole('button', { name: `${label}: kopyala` }).parentElement!.querySelector('.font-mono')!
    .textContent;

beforeEach(() => {
  localStorage.clear();
  useToolsStore.setState({ favorites: [], recent: [], inputs: {}, volatile: {}, rememberInputs: true });
});

describe('Sayı tabanı aracı', () => {
  it('tüm tabanları canlı gösterir; girdi tabanı değişince yeniden okur', async () => {
    const user = renderTool(NumberBaseTool);
    await user.type(screen.getByRole('textbox', { name: 'Sayı' }), '255');
    expect(rowValue('İkili (2)')).toBe('11111111');
    expect(rowValue('Sekizli (8)')).toBe('377');
    expect(rowValue('Onaltılı (16)')).toBe('FF');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Girdi tabanı' }), '16');
    expect(rowValue('Onlu (10)')).toBe('597');
  });

  it('bit genişliği ve işaretli yorum; gruplama', async () => {
    setInput('number-base', '-1');
    const user = renderTool(NumberBaseTool);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Bit genişliği' }), '16');
    expect(rowValue('Onaltılı (16)')).toBe('FFFF');
    expect(rowValue('Onlu (10)')).toBe('-1');
    await user.click(screen.getByRole('checkbox', { name: 'İşaretli (ikiye tümleyen)' }));
    expect(rowValue('Onlu (10)')).toBe('65535');
    await user.click(screen.getByRole('checkbox', { name: 'Grupla' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Binlik ayraç' }), '.');
    expect(rowValue('Onlu (10)')).toBe('65.535');
    expect(rowValue('İkili (2)')).toBe('1111 1111 1111 1111');
  });

  it('bit tıklanınca değer değişir', async () => {
    setInput('number-base', '5');
    const user = renderTool(NumberBaseTool);
    const bit1 = screen.getByRole('button', { name: 'Bit 1' });
    expect(bit1).toHaveAttribute('aria-pressed', 'false');
    await user.click(bit1);
    expect(stored('number-base')).toBe('7');
    await user.click(screen.getByRole('button', { name: 'Bit 0' }));
    expect(stored('number-base')).toBe('6');
  });

  it('geçersiz hane konumlu hata gösterir; ek taban', async () => {
    setInput('number-base', '12z');
    renderTool(NumberBaseTool);
    expect(screen.getByRole('alert')).toHaveTextContent('geçersiz hane: "z" (konum 3)');
  });

  it('ek taban ve önek bilgisi', async () => {
    setInput('number-base', '0x10');
    const user = renderTool(NumberBaseTool);
    expect(screen.getByText(/Önek nedeniyle girdi 16 tabanında okundu/)).toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Ek taban' }), '36');
    expect(rowValue('Taban 36')).toBe('G');
  });
});

describe('Bayt birimleri aracı', () => {
  it('Türkçe ondalıkla yazılan boyutu tüm birimlere çevirir', () => {
    setInput('byte-units', '1,5 GiB');
    renderTool(ByteUnitsTool);
    expect(rowValue('B')).toBe('1610612736');
    expect(rowValue('MiB')).toBe('1536');
    expect(rowValue('GB')).toBe('1,6106');
    expect(rowValue('IEC (1024)')).toBe('1,5 GiB');
    expect(rowValue('SI (1000)')).toBe('1,6106 GB');
    expect(rowValue('Gibit')).toBe('12');
  });

  it('ondalık ayraç, hane ve eski ikili seçenek', async () => {
    setInput('byte-units', '1 MB');
    const user = renderTool(ByteUnitsTool);
    expect(rowValue('KiB')).toBe('976,5625');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Ondalık ayraç' }), '.');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Ondalık hane' }), '2');
    expect(rowValue('KiB')).toBe('976.56');
    await user.click(screen.getByRole('checkbox', { name: 'KB/MB/GB = 1024' }));
    expect(rowValue('KiB')).toBe('1024');
  });

  it('aktarım süresi ve hatalar', async () => {
    setInput('byte-units', '1 GB');
    const user = renderTool(ByteUnitsTool);
    expect(screen.getByText('1 dk 20 sn')).toBeInTheDocument();
    const bandwidth = screen.getByRole('textbox', { name: 'Bant genişliği' });
    await user.clear(bandwidth);
    await user.type(bandwidth, '1 Gbps');
    expect(screen.getByText('8 sn')).toBeInTheDocument();
    await user.clear(screen.getByRole('textbox', { name: 'Boyut' }));
    await user.type(screen.getByRole('textbox', { name: 'Boyut' }), '5 parsec');
    expect(screen.getByRole('alert')).toHaveTextContent('Bilinmeyen birim');
  });
});

describe('Renk aracı', () => {
  it('tüm biçimleri ve CSS adını gösterir', () => {
    setInput('color', 'rebeccapurple');
    renderTool(ColorTool);
    expect(rowValue('HEX')).toBe('#663399');
    expect(rowValue('RGB')).toBe('rgb(102, 51, 153)');
    expect(rowValue('HSL')).toBe('hsl(270, 50%, 40%)');
    expect(rowValue('HWB')).toBe('hwb(270 20% 40%)');
    expect(rowValue('OKLCH')).toMatch(/^oklch\(/);
    expect(rowValue('CSS adı')).toBe('rebeccapurple');
  });

  it('karşıtlık oranları ve AA/AAA rozetleri; ikinci renk', async () => {
    setInput('color', '#777');
    const user = renderTool(ColorTool);
    // Beyaz zemin ve varsayılan ikinci renk (beyaz) 4,48; siyah zemin 4,69.
    expect(screen.getAllByText('4,48:1')).toHaveLength(2);
    // Beyazda yalnızca "AA büyük" geçer (3 kalır ×2), siyahta yalnızca AAA kalır.
    expect(screen.getAllByTitle('Kalır')).toHaveLength(7);
    const other = screen.getByRole('textbox', { name: 'İkinci renk (zemin)' });
    await user.clear(other);
    await user.type(other, 'black');
    expect(screen.getAllByText('4,69:1')).toHaveLength(2);
    await user.clear(other);
    await user.type(other, 'nope');
    expect(screen.getByRole('alert')).toHaveTextContent('Renk tanınmadı');
  });

  it('renk seçici ve palet girdiyi günceller; büyük harf HEX', async () => {
    setInput('color', '#ff0000');
    const user = renderTool(ColorTool);
    const picker = screen.getByLabelText('Renk seçici') as HTMLInputElement;
    expect(picker.value).toBe('#ff0000');
    fireEvent.input(picker, { target: { value: '#00ff00' } });
    expect(stored('color')).toBe('#00ff00');
    await user.click(screen.getByRole('button', { name: 'Koyu tonlar: #008000' }));
    expect(stored('color')).toBe('#008000');
    expect(rowValue('CSS adı')).toBe('green');
    await user.click(screen.getByRole('checkbox', { name: 'Büyük harf HEX' }));
    expect(rowValue('HEX')).toBe('#008000');
  });

  it('saydam renkte rgba ve geçersiz girdide hata', async () => {
    setInput('color', 'rgb(0 0 0 / 50%)');
    const user = renderTool(ColorTool);
    expect(rowValue('RGB')).toBe('rgba(0, 0, 0, 0.5)');
    expect(rowValue('HEX')).toBe('#00000080');
    await user.clear(screen.getByRole('textbox', { name: 'Renk' }));
    await user.type(screen.getByRole('textbox', { name: 'Renk' }), '#12345');
    expect(screen.getByRole('alert')).toHaveTextContent('Geçersiz HEX');
  });
});
