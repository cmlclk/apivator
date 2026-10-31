import { afterEach, describe, expect, it } from 'vitest';
import en from '../locales/en/toolsData.json';
import { registerCoreMessages, setCoreLanguage } from '../i18n';
import { ToolError } from './errors';
import { checkFormat } from './jsonSchemaFormats';
import { canonicalJson, codePointLength, isMultipleOf } from './jsonSchemaValidateHelpers';
import { validateJsonSchema, type ValidateOptions } from './jsonSchemaValidate';

const check = (schema: unknown, data: unknown, options?: ValidateOptions) =>
  validateJsonSchema(schema, data, options);
const valid = (schema: unknown, data: unknown, options?: ValidateOptions) =>
  check(schema, data, options).valid;
const keywords = (schema: unknown, data: unknown, options?: ValidateOptions) =>
  check(schema, data, options).errors.map((e) => e.keyword);

describe('validateJsonSchema: temel kurallar', () => {
  it('type, integer ve tür listesi', () => {
    expect(valid({ type: 'integer' }, 1)).toBe(true);
    expect(valid({ type: 'integer' }, 1.0)).toBe(true);
    expect(valid({ type: 'integer' }, 1.5)).toBe(false);
    expect(valid({ type: 'number' }, 1.5)).toBe(true);
    expect(valid({ type: ['string', 'null'] }, null)).toBe(true);
    expect(valid({ type: 'object' }, [])).toBe(false);
    expect(valid({ type: 'array' }, {})).toBe(false);
    const result = check({ type: 'string' }, 5);
    expect(result.errors).toEqual([
      {
        instancePath: '',
        schemaPath: '#/type',
        keyword: 'type',
        message: 'Tür uyuşmuyor: string bekleniyordu, number geldi.',
      },
    ]);
  });

  it('boolean şemalar', () => {
    expect(valid(true, 'x')).toBe(true);
    expect(valid(false, 'x')).toBe(false);
    expect(valid({ properties: { a: false } }, { a: 1 })).toBe(false);
  });

  it('enum ve const derin eşitlikle (anahtar sırası önemsiz)', () => {
    expect(valid({ enum: [{ a: 1, b: [1, 2] }] }, { b: [1, 2], a: 1 })).toBe(true);
    expect(valid({ enum: ['a', 'b'] }, 'c')).toBe(false);
    expect(valid({ const: 1 }, 1.0)).toBe(true);
    expect(valid({ const: [1] }, [2])).toBe(false);
    expect(keywords({ const: null }, 0)).toEqual(['const']);
  });

  it('sayı sınırları ve float güvenli multipleOf', () => {
    expect(valid({ minimum: 1, maximum: 3 }, 3)).toBe(true);
    expect(valid({ exclusiveMaximum: 3 }, 3)).toBe(false);
    expect(valid({ exclusiveMinimum: 1 }, 1.0001)).toBe(true);
    // Draft-04 tarzı boolean exclusive*
    expect(valid({ minimum: 1, exclusiveMinimum: true }, 1)).toBe(false);
    expect(valid({ multipleOf: 0.1 }, 0.3)).toBe(true);
    expect(valid({ multipleOf: 0.01 }, 19.99)).toBe(true);
    expect(valid({ multipleOf: 0.01 }, 19.995)).toBe(false);
    expect(valid({ multipleOf: 2 }, 7)).toBe(false);
    expect(isMultipleOf(1e-7, 1e-8)).toBe(true);
    expect(isMultipleOf(4.5e21, 1.5)).toBe(true);
    expect(isMultipleOf(5, 0)).toBe(false);
  });

  it('metin uzunluğu kod noktasıyla, unicode desen', () => {
    expect(codePointLength('😀a')).toBe(2);
    expect(valid({ maxLength: 2 }, '😀a')).toBe(true);
    expect(valid({ minLength: 3 }, 'çğ')).toBe(false);
    expect(valid({ pattern: '^\\p{L}+$' }, 'şeker')).toBe(true);
    expect(valid({ pattern: '^[a-z]+$' }, 'Şeker')).toBe(false);
    expect(valid({ pattern: 'b' }, 'abc')).toBe(true);
    // Desen sayı olmayan değerlere uygulanmaz.
    expect(valid({ pattern: '^a$', minLength: 5 }, 12)).toBe(true);
  });

  it('geçersiz düzenli ifade araç hatası', () => {
    expect(() => check({ pattern: '(' }, 'x')).toThrow(ToolError);
  });
});

