import { afterEach, describe, expect, it } from 'vitest';
import en from '../locales/en/toolsData.json';
import { registerCoreMessages, setCoreLanguage } from '../i18n';
import { ToolError } from './errors';
import { JmesPathSyntaxError, queryJmesPath } from './jmespath';

// Örnekler jmespath.test resmi uyumluluk paketinden (basic, slice, filters, functions, multiselect, pipe).
type Case = [expression: string, expected: unknown];
const run = (data: unknown, cases: Case[]) => {
  for (const [expression, expected] of cases)
    expect(queryJmesPath(data, expression), expression).toEqual(expected);
};

describe('queryJmesPath — basic', () => {
  it('alanlar ve alt ifadeler', () => {
    const data = { foo: { bar: { baz: 'correct' } } };
    run(data, [
      ['foo', { bar: { baz: 'correct' } }],
      ['foo.bar', { baz: 'correct' }],
      ['foo.bar.baz', 'correct'],
      ['foo\n.\nbar\n.baz', 'correct'],
      ['foo.bar.baz.bad', null],
      ['foo.bar.bad', null],
      ['foo.bad', null],
      ['bad', null],
      ['bad.morebad.morebad', null],
    ]);
  });

  it('tırnaklı alan adları ve indeks', () => {
    run({ 'foo bar': 1, '"': 2, '✓': 3, foo: [0, 1, 2] }, [
      ['"foo bar"', 1],
      ['"\\""', 2],
      ['"\\u2713"', 3],
      ['foo[0]', 0],
      ['foo[-1]', 2],
      ['foo[3]', null],
      ['foo[-4]', null],
    ]);
    run(['one', 'two', 'three'], [['[1]', 'two']]);
    run({ foo: { bar: ['zero', 'one'] } }, [
      ['foo.bar[1]', 'one'],
      ['foo.bar.zero', null],
    ]);
  });
});

describe('queryJmesPath — slice', () => {
  it('dilimler', () => {
    const data = { foo: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], bar: { baz: 1 } };
    run(data, [
      ['bar[0:10]', null],
      ['foo[0:10:1]', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]],
      ['foo[0:10]', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]],
      ['foo[1:9]', [1, 2, 3, 4, 5, 6, 7, 8]],
      ['foo[0:10:2]', [0, 2, 4, 6, 8]],
      ['foo[5:]', [5, 6, 7, 8, 9]],
      ['foo[5::2]', [5, 7, 9]],
      ['foo[::2]', [0, 2, 4, 6, 8]],
      ['foo[::-1]', [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]],
      ['foo[1::2]', [1, 3, 5, 7, 9]],
      ['foo[10:0:-1]', [9, 8, 7, 6, 5, 4, 3, 2, 1]],
      ['foo[:-3]', [0, 1, 2, 3, 4, 5, 6]],
      ['foo[-3:]', [7, 8, 9]],
      ['foo[:100]', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]],
      ['foo[8:2:-2]', [8, 6, 4]],
    ]);
    run({ foo: [{ a: 1 }, { a: 2 }, { a: 3 }], bar: [{ a: { b: 1 } }, { a: { b: 2 } }] }, [
      ['foo[:2].a', [1, 2]],
      ['foo[:2].b', []],
      ['bar[::-1].a.b', [2, 1]],
    ]);
    expect(() => queryJmesPath(data, 'foo[::0]')).toThrow(JmesPathSyntaxError);
    expect(() => queryJmesPath(data, 'foo[:::]')).toThrow(JmesPathSyntaxError);
  });
});

