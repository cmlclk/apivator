import { describe, expect, it } from 'vitest';
import { ToolError } from './errors';
import { queryJsonPath } from './jsonpath';

// RFC 9535 bölüm 1.5 örnek belgesi
const store = {
  store: {
    book: [
      { category: 'reference', author: 'Nigel Rees', title: 'Sayings of the Century', price: 8.95 },
      { category: 'fiction', author: 'Evelyn Waugh', title: 'Sword of Honour', price: 12.99 },
      {
        category: 'fiction',
        author: 'Herman Melville',
        title: 'Moby Dick',
        isbn: '0-553-21311-3',
        price: 8.99,
      },
      {
        category: 'fiction',
        author: 'J. R. R. Tolkien',
        title: 'The Lord of the Rings',
        isbn: '0-395-19395-8',
        price: 22.99,
      },
    ],
    bicycle: { color: 'red', price: 399 },
  },
};
const books = store.store.book;
const AUTHORS = books.map((b) => b.author);

const values = (expression: string) => queryJsonPath(store, expression).map((m) => m.value);
const paths = (expression: string) => queryJsonPath(store, expression).map((m) => m.path);

describe('queryJsonPath — RFC 9535 kitapçı örnekleri', () => {
  it('$.store.book[*].author', () => {
    expect(values('$.store.book[*].author')).toEqual(AUTHORS);
    expect(paths('$.store.book[*].author')).toEqual(
      books.map((_, i) => `$['store']['book'][${i}]['author']`),
    );
  });

  it('$..author', () => {
    expect(values('$..author')).toEqual(AUTHORS);
  });

  it('$.store.*', () => {
    const result = values('$.store.*');
    expect(result).toHaveLength(2);
    expect(result).toContainEqual(books);
    expect(result).toContainEqual(store.store.bicycle);
  });

  it('$.store..price', () => {
    expect([...values('$.store..price')].sort()).toEqual([399, 8.95, 12.99, 8.99, 22.99].sort());
  });

  it('$..book[2] ve $..book[-1]', () => {
    expect(values('$..book[2]')).toEqual([books[2]]);
    expect(paths('$..book[2]')).toEqual(["$['store']['book'][2]"]);
    expect(values('$..book[-1]')).toEqual([books[3]]);
    expect(paths('$..book[-1]')).toEqual(["$['store']['book'][3]"]);
  });

  it('$..book[0,1] ve $..book[:2]', () => {
    expect(values('$..book[0,1]')).toEqual([books[0], books[1]]);
    expect(values('$..book[:2]')).toEqual([books[0], books[1]]);
    expect(values('$..book[1:3]')).toEqual([books[1], books[2]]);
    expect(values('$..book[-2:]')).toEqual([books[2], books[3]]);
  });

  it('$..book[?(@.isbn)] varlık filtresi', () => {
    expect(values('$..book[?(@.isbn)]')).toEqual([books[2], books[3]]);
  });

  it('$..book[?(@.price<10)] karşılaştırma filtresi', () => {
    expect(values('$..book[?(@.price<10)]')).toEqual([books[0], books[2]]);
    expect(values('$..book[?(@.price < 10)].title')).toEqual(['Sayings of the Century', 'Moby Dick']);
  });

  it('filtrede &&, ||, ! ve metin eşitliği', () => {
    expect(values("$..book[?(@.price < 10 && @.category == 'fiction')].title")).toEqual(['Moby Dick']);
    expect(values("$..book[?(@.price > 20 || @.category == 'reference')].title")).toEqual([
      'Sayings of the Century',
      'The Lord of the Rings',
    ]);
    expect(values('$..book[?(!@.isbn)].title')).toEqual(['Sayings of the Century', 'Sword of Honour']);
  });

  it('köşeli parantezli ad ve ad birleşimi', () => {
    expect(values("$['store']['bicycle']['color']")).toEqual(['red']);
    expect(values("$.store.bicycle['color','price']")).toEqual(['red', 399]);
  });

  it('$ kökü döner, olmayan yol boş sonuç', () => {
    expect(queryJsonPath(store, '$')).toEqual([{ path: '$', value: store }]);
    expect(values('$.store.yok')).toEqual([]);
    expect(values('$.store.book[10]')).toEqual([]);
  });

  it('özel karakterli anahtar normalleştirilmiş yolda tırnaklı', () => {
    const result = queryJsonPath({ 'a.b': { "c'd": 1 } }, "$['a.b'].*");
    expect(result).toHaveLength(1);
    expect(result[0]!.value).toBe(1);
    expect(result[0]!.path.startsWith("$['a.b'][")).toBe(true);
  });

  it('@.length filtrede dizi uzunluğu', () => {
    const data = { groups: [{ items: [1] }, { items: [1, 2, 3] }] };
    expect(queryJsonPath(data, '$.groups[?(@.items.length > 1)]').map((m) => m.value)).toEqual([
      data.groups[1],
    ]);
  });
});

describe('queryJsonPath — sözdizimi hataları', () => {
  it.each(['store.book', '$.store.book[', '$..book[?(@.price <)]', '$.store.book[0', "$['store"])(
    '%s → ToolError',
    (expression) => {
      expect(() => queryJsonPath(store, expression)).toThrow(ToolError);
    },
  );

  it('eval kullanmaz: kod enjeksiyonu çalışmaz', () => {
    (globalThis as Record<string, unknown>).__hacked = false;
    try {
      queryJsonPath(store, '$..book[?(globalThis.__hacked = true)]');
    } catch {
      // ToolError beklenen
    }
    expect((globalThis as Record<string, unknown>).__hacked).toBe(false);
    delete (globalThis as Record<string, unknown>).__hacked;
  });
});
