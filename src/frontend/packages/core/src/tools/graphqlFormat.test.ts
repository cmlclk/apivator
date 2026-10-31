import { describe, expect, it } from 'vitest';
import { FormatError } from './formatError';
import { formatGraphql, minifyGraphql } from './graphqlFormat';

const QUERY = `query Kullanici($id: ID!, $ilk: Int = 10 $dil: [String!]! = ["tr", "en"]) @cached(ttl: 60) {
  kullanici(id: $id) { id, ad: tamAd
    ...Profil
    gonderiler(ilk: $ilk, filtre: {durum: YAYINDA, etiket: ["a" "b"]}) @include(if: true) {
      ... on Makale { baslik }
      ... @skip(if: false) { kimlik }
    }
  }
}
fragment Profil on Kullanici { avatar(boyut: 64) eposta }`;

const QUERY_EXPECTED = `query Kullanici($id: ID!, $ilk: Int = 10, $dil: [String!]! = ["tr", "en"]) @cached(ttl: 60) {
  kullanici(id: $id) {
    id
    ad: tamAd
    ...Profil
    gonderiler(ilk: $ilk, filtre: { durum: YAYINDA, etiket: ["a", "b"] }) @include(if: true) {
      ... on Makale {
        baslik
      }
      ... @skip(if: false) {
        kimlik
      }
    }
  }
}

fragment Profil on Kullanici {
  avatar(boyut: 64)
  eposta
}`;

const SCHEMA = `"""
Kök sorgu tipi.
  İç girinti korunur.
"""
type Query implements Node & Kayit @key(fields: "id") {
  "Tek satır açıklama"
  kullanici(id: ID!, "argüman açıklaması" dil: Dil = TR): Kullanici @deprecated(reason: "Yeni alan: kisi")
  liste(filtre: Filtre = {sayfa: 1}): [Kullanici!]!
}
# Dil seçenekleri
enum Dil { TR EN @deprecated }
union Sonuc = | Kullanici | Makale
scalar Tarih
input Filtre { sayfa: Int = 1 sirala: String = "ad" }
directive @key(fields: String!) repeatable on OBJECT | INTERFACE
extend type Kullanici { yas: Int }
schema { query: Query }`;

const SCHEMA_EXPECTED = `"""
Kök sorgu tipi.
  İç girinti korunur.
"""
type Query implements Node & Kayit @key(fields: "id") {
  "Tek satır açıklama"
  kullanici(id: ID!, "argüman açıklaması" dil: Dil = TR): Kullanici @deprecated(reason: "Yeni alan: kisi")
  liste(filtre: Filtre = { sayfa: 1 }): [Kullanici!]!
}

# Dil seçenekleri
enum Dil {
  TR
  EN @deprecated
}

union Sonuc = | Kullanici | Makale

scalar Tarih

input Filtre {
  sayfa: Int = 1
  sirala: String = "ad"
}

directive @key(fields: String!) repeatable on OBJECT | INTERFACE

extend type Kullanici {
  yas: Int
}

schema {
  query: Query
}`;

function errorOf(text: string): FormatError {
  try {
    formatGraphql(text);
  } catch (error) {
    if (error instanceof FormatError) return error;
    throw error;
  }
  throw new Error('hata bekleniyordu');
}

