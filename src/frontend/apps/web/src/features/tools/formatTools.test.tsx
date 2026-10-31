import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import type { ComponentType } from 'react';
import { FormatError } from '@apivator/core/tools';
import { useToolsStore } from './toolsStore';
import { detectCodeLanguage, formatSql, formatYaml, minifySql } from './codeFormat';
import {
  GraphqlFormatTool,
  HtmlFormatTool,
  SqlFormatTool,
  XmlFormatTool,
  YamlFormatTool,
} from './tools/CodeFormatTool';

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

function Location() {
  return <output aria-label="Adres">{useLocation().pathname}</output>;
}

function renderTool(Tool: ComponentType) {
  render(
    <MemoryRouter initialEntries={['/tools/x']}>
      <Routes>
        <Route path="*" element={<Tool />} />
      </Routes>
      <Location />
    </MemoryRouter>,
  );
  return userEvent.setup();
}

const field = (name: string) => screen.getByRole('textbox', { name }) as HTMLTextAreaElement;
const setInput = (toolId: string, value: string, name = 'input') =>
  useToolsStore.getState().setInput(toolId, name, value);

function errorOf(run: () => unknown): FormatError {
  try {
    run();
  } catch (error) {
    if (error instanceof FormatError) return error;
    throw error;
  }
  throw new Error('hata bekleniyordu');
}

beforeEach(() => {
  localStorage.clear();
  useToolsStore.setState({ favorites: [], recent: [], inputs: {}, volatile: {}, rememberInputs: true });
});

describe('formatYaml', () => {
  const text = '# baş yorum\nb:   1 # satır yorumu\na:\n  - x\n  -   y\nc: {d: 1, e: [1,2]}\n---\nz: 2\n';

  it('yeniden yazar; yorumları ve çok belgeli akışı korur; idempotent', () => {
    const out = formatYaml(text);
    expect(out).toBe(
      '# baş yorum\nb: 1 # satır yorumu\na:\n  - x\n  - y\nc: { d: 1, e: [ 1, 2 ] }\n---\nz: 2',
    );
    expect(formatYaml(out)).toBe(out);
  });

  it('4 boşluk girinti ve anahtar sıralama', () => {
    expect(formatYaml('b:\n  y: 1\n  x: 2\na: 3', { indent: 4, sortKeys: true })).toBe(
      'a: 3\nb:\n    x: 2\n    y: 1',
    );
  });

  it('satır genişliği uzun dizgiyi katlar, 0 katlamaz', () => {
    const long = `a: ${'kelime '.repeat(20).trim()}`;
    expect(formatYaml(long, { lineWidth: 40 }).split('\n').length).toBeGreaterThan(1);
    expect(formatYaml(long, { lineWidth: 0 })).toBe(long);
  });

  it('hatada satır/sütun ve ofset', () => {
    const error = errorOf(() => formatYaml('a: 1\nb: [1, 2\nc: 3'));
    expect(error.line).toBe(3);
    expect(error.message).toMatch(/^3\. satır, \d+\. sütun: YAML: /);
    expect(formatYaml('')).toBe('');
  });
});

describe('formatSql', () => {
  it('lehçe, anahtar kelime harfi ve girinti', () => {
    expect(formatSql('select id, ad from kisi where aktif = 1')).toBe(
      'SELECT\n  id,\n  ad\nFROM\n  kisi\nWHERE\n  aktif = 1',
    );
    expect(formatSql('SELECT a FROM t', { keywordCase: 'lower', indent: 4 })).toBe(
      'select\n    a\nfrom\n    t',
    );
    expect(formatSql('select a from t', { indent: '\t' })).toBe('SELECT\n\ta\nFROM\n\tt');
    expect(formatSql('select [ad] from [kisi]', { dialect: 'tsql' })).toContain('[ad]');
    expect(formatSql('select $1::int', { dialect: 'postgresql' })).toBe('SELECT\n  $1::int');
    expect(formatSql('select `ad` from t', { dialect: 'mysql' })).toContain('`ad`');
  });

  it('idempotent', () => {
    const once = formatSql('select a,b from t join u on t.id=u.id where x in (1,2) order by a');
    expect(formatSql(once)).toBe(once);
  });

  it('hatada konum', () => {
    const error = errorOf(() => formatSql('select a\nfrom t where "kapanmamış'));
    expect(error.message).toContain('SQL:');
    expect(error.line).toBe(2);
  });
});

