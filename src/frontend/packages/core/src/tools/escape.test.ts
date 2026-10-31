import { describe, expect, it } from 'vitest';
import { ToolError } from './errors';
import { escapeString, unescapeString, type EscapeLanguage } from './escape';

const SAMPLE = 'Dosya: "C:\\temp\\ç.txt"\n\tO\'Brien\r\0 sonu';
const LANGUAGES: EscapeLanguage[] = [
  'json',
  'javascript',
  'java',
  'csharp',
  'csharp-verbatim',
  'sql',
  'regex',
];

describe('escapeString', () => {
  it('JSON', () => {
    expect(escapeString('a"b\\c\nç\u0001', 'json')).toBe('a\\"b\\\\c\\nç\\u0001');
  });

  it('JavaScript: iki tırnak türü, \\0 ve satır ayırıcı', () => {
    expect(escapeString(`'"\n\0\u2028\u0001`, 'javascript')).toBe(`\\'\\"\\n\\0\\u2028\\x01`);
  });

  it('JavaScript: ard\u0131ndan rakam gelen \\0 sekizli olmas\u0131n diye \\x00 olur', () => {
    expect(escapeString('\x001 \\01 \x00a', 'javascript')).toBe('\\x001 \\\\01 \\0a');
    expect(unescapeString(escapeString('\x001\x00\x002', 'javascript'), 'javascript')).toBe('\x001\x00\x002');
  });

  it('Java ve C#', () => {
    expect(escapeString('"\\\t\u0001', 'java')).toBe('\\"\\\\\\t\\u0001');
    expect(escapeString('"\0\u0007\v', 'csharp')).toBe('\\"\\0\\a\\v');
  });

  it('C# verbatim ve SQL tırnağı ikiler', () => {
    expect(escapeString('a "b" \\n', 'csharp-verbatim')).toBe('a ""b"" \\n');
    expect(escapeString("O'Brien", 'sql')).toBe("O''Brien");
  });

  it('regex meta karakterleri', () => {
    expect(escapeString('a.b*c?(d)[e]{f}^$|\\+/', 'regex')).toBe(
      'a\\.b\\*c\\?\\(d\\)\\[e\\]\\{f\\}\\^\\$\\|\\\\\\+/',
    );
  });

  it('tırnak seçeneği', () => {
    expect(escapeString('x', 'json', { quote: true })).toBe('"x"');
    expect(escapeString('x"', 'csharp-verbatim', { quote: true })).toBe('@"x"""');
    expect(escapeString('x', 'sql', { quote: true })).toBe("'x'");
    expect(escapeString('x', 'regex', { quote: true })).toBe('x');
  });
});

describe('unescapeString', () => {
  it('her dilde gidiş-dönüş korunur', () => {
    for (const language of LANGUAGES) {
      expect(unescapeString(escapeString(SAMPLE, language), language), language).toBe(SAMPLE);
      const quoted = escapeString(SAMPLE, language, { quote: true });
      expect(unescapeString(quoted, language, { quote: true }), language).toBe(SAMPLE);
    }
  });

  it('JSON: \\u ve \\/; tanımadığı kaçışta hata', () => {
    expect(unescapeString('\\u00e7\\/\\ud83d\\ude00', 'json')).toBe('ç/😀');
    expect(() => unescapeString('a\\x41', 'json')).toThrow(/konum 2/);
    expect(() => unescapeString('\\u12', 'json')).toThrow(ToolError);
  });

  it('JavaScript: \\x, \\u{...}, satır devamı ve kimlik kaçışı', () => {
    expect(unescapeString('\\x41\\u{1F600}\\q\\\nB', 'javascript')).toBe('A😀qB');
    expect(() => unescapeString('\\01', 'javascript')).toThrow(/Sekizli/);
    expect(() => unescapeString('\\u{110000}', 'javascript')).toThrow(ToolError);
  });

  it('Java: sekizli ve çoklu u', () => {
    expect(unescapeString('\\101\\7\\uu0042\\s', 'java')).toBe('A\u0007B ');
    expect(() => unescapeString('\\a', 'java')).toThrow(ToolError);
  });

  it('C#: \\x 1–4 hane, \\U ve \\0 ardından rakam', () => {
    expect(unescapeString('\\x41\\x0042\\U0001F600\\a\\01', 'csharp')).toBe('AB😀\u0007\u00001');
    expect(() => unescapeString('\\xZ', 'csharp')).toThrow(ToolError);
  });

  it('tek ters bölüyle biten metin', () => {
    expect(() => unescapeString('abc\\', 'json')).toThrow(/ters bölü/);
    expect(() => unescapeString('abc\\', 'regex')).toThrow(/ters bölü/);
  });

  it('SQL ve verbatim: tek başına tırnak hata verir', () => {
    expect(unescapeString("O''Brien", 'sql')).toBe("O'Brien");
    expect(() => unescapeString("O'Brien", 'sql')).toThrow(/konum 2/);
    expect(() => unescapeString('a"b', 'csharp-verbatim')).toThrow(ToolError);
  });

  it('regex: ters bölüler kaldırılır, \\n \\t karaktere döner', () => {
    expect(unescapeString('a\\.b\\*\\n\\t\\\\', 'regex')).toBe('a.b*\n\t\\');
  });

  it('tırnak seçeneğinde tırnaksız metin de çözülür', () => {
    expect(unescapeString('a\\"b', 'json', { quote: true })).toBe('a"b');
  });
});
