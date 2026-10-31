import {
  emptyDefinition,
  type ForkChangeDto,
  type ForkSnapshot,
  type MergeRequestStatus,
} from '@apivator/core';
import { translate } from '../../i18n';
import { diffLines, requestDiff, type SectionDiff } from '../../lib/diff';

const asText = (value: unknown) =>
  value === null || value === undefined
    ? ''
    : typeof value === 'string'
      ? value
      : JSON.stringify(value, null, 2);

function section(label: string, before: unknown, after: unknown): SectionDiff[] {
  const a = asText(before);
  const b = asText(after);
  return a === b ? [] : [{ label, lines: diffLines(a, b) }];
}

/** İki anlık görüntü arasındaki farklı bölümler (önce → sonra). Eklenen/silinen öğede taraflardan biri null. */
export function snapshotDiff(
  kind: ForkChangeDto['kind'],
  before: ForkSnapshot | null,
  after: ForkSnapshot | null,
): SectionDiff[] {
  if (kind === 'Request') {
    const sections = requestDiff(
      { name: before?.name ?? '', definition: before?.definition ?? emptyDefinition() },
      { name: after?.name ?? '', definition: after?.definition ?? emptyDefinition() },
    );
    const examples = (s: ForkSnapshot | null) =>
      (s?.examples ?? []).map((e) => `# ${e.name} (${e.status})\n${e.body}`).join('\n\n');
    sections.push(...section(translate('forks', 'diff.examples'), examples(before), examples(after)));
    if (before && after && before.parent !== after.parent)
      sections.push({
        label: translate('forks', 'diff.location'),
        lines: [{ kind: 'added', text: translate('forks', 'diff.movedToFolder') }],
      });
    return sections;
  }
  return [
    ...(kind === 'Folder' ? section(translate('forks', 'diff.name'), before?.name, after?.name) : []),
    ...(kind === 'Collection'
      ? section(translate('forks', 'diff.description'), before?.description, after?.description)
      : []),
    ...section(translate('forks', 'diff.auth'), before?.auth, after?.auth),
    ...(kind === 'Collection'
      ? section(translate('forks', 'diff.variables'), before?.variables, after?.variables)
      : []),
    ...section(translate('forks', 'diff.scripts'), before?.scripts, after?.scripts),
    ...(kind === 'Folder' && before && after && before.parent !== after.parent
      ? [
          {
            label: translate('forks', 'diff.location'),
            lines: [{ kind: 'added' as const, text: translate('forks', 'diff.movedToFolder') }],
          },
        ]
      : []),
  ];
}

// Dışa açık etiket haritaları dil değişince doğru kalsın diye erişim anında çevrilir.
export const changeLabel = {
  get Added() {
    return translate('forks', 'change.added');
  },
  get Modified() {
    return translate('forks', 'change.modified');
  },
  get Removed() {
    return translate('forks', 'change.removed');
  },
} as const;
export const kindLabel = {
  get Collection() {
    return translate('forks', 'kind.collection');
  },
  get Folder() {
    return translate('forks', 'kind.folder');
  },
  get Request() {
    return translate('forks', 'kind.request');
  },
} as const;

export const statusLabel: Record<MergeRequestStatus, string> = {
  get Open() {
    return translate('forks', 'status.open');
  },
  get Merged() {
    return translate('forks', 'status.merged');
  },
  get Declined() {
    return translate('forks', 'status.declined');
  },
  get Closed() {
    return translate('forks', 'status.closed');
  },
};
