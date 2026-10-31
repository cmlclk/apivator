import { cn } from '@apivator/ui';
import type { JsonChange } from '@apivator/core/tools';
import { useT } from '../../i18n';
import type { NumberedLine } from './diffText';

/** Ekranda gösterilen en fazla fark satırı; daha uzun farklarda kalanı özetlenir. */
const MAX_ROWS = 5000;

const ROW_TONE = {
  same: '',
  removed: 'bg-danger/10 text-danger',
  added: 'bg-success/10 text-success',
} as const;
const SIGN = { same: ' ', removed: '−', added: '+' } as const;

function Num({ n }: { n?: number }) {
  return <td className="w-10 select-none pe-2 text-end align-top text-fg-subtle">{n ?? ''}</td>;
}

function Truncated({ total }: { total: number }) {
  const t = useT('tools');
  if (total <= MAX_ROWS) return null;
  return <p className="px-2 py-1 text-xs text-fg-subtle">{t('diff.truncated', { max: MAX_ROWS, total })}</p>;
}

export function UnifiedDiff({ lines }: { lines: NumberedLine[] }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto rounded-md border border-line">
      <table className="w-full border-collapse font-mono text-xs">
        <tbody>
          {lines.slice(0, MAX_ROWS).map((line, index) => (
            <tr key={index} className={ROW_TONE[line.kind]}>
              <Num n={line.left} />
              <Num n={line.right} />
              <td className="w-4 select-none align-top">{SIGN[line.kind]}</td>
              <td className="whitespace-pre-wrap break-all">{line.text}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Truncated total={lines.length} />
    </div>
  );
}

/** Yan yana: ardışık silinen ve eklenen bloklar aynı satırlarda eşlenir. */
export function SideBySideDiff({ lines }: { lines: NumberedLine[] }) {
  const rows: [NumberedLine | null, NumberedLine | null][] = [];
  for (let k = 0; k < lines.length;) {
    const line = lines[k]!;
    if (line.kind === 'same') {
      rows.push([line, line]);
      k++;
      continue;
    }
    const removed: NumberedLine[] = [];
    const added: NumberedLine[] = [];
    while (k < lines.length && lines[k]!.kind === 'removed') removed.push(lines[k++]!);
    while (k < lines.length && lines[k]!.kind === 'added') added.push(lines[k++]!);
    for (let r = 0; r < Math.max(removed.length, added.length); r++)
      rows.push([removed[r] ?? null, added[r] ?? null]);
  }
  const cell = (line: NumberedLine | null, side: 'left' | 'right') => (
    <>
      <Num n={line?.[side]} />
      <td
        className={cn(
          'w-1/2 whitespace-pre-wrap break-all border-line align-top',
          side === 'left' && 'border-e',
          line ? ROW_TONE[line.kind] : 'bg-muted/40',
        )}
      >
        {line?.text}
      </td>
    </>
  );
  return (
    <div className="min-h-0 flex-1 overflow-auto rounded-md border border-line">
      <table className="w-full table-fixed border-collapse font-mono text-xs">
        <colgroup>
          <col className="w-10" />
          <col />
          <col className="w-10" />
          <col />
        </colgroup>
        <tbody>
          {rows.slice(0, MAX_ROWS).map(([left, right], index) => (
            <tr key={index}>
              {cell(left, 'left')}
              {cell(right, 'right')}
            </tr>
          ))}
        </tbody>
      </table>
      <Truncated total={rows.length} />
    </div>
  );
}

const KIND_TONE = { added: 'text-success', removed: 'text-danger', changed: 'text-warning' } as const;

function short(value: unknown): string {
  const text = JSON.stringify(value) ?? 'undefined';
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}

export function JsonChangeList({ changes }: { changes: JsonChange[] }) {
  const t = useT('tools');
  const kindLabel = { added: t('diff.added'), removed: t('diff.removed'), changed: t('diff.changed') };
  return (
    <div className="min-h-0 flex-1 overflow-auto rounded-md border border-line">
      <ul className="divide-y divide-line font-mono text-xs">
        {changes.slice(0, MAX_ROWS).map((change, index) => (
          <li key={index} className="flex flex-wrap items-baseline gap-x-2 px-2 py-1">
            <span className={cn('w-16 shrink-0 font-sans font-medium', KIND_TONE[change.kind])}>
              {kindLabel[change.kind]}
            </span>
            <span className="break-all text-fg">{change.path}</span>
            <span className="min-w-0 break-all text-fg-muted">
              {change.kind === 'added' && short(change.after)}
              {change.kind === 'removed' && short(change.before)}
              {change.kind === 'changed' && (
                <>
                  <span className="text-danger">{short(change.before)}</span> →{' '}
                  <span className="text-success">{short(change.after)}</span>
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
      <Truncated total={changes.length} />
    </div>
  );
}
