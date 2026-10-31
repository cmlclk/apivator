import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { HeartPulse, Plus } from 'lucide-react';
import { Alert, Button, Spinner, cn } from '@apivator/ui';
import type { MonitorDto } from '@apivator/core';
import { errorMessage } from '../../lib/errors';
import { useWorkspaces } from '../../lib/useWorkspaces';
import { useT } from '../../i18n';
import { timeAgo } from '../activity/activity';
import { MonitorDetailDialog, MonitorState } from './MonitorDetailDialog';
import { MonitorSettingsDialog } from './MonitorSettingsDialog';
import { describeSchedule } from './monitorSchedule';
import { monitorsQueryKey, useMonitorUi, useMonitors } from './useMonitors';

/** Kenar çubuğundaki "Monitörler" bölümü. */
export function MonitorsPanel() {
  const t = useT('monitors');
  const { current } = useWorkspaces();
  const workspaceId = current?.id;
  const queryClient = useQueryClient();
  const { data: monitors, isLoading, error } = useMonitors(workspaceId);
  const openId = useMonitorUi((s) => s.openMonitorId);
  const open = useMonitorUi((s) => s.open);
  const [creating, setCreating] = useState(false);
  const canEdit = current?.role !== 'Viewer';
  const opened = monitors?.find((m) => m.id === openId) ?? null;

  const created = async (monitor: MonitorDto) => {
    setCreating(false);
    await queryClient.invalidateQueries({ queryKey: monitorsQueryKey(workspaceId) });
    open(monitor.id);
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

        {monitors?.length === 0 && (
          <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
            <HeartPulse className="h-8 w-8 text-fg-subtle/60" aria-hidden="true" />
            <p className="text-sm text-fg-muted">{t('panel.empty')}</p>
            {canEdit && (
              <Button variant="secondary" size="sm" onClick={() => setCreating(true)}>
                <Plus className="h-3.5 w-3.5" /> {t('panel.new')}
              </Button>
            )}
          </div>
        )}

        {monitors?.map((monitor) => (
          <button
            key={monitor.id}
            type="button"
            onClick={() => open(monitor.id)}
            className="flex w-full flex-col gap-0.5 px-3 py-1.5 text-start text-[13px] text-fg-muted hover:bg-muted hover:text-fg"
          >
            <span className={cn('truncate', !monitor.enabled && 'text-fg-subtle')}>{monitor.name}</span>
            <span className="flex items-center gap-2 text-xs">
              <MonitorState monitor={monitor} />
              <span className="truncate text-fg-subtle">
                {monitor.lastRunAt ? timeAgo(monitor.lastRunAt) : describeSchedule(monitor.schedule)}
              </span>
            </span>
          </button>
        ))}
      </div>

      {creating && workspaceId && (
        <MonitorSettingsDialog
          workspaceId={workspaceId}
          onSaved={(m) => void created(m)}
          onClose={() => setCreating(false)}
        />
      )}
      {opened && <MonitorDetailDialog monitor={opened} canEdit={canEdit} onClose={() => open(null)} />}
    </section>
  );
}
