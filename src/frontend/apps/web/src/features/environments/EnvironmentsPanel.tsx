import { lazy, Suspense, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Download, Globe, History, Layers, Pencil, Plus, Trash2, Upload, Zap } from 'lucide-react';
import { Alert, Button, Spinner, cn } from '@apivator/ui';
import type { EnvironmentDto } from '@apivator/core';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useT } from '../../i18n';
import { Menu } from '../../components/ui/Menu';
import { api } from '../../lib/api';
import { saveFile } from '../../lib/download';
import { errorMessage } from '../../lib/errors';
import { useWorkspaces } from '../../lib/useWorkspaces';
import { scopeKeys, useEnvironmentStore } from './environmentStore';
import { environmentsQueryKey, globalsQueryKey, useEnvironments, useGlobals } from './useVariables';
import { VariablesDialog } from './VariablesDialog';
import { EnvironmentVersionsDialog } from '../activity/EnvironmentVersionsDialog';

// İçe aktarma (ayrıştırıcılar) yalnızca açılınca yüklenir.
const ImportDialog = lazy(() =>
  import('../importExport/ImportDialog').then((m) => ({ default: m.ImportDialog })),
);

type Editing = { kind: 'environment'; environment: EnvironmentDto } | { kind: 'globals' } | { kind: 'new' };