describe('minifySql', () => {
  const text = 'select a, -- yorum\n  \'x  -- değil\' as "b  c" /* blok */\nfrom   t\nwhere ( a = 1 ) ;';

  it('boşluğu sıkıştırır, dizgi ve tırnaklı adlara dokunmaz, yorumları korur', () => {
    expect(minifySql(text)).toBe(
      'select a,-- yorum\n\'x  -- değil\' as "b  c" /* blok */ from t where (a = 1);',
    );
  });

  it('yorumları çıkarır; biçimlendirilince aynı sonuç', () => {
    const min = minifySql(text, { removeComments: true });
    expect(min).toBe('select a,\'x  -- değil\' as "b  c" from t where (a = 1);');
    expect(formatSql(min)).toBe(formatSql(minifySql(text, { removeComments: true })));
  });

  it("lehçeye özgü: T-SQL [ad], PostgreSQL $$, MySQL # ve \\'", () => {
    expect(minifySql('select [a  b]  from t', { dialect: 'tsql' })).toBe('select [a  b] from t');
    expect(minifySql('do $$ begin   x; end $$', { dialect: 'postgresql' })).toBe('do $$ begin   x; end $$');
    expect(minifySql("select 'a\\'  b' # c\nfrom t", { dialect: 'mysql', removeComments: true })).toBe(
      "select 'a\\'  b' from t",
    );
  });

  it("PostgreSQL E'...' dizgisinde \\' kaçışı dizgiyi bitirmez", () => {
    expect(minifySql("select E'a\\'  b',  'x  y'", { dialect: 'postgresql' })).toBe(
      "select E'a\\'  b','x  y'",
    );
    // Standart dizgide ters eğik çizgi kaçış değildir.
    expect(minifySql("select 'a\\',  b", { dialect: 'postgresql' })).toBe("select 'a\\',b");
  });

  it('büyük girdide doğrusal', () => {
    const text = 'SELECT a, b FROM t WHERE x = 1;\n'.repeat(40_000);
    const started = performance.now();
    const min = minifySql(text);
    // Eskiden her parçada çıktının sonu okunurken metin kopyalanıyordu (~60 sn).
    expect(performance.now() - started).toBeLessThan(3000);
    expect(min.length).toBe(40_000 * 31 - 1);
  });
});

describe('detectCodeLanguage', () => {
  it.each([
    ['<?xml version="1.0"?><a/>', 'xml'],
    ['<kitap><ad/></kitap>', 'xml'],
    ['<!DOCTYPE html><p>', 'html'],
    ['<div class="a">x</div>', 'html'],
    ['{"a": 1}', 'json'],
    ['{ kullanici { id } }', 'graphql'],
    ['query Q { a }', 'graphql'],
    ['# şema\ntype Query { a: Int }', 'graphql'],
    ['-- rapor\nSELECT * FROM t', 'sql'],
    ['with x as (select 1) select * from x', 'sql'],
    ['ad: Ayşe\nyas: 3', 'yaml'],
    ['---\n- a', 'yaml'],
    ['düz metin', null],
    ['', null],
  ])('%s → %s', (text, expected) => {
    expect(detectCodeLanguage(text)).toBe(expected);
  });
});

