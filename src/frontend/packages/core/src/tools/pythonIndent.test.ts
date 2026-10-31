import { afterEach, describe, expect, it } from 'vitest';
import en from '../locales/en/toolsData.json';
import { registerCoreMessages, setCoreLanguage } from '../i18n';
import { reindentPython, type PythonIndentOptions } from './pythonIndent';

const src = (...lines: string[]) => lines.join('\n') + '\n';
const fix = (text: string, options?: PythonIndentOptions) => reindentPython(text, options).output;
const kinds = (text: string, options?: PythonIndentOptions) =>
  reindentPython(text, options).issues.map((i) => [i.line, i.kind]);

describe('reindentPython: girinti', () => {
  it('2 boşluktan 4 boşluğa, seviyeler korunarak', () => {
    const input = src('def f(x):', '  if x:', '    return 1', '  return 2');
    expect(fix(input)).toBe(src('def f(x):', '    if x:', '        return 1', '    return 2'));
  });

  it('boşluktan sekmeye ve sekmeden boşluğa', () => {
    const spaces = src('class A:', '    def m(self):', '        pass');
    const tabs = src('class A:', '\tdef m(self):', '\t\tpass');
    expect(fix(spaces, { style: 'tabs' })).toBe(tabs);
    expect(fix(tabs, { width: 2 })).toBe(src('class A:', '  def m(self):', '    pass'));
    expect(fix(tabs, { width: 8 })).toBe(src('class A:', '        def m(self):', '                pass'));
  });

  it('girintisi zaten düzgün kod değişmez', () => {
    const input = src('import os', '', '', 'def f():', '    return os.sep');
    expect(reindentPython(input)).toEqual({
      output: input,
      issues: [],
      stats: { tabLines: 0, spaceLines: 1, mixedLines: 0 },
    });
  });

  it('karışık sekme/boşluk ve TabError satır numarasıyla', () => {
    // 2. satır sekme, 3. satır 8 boşluk: Python'da sekme 8 sütun ama karşılaştırma tutarsız → TabError.
    const input = src('if True:', '\tx = 1', '        y = 2');
    const result = reindentPython(input);
    expect(result.issues.map((i) => [i.line, i.kind, i.fixed])).toEqual([[3, 'tab-error', true]]);
    expect(result.output).toBe(src('if True:', '    x = 1', '    y = 2'));
    expect(result.stats).toEqual({ tabLines: 1, spaceLines: 1, mixedLines: 0 });
    expect(kinds(src('if True:', '    \tx = 1'))).toEqual([[2, 'mixed']]);
  });

  it('sekme genişliği girdideki karışık girintinin yorumunu belirler', () => {
    const input = src('def f():', '    if x:', '\tpass');
    // Sekme 4 sütunsa üçüncü satır ikinciyle aynı seviyede (beklenen blok yok uyarısı).
    expect(fix(input, { tabSize: 4 })).toBe(src('def f():', '    if x:', '    pass'));
    // Sekme 8 sütunsa bir içeride.
    expect(fix(input, { tabSize: 8 })).toBe(src('def f():', '    if x:', '        pass'));
  });

  it('tutarsız geri girinti en yakın seviyeye çekilir', () => {
    const input = src('def f():', '    if x:', '        a()', '      b()', '  c()');
    const result = reindentPython(input);
    expect(result.output).toBe(src('def f():', '    if x:', '        a()', '        b()', '    c()'));
    expect(result.issues.map((i) => [i.line, i.kind])).toEqual([
      [4, 'dedent'],
      [5, 'dedent'],
    ]);
  });

  it('beklenmeyen girinti düzeltilir, eksik blok yalnızca bildirilir', () => {
    const result = reindentPython(src('x = 1', '    y = 2', 'if x:', 'z = 3'));
    expect(result.output).toBe(src('x = 1', 'y = 2', 'if x:', 'z = 3'));
    expect(result.issues.map((i) => [i.line, i.kind, i.fixed])).toEqual([
      [2, 'unexpected-indent', true],
      [4, 'expected-indent', false],
    ]);
  });

  it('yorum satırları yakın seviyeye hizalanır, girintiyi etkilemez', () => {
    const input = src('def f():', '  # gövde', '  x = 1', '      # derin yorum', '# dış', '  return x');
    expect(fix(input)).toBe(
      src('def f():', '    # gövde', '    x = 1', '    # derin yorum', '# dış', '    return x'),
    );
    expect(fix(src('if a:', '      # ilk', '  b()'))).toBe(src('if a:', '    # ilk', '    b()'));
  });
});

