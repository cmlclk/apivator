import { describe, expect, it } from 'vitest';
import {
  camelCase,
  generateModel,
  inferModel,
  modelFromSchema,
  pascalCase,
  singular,
  snakeCase,
  toJsonSchema,
  type ModelClass,
  type ModelLanguage,
  type ModelSet,
} from './index';
import { goName, typeName } from './naming';

const order = {
  data: {
    items: [
      {
        id: 1,
        order_no: 'A-1',
        total: 1250.5,
        createdAt: '2026-10-23T09:30:00+03:00',
        dueDate: '2026-11-01',
        uuid: '3f2b8c1e-5b7d-4e8a-9c21-7d4e5f6a8b90',
        address: { şehir: 'İzmir' },
        billing: { şehir: 'Muğla' },
        lines: [{ sku: 'K1', qty: 3 }],
        note: null,
        big: 5_000_000_000,
        class: 'vip',
      },
      {
        id: 2,
        order_no: 'A-2',
        total: 99,
        createdAt: '2026-10-22T10:00:00Z',
        dueDate: '2026-11-02',
        uuid: '4f2b8c1e-5b7d-4e8a-9c21-7d4e5f6a8b90',
        address: { şehir: 'Bursa' },
        billing: { şehir: 'Ankara' },
        lines: [],
        note: 'kapıya',
        big: 1,
        class: 'std',
        extra: true,
      },
    ],
  },
};

const cls = (set: ModelSet, name: string) =>
  set.types.find((t): t is ModelClass => t.kind === 'class' && t.name === name)!;
const field = (set: ModelSet, type: string, name: string) =>
  cls(set, type).fields.find((f) => f.name === name)!;

describe('adlar', () => {
  it('JSON adlarını dillerin kurallarına çevirir (Türkçe karakterler ASCII olur)', () => {
    expect(pascalCase('customer_name')).toBe('CustomerName');
    expect(pascalCase('müşteriAdı')).toBe('MusteriAdi');
    expect(camelCase('Order-No')).toBe('orderNo');
    expect(camelCase('1st')).toBe('n1st');
    expect(snakeCase('createdAt')).toBe('created_at');
    expect(snakeCase('HTTPStatus')).toBe('http_status');
    expect(goName('user_id')).toBe('UserID');
    expect(goName('api_url')).toBe('APIURL');
  });

  it('çoğul alan adından tekil sınıf adı; yerleşik tiplerle çakışmaz', () => {
    expect(
      ['items', 'categories', 'addresses', 'boxes', 'satırlar', 'kullanicilar', 'status', 'data'].map(
        singular,
      ),
    ).toEqual(['item', 'category', 'address', 'box', 'satir', 'kullanici', 'status', 'data']);
    expect(typeName('data')).toBe('DataModel');
    expect(typeName('list')).toBe('ListModel');
    expect(typeName('order')).toBe('Order');
  });
});

describe('JSON örneğinden çıkarım', () => {
  const set = inferModel([order], { rootName: 'OrderResponse' });

  it('sınıfları kökten itibaren sıralar; aynı yapıdaki nesneler tek sınıf olur', () => {
    expect(set.root).toEqual({ kind: 'class', name: 'OrderResponse' });
    expect(set.types.map((t) => t.name)).toEqual(['OrderResponse', 'DataModel', 'Item', 'Address', 'Line']);
    expect(field(set, 'Item', 'billing').type).toEqual({ kind: 'class', name: 'Address' });
  });

  it('tam sayı/büyük tam sayı/ondalık, tarih, tarih-saat ve GUID ayrılır', () => {
    const types = Object.fromEntries(
      cls(set, 'Item').fields.map((f) => [f.name, f.type.kind === 'primitive' ? f.type.type : f.type.kind]),
    );
    expect(types).toMatchObject({
      id: 'integer',
      order_no: 'string',
      total: 'number',
      createdAt: 'datetime',
      dueDate: 'date',
      uuid: 'uuid',
      big: 'long',
      lines: 'array',
    });
  });

  it('null görülen alan nullable, bazı örneklerde olmayan alan opsiyonel', () => {
    expect(field(set, 'Item', 'note')).toMatchObject({
      nullable: true,
      optional: false,
      type: { kind: 'primitive', type: 'string' },
    });
    expect(field(set, 'Item', 'extra')).toMatchObject({ nullable: false, optional: true });
    expect(field(set, 'Item', 'id')).toMatchObject({ nullable: false, optional: false });
  });

  it('birden çok örnek birleşir; çelişen tipler any, karışık tarih biçimleri metin olur', () => {
    const merged = inferModel([
      { a: 1, b: '2026-01-01', c: 'x', d: [] },
      { a: 2.5, b: '2026-01-01T10:00:00Z', c: 3 },
    ]);
    const types = cls(merged, 'Root').fields.map((f) => [f.name, f.type]);
    expect(types).toEqual([
      ['a', { kind: 'primitive', type: 'number' }],
      ['b', { kind: 'primitive', type: 'string' }],
      ['c', { kind: 'primitive', type: 'any' }],
      ['d', { kind: 'array', items: { kind: 'primitive', type: 'any' } }],
    ]);
  });

  it('kök dizi eleman sınıfını kök adıyla üretir; boş nesne sözlük olur', () => {
    const list = inferModel([[{ id: 1, meta: {} }]], { rootName: 'Product' });
    expect(list.root).toEqual({ kind: 'array', items: { kind: 'class', name: 'Product' } });
    expect(field(list, 'Product', 'meta').type).toEqual({
      kind: 'map',
      values: { kind: 'primitive', type: 'any' },
    });
  });
});

