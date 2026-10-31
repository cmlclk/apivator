import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, MessageSquare, Pencil, RotateCcw, Trash2, X } from 'lucide-react';
import { Alert, Spinner, cn } from '@apivator/ui';
import type { CommentDto } from '@apivator/core';
import { useT } from '../../i18n';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { initials, presenceColor } from '../../lib/presence';
import {
  commentCountsQueryKey,
  commentsQueryKey,
  fullTime,
  timeAgo,
  useCommentsPanel,
  type CommentsTarget,
} from '../activity/activity';
import { CommentComposer } from './CommentComposer';
import { parseComment } from './mentions';

function Body({ body }: { body: string }) {
  return (
    <p className="text-[13px] break-words whitespace-pre-wrap">
      {parseComment(body).map((part, i) =>
        part.kind === 'text' ? (
          <span key={i}>{part.text}</span>
        ) : (
          <span key={i} className="rounded bg-accent/10 px-0.5 font-medium text-accent">
            @{part.name}
          </span>
        ),
      )}
    </p>
  );
}

function CommentItem({
  comment,
  workspaceId,
  focused,
  onChanged,
  onError,
}: {
  comment: CommentDto;
  workspaceId: string;
  focused: boolean;
  onChanged: () => Promise<unknown>;
  onError: (message: string) => void;
}) {
  const t = useT('comments');
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'center' });
  }, [focused]);

  return (
    <div
      ref={ref}
      className={cn('group flex gap-2.5 rounded-md p-1.5', focused && 'bg-accent/10 ring-1 ring-accent/40')}
    >
      <span
        aria-hidden="true"
        className={cn(
          'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white',
          presenceColor(comment.authorId),
        )}
      >
        {initials(comment.authorName)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[12px]">
          <span className="font-medium">{comment.authorName}</span>
          <span className="text-fg-subtle" title={fullTime(comment.createdAt)}>
            {timeAgo(comment.createdAt)}
            {comment.editedAt && t('panel.edited')}
          </span>
          <span className="ms-auto hidden gap-0.5 group-hover:flex">
            {comment.canEdit && !editing && (
              <button
                type="button"
                aria-label={t('panel.editLabel')}
                onClick={() => setEditing(true)}
                className="rounded p-1 text-fg-subtle hover:bg-muted hover:text-fg"
              >
                <Pencil className="h-3 w-3" />
              </button>
            )}
            {comment.canDelete && (
              <button
                type="button"
                aria-label={t('panel.deleteLabel')}
                onClick={() => {
                  void api.comments
                    .remove(comment.id)
                    .then(onChanged)
                    .catch((e) => onError(errorMessage(e)));
                }}
                className="rounded p-1 text-fg-subtle hover:bg-danger/10 hover:text-danger"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            )}
          </span>
        </div>
        {editing ? (
          <div className="mt-1">
            <CommentComposer
              workspaceId={workspaceId}
              initialBody={comment.body}
              placeholder={t('panel.editPlaceholder')}
              submitLabel={t('panel.save')}
              autoFocus
              onCancel={() => setEditing(false)}
              onSubmit={async (body) => {
                try {
                  await api.comments.edit(comment.id, body);
                  setEditing(false);
                  await onChanged();
                } catch (e) {
                  onError(errorMessage(e));
                }
              }}
            />
          </div>
        ) : (
          <Body body={comment.body} />
        )}
      </div>
    </div>
  );
}