describe('Kod biçimlendirici araçları', () => {
  it('XML: biçimlendirir, küçültür, girdiye uygular', async () => {
    setInput('xml-format', '<a><b>1</b><!-- y --></a>');
    const user = renderTool(XmlFormatTool);
    expect(field('Sonuç')).toHaveValue('<a>\n  <b>1</b>\n  <!-- y -->\n</a>');
    expect(screen.getByText('Geçerli XML')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Girinti'), '4');
    expect(field('Sonuç')).toHaveValue('<a>\n    <b>1</b>\n    <!-- y -->\n</a>');
    await user.selectOptions(screen.getByLabelText('İşlem'), 'minify');
    expect(screen.queryByLabelText('Girinti')).not.toBeInTheDocument();
    await user.click(screen.getByLabelText('Yorumları çıkar'));
    expect(field('Sonuç')).toHaveValue('<a><b>1</b></a>');
    await user.click(screen.getByRole('button', { name: 'Girdiye uygula' }));
    expect(field('XML')).toHaveValue('<a><b>1</b></a>');
  });

  it('XML: hatada satır/sütun, alıntı ve "Hataya git"', () => {
    setInput('xml-format', '<a>\n  <b></c>\n</a>');
    renderTool(XmlFormatTool);
    expect(screen.getByRole('alert')).toHaveTextContent(
      '2. satır, 6. sütun: Beklenmeyen kapanış etiketi </c>',
    );
    expect(document.querySelector('pre')).toHaveTextContent('<b></c>');
    expect(screen.getByRole('button', { name: 'Hataya git' })).toBeEnabled();
    expect(field('Sonuç')).toHaveValue('');
  });

  it('YAML: küçültme yok, sekme girintisi sunulmaz, anahtar sıralar', async () => {
    setInput('yaml-format', 'b: 1\na: 2');
    const user = renderTool(YamlFormatTool);
    expect(screen.queryByLabelText('İşlem')).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Sekme' })).not.toBeInTheDocument();
    await user.click(screen.getByLabelText('Anahtarları sırala'));
    expect(field('Sonuç')).toHaveValue('a: 2\nb: 1');
  });

  it('SQL: lehçe ve harf seçimi; küçültme', async () => {
    setInput('sql-format', 'select a from t');
    const user = renderTool(SqlFormatTool);
    expect(field('Sonuç')).toHaveValue('SELECT\n  a\nFROM\n  t');
    await user.selectOptions(screen.getByLabelText('Anahtar kelimeler'), 'lower');
    expect(field('Sonuç')).toHaveValue('select\n  a\nfrom\n  t');
    await user.selectOptions(screen.getByLabelText('Lehçe'), 'postgresql');
    await user.selectOptions(screen.getByLabelText('İşlem'), 'minify');
    expect(field('Sonuç')).toHaveValue('select a from t');
  });

  it('GraphQL biçimlendirir', () => {
    setInput('graphql-format', '{ a { b } }');
    renderTool(GraphqlFormatTool);
    expect(field('Sonuç')).toHaveValue('{\n  a {\n    b\n  }\n}');
  });

  it('HTML biçimlendirir', () => {
    setInput('html-format', '<ul><li>a<li>b</ul>');
    renderTool(HtmlFormatTool);
    expect(field('Sonuç')).toHaveValue('<ul>\n  <li>a\n  <li>b\n</ul>');
  });

  it('başka dile benzeyen girdi için ilgili aracı önerir', async () => {
    setInput('xml-format', 'SELECT * FROM t');
    const user = renderTool(XmlFormatTool);
    expect(screen.getByText(/Girdi SQL gibi görünüyor/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'SQL biçimlendiricide aç' }));
    expect(screen.getByRole('status', { name: 'Adres' })).toHaveTextContent('/tools/sql-format');
    expect(useToolsStore.getState().inputs['sql-format']?.input).toBe('SELECT * FROM t');
  });

  it('5 MB üstü girdiyi biçimlendirmez', () => {
    setInput('graphql-format', `{ a }${' '.repeat(5 * 1024 * 1024)}`);
    renderTool(GraphqlFormatTool);
    expect(screen.getByRole('alert')).toHaveTextContent('Girdi çok büyük');
  });
});
