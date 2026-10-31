import { describe, expect, it } from 'vitest';
import { diffJson } from './jsonDiff';

describe('diffJson', () => {
  it('aynı değerlerde boş; nesne anahtar sırası önemsiz', () => {
    expect(diffJson({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toEqual([]);
    expect(diffJson(null, null)).toEqual([]);
    expect(diffJson('x', 'x')).toEqual([]);
  });

  it('eklenen, silinen ve değişen alanlar', () => {
    const before = { user: { name: 'Ali', age: 30, city: 'İzmir' } };
    const after = { user: { name: 'Ali', age: 31, email: 'a@b.c' } };
    const changes = diffJson(before, after);
    expect(changes).toHaveLength(3);
    expect(changes).toContainEqual({ path: '$.user.age', kind: 'changed', before: 30, after: 31 });
    expect(changes).toContainEqual({ path: '$.user.city', kind: 'removed', before: 'İzmir' });
    expect(changes).toContainEqual({ path: '$.user.email', kind: 'added', after: 'a@b.c' });
  });

  it('tip değişimi changed olarak tek kayıt', () => {
    expect(diffJson({ a: { x: 1 } }, { a: [1] })).toEqual([
      { path: '$.a', kind: 'changed', before: { x: 1 }, after: [1] },
    ]);
    expect(diffJson({ a: 1 }, { a: '1' })).toEqual([{ path: '$.a', kind: 'changed', before: 1, after: '1' }]);
    expect(diffJson({ a: null }, { a: 0 })).toEqual([
      { path: '$.a', kind: 'changed', before: null, after: 0 },
    ]);
  });

  it('kökte değişim', () => {
    expect(diffJson(1, 2)).toEqual([{ path: '$', kind: 'changed', before: 1, after: 2 }]);
  });

  it('diziler varsayılan olarak indeks indeks', () => {
    expect(diffJson({ tags: ['a', 'b'] }, { tags: ['a', 'c', 'd'] })).toEqual([
      { path: '$.tags[1]', kind: 'changed', before: 'b', after: 'c' },
      { path: '$.tags[2]', kind: 'added', after: 'd' },
    ]);
    expect(diffJson([1, 2, 3], [1])).toEqual([
      { path: '$[1]', kind: 'removed', before: 2 },
      { path: '$[2]', kind: 'removed', before: 3 },
    ]);
  });

  it('ignoreArrayOrder ile sıra farkı yok sayılır, çokluk korunur', () => {
    expect(diffJson([1, 2, 3], [3, 1, 2], { ignoreArrayOrder: true })).toEqual([]);
    expect(diffJson([{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 1 }], { ignoreArrayOrder: true })).toEqual([]);
    expect(diffJson([1, 2, 3], [3, 1, 2])).not.toEqual([]);

    const changes = diffJson([1, 1, 2], [1, 2, 2], { ignoreArrayOrder: true });
    expect(changes.map((c) => c.kind).sort()).toEqual(['added', 'removed']);
    expect(changes.find((c) => c.kind === 'removed')?.before).toBe(1);
    expect(changes.find((c) => c.kind === 'added')?.after).toBe(2);
  });

  it('özel karakterli anahtarlar köşeli parantezle kaçışlanır', () => {
    const changes = diffJson({ 'a.b': 1, 'x y': 1, "o'k": 1 }, { 'a.b': 2, 'x y': 2, "o'k": 2 });
    const paths = changes.map((c) => c.path);
    expect(paths).toContain("$['a.b']");
    expect(paths).toContain("$['x y']");
    expect(paths.some((p) => p.startsWith('$[') && p.includes('o') && p.includes('k'))).toBe(true);
  });

  it('sonuç belge sırasında', () => {
    const changes = diffJson({ a: 1, b: { c: 1 }, d: 1 }, { a: 2, b: { c: 2 }, d: 2 });
    expect(changes.map((c) => c.path)).toEqual(['$.a', '$.b.c', '$.d']);
  });

  it('derin iç içe yol', () => {
    expect(diffJson({ a: [{ b: { c: [0, 1] } }] }, { a: [{ b: { c: [0, 5] } }] })).toEqual([
      { path: '$.a[0].b.c[1]', kind: 'changed', before: 1, after: 5 },
    ]);
  });
});