describe('queryJmesPath — izdüşümler', () => {
  it('liste, nesne ve düzleştirme', () => {
    const data = { foo: { bar: { name: 'one' }, baz: { name: 'two' } } };
    run(data, [
      ['foo.*.name', ['one', 'two']],
      ['foo.*', [{ name: 'one' }, { name: 'two' }]],
    ]);
    const people = { people: [{ first: 'James', last: 'd' }, { first: 'Jacob', last: 'e' }, { missing: 1 }] };
    run(people, [
      ['people[*].first', ['James', 'Jacob']],
      ['people[*].first | [0]', 'James'],
      ['people[].first', ['James', 'Jacob']],
    ]);
    run({ a: [[1, 2], [3, [4]], 5] }, [
      ['a[]', [1, 2, 3, [4], 5]],
      ['a[][]', [1, 2, 3, 4, 5]],
    ]);
    run({ reservations: [{ instances: [{ s: 'a' }, { s: 'b' }] }, { instances: [{ s: 'c' }] }] }, [
      ['reservations[*].instances[*].s', [['a', 'b'], ['c']]],
      ['reservations[].instances[].s', ['a', 'b', 'c']],
    ]);
  });
});

describe('queryJmesPath — filters', () => {
  it('karşılaştırma ve mantıksal işleçler', () => {
    const data = { foo: [{ name: 'a', age: 20 }, { name: 'b', age: 30 }, { name: 'c' }] };
    run(data, [
      ["foo[?name == 'a']", [{ name: 'a', age: 20 }]],
      ['foo[?age > `25`].name', ['b']],
      ['foo[?age >= `20`].name', ['a', 'b']],
      ['foo[?age < `25`].name', ['a']],
      ['foo[?age != `20`].name', ['b', 'c']],
      ['foo[?age].name', ['a', 'b']],
      ['foo[?!age].name', ['c']],
      ["foo[?name == 'a' || name == 'c'].name", ['a', 'c']],
      ["foo[?age > `10` && name != 'b'].name", ['a']],
      ['foo[?name > `1`]', []],
      ["foo[?name == 'x']", []],
      ['foo[?`true`].name', ['a', 'b', 'c']],
    ]);
    run({ foo: [{ a: { b: 1 } }, { a: { b: 2 } }], bar: [[1, 2], [3]] }, [
      ['foo[?a == `{"b": 1}`]', [{ a: { b: 1 } }]],
      ['foo[?a.b == `2`].a.b', [2]],
      ['bar[?length(@) > `1`]', [[1, 2]]],
    ]);
    run({ a: [1, 2, 3, 4] }, [['a[?@ > `2`]', [3, 4]]]);
  });

  it('|| ve && sonuç değerleri, !', () => {
    run({ outer: { foo: 'foo', empty: '', list: [] }, t: true, f: false }, [
      ['outer.foo || outer.bar', 'foo'],
      ['outer.bar || outer.foo', 'foo'],
      ['outer.empty || outer.foo', 'foo'],
      ['outer.list && outer.foo', []],
      ['outer.foo && outer.empty', ''],
      ['!t', false],
      ['!(outer.list)', true],
      ['t && f', false],
    ]);
  });
});