describe('validateJsonSchema: nesneler', () => {
  const person = {
    type: 'object',
    properties: { ad: { type: 'string' }, yas: { type: 'integer', minimum: 0 } },
    required: ['ad', 'yas'],
    additionalProperties: false,
  };

  it('required, additionalProperties ve iç içe yollar', () => {
    const result = check(person, { yas: -1, fazla: true });
    expect(result.valid).toBe(false);
    expect(result.errors.map((e) => [e.instancePath, e.schemaPath, e.message])).toEqual([
      ['', '#/required', 'Zorunlu alan eksik: "ad"'],
      ['/yas', '#/properties/yas/minimum', 'En az 0 olmalı.'],
      ['/fazla', '#/additionalProperties', 'Ek alana izin verilmiyor: "fazla"'],
    ]);
  });

  it('JSON pointer kaçışı (~ ve /)', () => {
    const result = check({ properties: { 'a/b~c': { type: 'string' } } }, { 'a/b~c': 1 });
    expect(result.errors[0]!.instancePath).toBe('/a~1b~0c');
    expect(result.errors[0]!.schemaPath).toBe('#/properties/a~1b~0c/type');
  });

  it('patternProperties, additionalProperties şeması, propertyNames', () => {
    const schema = {
      patternProperties: { '^x-': { type: 'string' } },
      additionalProperties: { type: 'number' },
      propertyNames: { maxLength: 5 },
    };
    expect(valid(schema, { 'x-a': 'ok', b: 1 })).toBe(true);
    expect(keywords(schema, { 'x-a': 1 })).toEqual(['type']);
    expect(keywords(schema, { b: 'yazı' })).toEqual(['type']);
    expect(keywords(schema, { uzunAlan: 1 })).toEqual(['propertyNames']);
  });

  it('__proto__ ve prototip anahtarları güvenli', () => {
    const data = JSON.parse('{"__proto__": 1, "constructor": 2}');
    expect(valid({ properties: { toString: false }, additionalProperties: { type: 'integer' } }, data)).toBe(
      true,
    );
    expect(keywords({ required: ['toString'] }, {})).toEqual(['required']);
  });

  it('min/maxProperties, dependentRequired, dependentSchemas ve draft-07 dependencies', () => {
    expect(keywords({ minProperties: 2 }, { a: 1 })).toEqual(['minProperties']);
    expect(keywords({ maxProperties: 0 }, { a: 1 })).toEqual(['maxProperties']);
    expect(keywords({ dependentRequired: { kart: ['cvv'] } }, { kart: '1' })).toEqual(['dependentRequired']);
    expect(valid({ dependentSchemas: { a: { required: ['b'] } } }, { a: 1, b: 2 })).toBe(true);
    expect(valid({ dependentSchemas: { a: { required: ['b'] } } }, { a: 1 })).toBe(false);
    expect(keywords({ dependencies: { a: ['b'] } }, { a: 1 })).toEqual(['dependencies']);
    expect(valid({ dependencies: { a: { properties: { b: { type: 'string' } } } } }, { a: 1, b: 2 })).toBe(
      false,
    );
  });
});

describe('validateJsonSchema: diziler', () => {
  it('items, prefixItems ve kalan öğeler', () => {
    const schema = { prefixItems: [{ type: 'string' }, { type: 'number' }], items: false };
    expect(valid(schema, ['a', 1])).toBe(true);
    expect(valid(schema, ['a'])).toBe(true);
    expect(keywords(schema, ['a', 1, true])).toEqual(['items']);
    expect(check({ items: { type: 'integer' } }, [1, 'x']).errors[0]!.instancePath).toBe('/1');
  });

  it('draft-07 dizi biçimli items ve additionalItems', () => {
    const schema = { items: [{ type: 'string' }], additionalItems: { type: 'number' } };
    expect(valid(schema, ['a', 1, 2])).toBe(true);
    expect(check(schema, ['a', 'b']).errors[0]!.schemaPath).toBe('#/additionalItems/type');
    expect(valid({ items: [{ type: 'string' }], additionalItems: false }, ['a', 'b'])).toBe(false);
  });

  it('contains, minContains, maxContains', () => {
    const schema = { contains: { type: 'number' }, minContains: 2, maxContains: 3 };
    expect(valid(schema, [1, 'a', 2])).toBe(true);
    expect(keywords(schema, [1, 'a'])).toEqual(['contains']);
    expect(keywords(schema, [1, 2, 3, 4])).toEqual(['maxContains']);
    expect(valid({ contains: { type: 'number' }, minContains: 0 }, [])).toBe(true);
    expect(valid({ contains: { type: 'number' } }, [])).toBe(false);
  });

  it('min/maxItems ve uniqueItems (anahtar sırası önemsiz)', () => {
    expect(keywords({ minItems: 1 }, [])).toEqual(['minItems']);
    expect(keywords({ maxItems: 1 }, [1, 2])).toEqual(['maxItems']);
    const result = check({ uniqueItems: true }, [{ a: 1, b: 2 }, 3, { b: 2, a: 1 }]);
    expect(result.errors[0]!.instancePath).toBe('/2');
    expect(valid({ uniqueItems: true }, [1, '1', [1], { a: 1 }])).toBe(true);
    expect(canonicalJson({ b: 1, a: [2] })).toBe('{"a":[2],"b":1}');
  });
});

