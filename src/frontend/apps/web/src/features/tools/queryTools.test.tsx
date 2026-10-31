import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { useToolsStore } from './toolsStore';
import JsonPathTool from './tools/JsonPathTool';
import { evaluateXPath, formatXPathOutput } from './xpath';
import { runQuery } from './queryEngines';

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

function renderTool() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <JsonPathTool />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

const field = (name: string) => screen.getByRole('textbox', { name }) as HTMLTextAreaElement;
const setInput = (field: string, value: string) =>
  useToolsStore.getState().setInput('jsonpath', field, value);

const XML = `<?xml version="1.0"?>
<kitaplar xmlns:x="urn:ek">
  <kitap id="1"><baslik>Bir</baslik><fiyat>8</fiyat></kitap>
  <kitap id="2"><baslik>İki &amp; Üç</baslik><fiyat>12</fiyat><x:not>ek</x:not></kitap>
  <!-- yorum -->
</kitaplar>`;

beforeEach(() => {
  localStorage.clear();
  useToolsStore.setState({ favorites: [], recent: [], inputs: {}, volatile: {}, rememberInputs: true });
});

describe('evaluateXPath', () => {
  it('düğüm kümesi belge sırasıyla; öznitelik, metin, yorum', () => {
    const elements = evaluateXPath(XML, '//kitap');
    expect(elements.kind).toBe('nodes');
    if (elements.kind !== 'nodes') return;
    expect(elements.count).toBe(2);
    expect(elements.nodes[0]).toMatchObject({ kind: 'element', name: 'kitap', text: 'Bir8' });
    expect(elements.nodes[0]!.xml).toBe('<kitap id="1"><baslik>Bir</baslik><fiyat>8</fiyat></kitap>');

    expect(formatXPathOutput(evaluateXPath(XML, '//kitap/@id'), 'text')).toBe('1\n2');
    expect(formatXPathOutput(evaluateXPath(XML, '//kitap/@id'), 'xml')).toBe('id="1"\nid="2"');
    expect(formatXPathOutput(evaluateXPath(XML, '//kitap[fiyat > 10]/baslik/text()'), 'text')).toBe(
      'İki & Üç',
    );
    expect(formatXPathOutput(evaluateXPath(XML, '//comment()'), 'text')).toBe(' yorum ');
    expect(formatXPathOutput(evaluateXPath(XML, '//x:not'), 'text')).toBe('ek');
    expect(evaluateXPath(XML, '//yok')).toEqual({ kind: 'nodes', nodes: [], count: 0 });
  });

  it('sayı, metin ve mantıksal sonuçlar', () => {
    expect(evaluateXPath(XML, 'count(//kitap)')).toEqual({ kind: 'number', value: 2 });
    expect(evaluateXPath(XML, 'sum(//fiyat)')).toEqual({ kind: 'number', value: 20 });
    expect(evaluateXPath(XML, 'string(//kitap[2]/@id)')).toEqual({ kind: 'string', value: '2' });
    expect(evaluateXPath(XML, '//fiyat > 10')).toEqual({ kind: 'boolean', value: true });
  });

  it('hatalar Türkçe; DOCTYPE/ENTITY reddedilir', () => {
    expect(() => evaluateXPath('<a><b></a>', '//b')).toThrow(/Geçerli bir XML değil/);
    expect(() => evaluateXPath(XML, '//[')).toThrow(/Geçersiz XPath ifadesi/);
    expect(() => evaluateXPath(XML, '//yok:a')).toThrow(/Geçersiz XPath ifadesi/);
    const xxe = '<?xml version="1.0"?><!DOCTYPE a [<!ENTITY e SYSTEM "file:///etc/passwd">]><a>&e;</a>';
    expect(() => evaluateXPath(xxe, '/a')).toThrow(/DOCTYPE/);
    expect(() => evaluateXPath('<a/><!doctype a>', '/a')).toThrow(/DOCTYPE/);
  });

  it('derin belgede //* serileştirmesi toplam boyutla sınırlı; sayı hepsini kapsar', () => {
    const deep = '<a>'.repeat(300) + 'x'.repeat(100_000) + '</a>'.repeat(300);
    const result = evaluateXPath(deep, '//*');
    if (result.kind !== 'nodes') throw new Error('düğüm bekleniyordu');
    expect(result.count).toBe(300);
    expect(result.nodes.length).toBeLessThan(300);
    expect(runQuery('xpath', deep, '//*', 'xml').summary).toMatch(/^300 düğüm \(ilk \d+ gösteriliyor\)$/);
  });
});