describe('formatGraphql', () => {
  it('sorgu: değişkenler, takma ad, parça, satır içi parça, yönergeler, nesne ve liste değerleri', () => {
    expect(formatGraphql(QUERY)).toBe(QUERY_EXPECTED);
  });

  it('şema (SDL): açıklamalar, blok dizgi, enum, union, input, directive, extend, schema', () => {
    expect(formatGraphql(SCHEMA)).toBe(SCHEMA_EXPECTED);
  });

  it('idempotent', () => {
    for (const text of [QUERY, SCHEMA]) {
      const once = formatGraphql(text);
      expect(formatGraphql(once)).toBe(once);
      const four = formatGraphql(text, { indent: 4 });
      expect(formatGraphql(four, { indent: 4 })).toBe(four);
    }
  });

  it('küçültür; küçültülmüş metin aynı biçime döner', () => {
    const min = minifyGraphql(QUERY);
    expect(min).not.toContain('\n');
    expect(min).toContain('query Kullanici($id:ID!$ilk:Int=10');
    expect(min).toContain('...Profil gonderiler');
    expect(formatGraphql(min)).toBe(QUERY_EXPECTED);
    const schemaMin = minifyGraphql(SCHEMA);
    // Yorum küçültmede atılır, blok dizgi korunur.
    expect(schemaMin).not.toContain('# Dil');
    expect(formatGraphql(schemaMin)).toBe(SCHEMA_EXPECTED.replace('# Dil seçenekleri\n', ''));
  });

  it('küçültmede yan yana dizgiler blok dizgiye karışmaz', () => {
    expect(minifyGraphql('{ a(x: "", y: "b") }')).toBe('{a(x:""y:"b")}');
    expect(minifyGraphql('{ a(x: "" "b") }')).toBe('{a(x:"" "b")}');
  });

  it('dizgi içindeki parantez, # ve virgül dokunulmadan kalır', () => {
    const text = '{ a(q: "{ ( # , \\" }") }';
    expect(formatGraphql(text)).toBe('{\n  a(q: "{ ( # , \\" }")\n}');
    expect(minifyGraphql(text)).toBe('{a(q:"{ ( # , \\" }")}');
  });

  it('yorumlar: satır sonu ve kendi satırında; boş satır korunur', () => {
    const text = '{\n  # baş\n  a # sonda\n\n  b(\n    # arg\n    x: 1\n  )\n}';
    const formatted = formatGraphql(text);
    expect(formatted).toBe('{\n  # baş\n  a # sonda\n\n  b(\n    # arg\n    x: 1)\n}');
    expect(formatGraphql(formatted)).toBe(formatted);
  });

  it('tanımlar arasındaki ardışık yorumlar', () => {
    const text = '# baş\n# ikinci\nscalar A\n# A sonrası\n# devam\nscalar B';
    const formatted = formatGraphql(text);
    expect(formatted).toBe('# baş\n# ikinci\nscalar A\n\n# A sonrası\n# devam\nscalar B');
    expect(formatGraphql(formatted)).toBe(formatted);
  });

  it('isimsiz sorgu ve kaçışlı blok dizgi', () => {
    expect(formatGraphql('{a}{b}')).toBe('{\n  a\n}\n\n{\n  b\n}');
    const block = 'type A {\n  """x \\""" y"""\n  f: Int\n}';
    expect(formatGraphql(block)).toBe(block);
  });

  it('sekme girintisi ve BOM', () => {
    expect(formatGraphql('﻿{ a { b } }', { indent: '\t' })).toBe('{\n\ta {\n\t\tb\n\t}\n}');
  });

  it.each([
    ['{ a { b }', "Kapanmamış '{'", 1, 1],
    ['{ a }\n}', "Eşleşmeyen '}'", 2, 1],
    ['{ a(x: 1 }', "')' bekleniyordu", 1, 10],
    ['{ a(x: "abc) }', 'Dizgi kapanmamış', 1, 8],
    ['type A {\n  """aç\n}', 'Blok dizgi kapanmamış', 2, 3],
    ['{ a ^ }', "Beklenmeyen karakter '^'", 1, 5],
  ])('hatalı GraphQL: %s', (text, reason, line, column) => {
    const error = errorOf(text);
    expect(error.message).toContain(reason);
    expect({ line: error.line, column: error.column }).toEqual({ line, column });
  });
});

describe('formatGraphql büyük girdi', () => {
  it('çıktı uzunluğuyla doğrusal: 40 bin alan hızlı biçimlenir', () => {
    const text = `query {\n${'  a { b c }\n'.repeat(40_000)}}`;
    const started = performance.now();
    const formatted = formatGraphql(text);
    // Eskiden her satır sonunda tüm çıktı kopyalanıyordu (~17 sn).
    expect(performance.now() - started).toBeLessThan(3000);
    expect(formatted.split('\n')).toHaveLength(40_000 * 4 + 2);
  });
});
