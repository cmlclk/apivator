import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { ComponentType } from 'react';
import { useToolsStore } from './toolsStore';
import UuidTool from './tools/UuidTool';
import LoremTool from './tools/LoremTool';
import RandomTool from './tools/RandomTool';
import QrTool from './tools/QrTool';
import { QR_MAX_BYTES, makeQrMatrix, qrSvgString } from './tools/qrCode';

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

const output = (name: RegExp) => (screen.getByRole('textbox', { name }) as HTMLTextAreaElement).value;
const setField = (toolId: string, name: string, value: string) =>
  useToolsStore.getState().setInput(toolId, name, value, true);

beforeEach(() => {
  localStorage.clear();
  useToolsStore.setState({ favorites: [], recent: [], inputs: {}, volatile: {}, rememberInputs: true });
});

describe('ID üretici', () => {
  it('eski kayıtlı UUID seçenekleri çalışmaya devam eder', () => {
    setField('uuid', 'version', '7');
    setField('uuid', 'count', '3');
    setField('uuid', 'uppercase', '1');
    renderTool(UuidTool);
    const lines = output(/Üretilen (UUID|nanoid)'ler/).split('\n');
    expect(lines).toHaveLength(3);
    for (const id of lines)
      expect(id).toMatch(/^[0-9A-F]{8}-[0-9A-F]{4}-7[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/);
  });

  it('monoton ULID, CSV çıktısı başlıklı ve sıralı', async () => {
    setField('uuid', 'count', '50');
    const user = renderTool(UuidTool);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Tür' }), 'ulid');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Çıktı' }), 'csv');
    const [header, ...ids] = output(/Üretilen ULID'ler \(50\)/).split('\n');
    expect(header).toBe('ulid');
    expect(ids).toHaveLength(50);
    for (const id of ids) expect(id).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
    expect([...ids].sort()).toEqual(ids);
  });

  it('nanoid özel alfabe, JSON dizisi ve çakışma ipucu', async () => {
    setField('uuid', 'version', 'nanoid');
    setField('uuid', 'count', '4');
    setField('uuid', 'format', 'json');
    setField('uuid', 'nanoidSize', '8');
    setField('uuid', 'nanoidAlphabet', '0123456789abcdef');
    renderTool(UuidTool);
    const ids = JSON.parse(output(/Üretilen (UUID|nanoid)'ler/)) as string[];
    expect(ids).toHaveLength(4);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}$/);
    expect(screen.getByLabelText('Çakışma ipucu').textContent).toContain('32 bit');
  });

  it('tekrar eden alfabede hata gösterir', () => {
    setField('uuid', 'version', 'nanoid');
    setField('uuid', 'nanoidAlphabet', 'aab');
    renderTool(UuidTool);
    expect(screen.getByRole('alert').textContent).toMatch(/tekrar eden/);
  });

  it('ULID ve UUID inceler', async () => {
    const user = renderTool(UuidTool);
    const box = screen.getByRole('textbox', { name: 'İncelenecek kimlik' });
    await user.type(box, '01ARZ3NDEKTSV4RRFFQ69G5FAV');
    expect(screen.getByText(/ULID \(48 bit/)).toBeTruthy();
    expect(screen.getByText(/2016-07-30T23:54:10.259Z/)).toBeTruthy();
    await user.clear(box);
    await user.type(box, 'nope');
    expect(screen.getByText('Geçerli bir UUID ya da ULID değil.')).toBeTruthy();
  });
});

describe('Lorem ipsum', () => {
  it('tohumla belirlenimci, HTML paragrafları', () => {
    setField('lorem', 'seed', '5');
    setField('lorem', 'html', '1');
    renderTool(LoremTool);
    const first = output(/^Metin$/);
    expect(first.startsWith('<p>Lorem ipsum dolor sit amet')).toBe(true);
    expect(first.split('\n')).toHaveLength(3);
    // Yeniden üretme tohumlu metinde kapalı; aynı tohum aynı metin.
    expect(screen.getByRole('button', { name: /Yeniden üret/ })).toHaveProperty('disabled', true);
  });

  it('Türkçe kelimeler', async () => {
    setField('lorem', 'classic', '');
    const user = renderTool(LoremTool);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Birim' }), 'words');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Dil' }), 'tr');
    const text = output(/^Metin$/);
    expect(text.split(' ')).toHaveLength(3);
    expect(text).not.toMatch(/lorem/i);
  });
});

