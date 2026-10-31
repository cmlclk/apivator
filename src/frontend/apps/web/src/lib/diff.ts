import { normalizeDefinition, type RequestDefinition } from '@apivator/core';

export type DiffLine = { kind: 'same' | 'added' | 'removed'; text: string };

/** Satır bazında fark (LCS). Küçük metinler için; çok uzun girdide yalnızca değişen blok gösterilir. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before === '' ? [] : before.split('\n');
  const b = after === '' ? [] : after.split('\n');
  // Ortak baş ve son satırları ayırmak, büyük gövdelerde tabloyu küçültür.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);

  const lines: DiffLine[] = a.slice(0, start).map((text) => ({ kind: 'same', text }));
  if (midA.length * midB.length > 250_000) {
    // Yayma (...) ~120 bin elemanda yığın taşırır; büyük farklarda tek tek eklenir.
    for (const text of midA) lines.push({ kind: 'removed', text });
    for (const text of midB) lines.push({ kind: 'added', text });
  } else {
    const table = Array.from({ length: midA.length + 1 }, () => new Array<number>(midB.length + 1).fill(0));
    for (let i = midA.length - 1; i >= 0; i--) {
      for (let j = midB.length - 1; j >= 0; j--) {
        table[i]![j] =
          midA[i] === midB[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
      }
    }
    let i = 0;
    let j = 0;
    while (i < midA.length || j < midB.length) {
      if (i < midA.length && j < midB.length && midA[i] === midB[j]) {
        lines.push({ kind: 'same', text: midA[i]! });
        i++;
        j++;
      } else if (i < midA.length && (j >= midB.length || table[i + 1]![j]! >= table[i]![j + 1]!)) {
        // Eşitlikte önce silinen satır: alışılmış "−eski / +yeni" sırası.
        lines.push({ kind: 'removed', text: midA[i]! });
        i++;
      } else {
        lines.push({ kind: 'added', text: midB[j]! });
        j++;
      }
    }
  }
  for (let k = endA; k < a.length; k++) lines.push({ kind: 'same', text: a[k]! });
  return lines;
}

export interface SectionDiff {
  label: string;
  lines: DiffLine[];
}

const SECTIONS: { label: string; pick: (name: string, d: RequestDefinition) => unknown }[] = [
  { label: 'Ad', pick: (name) => name },
  { label: 'Metod ve URL', pick: (_, d) => `${d.method} ${d.url}` },
  {
    label: 'Header',
    // Kapalı satırlar "#" ile gösterilir (toplu düzenleme görünümündeki gibi).
    pick: (_, d) => d.headers.map((h) => `${h.enabled ? '' : '# '}${h.key}: ${h.value}`).join('\n'),
  },
  { label: 'Body', pick: (_, d) => d.body },
  { label: 'Yetkilendirme', pick: (_, d) => d.auth },
  { label: 'Pre-request script', pick: (_, d) => d.scripts.preRequest },
  { label: 'Post-response script', pick: (_, d) => d.scripts.postResponse },
];

const asText = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value, null, 2));

/** İki istek sürümü arasında değişen bölümler ("sizin" → "onların"). */
export function requestDiff(
  mine: { name: string; definition: RequestDefinition },
  theirs: { name: string; definition: RequestDefinition },
): SectionDiff[] {
  const a = normalizeDefinition(mine.definition);
  const b = normalizeDefinition(theirs.definition);
  return SECTIONS.flatMap(({ label, pick }) => {
    const before = asText(pick(mine.name, a));
    const after = asText(pick(theirs.name, b));
    return before === after ? [] : [{ label, lines: diffLines(before, after) }];
  });
}
