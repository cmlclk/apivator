import { lazy, Suspense, useCallback, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Building2, Check, ChevronDown, Lock, Plus, Settings, Users } from 'lucide-react';
import { cn, Spinner } from '@apivator/ui';
import type { WorkspaceDto } from '@apivator/core';
import { useWorkspaces } from '../lib/useWorkspaces';
import { groupWorkspaces, WORKSPACE_ROLE_LABELS } from '../lib/teams';
import { useUi } from '../stores/ui';
import { useT } from '../i18n';
import { useDismiss } from './useDismiss';
import { CreateWorkspaceDialog } from './CreateWorkspaceDialog';

// Ayarlar diyaloğu yalnızca açılınca yüklenir.
const WorkspaceSettingsDialog = lazy(() =>
  import('./WorkspaceSettingsDialog').then((m) => ({ default: m.WorkspaceSettingsDialog })),
);

function WorkspaceIcon({ workspace }: { workspace: WorkspaceDto }) {
  const Icon = workspace.type === 'Personal' ? Lock : Users;
  return <Icon className="h-3.5 w-3.5 shrink-0 text-fg-subtle" aria-hidden="true" />;
}

const itemClass =
  'flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-start text-sm hover:bg-muted';

export function WorkspaceSwitcher() {
  const t = useT('shell');
  const { workspaces, current, isLoading } = useWorkspaces();
  const setCurrent = useUi((s) => s.setCurrentWorkspaceId);
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<'settings' | 'create' | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);

  if (isLoading) return <Spinner className="h-4 w-4 text-fg-subtle" />;
  if (!current) return null;

  const groups = groupWorkspaces(workspaces);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex h-8 items-center gap-2 rounded-md px-2.5 text-sm font-medium hover:bg-muted"
      >
        <WorkspaceIcon workspace={current} />
        <span className="max-w-48 truncate">{current.name}</span>
        {current.type === 'Team' && (
          <span className="hidden max-w-32 truncate text-xs font-normal text-fg-subtle md:inline">
            {current.organizationName}
          </span>
        )}
        <ChevronDown className="h-3.5 w-3.5 text-fg-subtle" aria-hidden="true" />
      </button>

      {open && (
        <div className="absolute start-0 top-full z-20 mt-1 w-80 rounded-lg border border-line bg-surface p-1 shadow-lg">
          <div role="listbox" aria-label={t('workspaceSwitcher.list')} className="max-h-[60vh] overflow-auto">
            {groups.map((group) => (
              <div key={group.personal ? 'personal' : group.name} role="group" aria-label={group.name}>
                <p className="px-2.5 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
                  {group.personal ? t('workspaceSwitcher.personal') : group.name}
                </p>
                {group.items.map((w) => (
                  <button
                    key={w.id}
                    type="button"
                    role="option"
                    aria-selected={w.id === current.id}
                    onClick={() => {
                      setCurrent(w.id);
                      close();
                      if (location.pathname !== '/') navigate('/');
                    }}
                    className={cn(itemClass, w.id === current.id && 'bg-muted')}
                  >
                    <WorkspaceIcon workspace={w} />
                    <span className="flex-1 truncate">{w.name}</span>
                    {w.type === 'Team' && (
                      <span className="text-[11px] text-fg-subtle">{WORKSPACE_ROLE_LABELS[w.role]}</span>
                    )}
                    {w.id === current.id && <Check className="h-4 w-4 text-accent" aria-hidden="true" />}
                  </button>
                ))}
              </div>
            ))}
          </div>
          <div className="mt-1 border-t border-line pt-1">
            <button
              type="button"
              className={cn(itemClass, 'text-fg-muted')}
              onClick={() => {
                close();
                setDialog('settings');
              }}
            >
              <Settings className="h-3.5 w-3.5" /> {t('workspaceSwitcher.settings', { name: current.name })}
            </button>
            <button
              type="button"
              className={cn(itemClass, 'text-fg-muted')}
              onClick={() => {
                close();
                setDialog('create');
              }}
            >
              <Plus className="h-3.5 w-3.5" /> {t('workspaceSwitcher.create')}
            </button>
            <button
              type="button"
              className={cn(itemClass, 'text-fg-muted')}
              onClick={() => {
                close();
                navigate('/team');
              }}
            >
              <Building2 className="h-3.5 w-3.5" /> {t('workspaceSwitcher.team')}
            </button>
          </div>
        </div>
      )}
      {dialog === 'settings' && (
        <Suspense fallback={null}>
          <WorkspaceSettingsDialog workspace={current} onClose={() => setDialog(null)} />
        </Suspense>
      )}
      {dialog === 'create' && (
        <CreateWorkspaceDialog
          organizationId={current.type === 'Team' ? current.organizationId : undefined}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