describe('Rastgele sayı ve tarih', () => {
  it('tekrarsız tamsayılar; aralık yetmezse hata', async () => {
    setField('random', 'min', '1');
    setField('random', 'max', '5');
    setField('random', 'count', '5');
    setField('random', 'unique', '1');
    setField('random', 'sort', 'asc');
    const user = renderTool(RandomTool);
    expect(output(/Üretilenler/)).toBe('1\n2\n3\n4\n5');
    const count = screen.getByRole('spinbutton', { name: 'Adet' });
    await user.clear(count);
    await user.type(count, '6');
    expect(screen.getByRole('alert').textContent).toMatch(/yalnızca 5 farklı/);
  });

  it('ondalık basamak', () => {
    setField('random', 'numberKind', 'decimal');
    setField('random', 'min', '0');
    setField('random', 'max', '1');
    setField('random', 'precision', '3');
    renderTool(RandomTool);
    for (const v of output(/Üretilenler/).split('\n')) expect(v).toMatch(/^[01]\.\d{3}$/);
  });

  it('tarih bölümü: saat diliminde gün adımlı tarihler', async () => {
    setField('random', 'zone', 'Europe/Istanbul');
    setField('random', 'from', '2026-03-01');
    setField('random', 'to', '2026-03-03');
    setField('random', 'step', 'day');
    setField('random', 'dateFormat', 'zoned');
    setField('random', 'unique', '1');
    setField('random', 'sort', 'asc');
    setField('random', 'count', '3');
    const user = renderTool(RandomTool);
    await user.click(screen.getByRole('button', { name: 'Tarih' }));
    expect(output(/Üretilenler/)).toBe(
      '2026-03-01T00:00:00+03:00\n2026-03-02T00:00:00+03:00\n2026-03-03T00:00:00+03:00',
    );
  });

  it('tanınmayan tarihte hata', async () => {
    setField('random', 'section', 'date');
    setField('random', 'from', 'dün');
    renderTool(RandomTool);
    expect(screen.getByRole('alert').textContent).toMatch(/Başlangıç tanınmadı/);
  });
});

describe('QR kod', () => {
  it('kısa metin sürüm 1, köşelerde konum desenleri', () => {
    const m = makeQrMatrix('HELLO', 'M');
    expect(m.size).toBe(21);
    expect(m.version).toBe(1);
    // Konum deseni: 7×7 koyu çerçeve, içi açık halka, ortada 3×3 koyu.
    for (const [r0, c0] of [
      [0, 0],
      [0, 14],
      [14, 0],
    ] as const) {
      expect(m.dark[r0]![c0]).toBe(true);
      expect(m.dark[r0 + 1]![c0 + 1]).toBe(false);
      expect(m.dark[r0 + 3]![c0 + 3]).toBe(true);
      expect(m.dark[r0 + 6]![c0 + 6]).toBe(true);
    }
  });

  it('kapasite sınırı düzeye göre; UTF-8 bayt sayılır', () => {
    expect(makeQrMatrix('a'.repeat(QR_MAX_BYTES.L), 'L').version).toBe(40);
    expect(() => makeQrMatrix('a'.repeat(QR_MAX_BYTES.L + 1), 'L')).toThrow(/en fazla 2953 bayt/);
    expect(() => makeQrMatrix('ş'.repeat(700), 'H')).toThrow(/1400 bayt/);
  });

  it('SVG metni yalnızca matris ve doğrulanmış renklerden kurulur', () => {
    const svg = qrSvgString(makeQrMatrix('<script>alert(1)</script>', 'L'), {
      pixels: 200,
      margin: 2,
      foreground: '"/><script>x</script>',
      background: '#00ff00',
    });
    expect(svg).not.toContain('script');
    expect(svg).toContain('fill="#000000"');
    expect(svg).toContain('fill="#00ff00"');
    expect(svg).toMatch(
      /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="200" height="200" viewBox="0 0 29 29"/,
    );
  });

  it('araç önizlemeyi çizer, uzun metinde kapasite hatası', async () => {
    setField('qr', 'input', 'https://ornek.com');
    renderTool(QrTool);
    expect(screen.getByRole('img', { name: 'QR kod' })).toBeTruthy();
    expect(screen.getByText(/Sürüm 2 · 25×25 modül · 17 bayt/)).toBeTruthy();
    useToolsStore.getState().setInput('qr', 'input', 'x'.repeat(3000), true);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/sığmıyor/);
    expect(screen.queryByRole('img', { name: 'QR kod' })).toBeNull();
    expect(screen.getByRole('button', { name: /SVG/ })).toHaveProperty('disabled', true);
  });
});
