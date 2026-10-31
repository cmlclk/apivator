import { useCallback, useRef, useState, type ReactNode } from 'react';
import { MoreHorizontal, type LucideIcon } from 'lucide-react';
import { cn } from '@apivator/ui';
import { useDismiss } from '../useDismiss';

export interface MenuItem {
  label: string;
  icon?: LucideIcon;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

/** "…" düğmesiyle açılan küçük işlem menüsü. */
export function Menu({ items, label, className }: { items: MenuItem[]; label: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className={cn(
          'flex h-6 w-6 items-center justify-center rounded text-fg-subtle hover:bg-line hover:text-fg',
          open && 'bg-line text-fg',
        )}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute end-0 top-full z-30 mt-1 w-max min-w-44 max-w-80 rounded-lg border border-line bg-surface p-1 shadow-lg"
        >
          {items.map(({ label: itemLabel, icon: Icon, onSelect, danger, disabled }) => (
            <button
              key={itemLabel}
              type="button"
              role="menuitem"
              disabled={disabled}
              onClick={(e) => {
                e.stopPropagation();
                close();
                onSelect();
              }}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-start text-sm whitespace-nowrap disabled:opacity-50',
                danger ? 'text-danger hover:bg-danger/10' : 'text-fg-muted hover:bg-muted hover:text-fg',
              )}
            >
              {Icon && <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
              {itemLabel}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function MenuDivider(): ReactNode {
  return <div className="my-1 border-t border-line" />;
}
