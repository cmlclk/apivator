import { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Minus, PenLine, Plus } from 'lucide-react';
import { cn } from '@apivator/ui';
import type { ForkChangeDto, ForkChangeType } from '@apivator/core';
import { useT } from '../../i18n';
import { DiffSections } from '../activity/DiffSections';
import { changeLabel, kindLabel, snapshotDiff } from './forkDiff';

export type Winner = 'source' | 'fork';

function ChangeIcon({ change }: { change: ForkChangeType }) {
  const Icon = change === 'Added' ? Plus : change === 'Removed' ? Minus : PenLine;
  return (
    <Icon
      className={cn(
        'h-3.5 w-3.5 shrink-0',
        change === 'Added' ? 'text-success' : change === 'Removed' ? 'text-danger' : 'text-warning',
      )}
      aria-hidden="true"
    />
  );
}

/**
 * Değişiklik listesi. "outgoing": fork'ta yapılanlar (taban → fork), "incoming": kaynakta yapılanlar
 * (taban → kaynak). Çakışmalarda iki tarafın farkı da gösterilir; <paramref name="onResolve"/> verilirse seçim
 * yapılır.
 */
export function ChangeList({
  changes,
  direction,
  resolutions,
  onResolve,
  empty,
}: {
  changes: ForkChangeDto[];
  direction: 'outgoing' | 'incoming';
  resolutions?: Record<string, Winner>;
  onResolve?: (key: string, winner: Winner) => void;
  empty: string;
}) {
  const t = useT('forks');
  const [open, setOpen] = useState<string | null>(null);
  const shown = changes.filter((c) => (direction === 'outgoing' ? c.forkChange : c.sourceChange) !== null);
  if (shown.length === 0) return <p className="py-3 text-[13px] text-fg-subtle">{empty}</p>;

  return (
    <ul className="divide-y divide-line rounded-md border border-line">
      {shown.map((c) => {
        const change = (direction === 'outgoing' ? c.forkChange : c.sourceChange)!;
        const expanded = open === c.key;
        const after = direction === 'outgoing' ? c.fork : c.source;
        return (
          <li key={c.key}>
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setOpen(expanded ? null : c.key)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-start text-[13px] hover:bg-muted/60"
            >
              {expanded ? (
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
              )}
              <ChangeIcon change={change} />
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{c.kind === 'Collection' ? kindLabel.Collection : c.name}</span>
                <span className="text-fg-subtle">
                  {' '}
                  · {c.kind !== 'Collection' && `${kindLabel[c.kind]} `}
                  {changeLabel[change]}
                  {c.path && ` · ${c.path}`}
                </span>
              </span>
              {c.conflict && (
                <span className="flex shrink-0 items-center gap-1 rounded bg-warning/15 px-1.5 py-0.5 text-[11px] font-medium text-warning">
                  <AlertTriangle className="h-3 w-3" aria-hidden="true" /> {t('changes.conflict')}
                </span>
              )}
            </button>
            {c.conflict && onResolve && (
              <fieldset className="flex flex-wrap items-center gap-4 border-t border-line bg-warning/5 px-9 py-1.5 text-[12.5px]">
                <legend className="sr-only">{t('changes.keepWhich', { name: c.name })}</legend>
                <span className="text-fg-muted">{t('changes.changedBothSides')}</span>
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name={`resolve-${c.key}`}
                    checked={resolutions?.[c.key] === 'source'}
                    onChange={() => onResolve(c.key, 'source')}
                  />
                  {t('changes.takeSource')}
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name={`resolve-${c.key}`}
                    checked={resolutions?.[c.key] === 'fork'}
                    onChange={() => onResolve(c.key, 'fork')}
                  />
                  {t('changes.keepMine')}
                </label>
              </fieldset>
            )}
            {expanded && (
              <div className="flex flex-col gap-3 border-t border-line px-9 py-3">
                {c.conflict ? (
                  <>
                    <h4 className="text-xs font-semibold text-fg-muted">{t('changes.inSource')}</h4>
                    <DiffSections
                      sections={snapshotDiff(c.kind, c.base, c.source)}
                      empty={t('changes.deleted')}
                    />
                    <h4 className="text-xs font-semibold text-fg-muted">{t('changes.inFork')}</h4>
                    <DiffSections
                      sections={snapshotDiff(c.kind, c.base, c.fork)}
                      empty={t('changes.deleted')}
                    />
                  </>
                ) : (
                  <DiffSections
                    sections={snapshotDiff(c.kind, c.base, after)}
                    empty={change === 'Removed' ? t('changes.itemDeleted') : t('changes.noVisibleDiff')}
                  />
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
