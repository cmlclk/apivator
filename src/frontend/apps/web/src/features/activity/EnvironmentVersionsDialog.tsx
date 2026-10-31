import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw } from 'lucide-react';
import { Alert, Button, Spinner, cn } from '@apivator/ui';
import type { EnvironmentDto, EnvironmentSnapshot, VersionDto } from '@apivator/core';
import { translate, useT } from '../../i18n';
import { Dialog } from '../../components/ui/Dialog';
import { api } from '../../lib/api';
import { diffLines } from '../../lib/diff';
import { errorMessage } from '../../lib/errors';
import { environmentsQueryKey } from '../environments/useVariables';
import { ACTION_LABELS, activityQueryKey, fullTime, timeAgo, versionsQueryKey } from './activity';
import { DiffSections } from './DiffSections';

/** Değişkenler satır satır; gizli değerler ekranda maskelenir (fark yine de "değişti" olarak görünür). */
function asText(snapshot: EnvironmentSnapshot | null | undefined) {
  if (!snapshot) return '';
  return snapshot.variables
    .map((v) => {
      const value = v.isSecret
        ? translate('activity', 'versions.secretValue', { count: v.value.length })
        : v.value;
      return `${v.enabled ? '' : '# '}${v.key} = ${value}`;
    })
    .join('\n');
}

export function EnvironmentVersionsDialog({
  environment,
  canEdit,
  onClose,
}: {
  environment: EnvironmentDto;
  canEdit: boolean;
  onClose: () => void;
}) {
  const t = useT('activity');
  const queryClient = useQueryClient();
  const {
    data: versions,
    isLoading,
    error,
  } = useQuery({
    queryKey: versionsQueryKey('environment', environment.id),
    queryFn: () => api.environments.versions(environment.id),
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  const list = versions?.filter((v) => v.snapshot) ?? [];
  const index = Math.max(
    0,
    list.findIndex((v) => v.id === selectedId),
  );
  const selected: VersionDto<EnvironmentSnapshot> | undefined = list[index];
  const previous = list[index + 1];
  const isCurrent = selected?.version === environment.version;

  const sections = selected
    ? [
        ...(previous && previous.snapshot!.name !== selected.snapshot!.name
          ? [
              {
                label: t('versions.envName'),
                lines: diffLines(previous.snapshot!.name, selected.snapshot!.name),
              },
            ]
          : []),
        {
          label: t('versions.envVariables'),
          lines: diffLines(asText(previous?.snapshot), asText(selected.snapshot)),
        },
      ].filter((s) => s.lines.some((l) => l.kind !== 'same'))
    : [];

  async function restore() {
    if (!selected) return;
    setBusy(true);
    setRestoreError(null);
    try {
      await api.environments.restore(environment.id, selected.id, environment.version);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: environmentsQueryKey(environment.workspaceId) }),
        queryClient.invalidateQueries({ queryKey: versionsQueryKey('environment', environment.id) }),
        queryClient.invalidateQueries({ queryKey: activityQueryKey(environment.workspaceId) }),
      ]);
      onClose();
    } catch (e) {
      setRestoreError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={t('versions.title', { name: environment.name })}
      size="xl"
      onClose={onClose}
      footer={
        canEdit && selected ? (
          <Button onClick={() => void restore()} loading={busy} disabled={isCurrent}>
            <RotateCcw className="h-3.5 w-3.5" />{' '}
            {t('versions.restoreVersion', { version: selected.version })}
          </Button>
        ) : undefined
      }
    >
      {isLoading && (
        <div className="flex justify-center py-10 text-fg-subtle">
          <Spinner className="h-5 w-5" />
        </div>
      )}
      {(error || restoreError) && <Alert tone="error">{restoreError ?? errorMessage(error)}</Alert>}
      {versions && (
        <div className="flex min-h-[360px] gap-4">
          <ol
            aria-label={t('versions.list')}
            className="w-60 shrink-0 overflow-y-auto border-e border-line pe-2"
          >
            {list.map((v, i) => (
              <li key={v.id}>
                <button
                  type="button"
                  aria-current={i === index ? 'true' : undefined}
                  onClick={() => setSelectedId(v.id)}
                  title={fullTime(v.createdAt)}
                  className={cn(
                    'w-full rounded-md px-2 py-2 text-start text-[12.5px]',
                    i === index ? 'bg-accent/10' : 'hover:bg-muted',
                  )}
                >
                  <span className="font-medium">v{v.version}</span>{' '}
                  <span className="text-fg-muted">{ACTION_LABELS[v.action]}</span>
                  <span className="block truncate text-[11px] text-fg-subtle">
                    {v.userName} · {timeAgo(v.createdAt)}
                  </span>
                </button>
              </li>
            ))}
          </ol>
          <div className="min-w-0 flex-1">
            <p className="mb-3 text-[12px] text-fg-muted">{t('versions.envNote')}</p>
            <DiffSections
              sections={sections}
              empty={previous ? t('versions.envNoChange') : t('versions.envFirst')}
            />
          </div>
        </div>
      )}
    </Dialog>
  );
}