const openApi = {
  openapi: '3.0.3',
  info: { title: 't', version: '1' },
  paths: {},
  components: {
    schemas: {
      Order: {
        type: 'object',
        required: ['id', 'status'],
        properties: {
          id: { type: 'integer', format: 'int64' },
          status: { $ref: '#/components/schemas/OrderStatus' },
          parent: { $ref: '#/components/schemas/Order' },
          note: { type: 'string', nullable: true, description: 'Teslimat notu' },
          lines: { type: 'array', items: { $ref: '#/components/schemas/Line' } },
          tags: { type: 'object', additionalProperties: { type: 'string' } },
          kind: { type: 'string', enum: ['in-store', 'online'] },
        },
      },
      Line: {
        allOf: [
          { $ref: '#/components/schemas/Base' },
          { type: 'object', required: ['sku'], properties: { sku: { type: 'string' } } },
        ],
      },
      Base: { type: 'object', properties: { createdAt: { type: 'string', format: 'date-time' } } },
      OrderStatus: { type: 'string', enum: ['new', 'in_progress'] },
    },
  },
};

describe('şemadan model', () => {
  it('OpenAPI: başvurular, allOf, enum, kendine başvuru, nullable ve sözlük', () => {
    const set = modelFromSchema(openApi);
    expect(set.types.map((t) => `${t.kind}:${t.name}`)).toEqual([
      'class:Order',
      'class:Line',
      'class:Base',
      'enum:OrderStatus',
      'enum:Kind',
    ]);
    expect(field(set, 'Order', 'parent')).toMatchObject({
      type: { kind: 'class', name: 'Order' },
      optional: true,
    });
    expect(field(set, 'Order', 'note')).toMatchObject({
      nullable: true,
      optional: true,
      description: 'Teslimat notu',
    });
    expect(field(set, 'Order', 'id')).toMatchObject({
      type: { kind: 'primitive', type: 'long' },
      optional: false,
    });
    expect(field(set, 'Order', 'tags').type).toEqual({
      kind: 'map',
      values: { kind: 'primitive', type: 'string' },
    });
    expect(cls(set, 'Line').fields.map((f) => [f.name, f.optional])).toEqual([
      ['createdAt', true],
      ['sku', false],
    ]);
  });

  it("gRPC mesajının JSON Schema'sı (sunucunun ürettiği biçim)", () => {
    const set = modelFromSchema({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      title: 'Urun',
      $ref: '#/$defs/Urun',
      $defs: {
        Urun: {
          type: 'object',
          properties: {
            stok: { type: 'string', format: 'int64' },
            durum: { $ref: '#/$defs/Durum' },
            not: { type: ['string', 'null'] },
            depolar: { type: 'object', additionalProperties: { type: 'integer', format: 'int32' } },
          },
          required: ['stok', 'durum', 'depolar'],
        },
        Durum: { type: 'string', enum: ['DURUM_BELIRSIZ', 'STOKTA'] },
      },
    });
    expect(set.root).toEqual({ kind: 'class', name: 'Urun' });
    expect(field(set, 'Urun', 'not')).toMatchObject({ nullable: true, optional: true });
    expect(field(set, 'Urun', 'durum').type).toEqual({ kind: 'enum', name: 'Durum' });
  });

  it('JSON Schema dışa aktarma geri okunduğunda aynı modeli verir', () => {
    const set = inferModel([order], { rootName: 'OrderResponse' });
    const again = modelFromSchema(toJsonSchema(set, 'OrderResponse'));
    expect(again.types.map((t) => t.name).sort()).toEqual(set.types.map((t) => t.name).sort());
    expect(field(again, 'Item', 'note')).toMatchObject({ nullable: true, optional: false });
    expect(field(again, 'Item', 'extra')).toMatchObject({ optional: true });
    expect(field(again, 'Item', 'dueDate').type).toEqual({ kind: 'primitive', type: 'date' });
  });
});