export function EnvironmentsPanel() {
  const t = useT('environments');
  const { current } = useWorkspaces();
  const workspaceId = current?.id;
  const queryClient = useQueryClient();
  const { data: environments, isLoading, error } = useEnvironments(workspaceId);
  const { data: globals } = useGlobals(workspaceId);
  const activeId = useEnvironmentStore((s) => (workspaceId ? (s.active[workspaceId] ?? null) : null));
  const currentValues = useEnvironmentStore((s) => s.currentValues);
  const { setActive, setCurrentValues, forgetScope } = useEnvironmentStore.getState();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [deleting, setDeleting] = useState<EnvironmentDto | null>(null);
  const [importing, setImporting] = useState(false);
  const [versionsOf, setVersionsOf] = useState<EnvironmentDto | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const exportEnvironment = async (env: EnvironmentDto) => {
    setExportError(null);
    try {
      await saveFile(await api.importExport.exportEnvironment(env.id));
    } catch (e) {
      setExportError(errorMessage(e));
    }
  };
  const canEdit = current?.role !== 'Viewer';

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: environmentsQueryKey(workspaceId) }),
      queryClient.invalidateQueries({ queryKey: globalsQueryKey(workspaceId) }),
    ]);

  return (
    <section
      aria-label={t('panel.title')}
      className="flex w-72 shrink-0 flex-col border-e border-line bg-surface"
    >
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-line px-3">
        <h2 className="text-sm font-semibold">{t('panel.title')}</h2>
        <div className="flex items-center">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setImporting(true)}
            disabled={!workspaceId || !canEdit}
            title={t('panel.importTitle')}
            aria-label={t('panel.import')}
          >
            <Upload className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setEditing({ kind: 'new' })}
            disabled={!workspaceId || !canEdit}
            title={t('panel.new')}
            aria-label={t('panel.new')}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {exportError && (
        <Alert tone="error" className="m-2 text-xs">
          {exportError}
        </Alert>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        <button
          type="button"
          onClick={() => setEditing({ kind: 'globals' })}
          className="flex h-8 w-full items-center gap-2 px-3 text-start text-[13px] text-fg-muted hover:bg-muted hover:text-fg"
        >
          <Globe className="h-3.5 w-3.5 text-fg-subtle" aria-hidden="true" />
          <span className="flex-1">{t('globals.title')}</span>
          <span className="text-xs text-fg-subtle">{globals?.variables.length ?? 0}</span>
        </button>
        <div className="mx-3 my-1 border-t border-line" />

        {isLoading && (
          <div className="flex justify-center py-6 text-fg-subtle">
            <Spinner className="h-4 w-4" />
          </div>
        )}
        {error && (
          <Alert tone="error" className="m-2 text-xs">
            {errorMessage(error)}
          </Alert>
        )}

        {environments?.length === 0 && (
          <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
            <Layers className="h-8 w-8 text-fg-subtle/60" aria-hidden="true" />
            <p className="text-sm text-fg-muted">{t('panel.emptyHint')}</p>
            {canEdit && (
              <Button variant="secondary" size="sm" onClick={() => setEditing({ kind: 'new' })}>
                <Plus className="h-3.5 w-3.5" /> {t('panel.new')}
              </Button>
            )}
          </div>
        )}

        {environments?.map((env) => {
          const active = env.id === activeId;
          return (
            <div
              key={env.id}
              role="button"
              tabIndex={0}
              onClick={() => setEditing({ kind: 'environment', environment: env })}
              onKeyDown={(e) => e.key === 'Enter' && setEditing({ kind: 'environment', environment: env })}
              className={cn(
                'group flex h-8 cursor-pointer items-center gap-2 px-3 text-[13px]',
                active ? 'bg-accent/10 text-fg' : 'text-fg-muted hover:bg-muted hover:text-fg',
              )}
            >
              {active ? (
                <Check className="h-3.5 w-3.5 text-accent" aria-label={t('item.active')} />
              ) : (
                <span className="h-3.5 w-3.5" />
              )}
              <span className="min-w-0 flex-1 truncate">{env.name}</span>
              <span className="text-xs text-fg-subtle group-hover:hidden">{env.variables.length}</span>
              <div className="hidden group-hover:block group-focus-within:block">
                <Menu
                  label={t('item.actions', { name: env.name })}
                  items={[
                    active
                      ? {
                          label: t('item.deactivate'),
                          icon: Zap,
                          onSelect: () => setActive(workspaceId!, null),
                        }
                      : {
                          label: t('item.activate'),
                          icon: Zap,
                          onSelect: () => setActive(workspaceId!, env.id),
                        },
                    {
                      label: t('item.edit'),
                      icon: Pencil,
                      onSelect: () => setEditing({ kind: 'environment', environment: env }),
                    },
                    {
                      label: t('item.versions'),
                      icon: History,
                      onSelect: () => setVersionsOf(env),
                    },
                    {
                      label: t('item.exportPostman'),
                      icon: Download,
                      onSelect: () => void exportEnvironment(env),
                    },
                    {
                      label: t('item.delete'),
                      icon: Trash2,
                      danger: true,
                      disabled: !canEdit,
                      onSelect: () => setDeleting(env),
                    },
                  ]}
                />
              </div>
            </div>
          );
        })}
      </div>

      {editing?.kind === 'new' && (
        <VariablesDialog
          title={t('panel.new')}
          description={t('dialog.description')}
          name={t('dialog.defaultName')}
          variables={[]}
          currentValues={{}}
          onSave={async ({ name, variables, currentValues: values }) => {
            const created = await api.environments.create(workspaceId!, name, variables);
            setCurrentValues(scopeKeys.environment(created.id), values);
            if (!activeId) setActive(workspaceId!, created.id);
            await refresh();
          }}
          onClose={() => setEditing(null)}
        />
      )}

      {editing?.kind === 'environment' && (
        <VariablesDialog
          title={t('dialog.title', { name: editing.environment.name })}
          description={t('dialog.description')}
          name={editing.environment.name}
          readOnly={!canEdit}
          variables={editing.environment.variables}
          currentValues={currentValues[scopeKeys.environment(editing.environment.id)] ?? {}}
          onSave={async ({ name, variables, currentValues: values }) => {
            await api.environments.update(
              editing.environment.id,
              name,
              variables,
              editing.environment.version,
            );
            setCurrentValues(scopeKeys.environment(editing.environment.id), values);
            await refresh();
          }}
          onClose={() => setEditing(null)}
        />
      )}

      {editing?.kind === 'globals' && workspaceId && (
        <VariablesDialog
          title={t('globals.title')}
          description={t('globals.description')}
          readOnly={!canEdit}
          variables={globals?.variables ?? []}
          currentValues={currentValues[scopeKeys.globals(workspaceId)] ?? {}}
          onSave={async ({ variables, currentValues: values }) => {
            await api.globals.update(workspaceId, variables);
            setCurrentValues(scopeKeys.globals(workspaceId), values);
            await refresh();
          }}
          onClose={() => setEditing(null)}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title={t('delete.title')}
          confirmLabel={t('item.delete')}
          onConfirm={async () => {
            await api.environments.remove(deleting.id);
            forgetScope(scopeKeys.environment(deleting.id));
            if (activeId === deleting.id) setActive(workspaceId!, null);
            await refresh();
          }}
          onClose={() => setDeleting(null)}
        >
          <p>
            {t.rich(
              'delete.message',
              { b: (c) => <strong className="text-fg">{c}</strong> },
              { name: deleting.name, count: deleting.variables.length },
            )}
          </p>
        </ConfirmDialog>
      )}

      {importing && workspaceId && (
        <Suspense fallback={null}>
          <ImportDialog workspaceId={workspaceId} onClose={() => setImporting(false)} />
        </Suspense>
      )}
      {versionsOf && (
        <EnvironmentVersionsDialog
          environment={environments?.find((e) => e.id === versionsOf.id) ?? versionsOf}
          canEdit={canEdit}
          onClose={() => setVersionsOf(null)}
        />
      )}
    </section>
  );
}