describe('runQuery', () => {
  it('JMESPath: JSON olmadan da sözdizimi hatası konumlu', () => {
    expect(runQuery('jmespath', '', 'foo[', 'values')).toMatchObject({ position: 4 });
    // Çalışma hatası (tür) girdi yokken gösterilmez.
    expect(runQuery('jmespath', '', 'abs(foo)', 'values').error).toBeNull();
    expect(runQuery('jmespath', '[1,2]', 'abs(@)', 'values').error).toMatch(/abs\(\)/);
  });

  it('JMESPath sonucu ve özet', () => {
    const result = runQuery('jmespath', '[{"id":1,"f":9},{"id":2,"f":3}]', 'sort_by(@, &f)[*].id', 'values');
    expect(JSON.parse(result.text)).toEqual([2, 1]);
    expect(result.summary).toBe('2 öğe');
    expect(result.items).toBeNull();
  });

  it('JSON hatası ifade geçerliyken gösterilir', () => {
    expect(runQuery('jmespath', '{bozuk', '@', 'values').error).toBeTruthy();
    expect(runQuery('jsonpath', '{bozuk', '$', 'values').error).toBeTruthy();
  });

  it('XPath sonucu dil ve özetle', () => {
    const nodes = runQuery('xpath', XML, '//baslik', 'xml');
    expect(nodes.summary).toBe('2 düğüm');
    expect(nodes.textLanguage).toBe('Xml');
    expect(nodes.items?.map((i) => i.label)).toEqual(['baslik', 'baslik']);
    expect(runQuery('xpath', XML, '//@id', 'text').items?.map((i) => i.label)).toEqual(['@id', '@id']);
    expect(runQuery('xpath', XML, 'count(//kitap)', 'xml')).toMatchObject({
      text: '2',
      summary: 'Sonuç (sayı)',
    });
    expect(runQuery('xpath', '', '//a', 'xml').error).toBeNull();
  });
});

describe('Sorgu aracı', () => {
  it('eski JSONPath kaydı korunur; dil değişince her dilin ifadesi ayrı', async () => {
    setInput(
      'input',
      JSON.stringify([
        { id: 1, fiyat: 8 },
        { id: 2, fiyat: 12 },
      ]),
    );
    setInput('expression', '$[?(@.fiyat < 10)].id');
    const user = renderTool();
    expect(JSON.parse(field('Sonuç JSON').value)).toEqual([1]);

    await user.selectOptions(screen.getByRole('combobox', { name: 'Sorgu dili' }), 'jmespath');
    const expression = screen.getByRole('textbox', { name: 'JMESPath ifadesi' });
    await user.clear(expression);
    await user.click(expression);
    await user.paste('[?fiyat > `10`].id | [0]');
    expect(JSON.parse(field('Sonuç JSON').value)).toBe(2);
    expect(useToolsStore.getState().inputs.jsonpath).toMatchObject({
      language: 'jmespath',
      expression: '$[?(@.fiyat < 10)].id',
      jmespathExpression: '[?fiyat > `10`].id | [0]',
    });

    await user.selectOptions(screen.getByRole('combobox', { name: 'Sorgu dili' }), 'jsonpath');
    expect(screen.getByRole('textbox', { name: 'JSONPath ifadesi' })).toHaveValue('$[?(@.fiyat < 10)].id');
  });

  it('JMESPath sözdizimi hatası uyarı olarak gösterilir', async () => {
    setInput('language', 'jmespath');
    setInput('input', '{"a": 1}');
    const user = renderTool();
    const expression = screen.getByRole('textbox', { name: 'JMESPath ifadesi' });
    await user.clear(expression);
    await user.click(expression);
    await user.paste('a.');
    expect(screen.getByRole('alert')).toHaveTextContent('3. karakterde');
  });

  it('XPath: XML girdisi, düğüm listesi ve metin çıktısı', async () => {
    setInput('language', 'xpath');
    setInput('input', XML);
    const user = renderTool();
    const expression = screen.getByRole('textbox', { name: 'XPath ifadesi' });
    await user.clear(expression);
    await user.click(expression);
    await user.paste('//kitap/baslik');
    expect(screen.getByText('2 düğüm')).toBeInTheDocument();
    expect(field('Sonuç').value).toBe('<baslik>Bir</baslik>\n<baslik>İki &amp; Üç</baslik>');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sonuç' }), 'text');
    expect(field('Sonuç').value).toBe('Bir\nİki & Üç');

    await user.click(screen.getByRole('button', { name: 'count(//*)' }));
    expect(field('Sonuç').value).toBe('8');
  });

  it('XPath: geçersiz XML Türkçe hata', () => {
    setInput('language', 'xpath');
    setInput('input', '<a><b></a>');
    renderTool();
    expect(screen.getByRole('alert')).toHaveTextContent('Geçerli bir XML değil');
  });
});
