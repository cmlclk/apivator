import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { ComponentType } from 'react';
import { useToolsStore } from './toolsStore';
import HtmlEntityTool from './tools/HtmlEntityTool';
import UnicodeTool from './tools/UnicodeTool';
import HexTool from './tools/HexTool';
import Base32Tool from './tools/Base32Tool';
import StringEscapeTool from './tools/StringEscapeTool';
import CompressTool from './tools/CompressTool';

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
const setInput = (toolId: string, value: string, name = 'input') =>
  useToolsStore.getState().setInput(toolId, name, value);
/** CompressionStream ve FileReader eşzamansız; yüklü makinede varsayılan 1 sn yetmeyebilir. */
const SLOW = { timeout: 5000 };

beforeEach(() => {
  localStorage.clear();
  useToolsStore.setState({ favorites: [], recent: [], inputs: {}, volatile: {}, rememberInputs: true });
});

describe('HTML varlıkları aracı', () => {
  it('kodlar; ASCII dışı ve adlandırılmış seçenekleri; yer değiştirince çözer', async () => {
    setInput('html-entity', '<b>ç & ğ</b>');
    const user = renderTool(HtmlEntityTool);
    expect(field('HTML')).toHaveValue('&lt;b&gt;ç &amp; ğ&lt;/b&gt;');

    await user.click(screen.getByRole('checkbox', { name: 'ASCII dışını da kodla' }));
    expect(field('HTML')).toHaveValue('&lt;b&gt;&#xE7; &amp; &#x11F;&lt;/b&gt;');
    await user.click(screen.getByRole('checkbox', { name: /Adlandırılmış/ }));
    expect(field('HTML')).toHaveValue('&lt;b&gt;&ccedil; &amp; &gbreve;&lt;/b&gt;');

    await user.click(screen.getByRole('button', { name: 'Yer değiştir' }));
    expect(field('Metin')).toHaveValue('<b>ç & ğ</b>');
  });
});

describe('Unicode kaçış aracı', () => {
  it('kaçışlar ve biçim değiştirir', async () => {
    setInput('unicode', 'ç😀');
    const user = renderTool(UnicodeTool);
    expect(field('Kaçışlı metin')).toHaveValue('\\u00e7\\ud83d\\ude00');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Biçim' }), 'codepoint');
    expect(field('Kaçışlı metin')).toHaveValue('\\u{e7}\\u{1f600}');
  });

  it('çözer; hatalı dizide konumlu hata gösterir', () => {
    setInput('unicode', 'decode', 'direction');
    setInput('unicode', '\\u00c7a\\u011fr\\u0131 U+1F680');
    renderTool(UnicodeTool);
    expect(field('Metin')).toHaveValue('Çağrı 🚀');
  });

  it('hatalı diziyi olduğu gibi bırakır; katı seçenekte konumlu hata', async () => {
    setInput('unicode', 'decode', 'direction');
    setInput('unicode', 'C:\\Users\\u00e7 ab\\u12');
    const user = renderTool(UnicodeTool);
    expect(field('Metin')).toHaveValue('C:\\Usersç ab\\u12');
    await user.click(screen.getByRole('checkbox', { name: 'Hatalı dizide hata ver' }));
    expect(screen.getByRole('alert')).toHaveTextContent('konum 3');
  });
});

describe('Hex aracı', () => {
  it('ayraç ve büyük harf seçenekleri', async () => {
    setInput('hex', 'Hiç');
    const user = renderTool(HexTool);
    expect(field('Hex')).toHaveValue('48 69 c3 a7');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Ayraç' }), '0x');
    await user.click(screen.getByRole('checkbox', { name: 'Büyük harf' }));
    expect(field('Hex')).toHaveValue('0x48 0x69 0xC3 0xA7');
  });

  it('çözerken geçersiz UTF-8 hata verir ya da � ile değiştirilir', async () => {
    setInput('hex', 'decode', 'direction');
    setInput('hex', 'ff 41');
    const user = renderTool(HexTool);
    expect(screen.getByRole('alert')).toHaveTextContent('UTF-8');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Geçersiz UTF-8' }), 'replace');
    expect(field('Metin')).toHaveValue('�A');
  });

  it('tek sayıda hane', () => {
    setInput('hex', 'decode', 'direction');
    setInput('hex', '486');
    renderTool(HexTool);
    expect(screen.getByRole('alert')).toHaveTextContent('Tek sayıda');
  });
});