describe('queryJmesPath — multiselect ve pipe', () => {
  it('liste ve nesne çoklu seçimi', () => {
    const data = { foo: { bar: 'bar', baz: 'baz', qux: 'qux', nested: { one: 1 } } };
    run(data, [
      ['foo.[bar, baz]', ['bar', 'baz']],
      ['foo.{bar: bar, baz: baz}', { bar: 'bar', baz: 'baz' }],
      ['foo.{"b r": bar}', { 'b r': 'bar' }],
      ['foo.[bar, nested.one]', ['bar', 1]],
      ['foo.missing.[bar]', null],
      ['foo.missing.{a: bar}', null],
      ['[foo.bar, foo.qux]', ['bar', 'qux']],
      ['{a: foo.bar, b: `1`}', { a: 'bar', b: 1 }],
    ]);
    run(
      {
        items: [
          { k: 'a', v: 1 },
          { k: 'b', v: 2 },
        ],
      },
      [
        [
          'items[*].[k, v]',
          [
            ['a', 1],
            ['b', 2],
          ],
        ],
        ['items[*].{key: k}', [{ key: 'a' }, { key: 'b' }]],
      ],
    );
  });

  it('boru izdüşümü keser', () => {
    const data = { foo: [{ bar: [1, 2] }, { bar: [3, 4] }] };
    run(data, [
      ['foo[*].bar | [0]', [1, 2]],
      ['foo[*].bar[0]', [1, 3]],
      ['foo | [1].bar | [0]', 3],
      ['foo[*].bar[] | sort(@) | reverse(@)', [4, 3, 2, 1]],
    ]);
  });

  it('değişmezler ve @', () => {
    run({ foo: 1 }, [
      ['`"a"`', 'a'],
      ['`[1, 2]`', [1, 2]],
      ['`{"a": "b`"}`'.replace('b`"', 'b\\`"'), { a: 'b`' }],
      ["'raw'", 'raw'],
      ["'it\\'s'", "it's"],
      ["'a\\b'", 'a\\b'],
      ['@', { foo: 1 }],
      ['@.foo', 1],
    ]);
  });
});

describe('queryJmesPath — functions', () => {
  const data = {
    foo: -1,
    zero: 0,
    numbers: [-1, 3, 4, 5],
    strings: ['a', 'b', 'c'],
    decimals: [1.01, 1.2, -1.5],
    str: 'Str',
    array: [-1, 3, 4, 5, 'a', '100'],
    empty_list: [],
    objects: { foo: 'bar', bar: 'baz' },
    people: [
      { name: 'b', age: 30 },
      { name: 'a', age: 50 },
      { name: 'c', age: 40 },
    ],
  };
  it('sayısal ve metin fonksiyonları', () => {
    run(data, [
      ['abs(foo)', 1],
      ['abs(`-24`)', 24],
      ['avg(numbers)', 2.75],
      ['avg(empty_list)', null],
      ['ceil(`1.2`)', 2],
      ['floor(decimals[0])', 1],
      ["contains('abc', 'a')", true],
      ["contains('abc', 'd')", false],
      ['contains(strings, `"a"`)', true],
      ['contains(decimals, `false`)', false],
      ["ends_with(str, 'r')", true],
      ["starts_with(str, 'S')", true],
      ["join(', ', strings)", 'a, b, c'],
      ['length(str)', 3],
      ["length('✓✓')", 2],
      ['length(objects)', 2],
      ['max(numbers)', 5],
      ['min(decimals)', -1.5],
      ['max(strings)', 'c'],
      ['max(empty_list)', null],
      ['sum(numbers)', 11],
      ['sum(empty_list)', 0],
      ['reverse(str)', 'rtS'],
      ['sort(strings)', ['a', 'b', 'c']],
      ['sort(numbers)', [-1, 3, 4, 5]],
    ]);
  });

  it('tür ve dönüşüm fonksiyonları', () => {
    run(data, [
      ['keys(objects)', ['foo', 'bar']],
      ['values(objects)', ['bar', 'baz']],
      ['merge(`{"a": 1}`, `{"b": 2}`, `{"a": 3}`)', { a: 3, b: 2 }],
      ['not_null(unknown, `null`, foo, str)', -1],
      ['to_array(foo)', [-1]],
      ['to_array(numbers)', [-1, 3, 4, 5]],
      ["to_number('1.5')", 1.5],
      ["to_number('abc')", null],
      ['to_number(`true`)', null],
      ['to_string(numbers)', '[-1,3,4,5]'],
      ['to_string(str)', 'Str'],
      ['type(foo)', 'number'],
      ['type(str)', 'string'],
      ['type(objects)', 'object'],
      ['type(`null`)', 'null'],
      ['type(@.empty_list)', 'array'],
    ]);
  });

  it('ifade başvuruları (&)', () => {
    run(data, [
      ['sort_by(people, &age)[*].name', ['b', 'c', 'a']],
      ['sort_by(people, &name)[0].age', 50],
      ['max_by(people, &age).name', 'a'],
      ['min_by(people, &age).name', 'b'],
      ['map(&name, people)', ['b', 'a', 'c']],
      ['map(&missing, people)', [null, null, null]],
      ['people[?age > `35`] | sort_by(@, &age) | [*].name', ['c', 'a']],
    ]);
  });

  it('tür ve sayı hataları ToolError', () => {
    for (const expression of [
      'abs(str)',
      'avg(array)',
      'sort(array)',
      'length(foo)',
      'keys(numbers)',
      'sort_by(people, &foo)',
      'abs()',
      'abs(`1`, `2`)',
      'nope(foo)',
      'map(name, people)',
    ])
      expect(() => queryJmesPath(data, expression), expression).toThrow(ToolError);
  });
});

