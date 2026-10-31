import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Lock, Plus, Server } from 'lucide-react';
import { Alert, Button, Spinner, cn } from '@apivator/ui';
import type { MockServerDto } from '@apivator/core';
import { errorMessage } from '../../lib/errors';
import { useT } from '../../i18n';
import { useWorkspaces } from '../../lib/useWorkspaces';
import { MockDetailDialog } from './MockDetailDialog';
import { MockSettingsDialog } from './MockSettingsDialog';
import { mocksQueryKey, useMockUi, useMocks } from './useMocks';

/** Kenar çubuğundaki "Mock'lar" bölümü. */
export function MocksPanel() {
  const t = useT('mocks');
  const { current } = useWorkspaces();
  const workspaceId = current?.id;
  const queryClient = useQueryClient();
  const { data: mocks, isLoading, error } = useMocks(workspaceId);
  const openMockId = useMockUi((s) => s.openMockId);
  const open = useMockUi((s) => s.open);
  const [creating, setCreating] = useState(false);
  const canEdit = current?.role !== 'Viewer';
  const opened = mocks?.find((m) => m.id === openMockId) ?? null;

  const created = async (mock: MockServerDto) => {
    setCreating(false);
    await queryClient.invalidateQueries({ queryKey: mocksQueryKey(workspaceId) });
    open(mock.id);
  };

  return (
    <section
      aria-label={t('panel.title')}
      className="flex w-72 shrink-0 flex-col border-e border-line bg-surface"
    >
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-line px-3">
        <h2 className="text-sm font-semibold">{t('panel.title')}</h2>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setCreating(true)}
          disabled={!workspaceId || !canEdit}
          title={t('panel.new')}
          aria-label={t('panel.new')}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto py-1">
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

        {mocks?.length === 0 && (
          <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
            <Server className="h-8 w-8 text-fg-subtle/60" aria-hidden="true" />
            <p className="text-sm text-fg-muted">{t('panel.empty')}</p>
            {canEdit && (
              <Button variant="secondary" size="sm" onClick={() => setCreating(true)}>
                <Plus className="h-3.5 w-3.5" /> {t('panel.new')}
              </Button>
            )}
          </div>
        )}

        {mocks?.map((mock) => (
          <button
            key={mock.id}
            type="button"
            onClick={() => open(mock.id)}
            className="flex w-full items-start gap-2 px-3 py-1.5 text-start text-[13px] text-fg-muted hover:bg-muted hover:text-fg"
          >
            <Server
              className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', mock.enabled ? 'text-success' : 'text-fg-subtle')}
              aria-label={mock.enabled ? t('panel.enabled') : t('panel.off')}
            />
            <span className="min-w-0 flex-1">
              <span className={cn('flex items-center gap-1 truncate', !mock.enabled && 'line-through')}>
                <span className="truncate">{mock.name}</span>
                {mock.isPrivate && (
                  <Lock className="h-3 w-3 shrink-0 text-fg-subtle" aria-label={t('panel.private')} />
                )}
              </span>
              <span className="block truncate text-xs text-fg-subtle">{mock.collectionName}</span>
            </span>
          </button>
        ))}
      </div>

      {creating && workspaceId && (
        <MockSettingsDialog
          workspaceId={workspaceId}
          onSaved={(m) => void created(m)}
          onClose={() => setCreating(false)}
        />
      )}
      {opened && <MockDetailDialog mock={opened} canEdit={canEdit} onClose={() => open(null)} />}
    </section>
  );
}
