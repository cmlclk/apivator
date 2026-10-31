import { describe, expect, it } from 'vitest';
import { ToolError } from './errors';
import { inferJsonSchema } from './jsonSchemaInfer';
import { sampleFromPattern } from './jsonSchemaPattern';
import { sampleFromSchema, seededRandom } from './jsonSchemaSample';

describe('sampleFromSchema', () => {
  it('tiplere ve özellik adlarına göre belirlenimci örnek', () => {
    const schema = {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        name: { type: 'string' },
        email: { type: 'string' },
        puan: { type: 'number' },
        aktif: { type: 'boolean' },
        bos: { type: 'null' },
        etiketler: { type: 'array', items: { type: 'string' } },
      },
    };
    expect(sampleFromSchema(schema)).toEqual({
      id: 1,
      name: 'Ayşe Yılmaz',
      email: 'ayse.yilmaz@ornek.com',
      puan: 1.5,
      aktif: true,
      bos: null,
      etiketler: ['örnek metin'],
    });
    expect(sampleFromSchema(schema)).toEqual(sampleFromSchema(schema));
  });

  it('yalnızca zorunlu alanlar seçeneği', () => {
    const schema = {
      type: 'object',
      required: ['a'],
      properties: { a: { type: 'integer' }, b: { type: 'string' } },
    };
    expect(sampleFromSchema(schema, { requiredOnly: true })).toEqual({ a: 1 });
    expect(sampleFromSchema(schema)).toEqual({ a: 1, b: 'örnek metin' });
  });

  it('const, examples, example, default ve enum önceliklidir', () => {
    expect(sampleFromSchema({ type: 'string', const: 'sabit', examples: ['x'] })).toBe('sabit');
    expect(sampleFromSchema({ type: 'string', examples: ['ilk', 'iki'], default: 'v' })).toBe('ilk');
    expect(sampleFromSchema({ type: 'integer', example: 7, default: 3 })).toBe(7);
    expect(sampleFromSchema({ type: 'integer', default: 3 })).toBe(3);
    expect(sampleFromSchema({ enum: ['kırmızı', 'mavi'] })).toBe('kırmızı');
    expect(sampleFromSchema({ type: 'array', minItems: 3, items: { enum: ['a', 'b'] } })).toEqual([
      'a',
      'b',
      'a',
    ]);
  });

  it('biçimler', () => {
    const formats = ['date-time', 'date', 'time', 'email', 'uri', 'uuid', 'ipv4', 'ipv6', 'hostname'];
    const out = sampleFromSchema({
      type: 'object',
      properties: Object.fromEntries(formats.map((f) => [f, { type: 'string', format: f }])),
    }) as Record<string, string>;
    expect(out).toEqual({
      'date-time': '2024-01-15T09:30:00Z',
      date: '2024-01-15',
      time: '09:30:00Z',
      email: 'ayse.yilmaz@ornek.com',
      uri: 'https://ornek.com/kaynak/1',
      uuid: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
      ipv4: '192.168.1.10',
      ipv6: '2001:db8::1',
      hostname: 'api.ornek.com',
    });
  });

  it('sayı sınırları, dışlayıcı sınırlar ve multipleOf', () => {
    expect(sampleFromSchema({ type: 'integer', minimum: 10, maximum: 20 })).toBe(10);
    expect(sampleFromSchema({ type: 'integer', maximum: -5 })).toBe(-5);
    expect(sampleFromSchema({ type: 'integer', exclusiveMinimum: 10 })).toBe(11);
    expect(sampleFromSchema({ type: 'integer', minimum: 10, exclusiveMinimum: true })).toBe(11);
    expect(sampleFromSchema({ type: 'number', exclusiveMinimum: 0, exclusiveMaximum: 1 })).toBe(0.5);
    expect(sampleFromSchema({ type: 'integer', minimum: 7, multipleOf: 5 })).toBe(10);
    expect(sampleFromSchema({ type: 'number', minimum: 0.25, multipleOf: 0.1 })).toBe(0.3);
    expect(sampleFromSchema({ type: 'object', properties: { age: { type: 'integer' } } })).toEqual({
      age: 30,
    });
  });

  it('metin uzunluğu ve pattern', () => {
    const long = sampleFromSchema({ type: 'string', minLength: 30 }) as string;
    expect([...long].length).toBe(30);
    expect(sampleFromSchema({ type: 'string', maxLength: 5 })).toBe('örnek');
    expect(sampleFromSchema({ type: 'string', pattern: '^[A-Z]{3}-\\d{2}$' })).toBe('AAA-00');
    // Desteklenmeyen desen: düz örneğe düşer.
    expect(sampleFromSchema({ type: 'string', pattern: '^(a)\\1$' })).toBe('örnek metin');
  });

  it('dizi: minItems/maxItems, prefixItems ve draft-07 tuple', () => {
    expect(sampleFromSchema({ type: 'array', items: { type: 'integer' }, minItems: 3 })).toEqual([1, 2, 3]);
    expect(sampleFromSchema({ type: 'array', items: { type: 'integer' }, maxItems: 0 })).toEqual([]);
    expect(
      sampleFromSchema({
        type: 'array',
        prefixItems: [{ type: 'string' }, { type: 'boolean' }],
        items: false,
      }),
    ).toEqual(['örnek metin', true]);
    expect(sampleFromSchema({ type: 'array', items: [{ type: 'integer' }, { const: 'x' }] })).toEqual([
      1,
      'x',
    ]);
    expect(sampleFromSchema({ type: 'array' })).toEqual([]);
  });

  it('oneOf/anyOf ilk (null olmayan) seçenek, allOf birleşir', () => {
    expect(sampleFromSchema({ oneOf: [{ type: 'null' }, { type: 'integer' }] })).toBe(1);
    expect(sampleFromSchema({ anyOf: [{ type: 'string', format: 'date' }, { type: 'integer' }] })).toBe(
      '2024-01-15',
    );
    expect(
      sampleFromSchema({
        allOf: [
          { type: 'object', properties: { a: { type: 'integer' } }, required: ['a'] },
          { properties: { b: { const: true } }, required: ['b'] },
        ],
      }),
    ).toEqual({ a: 1, b: true });
    expect(sampleFromSchema({ type: ['null', 'string'] })).toBe('örnek metin');
  });

  it('yerel $ref: $defs, definitions, kardeş anahtarlar ve özyineleme sınırı', () => {
    const schema = {
      $ref: '#/$defs/Dugum',
      $defs: {
        Dugum: {
          type: 'object',
          required: ['ad', 'cocuklar'],
          properties: {
            ad: { type: 'string' },
            cocuklar: { type: 'array', items: { $ref: '#/$defs/Dugum' } },
            ebeveyn: { $ref: '#/$defs/Dugum' },
          },
        },
      },
    };
    expect(sampleFromSchema(schema)).toEqual({ ad: 'Ayşe', cocuklar: [] });
    expect(
      sampleFromSchema({
        properties: { x: { $ref: '#/definitions/T', description: 'açıklama' } },
        definitions: { T: { type: 'integer', minimum: 5 } },
      }),
    ).toEqual({ x: 5 });
  });

  it('derinlik sınırı', () => {
    const deep = {
      type: 'object',
      properties: {
        a: { type: 'object', properties: { b: { type: 'object', properties: { c: { type: 'integer' } } } } },
      },
    };
    expect(sampleFromSchema(deep, { maxDepth: 1 })).toEqual({ a: {} });
  });

  it('OpenAPI belgesi: components.schemas, seçilen şema', () => {
    const doc = {
      openapi: '3.0.0',
      components: {
        schemas: {
          Pet: {
            type: 'object',
            required: ['id'],
            properties: {
              id: { type: 'integer', format: 'int64' },
              sahip: { $ref: '#/components/schemas/Kisi' },
            },
          },
          Kisi: { type: 'object', properties: { ad: { type: 'string', example: 'Ali' } } },
        },
      },
    };
    expect(sampleFromSchema(doc)).toEqual({ id: 1, sahip: { ad: 'Ali' } });
    expect(sampleFromSchema(doc, { schemaName: 'Kisi' })).toEqual({ ad: 'Ali' });
    expect(() => sampleFromSchema({ openapi: '3.1.0', paths: {} })).toThrow(ToolError);
  });

  it('harici ve çözülemeyen $ref açık hata verir (ağa gitmez)', () => {
    expect(() => sampleFromSchema({ $ref: 'https://ornek.com/schema.json' })).toThrow(/Harici \$ref/);
    expect(() => sampleFromSchema({ $ref: 'other.json#/a' })).toThrow(ToolError);
    expect(() => sampleFromSchema({ $ref: '#/$defs/Yok' })).toThrow(/Çözülemeyen başvuru/);
    expect(() =>
      sampleFromSchema({ $ref: '#/$defs/A', $defs: { A: { allOf: [{ $ref: '#/$defs/A' }] } } }),
    ).toThrow(ToolError);
    expect(() => sampleFromSchema('metin')).toThrow(ToolError);
    expect(() => sampleFromSchema(false)).toThrow(ToolError);
  });

  it('sözlük (additionalProperties) ve tipsiz anahtar sözcükler', () => {
    expect(sampleFromSchema({ type: 'object', additionalProperties: { type: 'integer' } })).toEqual({
      anahtar: 1,
    });
    expect(sampleFromSchema({ properties: { x: { minimum: 3 } } })).toEqual({ x: 3 });
    expect(sampleFromSchema({})).toBeNull();
    expect(sampleFromSchema(true)).toBeNull();
  });

  it('rastgele: aynı tohum aynı çıktı, farklı tohum farklı; sınırlara uyar', () => {
    const schema = {
      type: 'object',
      properties: {
        n: { type: 'integer', minimum: 0, maximum: 1000 },
        k: { type: 'string', format: 'uuid' },
        e: { enum: ['a', 'b', 'c', 'd', 'e', 'f'] },
        d: { type: 'string', pattern: '^[a-f]{4}\\d{2}$' },
        t: { type: 'string', format: 'date-time' },
      },
    };
    const a = sampleFromSchema(schema, { random: true, seed: 42 }) as Record<string, unknown>;
    expect(sampleFromSchema(schema, { random: true, seed: 42 })).toEqual(a);
    const outputs = new Set(
      [1, 2, 3, 4, 5].map((seed) => JSON.stringify(sampleFromSchema(schema, { random: true, seed }))),
    );
    expect(outputs.size).toBeGreaterThan(1);
    expect(a.n).toBeGreaterThanOrEqual(0);
    expect(a.n).toBeLessThanOrEqual(1000);
    expect(Number.isInteger(a.n)).toBe(true);
    expect(a.k).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a.d).toMatch(/^[a-f]{4}\d{2}$/);
    expect(a.t).toMatch(/^2024|^2025/);
  });

  it('büyük minItems/minLength ve derinlik artırmayan döngü arayüzü dondurmaz', () => {
    const array = (items: unknown) => ({ type: 'array', minItems: 100, items });
    const huge = sampleFromSchema(array(array(array(array({ type: 'string', minLength: 1e9 })))));
    expect(JSON.stringify(huge).length).toBeLessThan(2_000_000);
    // oneOf içinden kendine dönen $ref: allOf birleştirmesi refStack'i atlıyordu (yığın taşması).
    const loop = {
      $defs: { Y: { type: 'object', oneOf: [{ $ref: '#/$defs/Y' }] } },
      $ref: '#/$defs/Y',
      title: 'x',
    };
    expect(sampleFromSchema(loop)).toEqual({});
  });

  it('__proto__ ve constructor adlı özellikler kendi alanı olarak üretilir', () => {
    const schema = JSON.parse(
      '{"type":"object","required":["constructor"],"properties":{"__proto__":{"type":"string"}}}',
    ) as unknown;
    const sample = sampleFromSchema(schema) as Record<string, unknown>;
    expect(Object.getPrototypeOf(sample)).toBe(Object.prototype);
    expect(JSON.stringify(sample)).toBe('{"__proto__":"örnek metin","constructor":null}');
  });

  it('çıkarılan şemadan üretilen örnek yine aynı şemayı verir', () => {
    const value = { id: 3, ad: 'Ayşe', etiketler: ['x'], adres: { il: 'Ankara', posta: '2024-01-01' } };
    const schema = inferJsonSchema(value);
    expect(inferJsonSchema(sampleFromSchema(schema))).toEqual(schema);
  });
});

