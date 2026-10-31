import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownToLine, GitPullRequest, Link2Off } from 'lucide-react';
import { Alert, Button, Input, Spinner } from '@apivator/ui';
import type { ForkInfoDto } from '@apivator/core';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Dialog } from '../../components/ui/Dialog';
import { useT } from '../../i18n';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { useUi } from '../../stores/ui';
import { fullTime } from '../activity/activity';
import { collectionsQueryKey } from '../collections/useCollections';
import { ChangeList, type Winner } from './ChangeList';
import { forkCompareQueryKey, mergeRequestsQueryKey, useMergeUi, workspaceForksQueryKey } from './useForks';

/** Fork'un kaynağa göre durumu: kaynaktakileri çekme, kendi değişikliklerini merge isteğiyle önerme. */
export function ForkStatusDialog({
  fork,
  canEdit,
  onClose,
}: {
  fork: ForkInfoDto;
  canEdit: boolean;
  onClose: () => void;
}) {
  const t = useT('forks');
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: forkCompareQueryKey(fork.id),
    queryFn: () => api.forks.compare(fork.id),
  });
  const [resolutions, setResolutions] = useState<Record<string, Winner>>({});
  const [pulling, setPulling] = useState(false);
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const changes = data?.changes ?? [];
  const incomingConflicts = changes.filter((c) => c.conflict && c.sourceChange);
  const unresolved = incomingConflicts.filter((c) => !resolutions[c.key]).length;

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: forkCompareQueryKey(fork.id) }),
      fork.forkWorkspaceId &&
        queryClient.invalidateQueries({ queryKey: collectionsQueryKey(fork.forkWorkspaceId) }),
    ]);
  };

  async function pull() {
    setPulling(true);
    setActionError(null);
    try {
      queryClient.setQueryData(forkCompareQueryKey(fork.id), await api.forks.pull(fork.id, resolutions));
      setResolutions({});
      await refresh();
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setPulling(false);
    }
  }

  async function openMergeRequest() {
    setSubmitting(true);
    setActionError(null);
    try {
      const created = await api.mergeRequests.create(fork.id, title.trim(), description.trim() || null);
      if (fork.sourceWorkspaceId)
        await queryClient.invalidateQueries({ queryKey: mergeRequestsQueryKey(fork.sourceWorkspaceId) });
      onClose();
      if (fork.sourceWorkspaceId) useUi.getState().setCurrentWorkspaceId(fork.sourceWorkspaceId);
      useUi.getState().setSidebarSection('merges');
      useMergeUi.getState().open(created.id);
    } catch (e) {
      setActionError(errorMessage(e));
      setSubmitting(false);
    }
  }

  return (
    <Dialog title={t('status.title', { name: fork.forkName ?? '' })} size="xl" onClose={onClose}>
      <div className="flex flex-col gap-4 text-[13px]">
        <p className="text-fg-muted">
          {t.rich(
            'status.summary',
            { b: (c) => <strong className="text-fg">{c}</strong> },
            {
              source: fork.sourceName ?? t('status.sourceInaccessible'),
              hasWorkspace: fork.sourceWorkspaceName ? 'y' : 'n',
              workspace: fork.sourceWorkspaceName ?? '',
              creator: fork.createdByName,
              time: fullTime(fork.createdAt),
              hasPulled: fork.lastPulledAt ? 'y' : 'n',
              pulledAt: fork.lastPulledAt ? fullTime(fork.lastPulledAt) : '',
            },
          )}
        </p>
        {(error || actionError) && <Alert tone="error">{actionError ?? errorMessage(error)}</Alert>}
        {isLoading && <Spinner className="mx-auto h-4 w-4 text-fg-subtle" />}

        {data && (
          <>
            <section aria-label={t('status.incoming')} className="flex flex-col gap-2">
              <header className="flex items-center gap-2">
                <h3 className="font-semibold">{t('status.incoming')}</h3>
                <span className="text-fg-subtle">{data.incoming}</span>
                <span className="flex-1" />
                {canEdit && data.incoming > 0 && (
                  <Button size="sm" onClick={() => void pull()} loading={pulling} disabled={unresolved > 0}>
                    <ArrowDownToLine className="h-3.5 w-3.5" /> {t('status.pull')}
                  </Button>
                )}
              </header>
              {unresolved > 0 && (
                <Alert tone="warning">{t('status.unresolved', { count: unresolved })}</Alert>
              )}
              <ChangeList
                changes={changes}
                direction="incoming"
                resolutions={resolutions}
                onResolve={
                  canEdit ? (key, winner) => setResolutions((r) => ({ ...r, [key]: winner })) : undefined
                }
                empty={t('status.upToDate')}
              />
            </section>

            <section aria-label={t('status.outgoing')} className="flex flex-col gap-2">
              <header className="flex items-center gap-2">
                <h3 className="font-semibold">{t('status.outgoing')}</h3>
                <span className="text-fg-subtle">{data.outgoing}</span>
                <span className="flex-1" />
                {canEdit && data.outgoing > 0 && !composing && (
                  <Button size="sm" onClick={() => setComposing(true)}>
                    <GitPullRequest className="h-3.5 w-3.5" /> {t('status.openMergeRequest')}
                  </Button>
                )}
              </header>
              {composing && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void openMergeRequest();
                  }}
                  className="flex flex-col gap-2 rounded-md border border-line p-3"
                >
                  {data.conflicts > 0 && <Alert tone="warning">{t('status.conflictsWarning')}</Alert>}
                  <Input
                    label={t('status.titleLabel')}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    maxLength={200}
                  />
                  <label className="flex flex-col gap-1.5 text-sm font-medium">
                    {t('status.descriptionLabel')}
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      rows={3}
                      placeholder={t('status.descriptionPlaceholder')}
                      className="rounded-md border border-line bg-surface px-3 py-2 text-sm font-normal focus:border-accent focus:outline-none"
                    />
                  </label>
                  <div className="flex justify-end gap-2">
                    <Button variant="secondary" size="sm" onClick={() => setComposing(false)}>
                      {t('status.cancel')}
                    </Button>
                    <Button type="submit" size="sm" loading={submitting} disabled={!title.trim()}>
                      {t('status.send')}
                    </Button>
                  </div>
                </form>
              )}
              <ChangeList changes={changes} direction="outgoing" empty={t('status.noChanges')} />
            </section>
          </>
        )}

        {canEdit && (
          <div className="flex justify-end border-t border-line pt-3">
            <Button size="sm" variant="ghost" className="text-danger" onClick={() => setUnlinking(true)}>
              <Link2Off className="h-3.5 w-3.5" /> {t('status.unlink')}
            </Button>
          </div>
        )}
      </div>

      {unlinking && (
        <ConfirmDialog
          title={t('status.unlinkTitle')}
          confirmLabel={t('status.unlinkConfirm')}
          onConfirm={async () => {
            await api.forks.unlink(fork.id);
            if (fork.forkWorkspaceId)
              await queryClient.invalidateQueries({ queryKey: workspaceForksQueryKey(fork.forkWorkspaceId) });
            onClose();
          }}
          onClose={() => setUnlinking(false)}
        >
          {t('status.unlinkMessage', { name: fork.forkName ?? '' })}
        </ConfirmDialog>
      )}
    </Dialog>
  );
}
