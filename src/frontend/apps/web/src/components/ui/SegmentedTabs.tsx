import { cn } from '@apivator/ui';

export interface SegmentedTab<T extends string> {
  id: T;
  label: string;
  badge?: number | string | null;
}

/** İstek editörü ve yanıt panelindeki alt sekmeler (Params / Headers / Body ...). */
export function SegmentedTabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: SegmentedTab<T>[];
  value: T;
  onChange: (id: T) => void;
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-4">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === value}
          onClick={() => onChange(tab.id)}
          className={cn(
            '-mb-px flex items-center gap-1.5 border-b-2 px-0.5 py-2 text-[13px] font-medium',
            tab.id === value
              ? 'border-accent text-fg'
              : 'border-transparent text-fg-subtle hover:text-fg-muted',
          )}
        >
          {tab.label}
          {tab.badge ? (
            <span className="rounded bg-muted px-1.5 text-[11px] font-semibold text-fg-muted">
              {tab.badge}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
