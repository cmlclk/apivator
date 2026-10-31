import { describe, expect, it } from 'vitest';
import { ToolError } from './errors';
import { parseQuery, queryPart, stringifyQuery } from './querystring';

describe('stringifyQuery', () => {
  const value = { q: 'çay & şeker', sayfa: 2, aktif: true, filtre: { durum: 'açık', tür: ['a', 'b'] } };

  it('iç içe nesneler köşeli parantezle, değerler kodlanır', () => {
    expect(stringifyQuery(value)).toBe(
      'q=%C3%A7ay%20%26%20%C5%9Feker&sayfa=2&aktif=true&filtre[durum]=a%C3%A7%C4%B1k&filtre[t%C3%BCr][]=a&filtre[t%C3%BCr][]=b',
    );
  });

  it('dizi biçimleri ve + ile boşluk', () => {
    const tags = { t: ['x y', 'z'] };
    expect(stringifyQuery(tags, { arrays: 'brackets' })).toBe('t[]=x%20y&t[]=z');
    expect(stringifyQuery(tags, { arrays: 'repeat', plusSpaces: true })).toBe('t=x+y&t=z');
    expect(stringifyQuery(tags, { arrays: 'indices' })).toBe('t[0]=x%20y&t[1]=z');
  });

  it('nesne dizileri her zaman sıra numaralı; null boş, boş dizi yazılmaz', () => {
    expect(stringifyQuery({ s: [{ a: 1 }, { a: 2 }], n: null, e: [] }, { arrays: 'repeat' })).toBe(
      's[0][a]=1&s[1][a]=2&n=',
    );
  });

  it('nesne olmayan kök ToolError', () => {
    expect(() => stringifyQuery([1, 2])).toThrow(ToolError);
    expect(() => stringifyQuery('a')).toThrow(/nesne olmalı/);
  });
});

describe('queryPart', () => {
  it('tam URL, baştaki ? ve # atılır', () => {
    expect(queryPart('https://ornek.com/ara?q=1&x=2#bolum')).toBe('q=1&x=2');
    expect(queryPart('?a=1')).toBe('a=1');
    expect(queryPart('a=1')).toBe('a=1');
    expect(queryPart('https://ornek.com/yol')).toBe('');
  });
});

describe('parseQuery', () => {
  it('iç içe nesne, dizi biçimleri ve tekrarlanan anahtar', () => {
    expect(parseQuery('a[b][c]=1&d[]=x&d[]=y&e=1&e=2&f[1]=q&f[0]=p')).toEqual({
      a: { b: { c: '1' } },
      d: ['x', 'y'],
      e: ['1', '2'],
      f: ['p', 'q'],
    });
  });

  it('+ boşluk, yüzde kodlaması çözülür; değersiz anahtar boş metin', () => {
    expect(parseQuery('?ad=Ay%C5%9Fe+Y%C4%B1lmaz&bayrak&k%5Bx%5D=1')).toEqual({
      ad: 'Ayşe Yılmaz',
      bayrak: '',
      k: { x: '1' },
    });
  });

  it('değerler metin kalır; coerce ile sayı ve mantıksal', () => {
    expect(parseQuery('n=5&b=true&z=007')).toEqual({ n: '5', b: 'true', z: '007' });
    expect(parseQuery('n=5&b=true&z=007&f=1.5', { coerce: true })).toEqual({
      n: 5,
      b: true,
      z: '007',
      f: 1.5,
    });
  });

  it('nesne dizisi, seyrek dizi ve dizi/nesne karışımı', () => {
    expect(parseQuery('s[0][a]=1&s[0][b]=2&s[1][a]=3')).toEqual({ s: [{ a: '1', b: '2' }, { a: '3' }] });
    expect(parseQuery('a[0]=x&a[5]=y')).toEqual({ a: ['x', 'y'] });
    expect(parseQuery('a[0]=x&a[k]=y')).toEqual({ a: { 0: 'x', k: 'y' } });
    expect(parseQuery('a[99999]=x')).toEqual({ a: { 99999: 'x' } });
  });

  it('bozuk parantezli anahtar olduğu gibi; __proto__ prototipe yazılmaz', () => {
    expect(parseQuery('a[b=1&c]d=2')).toEqual({ 'a[b': '1', 'c]d': '2' });
    const result = parseQuery('__proto__[x]=1');
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).x).toBeUndefined();
    expect(Object.keys(result)).toEqual(['__proto__']);
  });

  it('constructor/prototype ve iç içe __proto__ hiçbir prototipe dokunmaz; gidiş-dönüş korunur', () => {
    const text = 'constructor[prototype][y]=2&a[__proto__][z]=3&__proto__[]=q&prototype=1';
    const result = parseQuery(text);
    const empty = {} as Record<string, unknown>;
    expect([empty.y, empty.z, empty[0]]).toEqual([undefined, undefined, undefined]);
    expect(Object.getPrototypeOf(result.a)).toBe(Object.prototype);
    expect(JSON.parse(JSON.stringify(result))).toEqual(
      JSON.parse(
        '{"constructor":{"prototype":{"y":"2"}},"a":{"__proto__":{"z":"3"}},"__proto__":["q"],"prototype":"1"}',
      ),
    );
    expect(stringifyQuery(result)).toBe(text);
  });

  it('geçersiz kodlama ve değer/nesne çakışması ToolError', () => {
    expect(() => parseQuery('a=%E0%A4%A')).toThrow(/yüzde kodlaması/);
    expect(() => parseQuery('a=1&a[b]=2')).toThrow(ToolError);
    expect(() => parseQuery('a[b]=2&a=1')).toThrow(ToolError);
  });

  it('gidiş-dönüş', () => {
    const value = { q: 'a b+c', l: ['1', '2'], o: { x: 'ç', y: [{ z: 'w' }] } };
    for (const arrays of ['brackets', 'repeat', 'indices'] as const)
      expect(parseQuery(stringifyQuery(value, { arrays, plusSpaces: true }))).toEqual(value);
  });
});
