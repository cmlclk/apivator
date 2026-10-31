import { describe, expect, it } from 'vitest';
import { toXlsx } from '@apivator/core';
import { readXlsx, ToolError } from '@apivator/core/tools';
import {
  csvToJson,
  csvToTables,
  jsonToQuery,
  jsonToToml,
  parseDelimited,
  queryToJson,
  sheetToCsv,
  tomlToJson,
  jsonToCsv,
  jsonToXlsx,
  jsonToXml,
  jsonToYaml,
  parseJsonInput,
  sheetToJson,
  unflattenRecord,
  xmlToJson,
  yamlToJson,
} from './convert';

const parse = (text: string) => JSON.parse(text) as unknown;

describe('parseJsonInput', () => {
  it('geçersiz JSON satır/sütunlu ToolError', () => {
    expect(parseJsonInput('{"a":1}')).toEqual({ a: 1 });
    expect(() => parseJsonInput('{\n  "a": }')).toThrow(ToolError);
    expect(() => parseJsonInput('{\n  "a": }')).toThrow(/2\. satır, 8\. sütun/);
  });
});

describe('YAML', () => {
  it('JSON ↔ YAML gidiş-dönüş', () => {
    const json = '{"ad":"Çağrı","etiketler":["a","b"],"adres":{"şehir":"İzmir"},"n":1.5,"x":null}';
    const yaml = jsonToYaml(json);
    expect(yaml).toContain('ad: Çağrı');
    expect(yaml).toContain('- a');
    expect(parse(yamlToJson(yaml))).toEqual(parse(json));
  });

  it('boş YAML null; bozuk YAML satırlı ToolError', () => {
    expect(yamlToJson('')).toBe('null');
    expect(() => yamlToJson('a: [1, 2\nb: 3')).toThrow(ToolError);
    expect(() => yamlToJson('a: [1, 2\nb: 3')).toThrow(/YAML/);
  });
});

describe('XML', () => {
  it('tek anahtarlı nesne kök öğe olur; dizi tekrarlanan öğe; öznitelik ve metin', () => {
    const xml = jsonToXml(
      JSON.stringify({
        sipariş: { '@id': '7', müşteri: 'A & B', satır: [{ ürün: 'Kalem' }, { ürün: 'Defter' }] },
      }),
    );
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<sipariş id="7">');
    expect(xml).toContain('<müşteri>A &amp; B</müşteri>');
    expect(xml.match(/<satır>/g)).toHaveLength(2);
  });

  it('çok anahtarlı nesne ve kök dizi sarılır; geçersiz ad düzeltilir', () => {
    expect(jsonToXml('{"a":1,"b":2}')).toContain('<root>');
    expect(jsonToXml('[1,2]')).toMatch(/<root>\s*<item>1<\/item>\s*<item>2<\/item>\s*<\/root>/);
    expect(jsonToXml('{"x":{"1a":1,"b c":2}}')).toContain('<_1a>1</_1a>');
  });

  it('XML → JSON tip çevirisiyle ve çevirmeden', () => {
    const xml = '<kişi id="5"><ad>Şule</ad><yaş>30</yaş><aktif>true</aktif></kişi>';
    const coerced = parse(xmlToJson(xml)) as { kişi: Record<string, unknown> };
    expect(coerced.kişi.ad).toBe('Şule');
    expect(coerced.kişi.yaş).toBe(30);
    expect(coerced.kişi.aktif).toBe(true);
    const raw = parse(xmlToJson(xml, false)) as { kişi: Record<string, unknown> };
    expect(raw.kişi.yaş).toBe('30');
  });

  it('JSON → XML → JSON gidiş-dönüş', () => {
    const value = {
      katalog: {
        kitap: [
          { ad: 'A', fiyat: 10 },
          { ad: 'B', fiyat: 20 },
        ],
      },
    };
    expect(parse(xmlToJson(jsonToXml(JSON.stringify(value))))).toEqual(value);
  });

  it('bozuk XML ToolError', () => {
    expect(() => xmlToJson('<a><b></a>')).toThrow(ToolError);
  });
});