describe('validateJsonSchema: birleşik şemalar', () => {
  it('allOf, anyOf, oneOf, not', () => {
    expect(valid({ allOf: [{ type: 'number' }, { minimum: 3 }] }, 2)).toBe(false);
    expect(valid({ anyOf: [{ type: 'string' }, { type: 'number' }] }, 2)).toBe(true);
    const anyOf = check({ anyOf: [{ type: 'string' }, { type: 'number', minimum: 5 }] }, 2);
    // En yakın seçeneğin ayrıntısı da gösterilir.
    expect(anyOf.errors.map((e) => e.keyword)).toEqual(['anyOf', 'type']);
    expect(valid({ oneOf: [{ type: 'number' }, { minimum: 0 }] }, 5)).toBe(false);
    expect(check({ oneOf: [{ type: 'number' }, { minimum: 0 }] }, 5).errors[0]!.message).toContain('0, 1');
    expect(valid({ oneOf: [{ type: 'number' }, { type: 'string' }] }, 's')).toBe(true);
    expect(keywords({ not: { type: 'null' } }, null)).toEqual(['not']);
  });

  it('if / then / else', () => {
    const schema = {
      if: { properties: { ulke: { const: 'TR' } } },
      then: { required: ['tckn'] },
      else: { required: ['pasaport'] },
    };
    expect(valid(schema, { ulke: 'TR', tckn: '1' })).toBe(true);
    expect(keywords(schema, { ulke: 'TR' })).toEqual(['required']);
    expect(check(schema, { ulke: 'DE' }).errors[0]!.schemaPath).toBe('#/else/required');
  });
});

describe('validateJsonSchema: başvurular', () => {
  it('$defs, definitions, $anchor ve özyineleme', () => {
    const tree = {
      $defs: { node: { type: 'object', properties: { children: { type: 'array', items: { $ref: '#' } } } } },
      $ref: '#/$defs/node',
      required: ['ad'],
    };
    expect(valid(tree, { ad: 'kök', children: [{ ad: 'a', children: [] }] })).toBe(true);
    const nested = check(tree, { ad: 'kök', children: [{ children: [] }] });
    expect(nested.errors[0]!.instancePath).toBe('/children/0');
    expect(valid({ definitions: { n: { type: 'number' } }, $ref: '#/definitions/n' }, 1)).toBe(true);
    expect(valid({ $defs: { a: { $anchor: 'sayi', type: 'number' } }, $ref: '#sayi' }, 'x')).toBe(false);
  });

  it('başvurulan şemadaki hata hedefin yoluyla raporlanır', () => {
    const result = check(
      { $defs: { s: { type: 'string' } }, properties: { a: { $ref: '#/$defs/s' } } },
      { a: 1 },
    );
    expect(result.errors[0]).toMatchObject({ instancePath: '/a', schemaPath: '#/$defs/s/type' });
  });

  it('gömülü $id ile başvuru', () => {
    const schema = {
      $id: 'https://ornek.com/kok.json',
      $defs: { adres: { $id: 'adres.json', type: 'object', required: ['sehir'] } },
      properties: { adres: { $ref: 'adres.json' }, ikinci: { $ref: 'https://ornek.com/adres.json' } },
    };
    expect(valid(schema, { adres: { sehir: 'İzmir' } })).toBe(true);
    expect(valid(schema, { ikinci: {} })).toBe(false);
  });

  it('draft-07: $ref yanındaki anahtarlar yok sayılır; 2020-12: uygulanır', () => {
    const base = { definitions: { s: { type: 'string' } }, $ref: '#/definitions/s', maxLength: 1 };
    expect(valid({ ...base, $schema: 'http://json-schema.org/draft-07/schema#' }, 'uzun')).toBe(true);
    expect(check({ ...base, $schema: 'http://json-schema.org/draft-07/schema#' }, 'x').draft).toBe('07');
    expect(valid(base, 'uzun')).toBe(false);
    expect(valid(base, 'uzun', { draft: '07' })).toBe(true);
  });

  it('harici, çözülemeyen ve sonsuz başvurular araç hatası (ağ isteği yok)', () => {
    expect(() => check({ $ref: 'https://baska.com/s.json' }, 1)).toThrow(/Harici \$ref/);
    expect(() => check({ $ref: '#/$defs/yok' }, 1)).toThrow(ToolError);
    expect(() => check({ $ref: '#nope' }, 1)).toThrow(ToolError);
    expect(() =>
      check({ $defs: { a: { $ref: '#/$defs/b' }, b: { $ref: '#/$defs/a' } }, $ref: '#/$defs/a' }, 1),
    ).toThrow(/döngüsü/);
  });

  it('OpenAPI belgesi: seçilen şema, nullable, components başvuruları', () => {
    const doc = {
      openapi: '3.0.3',
      components: {
        schemas: {
          Kisi: {
            type: 'object',
            required: ['ad'],
            properties: { ad: { type: 'string' }, adres: { $ref: '#/components/schemas/Adres' } },
          },
          Adres: { type: 'object', properties: { sehir: { type: 'string', nullable: true } } },
        },
      },
    };
    expect(valid(doc, { ad: 'Ada', adres: { sehir: null } })).toBe(true);
    expect(check(doc, { adres: {} }).errors[0]).toMatchObject({
      schemaPath: '#/components/schemas/Kisi/required',
    });
    expect(valid(doc, { sehir: 1 }, { schemaName: 'Adres' })).toBe(false);
    expect(check(doc, {}).draft).toBe('07');
    expect(() => check({ openapi: '3.1.0' }, {})).toThrow(/şema/);
  });
});

