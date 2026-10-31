import { afterEach, describe, expect, it } from 'vitest';
import en from './locales/en/core.json';
import { registerCoreMessages, setCoreLanguage } from './i18n';
import { DataFileError, parseCsv, parseDataFile, parseJsonData } from './dataFile';

describe('parseCsv', () => {
  it('handles quotes, escaped quotes, newlines and BOM', () => {
    const csv = '\uFEFFad,not\r\nAyşe,"merhaba, dünya"\n"Mehmet","satır\nsonu ""tırnak"""\n';
    expect(parseCsv(csv)).toEqual({
      columns: ['ad', 'not'],
      rows: [
        { ad: 'Ayşe', not: 'merhaba, dünya' },
        { ad: 'Mehmet', not: 'satır\nsonu "tırnak"' },
      ],
    });
  });

  it('detects semicolon delimiter and fills missing cells', () => {
    expect(parseCsv('a;b;c\n1;2\n\n').rows).toEqual([{ a: '1', b: '2', c: '' }]);
  });

  it('rejects broken input', () => {
    expect(() => parseCsv('')).toThrow(DataFileError);
    expect(() => parseCsv('a,b\n"1,2')).toThrow(DataFileError);
  });
});

describe('parseJsonData', () => {
  it('stringifies non-string values', () => {
    expect(parseJsonData('[{"ad":"Ayşe","yas":30,"etiket":["a"]},{"ad":"Can","aktif":true}]')).toEqual({
      columns: ['ad', 'yas', 'etiket', 'aktif'],
      rows: [
        { ad: 'Ayşe', yas: '30', etiket: '["a"]' },
        { ad: 'Can', aktif: 'true' },
      ],
    });
    expect(() => parseJsonData('{"a":1}')).toThrow(DataFileError);
  });

  it('picks the parser by name or content', () => {
    expect(parseDataFile('veri.csv', 'a\n1').rows).toEqual([{ a: '1' }]);
    expect(parseDataFile('veri.txt', ' [{"a":1}]').rows).toEqual([{ a: '1' }]);
  });
});

describe('data file messages (en)', () => {
  afterEach(() => setCoreLanguage('tr'));

  it('reports errors in English', () => {
    registerCoreMessages('en', { core: en });
    setCoreLanguage('en');
    expect(() => parseCsv('')).toThrow('The CSV file is empty.');
    expect(() => parseJsonData('{}')).toThrow('A JSON data file must be an array of objects');
  });
});