describe('CSV', () => {
  const json = JSON.stringify([
    { id: 1, ad: 'Ali', adres: { şehir: 'İzmir' }, tutar: 1.5 },
    { id: 2, ad: 'Ayşe; Fatma', adres: { şehir: 'Muğla' }, tutar: 2 },
  ]);

  it('JSON → CSV düzleştirir, ayırıcı ve ondalık seçilir', () => {
    const csv = jsonToCsv(json, { delimiter: ';', decimal: ',' });
    const lines = csv.trim().split(/\r?\n/);
    expect(lines[0]).toBe('id;ad;adres.şehir;tutar');
    expect(lines[1]).toBe('1;Ali;İzmir;1,5');
    expect(lines[2]).toContain('"Ayşe; Fatma"');
    expect(csv.charCodeAt(0)).not.toBe(0xfeff);
  });

  it('CSV → JSON tip çevirisi, ; ayırıcıda virgüllü ondalık ve unflatten', () => {
    const csv = 'id;ad;adres.şehir;tutar;aktif\n1;Ali;İzmir;1,5;true\n2;Ayşe;;2;false\n';
    expect(parse(csvToJson(csv, { coerce: true, unflatten: true }))).toEqual([
      { id: 1, ad: 'Ali', adres: { şehir: 'İzmir' }, tutar: 1.5, aktif: true },
      { id: 2, ad: 'Ayşe', adres: { şehir: null }, tutar: 2, aktif: false },
    ]);
    expect(parse(csvToJson(csv))).toEqual([
      { id: '1', ad: 'Ali', 'adres.şehir': 'İzmir', tutar: '1,5', aktif: 'true' },
      { id: '2', ad: 'Ayşe', 'adres.şehir': '', tutar: '2', aktif: 'false' },
    ]);
  });

  it('JSON → CSV → JSON gidiş-dönüş', () => {
    const back = parse(csvToJson(jsonToCsv(json, { delimiter: ',' }), { coerce: true, unflatten: true }));
    expect(back).toEqual(parse(json));
  });
});

describe('Excel', () => {
  it('JSON → xlsx → sayfa → JSON gidiş-dönüş', async () => {
    const value = [
      { id: 1, ad: 'Çağrı', aktif: true },
      { id: 2, ad: 'Işık', aktif: false },
    ];
    const [sheet] = await readXlsx(await jsonToXlsx(JSON.stringify(value)));
    expect(parse(sheetToJson(sheet!, { header: true }))).toEqual(value);
    expect(parse(sheetToJson(sheet!))).toEqual([
      ['id', 'ad', 'aktif'],
      [1, 'Çağrı', true],
      [2, 'Işık', false],
    ]);
  });

  it('boş satırlar atlanır; boş ve tekrarlanan başlıklar benzersizleşir', () => {
    const sheet = {
      name: 'S',
      rows: [
        ['ad', null, 'ad'],
        [null, null, null],
        ['a', 1, 'b', 'fazla'],
      ],
    };
    expect(parse(sheetToJson(sheet, { header: true }))).toEqual([
      { ad: 'a', Sütun2: 1, ad_2: 'b', Sütun4: 'fazla' },
    ]);
  });
});

describe('unflattenRecord', () => {
  it('noktalı anahtarları iç içe yapar, çakışmada anahtarı olduğu gibi bırakır', () => {
    expect(unflattenRecord({ 'a.b': 1, 'a.c': 2, d: 3 })).toEqual({ a: { b: 1, c: 2 }, d: 3 });
    expect(unflattenRecord({ a: 1, 'a.b': 2 })).toEqual({ a: 1, 'a.b': 2 });
  });
});