describe('validateJsonSchema: unevaluated*', () => {
  it('unevaluatedProperties alt şemalardaki alanları görür', () => {
    const schema = {
      allOf: [{ properties: { a: true } }],
      anyOf: [{ properties: { b: true } }, { properties: { c: true } }],
      if: { properties: { tur: { const: 'x' } } },
      then: { properties: { x: true } },
      unevaluatedProperties: false,
    };
    expect(valid(schema, { a: 1, b: 2, c: 3 })).toBe(true);
    expect(valid(schema, { tur: 'x', x: 1 })).toBe(true);
    expect(valid(schema, { tur: 'y', x: 1 })).toBe(false);
    expect(check(schema, { a: 1, d: 1 }).errors[0]).toMatchObject({
      keyword: 'unevaluatedProperties',
      instancePath: '/d',
    });
  });

  it('başarısız alt şemanın alanları değerlendirilmiş sayılmaz; $ref üzerinden sayılır', () => {
    const schema = {
      $defs: { base: { properties: { id: true } } },
      $ref: '#/$defs/base',
      anyOf: [{ properties: { a: { type: 'string' } } }, true],
      unevaluatedProperties: false,
    };
    expect(valid(schema, { id: 1 })).toBe(true);
    expect(valid(schema, { id: 1, a: 'x' })).toBe(true);
    expect(valid(schema, { id: 1, a: 1 })).toBe(false);
  });

  it('unevaluatedItems prefixItems ve contains ile', () => {
    const schema = {
      prefixItems: [{ type: 'string' }],
      contains: { type: 'number' },
      unevaluatedItems: false,
    };
    expect(valid(schema, ['a', 1, 2])).toBe(true);
    expect(check(schema, ['a', 1, true]).errors[0]).toMatchObject({
      keyword: 'unevaluatedItems',
      instancePath: '/2',
    });
    expect(valid({ unevaluatedItems: { type: 'number' } }, [1, 'x'])).toBe(false);
  });
});

