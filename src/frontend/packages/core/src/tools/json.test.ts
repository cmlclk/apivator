import { afterEach, describe, expect, it } from 'vitest';
import en from '../locales/en/toolsData.json';
import { registerCoreMessages, setCoreLanguage } from '../i18n';
import { ToolError } from './errors';
import { formatJson, parseJsonDetailed, sortKeysDeep } from './json';

describe('parseJsonDetailed', () => {
  it('geçerli JSON değerini döner', () => {
    expect(parseJsonDetailed('{"a":[1,true,null,"ş"]}')).toEqual({
      ok: true,
      value: { a: [1, true, null, 'ş'] },
    });
    expect(parseJsonDetailed(' 42 ')).toEqual({ ok: true, value: 42 });
  });

  it('beklenmeyen karakterin satır/sütun/ofsetini bulur', () => {
    const text = '{\n  "a": 1,\n  "b": }';
    const result = parseJsonDetailed(text);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result).toMatchObject({ line: 3, column: 8, offset: 19 });
    expect(text[result.offset]).toBe('}');
    expect(result.message).toBeTruthy();
  });

  it('sondaki virgül', () => {
    const result = parseJsonDetailed('[1,2,]');
    expect(result).toMatchObject({ ok: false, line: 1, column: 6, offset: 5 });
  });

  it('CRLF satır sonlarında da satırı doğru sayar', () => {
    const result = parseJsonDetailed('{\r\n"a": 1\r\n"b": 2}');
    expect(result).toMatchObject({ ok: false, line: 3, column: 1 });
  });

  it('kapanmamış metin ve boş girdi', () => {
    const open = parseJsonDetailed('{"a": "x');
    expect(open.ok).toBe(false);
    if (!open.ok) expect(open.line).toBe(1);
    expect(parseJsonDetailed('')).toMatchObject({ ok: false, line: 1, column: 1, offset: 0 });
  });

  it('fazladan içerik hata', () => {
    expect(parseJsonDetailed('{} x')).toMatchObject({ ok: false, line: 1, column: 4, offset: 3 });
  });
});

describe('sortKeysDeep', () => {
  it('iç içe nesnelerde anahtarları sıralar, dizilerin sırası korunur', () => {
    const sorted = sortKeysDeep({ b: 1, a: { d: [3, { z: 1, y: 2 }, 1], c: null } });
    expect(JSON.stringify(sorted)).toBe('{"a":{"c":null,"d":[3,{"y":2,"z":1},1]},"b":1}');
  });

  it('girdiyi değiştirmez, ilkel değerleri olduğu gibi döner', () => {
    const input = { b: 1, a: 2 };
    sortKeysDeep(input);
    expect(Object.keys(input)).toEqual(['b', 'a']);
    expect(sortKeysDeep('x')).toBe('x');
    expect(sortKeysDeep(null)).toBeNull();
  });
});

describe('formatJson', () => {
  const text = '{"b":1,"a":[1,{"d":2,"c":3}]}';

  it('varsayılan 2 boşluk', () => {
    expect(formatJson(text)).toBe(JSON.stringify(JSON.parse(text), null, 2));
  });

  it('4 boşluk, sekme ve küçültme', () => {
    expect(formatJson(text, { indent: 4 })).toBe(JSON.stringify(JSON.parse(text), null, 4));
    expect(formatJson(text, { indent: '\t' })).toBe(JSON.stringify(JSON.parse(text), null, '\t'));
    expect(formatJson('{ "a" : [ 1 , 2 ] }', { indent: 0 })).toBe('{"a":[1,2]}');
  });

  it('sortKeys', () => {
    expect(formatJson(text, { indent: 0, sortKeys: true })).toBe('{"a":[1,{"c":3,"d":2}],"b":1}');
  });

  it('Unicode ve büyük sayılar korunur', () => {
    expect(formatJson('{"ad":"Çağrı","n":1.5e3}', { indent: 0 })).toBe('{"ad":"Çağrı","n":1500}');
  });

  it('geçersizse satır/sütunlu ToolError', () => {
    expect(() => formatJson('{\n  "a": 1,\n  "b": }')).toThrow(ToolError);
    expect(() => formatJson('{\n  "a": 1,\n  "b": }')).toThrow(/3\. satır, 8\. sütun/);
  });
});

describe('English messages', () => {
  afterEach(() => setCoreLanguage('tr'));

  it('reports JSON parse errors with line and column in English', () => {
    registerCoreMessages('en', { toolsData: en });
    setCoreLanguage('en');
    expect(() => formatJson('{\n  "a": 1,\n  "b": }')).toThrow(
      'Line 3, column 8: Unexpected character: "}".',
    );
    expect(() => formatJson('{"a": 1,}')).toThrow('A trailing comma is not allowed after the last element.');
    expect(() => formatJson('{"a" 1}')).toThrow('Expected ":".');
    expect(() => formatJson('{"a": 1 2}')).toThrow('Expected "," or "}".');
  });
});