describe('dil çıktıları', () => {
  const set = inferModel([order], { rootName: 'OrderResponse' });
  const schemaSet = modelFromSchema(openApi);
  const one = (language: ModelLanguage, options: object = {}, source = set) =>
    generateModel(source, { language, namespace: 'Acme.Models', ...options })
      .map((f) => f.content)
      .join('\n');

  it('C#: JSON adları öznitelikte, nullable, ayrılmış kelime ve sınıf adıyla çakışma', () => {
    const code = one('csharp');
    expect(code).toContain('namespace Acme.Models;');
    expect(code).toContain(
      '[JsonPropertyName("order_no")]\n    public string OrderNo { get; set; } = string.Empty;',
    );
    expect(code).toContain('public DateTimeOffset CreatedAt { get; set; }');
    expect(code).toContain('public DateOnly DueDate { get; set; }');
    expect(code).toContain('public long Big { get; set; }');
    expect(code).toContain('public string? Note { get; set; }');
    expect(code).toContain('public bool? Extra { get; set; }');
    expect(code).toContain('[JsonPropertyName("şehir")]\n    public string Sehir');
    expect(code).toContain('public string Class { get; set; }');
    expect(one('csharp', { csharp: { style: 'record' }, decimal: true })).toContain(
      '[property: JsonPropertyName("total")] decimal Total,',
    );
    const enums = one('csharp', {}, schemaSet);
    expect(enums).toContain('[JsonConverter(typeof(JsonStringEnumConverter<OrderStatus>))]');
    expect(enums).toContain('[JsonStringEnumMemberName("in_progress")]\n    InProgress,');
    expect(one('csharp', { csharp: { serializer: 'newtonsoft' } }, schemaSet)).toContain(
      '[EnumMember(Value = "in_progress")]',
    );
  });

  it('Java: her tip ayrı dosya, Jackson öznitelikleri, record ve Lombok', () => {
    const files = generateModel(set, { language: 'java', namespace: 'com.acme' });
    expect(files.map((f) => f.name)).toEqual([
      'OrderResponse.java',
      'DataModel.java',
      'Item.java',
      'Address.java',
      'Line.java',
    ]);
    const item = files.find((f) => f.name === 'Item.java')!.content;
    expect(item).toContain('package com.acme;');
    expect(item).toContain('@JsonProperty("class")\n    private String class_;');
    expect(item).toContain('public String getClass_() {');
    expect(item).toContain('private Boolean extra;');
    expect(item).toContain('private OffsetDateTime createdAt;');
    expect(one('java', { java: { style: 'record' } })).toContain(
      'public record Line(\n        @JsonProperty("sku") String sku,',
    );
    expect(one('java', { java: { lombok: true } })).toContain(
      '@Data\n@NoArgsConstructor\n@AllArgsConstructor\npublic class Item {',
    );
  });

  it('Kotlin, TypeScript, zod, Python, Go, Swift, Dart ve JSON Schema', () => {
    expect(one('kotlin')).toContain('@SerialName("order_no") val orderNo: String,');
    expect(one('kotlin')).toContain('@SerialName("note") val note: String? = null,');
    expect(one('kotlin')).toContain('@SerialName("class") val `class`: String,');

    const ts = one('typescript');
    expect(ts).toContain('  extra?: boolean;');
    expect(ts).toContain('  note: string | null;');
    expect(ts).toContain('  createdAt: string; // ISO 8601 tarih-saat');
    const zod = one('typescript', { typescript: { zod: true } }, schemaSet);
    expect(zod).toContain('export const OrderSchema: z.ZodType<Order> = z.object({');
    expect(zod).toContain('  parent: z.lazy(() => OrderSchema).optional(),');

    const pydantic = one('python');
    expect(pydantic).toContain('    order_no: str');
    expect(pydantic).toContain('    created_at: datetime = Field(alias="createdAt")');
    expect(pydantic).toContain('    extra: Optional[bool] = None');
    expect(pydantic).toContain('    class_: str = Field(alias="class")');
    expect(one('python', { python: { style: 'dataclass' } })).toContain(
      '            lines=[Line.from_dict(x) for x in data["lines"]],',
    );

    const go = one('go', { namespace: '' });
    expect(go).toContain('package models');
    expect(go).toContain('\tCreatedAt time.Time `json:"createdAt"`');
    expect(go).toContain('\tNote      *string   `json:"note"`');
    expect(go).toContain('\tExtra     *bool     `json:"extra,omitempty"`');

    const swift = one('swift', {}, schemaSet);
    expect(swift).toContain('final class Order: Codable {');
    expect(swift).toContain('struct Line: Codable {');
    expect(one('swift')).toContain('        case orderNo = "order_no"');

    const dart = one('dart', {}, schemaSet);
    expect(dart).toContain("        'status': status.toJson(),");
    expect(dart).toContain("  newValue('new'),");
    expect(one('dart')).toContain("        createdAt: DateTime.parse(json['createdAt'] as String),");

    const schema = JSON.parse(one('jsonschema'));
    expect(schema.$ref).toBe('#/$defs/OrderResponse');
    expect(schema.$defs.Item.properties.note).toEqual({ type: ['string', 'null'] });
  });
});
