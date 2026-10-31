import { describe, expect, it } from 'vitest';
import { emptyDefinition } from '@apivator/core';
import { diffLines, requestDiff } from './diff';

describe('diffLines', () => {
  it('eklenen, silinen ve aynı kalan satırları ayırır', () => {
    expect(diffLines('a\nb\nc', 'a\nx\nc')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'removed', text: 'b' },
      { kind: 'added', text: 'x' },
      { kind: 'same', text: 'c' },
    ]);
  });

  it('aynı metinde fark yok', () => {
    expect(diffLines('a\nb', 'a\nb').every((l) => l.kind === 'same')).toBe(true);
  });
});

describe('requestDiff', () => {
  it('yalnızca değişen bölümleri listeler', () => {
    const mine = { name: 'Liste', definition: { ...emptyDefinition(), url: 'https://a.test' } };
    const theirs = {
      name: 'Liste',
      definition: {
        ...emptyDefinition(),
        url: 'https://b.test',
        headers: [{ key: 'X-Id', value: '1', enabled: false }],
      },
    };
    const sections = requestDiff(mine, theirs);
    expect(sections.map((s) => s.label)).toEqual(['Metod ve URL', 'Header']);
    expect(sections[1]!.lines).toEqual([{ kind: 'added', text: '# X-Id: 1' }]);
  });
});
