import { describe, expect, it } from 'vitest';
import { detectStringFormat, inferJsonSchema } from './jsonSchemaInfer';

describe('inferJsonSchema', () => {
  it('basit nesne: tipler, zorunlu alanlar, 2020-12 başlığı', () => {
    expect(inferJsonSchema({ id: 1, ad: 'Ayşe', puan: 4.5, aktif: true, not: null })).toEqual({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        id: { type: 'integer' },
        ad: { type: 'string' },
        puan: { type: 'number' },
        aktif: { type: 'boolean' },
        not: { type: 'null' },
      },
      required: ['id', 'ad', 'puan', 'aktif', 'not'],
    });
  });

  it('draft-07 ve başlık', () => {
    const schema = inferJsonSchema('x', { draft: '07', title: '  Kullanıcı ' });
    expect(schema).toEqual({
      $schema: 'http://json-schema.org/draft-07/schema#',
      title: 'Kullanıcı',
      type: 'string',
    });
  });

  it('dizi elemanlarını birleştirir: özellik birleşimi, ortak zorunlular, null ve karışık tipler', () => {
    const schema = inferJsonSchema([
      { id: 1, ad: 'Ayşe', yas: 30, etiket: 'a' },
      { id: 2, ad: null, yas: 31.5, etiket: 5, sehir: 'İzmir' },
    ]);
    expect(schema).toEqual({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          ad: { type: ['string', 'null'] },
          yas: { type: 'number' },
          etiket: { type: ['string', 'integer'] },
          sehir: { type: 'string' },
        },
        required: ['id', 'ad', 'yas', 'etiket'],
      },
    });
  });

  it('kök diziyi örnek listesi sayabilir', () => {
    const schema = inferJsonSchema([{ a: 1 }, { a: 2, b: true }], { rootArrayAsSamples: true });
    expect(schema).toMatchObject({ type: 'object', required: ['a'] });
    expect(schema).not.toHaveProperty('items');
  });

  it('iç içe nesne ve diziler; boş dizi `items: {}`', () => {
    const schema = inferJsonSchema({
      adres: { il: 'Ankara' },
      etiketler: ['a', 'b'],
      bos: [],
      matris: [[1], [2, 3]],
    });
    expect(schema.properties).toEqual({
      adres: { type: 'object', properties: { il: { type: 'string' } }, required: ['il'] },
      etiketler: { type: 'array', items: { type: 'string' } },
      bos: { type: 'array', items: {} },
      matris: { type: 'array', items: { type: 'array', items: { type: 'integer' } } },
    });
  });

  it('nesne dizisinde alt nesneler de birleşir', () => {
    const schema = inferJsonSchema({ liste: [{ x: { a: 1 } }, { x: { b: 2 } }, { x: null }] });
    expect(schema.properties).toEqual({
      liste: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            x: { type: ['object', 'null'], properties: { a: { type: 'integer' }, b: { type: 'integer' } } },
          },
          required: ['x'],
        },
      },
    });
  });

  it('biçimleri tanır; karışık biçimde format yazılmaz; kapatılabilir', () => {
    const schema = inferJsonSchema({
      zaman: '2024-05-01T10:20:30Z',
      gun: '2024-05-01',
      eposta: 'ayse@ornek.com',
      site: 'https://ornek.com/a?b=1',
      kimlik: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
      ip: '10.0.0.1',
      duz: 'merhaba',
    });
    expect(schema.properties).toEqual({
      zaman: { type: 'string', format: 'date-time' },
      gun: { type: 'string', format: 'date' },
      eposta: { type: 'string', format: 'email' },
      site: { type: 'string', format: 'uri' },
      kimlik: { type: 'string', format: 'uuid' },
      ip: { type: 'string', format: 'ipv4' },
      duz: { type: 'string' },
    });
    expect(inferJsonSchema(['2024-05-01', '2024-05-01T10:20:30Z']).items).toEqual({ type: 'string' });
    expect(inferJsonSchema('2024-05-01', { detectFormats: false })).not.toHaveProperty('format');
  });

  it('örnekler (en fazla 3, tekrarsız) ve additionalProperties: false', () => {
    const schema = inferJsonSchema([{ a: 1 }, { a: 2 }, { a: 2 }, { a: 3 }, { a: 4 }], {
      examples: true,
      noAdditionalProperties: true,
      rootArrayAsSamples: true,
    });
    expect(schema).toEqual({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: { a: { type: 'integer', examples: [1, 2, 3] } },
      required: ['a'],
      additionalProperties: false,
    });
  });

  it('çıktı sırası belirlenimci', () => {
    const value = { b: [1, 'x', null, true, { z: 1 }], a: 1 };
    expect(JSON.stringify(inferJsonSchema(value))).toBe(JSON.stringify(inferJsonSchema(value)));
    expect(Object.keys(inferJsonSchema(value).properties as object)).toEqual(['b', 'a']);
    expect((inferJsonSchema(value).properties as Record<string, { items: unknown }>).b?.items).toMatchObject({
      type: ['object', 'string', 'integer', 'boolean', 'null'],
    });
  });
});

describe('detectStringFormat', () => {
  it('geçersiz tarih ve benzerlerini biçim saymaz', () => {
    expect(detectStringFormat('2024-13-01')).toBeNull();
    expect(detectStringFormat('2024-01-01 10:00')).toBeNull();
    expect(detectStringFormat('2024-01-01T10:00:00+03:00')).toBe('date-time');
    expect(detectStringFormat('256.1.1.1')).toBeNull();
    expect(detectStringFormat('a@b')).toBeNull();
    expect(detectStringFormat('ftp://ornek.com')).toBe('uri');
    expect(detectStringFormat('ornek.com')).toBeNull();
  });

  it('__proto__ adlı alan şemada kaybolmaz', () => {
    const schema = inferJsonSchema(JSON.parse('{"__proto__":{"a":1}}'));
    expect(Object.keys(schema.properties as object)).toEqual(['__proto__']);
    expect(({} as Record<string, unknown>).a).toBeUndefined();
  });
});