describe('reindentPython: anlam korunur', () => {
  it('üç tırnaklı metinlerin içi (önekli) değişmez', () => {
    const input = src(
      'def f():',
      '  s = """',
      '  sahte girinti:   ',
      '\tsekme',
      '      """',
      "  b = rb'''x",
      "   y'''  ",
      '  return s',
    );
    expect(fix(input)).toBe(
      src(
        'def f():',
        '    s = """',
        '  sahte girinti:   ',
        '\tsekme',
        '      """',
        "    b = rb'''x",
        "   y'''",
        '    return s',
      ),
    );
  });

  it('metin içindeki # ve tırnaklar, kaçışlı tırnak', () => {
    const input = src('if a:', '  s = "# değil \\" " + ""', '  t = \'"""\'', '  u = 1');
    expect(fix(input)).toBe(src('if a:', '    s = "# değil \\" " + ""', '    t = \'"""\'', '    u = 1'));
  });

  it('parantez içi devam satırları göreli hizasını korur', () => {
    const input = src(
      'def f():',
      '  x = foo(a,',
      '          b, [1,',
      '              2])',
      '  y = {',
      '      "k": (1,',
      '            2),',
      '  }',
      '  return x',
    );
    expect(fix(input)).toBe(
      src(
        'def f():',
        '    x = foo(a,',
        '            b, [1,',
        '                2])',
        '    y = {',
        '        "k": (1,',
        '              2),',
        '    }',
        '    return x',
      ),
    );
  });

  it('ters eğik çizgili devam ve sekmeli devam satırları', () => {
    expect(fix(src('if a:', '  x = 1 + \\', '      2', '  y = 3'))).toBe(
      src('if a:', '    x = 1 + \\', '        2', '    y = 3'),
    );
    expect(fix(src('if a:', '\tx = f(', '\t\t1)'))).toBe(src('if a:', '    x = f(', '        1)'));
    expect(fix(src('if a:', '\tx = f(', '\t\t1)'), { style: 'tabs' })).toBe(
      src('if a:', '\tx = f(', '\t\t1)'),
    );
  });

  it('parantez içindeki ":" blok açmaz; yorumdaki ":" sayılmaz', () => {
    const input = src('d = {', '  "a": 1,', '}', 'if x:  # yorum', '  y = d["a"][1:', '  ]');
    expect(fix(input)).toBe(src('d = {', '  "a": 1,', '}', 'if x:  # yorum', '    y = d["a"][1:', '    ]'));
  });

  it('kapanmayan üç tırnaklı metinden sonrası değişmez', () => {
    const result = reindentPython(src('def f():', '  x = """', '  a', '\tb'));
    expect(result.output).toBe(src('def f():', '    x = """', '  a', '\tb'));
    expect(result.issues.map((i) => [i.line, i.kind])).toEqual([[2, 'unterminated-string']]);
  });

  it('tek tırnaklı metin ters eğik çizgiyle sonraki satıra sürer', () => {
    const input = src('if a:', "  s = 'bir \\", "  iki'", '  t = 1');
    expect(fix(input)).toBe(src('if a:', "    s = 'bir \\", "  iki'", '    t = 1'));
  });
});

describe('reindentPython: boşluklar ve satır sonları', () => {
  it('satır sonu boşlukları silinir (metin içi ve ters eğik çizgi hariç)', () => {
    const input = src('x = 1   ', 'y = 2\t', 's = """a   ', 'b"""  ', 'z = 3 \\ ');
    expect(fix(input)).toBe(src('x = 1', 'y = 2', 's = """a   ', 'b"""', 'z = 3 \\ '));
    expect(fix(input, { trimTrailing: false })).toBe(input);
  });

  it('fazla boş satırlar: üst düzeyde 2, blok içinde 1, baş ve sonda yok', () => {
    const input = src(
      '',
      '',
      'import os',
      '',
      '',
      '',
      '',
      'def f():',
      '    a = 1',
      '',
      '',
      '',
      '    b = 2',
      '',
      '',
      '',
    );
    expect(fix(input)).toBe(src('import os', '', '', 'def f():', '    a = 1', '', '    b = 2'));
    expect(fix(input, { collapseBlankLines: false })).toBe(input);
    // Metin içindeki boş satırlara dokunulmaz.
    const doc = src('s = """', '', '', '', '"""');
    expect(fix(doc)).toBe(doc);
  });

  it('satır sonu biçimi: koru, LF, CRLF; son satır sonu korunur', () => {
    const crlf = 'if a:\r\n  b()\r\n';
    expect(fix(crlf)).toBe('if a:\r\n    b()\r\n');
    expect(fix(crlf, { lineEnding: 'lf' })).toBe('if a:\n    b()\n');
    expect(fix('if a:\n  b()', { lineEnding: 'crlf' })).toBe('if a:\r\n    b()');
    expect(fix('')).toBe('');
  });
});

describe('English messages', () => {
  afterEach(() => setCoreLanguage('tr'));

  it('reports indent warnings in English', () => {
    registerCoreMessages('en', { toolsData: en });
    setCoreLanguage('en');
    const result = reindentPython(src('if x:', '    a = 1', '  b = 2'));
    expect(result.issues.map((i) => i.message)).toEqual([
      'The indentation does not match any outer level; Python raises an IndentationError here.',
    ]);
  });
});