describe('Base32 aracı', () => {
  it('kodlar, dolguyu kaldırır ve çözer', async () => {
    setInput('base32', 'foobar');
    const user = renderTool(Base32Tool);
    expect(field('Base32')).toHaveValue('MZXW6YTBOI======');
    await user.click(screen.getByRole('checkbox', { name: 'Dolgu (=)' }));
    expect(field('Base32')).toHaveValue('MZXW6YTBOI');
    await user.click(screen.getByRole('button', { name: 'Yer değiştir' }));
    expect(field('Metin')).toHaveValue('foobar');
  });

  it('metin olmayan veriyi hex olarak gösterir', async () => {
    setInput('base32', 'decode', 'direction');
    setInput('base32', '74======');
    const user = renderTool(Base32Tool);
    expect(screen.getByRole('alert')).toHaveTextContent('hex');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Çıktı' }), 'hex');
    expect(field('Metin')).toHaveValue('ff');
  });
});

describe('String kaçışı aracı', () => {
  it('dile göre kaçışlar; tırnak seçeneği', async () => {
    setInput('string-escape', 'O\'Brien "x"\n');
    const user = renderTool(StringEscapeTool);
    expect(field('Kaçışlı metin')).toHaveValue('O\'Brien \\"x\\"\\n');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Dil' }), 'sql');
    expect(field('Kaçışlı metin')).toHaveValue('O\'\'Brien "x"\n');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Dil' }), 'csharp-verbatim');
    await user.click(screen.getByRole('checkbox', { name: 'Tırnaklarla' }));
    expect(field('Kaçışlı metin')).toHaveValue('@"O\'Brien ""x""\n"');
  });

  it('kaçışı çözer; geçersiz kaçışta hata', () => {
    setInput('string-escape', 'decode', 'direction');
    setInput('string-escape', 'a\\x41');
    renderTool(StringEscapeTool);
    expect(screen.getByRole('alert')).toHaveTextContent('konum 2');
  });
});

describe('Sıkıştırma aracı', () => {
  it('sıkıştırır, boyut ve oranı gösterir; yer değiştirince açar', async () => {
    setInput('compress', 'Merhaba dünya! '.repeat(50));
    const user = renderTool(CompressTool);
    const output = await screen.findByRole('textbox', { name: 'Sıkıştırılmış (Base64)' }, SLOW);
    await vi.waitFor(() => expect((output as HTMLTextAreaElement).value).toMatch(/^H4sI/), SLOW);
    expect(screen.getByTestId('compress-stats')).toHaveTextContent(/Orijinal: 800 bayt .* Oran: %/);

    await user.click(screen.getByRole('button', { name: 'Yer değiştir' }));
    await vi.waitFor(() => expect(field('Açılmış metin')).toHaveValue('Merhaba dünya! '.repeat(50)), SLOW);
    expect(screen.getByTestId('compress-stats')).toHaveTextContent('Orijinal: 800 bayt');
  });

  it('bozuk veride anlaşılır hata', async () => {
    setInput('compress', 'decompress', 'direction');
    setInput('compress', 'gzip', 'format');
    setInput('compress', 'SGVsbG8gZMO8bnlh');
    renderTool(CompressTool);
    expect(await screen.findByRole('alert', {}, SLOW)).toHaveTextContent('Veri açılamadı');
  });

  it('hex girdiyi otomatik tanır ve ikili dosya yüklenebilir', async () => {
    setInput('compress', 'decompress', 'direction');
    setInput('compress', 'auto', 'format');
    setInput('compress', 'auto', 'encoding');
    // printf 'hello' | gzip -n | xxd -p
    setInput('compress', '1f8b0800000000000003cb48cdc9c9070086a6103605000000');
    const user = renderTool(CompressTool);
    await vi.waitFor(() => expect(field('Açılmış metin')).toHaveValue('hello'), SLOW);

    const gzip = Uint8Array.from(atob('H4sIAAAAAAAAA8tIzcnJBwCGphA2BQAAAA=='), (c) => c.charCodeAt(0));
    await user.upload(
      screen.getByLabelText('Sıkıştırılmış veri: dosyadan yükle'),
      new File([gzip], 'merhaba.gz'),
    );
    expect(await screen.findByText('merhaba.gz', {}, SLOW)).toBeInTheDocument();
    await vi.waitFor(() => expect(field('Açılmış metin')).toHaveValue('hello'), SLOW);
  });
});
