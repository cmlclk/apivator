import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { buildSchema, graphqlSync, getIntrospectionQuery, parse, validate } from 'graphql';
import type { ExecuteResponse } from '@apivator/core';
import { buildOperation, sampleValue } from './operations';
import { schemaFromResponse } from './graphqlSchema';
import { graphqlSchemaKey } from './schemaKey';
import { SchemaExplorer } from './SchemaExplorer';

const api = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('../../lib/api', () => ({ api }));

const sdl = `
  """Mağaza ürünü"""
  type Urun { id: ID! ad: String! fiyat: Float etiketler: [String!]! kategori: Kategori! }
  type Kategori { id: ID! ad: String! }
  enum Siralama { AD FIYAT }
  input UrunGirdisi { ad: String! fiyat: Float stok: Int! }
  type UrunBaglantisi { edges: [UrunKenari!]! }
  type UrunKenari { node: Urun! }
  type Query {
    urun(id: ID!): Urun
    urunler(ilk: Int = 10, sirala: Siralama): [Urun!]!
    sayfa: UrunBaglantisi!
    eski: String @deprecated(reason: "yeni alanı kullanın")
  }
  type Mutation { urunEkle(girdi: UrunGirdisi!): Urun! }
`;
const schema = buildSchema(sdl);

function response(body: unknown, status = 200): ExecuteResponse {
  return {
    status,
    statusText: 'OK',
    headers: [],
    body: typeof body === 'string' ? body : JSON.stringify(body),
    bodyEncoding: 'text',
    size: 0,
    truncated: false,
    timeMs: 1,
    finalUrl: null,
    error: null,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('operations', () => {
  it('builds a runnable operation with variables for required arguments', () => {
    const urun = schema.getQueryType()!.getFields().urun!;
    const op = buildOperation('query', urun);
    expect(op.query).toBe(
      'query Urun($id: ID!) {\n  urun(id: $id) {\n    id\n    ad\n    fiyat\n    etiketler\n  }\n}\n',
    );
    expect(op.variables).toEqual({ id: '' });
    // Üretilen sorgu şemaya göre geçerli.
    expect(validate(schema, parse(op.query))).toEqual([]);
  });

  it('descends into connection types and fills input objects', () => {
    const sayfa = buildOperation('query', schema.getQueryType()!.getFields().sayfa!);
    expect(sayfa.query).toContain('edges {\n      node {');
    expect(validate(schema, parse(sayfa.query))).toEqual([]);

    const ekle = buildOperation('mutation', schema.getMutationType()!.getFields().urunEkle!);
    expect(ekle.variables).toEqual({ girdi: { ad: '', stok: 0 } });
    expect(ekle.query.startsWith('mutation UrunEkle($girdi: UrunGirdisi!)')).toBe(true);
    expect(validate(schema, parse(ekle.query))).toEqual([]);
    expect(sampleValue(schema.getType('Siralama') as never)).toBe('AD');
  });
});

describe('introspection', () => {
  it('builds a schema from an introspection response', () => {
    const data = graphqlSync({ schema, source: getIntrospectionQuery() }).data;
    const { schema: built } = schemaFromResponse(response({ data }));
    expect(Object.keys(built.getQueryType()!.getFields())).toContain('urunler');
  });

  it('explains common failures', () => {
    expect(() => schemaFromResponse(response('<html>Not found</html>', 404))).toThrow(
      /GraphQL uç noktası mı/,
    );
    expect(() =>
      schemaFromResponse(response({ errors: [{ message: 'GraphQL introspection is not allowed' }] })),
    ).toThrow(/introspection'ı kapatmış/);
    expect(() =>
      schemaFromResponse({ ...response({}), error: { code: 'dns', message: 'Adres çözülemedi' } }),
    ).toThrow('Adres çözülemedi');
    expect(() => schemaFromResponse({ ...response({}), truncated: true })).toThrow(/kesildi/);
  });

  it('keys schemas by resolved address without query', () => {
    const vars = new Map([
      ['base', { value: 'https://api.test', scope: 'environment' as const, scopeName: 'T', isSecret: false }],
    ]);
    expect(graphqlSchemaKey('{{base}}/graphql?x=1', vars)).toBe('https://api.test/graphql');
    expect(graphqlSchemaKey('{{yok}}/graphql', vars)).toBeNull();
    expect(graphqlSchemaKey('  ', vars)).toBeNull();
  });
});

describe('SchemaExplorer', () => {
  it('lists root fields, navigates types and inserts operations', async () => {
    const onInsert = vi.fn();
    render(<SchemaExplorer schema={schema} onInsert={onInsert} />);
    const user = userEvent.setup();

    const fields = screen.getByRole('list', { name: 'query alanları' });
    expect(within(fields).getByText('urunler')).toBeInTheDocument();
    expect(within(fields).getByText('eski')).toHaveClass('line-through');
    expect(screen.getByText(/yeni alanı kullanın/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'urun için örnek sorgu ekle' }));
    expect(onInsert).toHaveBeenCalledWith(expect.objectContaining({ variables: { id: '' } }));

    await user.click(within(fields).getAllByRole('button', { name: 'Urun' })[0]!);
    expect(screen.getByText('Mağaza ürünü')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Kategori' }));
    expect(screen.getByText('Kategori', { selector: 'span.font-semibold' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Geri' }));
    await user.click(screen.getByRole('button', { name: 'Geri' }));

    await user.click(screen.getByRole('tab', { name: 'Mutation' }));
    expect(screen.getByText('urunEkle')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Şemada ara'), 'sira');
    expect(screen.getByRole('button', { name: 'Siralama' })).toBeInTheDocument();
  });
});