describe('sampleFromPattern', () => {
  it('sınıflar, gruplar, alternatifler ve niceleyiciler', () => {
    expect(sampleFromPattern('^\\d{3}$')).toBe('000');
    expect(sampleFromPattern('^(foo|bar)+-[x-z]?$')).toBe('foo-x');
    expect(sampleFromPattern('^[^a-z]{2}$')).toBe('AA');
    expect(sampleFromPattern('ab.c')).toBe('abac');
    expect(sampleFromPattern('^\\w+@ornek\\.com$')).toBe('a@ornek.com');
    expect(sampleFromPattern('(?=a)a')).toBeNull();
    expect(sampleFromPattern('[')).toBeNull();
  });

  it('boş eşleşen iç içe tekrarlar ve çok derin gruplar takılmaz', () => {
    expect(sampleFromPattern('(((|a){1000}){1000}){1000}x')).toBeNull();
    expect(sampleFromPattern('('.repeat(20000) + 'a' + ')'.repeat(20000))).toBeNull();
  });

  it('rastgele üretim desene uyar', () => {
    const random = seededRandom(7);
    for (let i = 0; i < 20; i++)
      expect(sampleFromPattern('^[A-Z]{2}\\d{2,4}(-[a-z]+)?$', random)).toMatch(
        /^[A-Z]{2}\d{2,4}(-[a-z]+)?$/,
      );
  });
});
