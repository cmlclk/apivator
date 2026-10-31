import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, GitMerge, GitPullRequestClosed, ThumbsUp, X } from 'lucide-react';
import { Alert, Button, Spinner, cn } from '@apivator/ui';
import type { MergeRequestDto, MergeRequestStatus } from '@apivator/core';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Dialog } from '../../components/ui/Dialog';
import { formatList, useT } from '../../i18n';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { useSession } from '../../stores/session';
import { fullTime, timeAgo } from '../activity/activity';
import { collectionsQueryKey } from '../collections/useCollections';
import { CommentsPanel } from '../comments/CommentsPanel';
import { ChangeList } from './ChangeList';
import { changeLabel, kindLabel, statusLabel } from './forkDiff';
import { mergeRequestQueryKey, mergeRequestsQueryKey } from './useForks';

export function StatusChip({ status }: { status: MergeRequestStatus }) {
  return (
    <span
      className={cn(
        'shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium',
        status === 'Open' && 'bg-success/15 text-success',
        status === 'Merged' && 'bg-accent/15 text-accent',
        (status === 'Declined' || status === 'Closed') && 'bg-muted text-fg-muted',
      )}
    >
      {statusLabel[status]}
    </span>
  );
}

export function MergeRequestDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useT('forks');
  const queryClient = useQueryClient();
  const userId = useSession((s) => s.user?.id);
  const { data, isLoading, error } = useQuery({
    queryKey: mergeRequestQueryKey(id),
    queryFn: () => api.mergeRequests.get(id),
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'decline' | 'close' | null>(null);

  const request = data?.request;

  async function act(name: string, run: () => Promise<MergeRequestDto>) {
    setBusy(name);
    setActionError(null);
    try {
      await run();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: mergeRequestQueryKey(id) }),
        request && queryClient.invalidateQueries({ queryKey: mergeRequestsQueryKey(request.workspaceId) }),
        request && queryClient.invalidateQueries({ queryKey: collectionsQueryKey(request.workspaceId) }),
      ]);
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const approved = request?.approvals.some((a) => a.userId === userId) ?? false;
  const isAuthor = request?.authorId === userId;

  return (
    <Dialog title={request ? request.title : t('mr.title')} size="xl" onClose={onClose}>
      {isLoading && <Spinner className="mx-auto h-4 w-4 text-fg-subtle" />}
      {error && <Alert tone="error">{errorMessage(error)}</Alert>}
      {request && data && (
        <div className="flex gap-4 text-[13px]">
          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <section aria-label={t('mr.summary')} className="flex flex-col gap-2">
              <div className="flex items-start gap-2 text-fg-muted">
                <StatusChip status={request.status} />
                <span className="min-w-0">
                  {t.rich(
                    'mr.proposal',
                    {
                      b: (c) => <strong className="text-fg">{c}</strong>,
                      time: (c) => <span title={fullTime(request.createdAt)}>{c}</span>,
                    },
                    {
                      author: request.authorName,
                      fork: request.forkName ?? t('mr.deletedFork'),
                      hasWorkspace: request.forkWorkspaceName ? 'y' : 'n',
                      workspace: request.forkWorkspaceName ?? '',
                      source: request.sourceName,
                      ago: timeAgo(request.createdAt),
                    },
                  )}
                </span>
              </div>
              {request.description && <p className="whitespace-pre-wrap">{request.description}</p>}
              {request.approvals.length > 0 && (
                <p className="flex items-center gap-1.5 text-success">
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('mr.approvedBy', { names: formatList(request.approvals.map((a) => a.name)) })}
                </p>
              )}
              {request.status !== 'Open' && request.closedByName && (
                <p className="text-fg-muted">
                  {statusLabel[request.status]}: {request.closedByName}
                  {request.closedAt && `, ${fullTime(request.closedAt)}`}
                </p>
              )}
            </section>

            {actionError && <Alert tone="error">{actionError}</Alert>}
            {data.conflicts > 0 && (
              <Alert tone="warning">{t('mr.conflicts', { count: data.conflicts })}</Alert>
            )}

            {request.status === 'Open' && (
              <div className="flex flex-wrap gap-2">
                {request.canMerge && (
                  <Button
                    size="sm"
                    onClick={() => void act('merge', () => api.mergeRequests.merge(id))}
                    loading={busy === 'merge'}
                    disabled={data.conflicts > 0 || data.changes.length === 0}
                  >
                    <GitMerge className="h-3.5 w-3.5" /> {t('mr.merge')}
                  </Button>
                )}
                {request.canMerge && !isAuthor && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => void act('approve', () => api.mergeRequests.approve(id))}
                    loading={busy === 'approve'}
                  >
                    <ThumbsUp className="h-3.5 w-3.5" /> {approved ? t('mr.unapprove') : t('mr.approve')}
                  </Button>
                )}
                {request.canMerge && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-danger"
                    onClick={() => setConfirm('decline')}
                  >
                    <X className="h-3.5 w-3.5" /> {t('mr.decline')}
                  </Button>
                )}
                {request.canClose && (
                  <Button size="sm" variant="ghost" onClick={() => setConfirm('close')}>
                    <GitPullRequestClosed className="h-3.5 w-3.5" /> {t('mr.withdraw')}
                  </Button>
                )}
              </div>
            )}

            <section aria-label={t('mr.changes')} className="flex flex-col gap-2">
              <h3 className="font-semibold">{t('mr.changes')}</h3>
              {request.status === 'Open' ? (
                <ChangeList changes={data.changes} direction="outgoing" empty={t('mr.noChangesLeft')} />
              ) : request.mergedChanges.length > 0 ? (
                <ul className="divide-y divide-line rounded-md border border-line">
                  {request.mergedChanges.map((c, i) => (
                    <li key={i} className="px-3 py-1.5">
                      <span className="font-medium">
                        {c.kind === 'Collection' ? kindLabel.Collection : c.name}
                      </span>
                      <span className="text-fg-subtle">
                        {' '}
                        · {c.kind !== 'Collection' && `${kindLabel[c.kind]} `}
                        {changeLabel[c.change]}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-fg-subtle">{t('mr.diffsHidden')}</p>
              )}
            </section>
          </div>

          <div className="flex h-[60vh] w-80 shrink-0">
            <CommentsPanel
              embedded
              target={{ type: 'MergeRequest', id: request.id, name: request.title }}
              workspaceId={request.workspaceId}
            />
          </div>
        </div>
      )}

      {confirm && (
        <ConfirmDialog
          title={confirm === 'decline' ? t('mr.declineTitle') : t('mr.withdrawTitle')}
          confirmLabel={confirm === 'decline' ? t('mr.decline') : t('mr.withdraw')}
          onConfirm={() =>
            act(confirm, () =>
              confirm === 'decline' ? api.mergeRequests.decline(id) : api.mergeRequests.close(id),
            )
          }
          onClose={() => setConfirm(null)}
        >
          {confirm === 'decline' ? t('mr.declineMessage') : t('mr.withdrawMessage')}
        </ConfirmDialog>
      )}
    </Dialog>
  );
}
