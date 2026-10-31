import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@apivator/ui';
import { useT } from '../../i18n';

/** Bir düğümde ilk seferde gösterilen en fazla çocuk; büyük belgelerde sayfa donmasın. */
const PAGE = 200;

function Scalar({ value }: { value: unknown }) {
  if (value === null) return <span className="text-fg-subtle">null</span>;
  if (typeof value === 'string')
    return (
      <span className="break-all text-success">
        "{value.length > 500 ? `${value.slice(0, 500)}…` : value}"
      </span>
    );
  if (typeof value === 'number') return <span className="text-accent">{String(value)}</span>;
  if (typeof value === 'boolean') return <span className="text-warning">{String(value)}</span>;
  return <span>{String(value)}</span>;
}

function TreeNode({
  name,
  value,
  depth,
  openDepth,
}: {
  name: string | number | null;
  value: unknown;
  depth: number;
  openDepth: number;
}) {
  const container = typeof value === 'object' && value !== null;
  const [open, setOpen] = useState(depth < openDepth);
  const [limit, setLimit] = useState(PAGE);
  const t = useT('tools');
  const label =
    name === null ? null : (
      <span className={typeof name === 'number' ? 'text-fg-subtle' : 'text-fg'}>
        {typeof name === 'number' ? name : `"${name}"`}
        <span className="text-fg-subtle">: </span>
      </span>
    );

  if (!container) {
    return (
      <div className="ps-4">
        {label}
        <Scalar value={value} />
      </div>
    );
  }

  const isArray = Array.isArray(value);
  const entries: [string | number, unknown][] = isArray
    ? value.map((v, i) => [i, v])
    : Object.entries(value as Record<string, unknown>);
  const summary = isArray ? `[${entries.length}]` : `{${entries.length}}`;
  return (
    <div>
      <button
        type="button"
        className="flex items-center gap-0.5 rounded text-start hover:bg-muted"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        {open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
        {label}
        <span className="text-fg-subtle">{summary}</span>
      </button>
      {open && (
        <div className="ms-1.5 border-s border-line ps-1.5">
          {entries.slice(0, limit).map(([key, child]) => (
            <TreeNode key={key} name={key} value={child} depth={depth + 1} openDepth={openDepth} />
          ))}
          {entries.length > limit && (
            <button
              type="button"
              className="ps-4 text-accent hover:underline"
              onClick={() => setLimit(limit + PAGE)}
            >
              {t('tree.showMore', { count: entries.length - limit })}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Daraltılabilir JSON ağacı; `openDepth` seviyeye kadar açık başlar. */
export function JsonTree({
  value,
  openDepth = 2,
  className,
}: {
  value: unknown;
  openDepth?: number;
  className?: string;
}) {
  return (
    <div className={cn('overflow-auto p-2 font-mono text-xs leading-relaxed', className)}>
      <TreeNode name={null} value={value} depth={0} openDepth={openDepth} />
    </div>
  );
}
