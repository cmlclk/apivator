import { describe, expect, it } from 'vitest';
import { ToolError } from './errors';
import {
  LINE_OP_DEFAULTS,
  applyLineOp,
  applyLineOps,
  secureRandomInt,
  splitLines,
  unescapeSeparator,
  type LineOp,
} from './lineOps';

const sort = (lines: string[], over: Partial<Extract<LineOp, { kind: 'sort' }>> = {}) =>
  applyLineOp(lines, { ...LINE_OP_DEFAULTS.sort, ...over }).lines;

describe('splitLines / applyLineOps', () => {
  it('LF ve CRLF biçimini, sondaki satır sonunu korur', () => {
    expect(splitLines('a\r\nb\r\n')).toEqual({ lines: ['a', 'b'], eol: '\r\n', trailingNewline: true });
    expect(applyLineOps('b\r\na\r\n', [LINE_OP_DEFAULTS.sort]).text).toBe('a\r\nb\r\n');
    expect(applyLineOps('b\na', [LINE_OP_DEFAULTS.sort]).text).toBe('a\nb');
    expect(applyLineOps('', [LINE_OP_DEFAULTS.sort]).text).toBe('');
  });

  it('adımları sırayla uygular ve çıkarılan satır sayısını raporlar', () => {
    const result = applyLineOps(' b \na\n\nb\n', [
      LINE_OP_DEFAULTS.trim,
      LINE_OP_DEFAULTS['remove-empty'],
      LINE_OP_DEFAULTS.unique,
      LINE_OP_DEFAULTS.sort,
    ]);
    expect(result.text).toBe('a\nb\n');
    expect(result.steps.map((s) => s.removed)).toEqual([undefined, 1, 1, undefined]);
    expect(result.steps.at(-1)!.lineCount).toBe(2);
  });
});

describe('sıralama', () => {
  it('Türkçe harmanlama: ç c’den, ı i’den önce; İngilizce farklı', () => {
    expect(sort(['ç', 'd', 'c'])).toEqual(['c', 'ç', 'd']);
    expect(sort(['i', 'ı', 'h'])).toEqual(['h', 'ı', 'i']);
    expect(sort(['i', 'ı', 'h'], { locale: 'en' })).toEqual(['h', 'i', 'ı']);
    expect(sort(['b', 'B', 'a'], { locale: 'raw' })).toEqual(['B', 'a', 'b']);
  });

  it('azalan, doğal (sayısal), uzunluğa göre', () => {
    expect(sort(['a', 'c', 'b'], { descending: true })).toEqual(['c', 'b', 'a']);
    expect(sort(['f10', 'f2', 'f1'])).toEqual(['f1', 'f10', 'f2']);
    expect(sort(['f10', 'f2', 'f1'], { mode: 'natural' })).toEqual(['f1', 'f2', 'f10']);
    expect(sort(['ccc', 'a', 'bb', 'b'], { mode: 'length' })).toEqual(['a', 'b', 'bb', 'ccc']);
  });
});

describe('tekilleştirme ve filtre', () => {
  it('ilkini tutar; büyük/küçük harf ve boşluk seçenekleri (Türkçe İ/i)', () => {
    const u = (lines: string[], over = {}) => applyLineOp(lines, { ...LINE_OP_DEFAULTS.unique, ...over });
    expect(u(['a', 'A', 'a'])).toEqual({ lines: ['a', 'A'], removed: 1 });
    expect(u(['İstanbul', 'istanbul'], { ignoreCase: true }).lines).toEqual(['İstanbul']);
    expect(u(['a  b', ' a b'], { ignoreWhitespace: true }).lines).toEqual(['a  b']);
  });

  it('içeren / içermeyen satırlar', () => {
    const f = (keep: boolean, ignoreCase = true) =>
      applyLineOp(['IŞIK', 'ışık', 'kapı'], { ...LINE_OP_DEFAULTS.filter, text: 'ışık', keep, ignoreCase });
    expect(f(true)).toEqual({ lines: ['IŞIK', 'ışık'], removed: 1 });
    expect(f(false).lines).toEqual(['kapı']);
    expect(f(true, false).lines).toEqual(['ışık']);
  });
});

describe('diğer işlemler', () => {
  it('önek/sonek, numaralama, ters çevirme', () => {
    expect(applyLineOp(['a'], { kind: 'affix', prefix: '"', suffix: '",' }).lines).toEqual(['"a",']);
    expect(
      applyLineOp(
        Array.from({ length: 10 }, () => 'x'),
        { kind: 'number', start: 1, separator: ') ', pad: true },
      ).lines[0],
    ).toBe('01) x');
    expect(applyLineOp(['a', 'b'], LINE_OP_DEFAULTS.reverse).lines).toEqual(['b', 'a']);
  });

  it('birleştirme ve bölme (\\n, \\t kaçışları)', () => {
    expect(applyLineOps('a\nb\nc', [{ kind: 'join', separator: ', ' }]).text).toBe('a, b, c');
    expect(applyLineOps('a,b\nc', [{ kind: 'split', separator: ',' }]).text).toBe('a\nb\nc');
    expect(applyLineOps('a\nb', [{ kind: 'join', separator: '\\t' }]).text).toBe('a\tb');
    expect(unescapeSeparator('\\n\\\\')).toBe('\n\\');
    expect(() => applyLineOp(['a'], { kind: 'split', separator: '' })).toThrow(ToolError);
  });

  it('sözcük sınırında sarar, paragrafları birleştirir', () => {
    expect(applyLineOp(['bir iki üç dört'], { kind: 'wrap', width: 7 }).lines).toEqual([
      'bir iki',
      'üç dört',
    ]);
    expect(applyLineOp(['  aaaa bb'], { kind: 'wrap', width: 6 }).lines).toEqual(['  aaaa', '  bb']);
    expect(() => applyLineOp(['a'], { kind: 'wrap', width: 0 })).toThrow(ToolError);
    expect(applyLineOp(['bir', ' iki', '', 'üç'], LINE_OP_DEFAULTS.unwrap).lines).toEqual([
      'bir iki',
      '',
      'üç',
    ]);
  });

  it('karıştırma bir permütasyon üretir; verilen rastgele kaynağı kullanır', () => {
    const lines = Array.from({ length: 50 }, (_, i) => String(i));
    const shuffled = applyLineOp(lines, LINE_OP_DEFAULTS.shuffle).lines;
    expect([...shuffled].sort()).toEqual([...lines].sort());
    expect(applyLineOp(['a', 'b', 'c'], LINE_OP_DEFAULTS.shuffle, () => 0).lines).toEqual(['b', 'c', 'a']);
  });

  it('secureRandomInt aralıkta kalır', () => {
    for (let i = 0; i < 200; i++) {
      const n = secureRandomInt(7);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(7);
    }
    expect(secureRandomInt(1)).toBe(0);
  });
});