describe('validateJsonSchema: biçimler ve sınırlar', () => {
  it('format varsayılan olarak açıklama, istenirse hata', () => {
    expect(valid({ format: 'email' }, 'yok')).toBe(true);
    expect(keywords({ format: 'email' }, 'yok', { assertFormats: true })).toEqual(['format']);
    expect(valid({ format: 'bilinmeyen' }, 'x', { assertFormats: true })).toBe(true);
  });

  it('biçim denetimleri', () => {
    expect(checkFormat('date-time', '2024-02-29T10:00:00+03:00')).toBe(true);
    expect(checkFormat('date-time', '2023-02-29T10:00:00Z')).toBe(false);
    expect(checkFormat('date-time', '2024-01-01 10:00:00Z')).toBe(false);
    expect(checkFormat('time', '23:59:60Z')).toBe(true);
    expect(checkFormat('time', '22:59:60Z')).toBe(false);
    expect(checkFormat('time', '10:00:00')).toBe(false);
    expect(checkFormat('date', '2024-13-01')).toBe(false);
    expect(checkFormat('email', 'ayse@ornek.com')).toBe(true);
    expect(checkFormat('email', 'ayse@')).toBe(false);
    expect(checkFormat('uri', 'https://ornek.com/a?b=1')).toBe(true);
    expect(checkFormat('uri', '/goreli/yol')).toBe(false);
    expect(checkFormat('uuid', '3fa85f64-5717-4562-b3fc-2c963f66afa6')).toBe(true);
    expect(checkFormat('uuid', '3fa85f64-5717-4562-b3fc')).toBe(false);
    expect(checkFormat('ipv4', '192.168.1.1')).toBe(true);
    expect(checkFormat('ipv4', '256.1.1.1')).toBe(false);
    expect(checkFormat('ipv4', '01.1.1.1')).toBe(false);
    expect(checkFormat('ipv6', '2001:db8::1')).toBe(true);
    expect(checkFormat('ipv6', '::ffff:192.0.2.1')).toBe(true);
    expect(checkFormat('ipv6', '1:2:3:4:5:6:7:8:9')).toBe(false);
    expect(checkFormat('ipv6', '1::2::3')).toBe(false);
    expect(checkFormat('hostname', 'api.ornek.com')).toBe(true);
    expect(checkFormat('hostname', '-kotu.com')).toBe(false);
    expect(checkFormat('regex', '^[a-z]+$')).toBe(true);
    expect(checkFormat('regex', '(')).toBe(false);
  });

  it('hata sayısı sınırlanır', () => {
    const result = check(
      { items: { type: 'string' } },
      Array.from({ length: 50 }, (_, i) => i),
      { maxErrors: 10 },
    );
    expect(result.errors).toHaveLength(10);
    expect(result.truncated).toBe(true);
    expect(result.valid).toBe(false);
  });

  it('çok derin veri ve büyük işlem yükü araç hatası verir', () => {
    let deep: unknown = 1;
    for (let i = 0; i < 2000; i++) deep = [deep];
    expect(() => check({ items: { $ref: '#' } }, deep)).toThrow(ToolError);
    const big = Array.from({ length: 3000 }, () => Array.from({ length: 1000 }, () => 1));
    expect(() =>
      check({ items: { items: { anyOf: [{ type: 'string' }, { type: 'number' }] } } }, big),
    ).toThrow(/çok uzun/);
    // Tek başına ~3 sn; tüm paket paralel koşarken varsayılan 5 sn aşılabiliyor.
  }, 20_000);

  it('dinamik başvurular için not düşer', () => {
    const result = check({ $dynamicAnchor: 'kok', items: { $dynamicRef: '#kok' }, type: 'array' }, [[]]);
    expect(result.valid).toBe(true);
    expect(result.notes).toHaveLength(1);
  });
});

describe('validateJsonSchema derin veri', () => {
  it('uniqueItems karşılaştırmasında yığın taşması Türkçe ToolError olur', () => {
    let deep: unknown = 1;
    for (let i = 0; i < 50_000; i++) deep = [deep];
    expect(() => validateJsonSchema({ uniqueItems: true }, [deep, 1])).toThrow(ToolError);
    expect(() => validateJsonSchema({ uniqueItems: true }, [deep, 1])).toThrow(/derin/);
  });
});

describe('validateJsonSchema English messages', () => {
  afterEach(() => setCoreLanguage('tr'));

  it('reports validation errors in English', () => {
    registerCoreMessages('en', { toolsData: en });
    setCoreLanguage('en');
    const messages = (schema: unknown, data: unknown) => check(schema, data).errors.map((e) => e.message);
    expect(messages({ type: 'string' }, 5)).toEqual(['Type mismatch: expected string, got number.']);
    expect(messages({ required: ['a'] }, {})).toEqual(['Missing required property: "a"']);
    expect(messages({ minLength: 3 }, 'ab')).toEqual(['Must be at least 3 characters (2 given).']);
    expect(messages({ maximum: 1000 }, 5000)).toEqual(['Must be at most 1000.']);
    expect(() => check({ $ref: '#/nope' }, 1)).toThrow('Unresolved reference: #/nope');
  });
});