describe('queryJmesPath — hatalar ve sınırlar', () => {
  it('sözdizimi hatası konumlu', () => {
    const cases: [string, number][] = [
      ['foo.', 4],
      ['foo[', 4],
      ['foo bar', 4],
      ['foo = 1', 4],
      ['"foo', 0],
      ['`{bad}`', 0],
      ['foo.1', 4],
      ['{a b}', 3],
      ['"f"(@)', 0],
      ['', 0],
    ];
    for (const [expression, position] of cases) {
      let caught: unknown;
      try {
        queryJmesPath({}, expression);
      } catch (error) {
        caught = error;
      }
      expect(caught, expression).toBeInstanceOf(JmesPathSyntaxError);
      expect((caught as JmesPathSyntaxError).position, expression).toBe(position);
    }
  });

  it('__proto__ anahtarı prototipi değiştirmez', () => {
    const result = queryJmesPath({ a: 1 }, '{"__proto__": a}') as Record<string, unknown>;
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(Object.keys(result)).toEqual(['__proto__']);
    expect(queryJmesPath({}, 'constructor')).toBeNull();
  });

  it('işlem bütçesi aşılınca durur', () => {
    const big = { a: Array.from({ length: 2000 }, (_, i) => i) };
    expect(queryJmesPath(big, 'length(a[*].[@, @])')).toBe(2000);
    const nested = { a: Array.from({ length: 2000 }, () => big.a) };
    expect(() => queryJmesPath(nested, 'a[*][*].[@, @]')).toThrow(/çok fazla işlem/);
  });

  it('çok derin iç içe ifade ToolError', () => {
    expect(() => queryJmesPath({}, '('.repeat(20_000) + 'a' + ')'.repeat(20_000))).toThrow(ToolError);
  });
});

describe('queryJmesPath sonuç boyutu', () => {
  it('paylaşılan alt değerlerle üstel büyüyen sonuç ToolError (serileştirme donmaz)', () => {
    const expression = Array(30).fill('{a: @, b: @}').join(' | ');
    expect(() => queryJmesPath({}, expression)).toThrow(/çok büyük/);
    expect(() => queryJmesPath({}, `${expression} | to_string(@)`)).toThrow(/çok büyük/);
  });

  it('büyük ama gerçek sonuç sınıra takılmaz', () => {
    const data = Array.from({ length: 300_000 }, (_, i) => ({ id: i }));
    expect((queryJmesPath(data, '@') as unknown[]).length).toBe(300_000);
  });
});

describe('English messages', () => {
  afterEach(() => setCoreLanguage('tr'));

  it('reports syntax and function errors in English', () => {
    registerCoreMessages('en', { toolsData: en });
    setCoreLanguage('en');
    expect(() => queryJmesPath({}, 'a.')).toThrow(JmesPathSyntaxError);
    expect(() => queryJmesPath({}, 'length(a, b)')).toThrow('length() takes exactly 1 argument(s), 2 given.');
    expect(() => queryJmesPath({}, 'foo()')).toThrow('At character 4: Unknown function: foo().');
  });
});
