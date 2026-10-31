import { CloudUpload, Plus, X } from 'lucide-react';
import { cn } from '@apivator/ui';
import { useT } from '../../i18n';
import { methodColor, methodLabel } from './methodColors';
import { isDirty, useTabs, type RequestTab } from './tabsStore';

export function TabBar({
  tabs,
  activeId,
  onNew,
}: {
  tabs: RequestTab[];
  activeId: string | null;
  onNew: () => void;
}) {
  const t = useT('requests');
  const { activate, close } = useTabs.getState();

  return (
    <div className="flex h-10 shrink-0 items-stretch border-b border-line bg-surface">
      <div role="tablist" aria-label={t('tabs.open')} className="flex min-w-0 overflow-x-auto">
        {tabs.map((tab) => {
          const active = tab.id === activeId;
          const dirty = isDirty(tab);
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={active}
              tabIndex={0}
              onClick={() => activate(tab.id)}
              onKeyDown={(e) => e.key === 'Enter' && activate(tab.id)}
              onAuxClick={(e) => e.button === 1 && close(tab.id)}
              className={cn(
                'group relative flex w-44 shrink-0 cursor-pointer items-center gap-2 border-e border-line px-3 text-xs',
                active ? 'bg-bg text-fg' : 'text-fg-muted hover:bg-muted/60',
              )}
            >
              {active && <span className="absolute inset-x-0 top-0 h-0.5 bg-accent" />}
              <span
                className={cn(
                  'shrink-0 font-mono text-[10.5px] font-bold',
                  methodColor(tab.draft.method, tab.draft.kind),
                )}
              >
                {methodLabel(tab.draft.method, tab.draft.kind)}
              </span>
              <span className="min-w-0 flex-1 truncate">{tab.name}</span>
              {tab.pendingSave && (
                <CloudUpload
                  className="h-3.5 w-3.5 shrink-0 text-warning"
                  aria-label={t('tabs.pendingSave')}
                />
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  close(tab.id);
                }}
                aria-label={t('tabs.closeNamed', { name: tab.name })}
                className="relative flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-line"
              >
                {dirty && (
                  <span
                    className="absolute h-2 w-2 rounded-full bg-accent group-hover:hidden"
                    aria-label={t('tabs.unsaved')}
                  />
                )}
                <X
                  className={cn(
                    'h-3.5 w-3.5',
                    dirty ? 'hidden group-hover:block' : 'opacity-0 group-hover:opacity-100',
                  )}
                />
              </button>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        onClick={onNew}
        aria-label={t('tabs.newTabLabel')}
        title={t('tabs.newTabTitle')}
        className="flex w-10 shrink-0 items-center justify-center text-fg-subtle hover:bg-muted hover:text-fg"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}