describe('CSV ↔ Excel', () => {
  it('ayırıcıyla ayrıştırır: tırnak, kaçış, alan içinde satır sonu, sekme', () => {
    expect(parseDelimited('﻿a;b\r\n"x;1";"say ""merhaba""\nalt"\n', ';')).toEqual([
      ['a', 'b'],
      ['x;1', 'say "merhaba"\nalt'],
    ]);
    expect(parseDelimited('a\tb\n1\t2', '\t')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(() => parseDelimited('a\n"b', ';')).toThrow(/kapanmamış tırnak/);
  });

  it('CSV → Excel tabloları: virgüllü ondalık, mantıksal, ISO tarih tipi; tekrarlanan başlık', async () => {
    const [table] = csvToTables('ad;tutar;aktif;tarih;ad\nAli;1,5;true;2026-01-02;x\nAyşe;1.000;false;;y\n', {
      delimiter: ';',
      decimal: ',',
      coerce: true,
    });
    expect(table!.columns.map((c) => [c.key, c.type])).toEqual([
      ['ad', 'text'],
      ['tutar', 'text'],
      ['aktif', 'boolean'],
      ['tarih', 'date'],
      ['ad_2', 'text'],
    ]);
    expect(table!.rows[0]).toEqual(['Ali', 1.5, true, '2026-01-02', 'x']);
    // Virgüllü ondalıkta "1.000" binlik olabilir; metin kalır.
    expect(table!.rows[1]![1]).toBe('1.000');
    const [sheet] = await readXlsx(await toXlsx([table!]));
    expect(sheet!.rows[1]!.slice(0, 3)).toEqual(['Ali', 1.5, true]);
  });

  it('CSV → Excel: noktalı ondalık, çevirmeden ve yalnızca başlık', () => {
    const [table] = csvToTables('n,m\n1.5,2\n', { delimiter: ',', decimal: '.', coerce: true });
    expect(table!.rows).toEqual([[1.5, 2]]);
    expect(csvToTables('n,m\n1.5,2\n', { delimiter: ',' })[0]!.rows).toEqual([['1.5', '2']]);
    expect(csvToTables('a;b\n', {})[0]!.columns.map((c) => c.key)).toEqual(['a', 'b']);
    expect(() => csvToTables('\n\n', {})).toThrow(ToolError);
  });

  it('Excel sayfası → CSV: satırlar olduğu gibi, Türkçe ondalık, formül kaçışı', () => {
    const sheet = {
      name: 'S',
      rows: [
        ['ad', 'tutar'],
        [null, null],
        ['Ali; Veli', 1.5],
        ['=1+1', 2, 'fazla'],
      ],
    };
    expect(sheetToCsv(sheet, { delimiter: ';', decimal: ',' }).split('\r\n')).toEqual([
      'ad;tutar;',
      '"Ali; Veli";1,5;',
      "'=1+1;2;fazla",
      '',
    ]);
    expect(sheetToCsv(sheet, { delimiter: ',', decimal: '.' })).toContain('Ali; Veli,1.5,');
    expect(sheetToCsv({ name: 'Boş', rows: [] })).toBe('');
  });
});

describe('Query string', () => {
  it('JSON ↔ query gidiş-dönüş; URL girdisi; coerce', () => {
    const json = '{"q":"çay şeker","f":{"t":["a","b"]},"n":2}';
    const query = jsonToQuery(json, { plusSpaces: true });
    expect(query).toBe('q=%C3%A7ay+%C5%9Feker&f[t][]=a&f[t][]=b&n=2');
    expect(parse(queryToJson(query))).toEqual({ q: 'çay şeker', f: { t: ['a', 'b'] }, n: '2' });
    expect(parse(queryToJson(`https://ornek.com/?${query}`, true))).toEqual(parse(json));
    expect(() => jsonToQuery('[1]')).toThrow(ToolError);
  });
});

describe('TOML', () => {
  it('JSON ↔ TOML gidiş-dönüş', () => {
    const value = { ad: 'Çağrı', sürüm: 1.5, port: 8080, açık: true, sunucu: { etiketler: ['a', 'b'] } };
    const toml = jsonToToml(JSON.stringify(value));
    expect(toml).toContain('ad = "Çağrı"');
    expect(toml).toContain('[sunucu]');
    expect(parse(tomlToJson(toml))).toEqual(value);
  });

  it('TOML tarihleri ISO metni', () => {
    expect(parse(tomlToJson('d = 1979-05-27\nt = 1979-05-27T07:32:00Z'))).toEqual({
      d: '1979-05-27',
      t: '1979-05-27T07:32:00.000Z',
    });
  });

  it('null ve kök dizi açık hata; bozuk TOML satır/sütunlu', () => {
    expect(() => jsonToToml('[1,2]')).toThrow(/kökü bir tablo/);
    expect(() => jsonToToml('{"a":{"b":null}}')).toThrow(/"a\.b"/);
    expect(() => jsonToToml('{"a":[1,null]}')).toThrow(/"a\[1\]"/);
    expect(() => tomlToJson('a = 1\nb = [1,\nc = "x')).toThrow(ToolError);
    expect(() => tomlToJson('a = 1\nb = [1,\nc = "x')).toThrow(/TOML: 3\. satır, 1\. sütun/);
    expect(() => tomlToJson('a = 1\na = 2')).toThrow(ToolError);
  });
});