/** İstek ya da collection üzerindeki yorum başlıkları; sağda açılır. */
export function CommentsPanel({
  target,
  workspaceId,
  embedded = false,
}: {
  target: CommentsTarget;
  workspaceId: string;
  /** Başka bir ekranın (ör. merge isteği) içinde: kapatma düğmesi yok, genişlik kapsayıcıdan gelir. */
  embedded?: boolean;
}) {
  const t = useT('comments');
  const queryClient = useQueryClient();
  const close = useCommentsPanel((s) => s.close);
  const focusCommentId = useCommentsPanel((s) => s.focusCommentId);
  const [showResolved, setShowResolved] = useState(false);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = commentsQueryKey(target.type, target.id);
  const { data: comments, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => api.comments.list(target.type, target.id),
  });

  const threads = useMemo(() => {
    const roots = (comments ?? []).filter((c) => !c.parentId);
    return roots.map((root) => ({ root, replies: (comments ?? []).filter((c) => c.parentId === root.id) }));
  }, [comments]);
  const focusedThread = threads.find(
    (th) => th.root.id === focusCommentId || th.replies.some((r) => r.id === focusCommentId),
  );
  const open = threads.filter((th) => !th.root.resolvedAt);
  const resolved = threads.filter((th) => th.root.resolvedAt);
  const visible = showResolved || focusedThread?.root.resolvedAt ? threads : open;

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: key }),
      queryClient.invalidateQueries({ queryKey: commentCountsQueryKey(workspaceId) }),
    ]);

  const post = async (body: string, parentId?: string) => {
    setError(null);
    try {
      await api.comments.create(target.type, target.id, body, parentId);
      setReplyTo(null);
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
      throw e;
    }
  };

  return (
    <aside
      aria-label={t('panel.title')}
      className={cn(
        'flex shrink-0 flex-col bg-surface',
        embedded ? 'min-h-0 w-full rounded-md border border-line' : 'w-96 border-s border-line',
      )}
      onKeyDown={(e) => e.key === 'Escape' && e.target === e.currentTarget && close()}
    >
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
        <MessageSquare className="h-4 w-4 text-fg-subtle" aria-hidden="true" />
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">
          {t('panel.title')} <span className="font-normal text-fg-subtle">· {target.name}</span>
        </h2>
        {!embedded && (
          <button
            type="button"
            aria-label={t('panel.close')}
            onClick={close}
            className="rounded p-1 text-fg-subtle hover:bg-muted hover:text-fg"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {error && (
          <Alert tone="error" className="mb-2 text-xs">
            {error}
          </Alert>
        )}
        {isLoading && (
          <div className="flex justify-center py-6 text-fg-subtle">
            <Spinner className="h-4 w-4" />
          </div>
        )}
        {comments && threads.length === 0 && (
          <p className="px-2 py-8 text-center text-[13px] text-fg-muted">{t('panel.empty')}</p>
        )}
        {resolved.length > 0 && (
          <button
            type="button"
            onClick={() => setShowResolved((s) => !s)}
            className="mb-2 text-[12px] text-accent hover:underline"
          >
            {showResolved ? t('panel.hideResolved') : t('panel.showResolved', { count: resolved.length })}
          </button>
        )}
        <ul className="flex flex-col gap-3">
          {visible.map(({ root, replies }) => (
            <li
              key={root.id}
              className={cn('rounded-lg border border-line p-1.5', root.resolvedAt && 'opacity-70')}
              aria-label={t('panel.threadLabel', { name: root.authorName })}
            >
              <CommentItem
                comment={root}
                workspaceId={workspaceId}
                focused={root.id === focusCommentId}
                onChanged={refresh}
                onError={setError}
              />
              {replies.length > 0 && (
                <div className="ms-6 border-s border-line ps-1.5">
                  {replies.map((reply) => (
                    <CommentItem
                      key={reply.id}
                      comment={reply}
                      workspaceId={workspaceId}
                      focused={reply.id === focusCommentId}
                      onChanged={refresh}
                      onError={setError}
                    />
                  ))}
                </div>
              )}
              <div className="mt-1 flex items-center gap-3 px-1.5 text-[12px]">
                {replyTo !== root.id && (
                  <button
                    type="button"
                    onClick={() => setReplyTo(root.id)}
                    className="text-accent hover:underline"
                  >
                    {t('panel.reply')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    void api.comments
                      .resolve(root.id, !root.resolvedAt)
                      .then(refresh)
                      .catch((e) => setError(errorMessage(e)));
                  }}
                  className="flex items-center gap-1 text-fg-muted hover:text-fg"
                >
                  {root.resolvedAt ? (
                    <>
                      <RotateCcw className="h-3 w-3" /> {t('panel.reopen')}
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-3 w-3" /> {t('panel.resolve')}
                    </>
                  )}
                </button>
                {root.resolvedAt && root.resolvedByName && (
                  <span className="text-fg-subtle">
                    {t('panel.resolvedBy', { name: root.resolvedByName })}
                  </span>
                )}
              </div>
              {replyTo === root.id && (
                <div className="mt-2 px-1.5">
                  <CommentComposer
                    workspaceId={workspaceId}
                    placeholder={t('panel.replyPlaceholder')}
                    submitLabel={t('panel.reply')}
                    autoFocus
                    onCancel={() => setReplyTo(null)}
                    onSubmit={(body) => post(body, root.id)}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div className="border-t border-line p-3">
        <CommentComposer
          key={target.id}
          workspaceId={workspaceId}
          placeholder={t('panel.newPlaceholder')}
          submitLabel={t('panel.send')}
          onSubmit={(body) => post(body)}
        />
      </div>
    </aside>
  );
}
