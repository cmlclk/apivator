import { useCallback, useRef, useState } from 'react';
import { Check, ChevronDown, Layers, Settings2 } from 'lucide-react';
import { cn } from '@apivator/ui';
import { useDismiss } from '../../components/useDismiss';
import { useT } from '../../i18n';
import { useWorkspaces } from '../../lib/useWorkspaces';
import { useUi } from '../../stores/ui';
import { useEnvironmentStore } from './environmentStore';
import { useActiveEnvironment, useEnvironments } from './useVariables';

/** Üst bardaki aktif environment seçici. */
export function EnvironmentSwitcher() {
  const t = useT('environments');
  const { current } = useWorkspaces();
  const workspaceId = current?.id;
  const { data: environments = [] } = useEnvironments(workspaceId);
  const active = useActiveEnvironment(workspaceId);
  const setActive = useEnvironmentStore((s) => s.setActive);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);

  if (!workspaceId) return null;

  const choose = (id: string | null) => {
    setActive(workspaceId, id);
    close();
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('switcher.active')}
        className={cn(
          'flex h-8 w-52 items-center gap-2 rounded-md border px-2.5 text-[13px]',
          active ? 'border-accent/40 bg-accent/5 text-fg' : 'border-line text-fg-subtle hover:text-fg',
        )}
      >
        <Layers className={cn('h-3.5 w-3.5 shrink-0', active ? 'text-accent' : '')} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-start">{active?.name ?? t('switcher.none')}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-fg-subtle" aria-hidden="true" />
      </button>
      {open && (
        <div
          role="listbox"
          aria-label={t('switcher.list')}
          className="absolute end-0 top-full z-30 mt-1 w-64 rounded-lg border border-line bg-surface p-1 shadow-lg"
        >
          {[{ id: null as string | null, name: t('switcher.none') }, ...environments].map((env) => {
            const selected = (active?.id ?? null) === env.id;
            return (
              <button
                key={env.id ?? 'none'}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => choose(env.id)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-start text-sm hover:bg-muted',
                  env.id === null && 'text-fg-subtle',
                )}
              >
                <span className="min-w-0 flex-1 truncate">{env.name}</span>
                {selected && <Check className="h-4 w-4 text-accent" aria-hidden="true" />}
              </button>
            );
          })}
          <div className="my-1 border-t border-line" />
          <button
            type="button"
            onClick={() => {
              useUi.getState().setSidebarSection('environments');
              close();
            }}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-start text-sm text-fg-muted hover:bg-muted hover:text-fg"
          >
            <Settings2 className="h-3.5 w-3.5" aria-hidden="true" /> {t('switcher.manage')}
          </button>
        </div>
      )}
    </div>
  );
}
