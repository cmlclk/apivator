import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Laptop, Link2Off, RefreshCw } from 'lucide-react';
import { Alert, Button, Spinner, cn } from '@apivator/ui';
import type {
  CollectionSourceDto,
  CollectionTreeDto,
  SourceApplyResult,
  SourceChangeDto,
  SourceDiffDto,
} from '@apivator/core';
import { Dialog } from '../../components/ui/Dialog';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { CopyButton } from '../../components/ui/CopyButton';
import { formatDateTime, translate, useT } from '../../i18n';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { applyRemoteRequest } from '../../lib/realtime';
import { timeAgo } from '../activity/activity';
import { collectionsQueryKey } from '../collections/useCollections';
import { methodColor } from '../requests/methodColors';
import { AccessHeaders } from './AccessHeaders';
import { accessHeaders, emptyAccess, type AccessState } from './access';
import { sourceQueryKey } from './sourceUi';

const intervals = [
  { value: '', key: 'source.interval.off' },
  { value: '1', key: 'source.interval.hourly' },
  { value: '6', key: 'source.interval.sixHours' },
  { value: '24', key: 'source.interval.daily' },
] as const;

type Group = 'added' | 'changed' | 'removed';

const groupTitleKeys = {
  added: 'source.groups.added',
  changed: 'source.groups.changed',
  removed: 'source.groups.removed',
} as const satisfies Record<Group, string>;

/**
 * Adresten içe aktarılmış collection'ın kaynağı: adres, otomatik kontrol ve "kaynaktan güncelle". Güncellemede
 * belge yeniden çekilir, son uygulanan belgeyle farkı gösterilir; seçilen değişiklikler uygulanır.
 */
export function SourceDialog({
  collection,
  canEdit,
  onClose,
}: {
  collection: CollectionTreeDto;
  canEdit: boolean;
  onClose: () => void;
}) {
  const t = useT('exchange');
  const queryClient = useQueryClient();
  const { data: source, error: loadError } = useQuery({
    queryKey: sourceQueryKey(collection.id),
    queryFn: () => api.sources.get(collection.id),
  });
  const [access, setAccess] = useState<AccessState>(emptyAccess);
  const [diff, setDiff] = useState<SourceDiffDto | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [applied, setApplied] = useState<SourceApplyResult | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const refreshTree = () =>
    queryClient.invalidateQueries({ queryKey: collectionsQueryKey(collection.workspaceId) });
  const setSource = (value: CollectionSourceDto) =>
    queryClient.setQueryData(sourceQueryKey(collection.id), value);

  const preview = useMutation({
    mutationFn: () => api.sources.preview(collection.id, source!.url, accessHeaders(access)),
    onSuccess: (result) => {
      setDiff(result);
      // Silmeler varsayılan olarak seçilmez.
      setSelected(new Set([...result.added, ...result.changed].map((c) => c.key)));
    },
  });

  const apply = useMutation({
    mutationFn: (keys: string[]) => api.sources.apply(collection.id, diff!.hash, keys),
    onSuccess: async (result, keys) => {
      setSource(result.source);
      setApplied(result);
      // Açık sekmeler: kaydedilmemiş değişiklik yoksa güncellenir, varsa kullanıcıya sorulur.
      const chosen = new Set(keys);
      for (const change of diff!.changed.filter((c) => chosen.has(c.key) && c.requestId))
        void applyRemoteRequest(
          {
            id: change.requestId!,
            collectionId: collection.id,
            version: Number.MAX_SAFE_INTEGER,
            deleted: false,
          },
          translate('exchange', 'source.updateFromSource'),
        );
      for (const change of diff!.removed.filter((c) => chosen.has(c.key) && c.requestId))
        void applyRemoteRequest(
          {
            id: change.requestId!,
            collectionId: collection.id,
            version: Number.MAX_SAFE_INTEGER,
            deleted: true,
          },
          translate('exchange', 'source.updateFromSource'),
        );
      await refreshTree();
    },
  });

  const schedule = useMutation({
    mutationFn: (hours: number | null) => api.sources.schedule(collection.id, hours),
    onSuccess: setSource,
  });

  const total = diff ? diff.added.length + diff.changed.length + diff.removed.length : 0;

  const footer = applied ? (
    <Button onClick={onClose}>{t('source.done')}</Button>
  ) : diff ? (
    total === 0 ? (
      <Button
        onClick={() => apply.mutate([])}
        disabled={apply.isPending || !canEdit}
        title={t('source.upToDateTitle')}
      >
        {apply.isPending && <Spinner className="h-3.5 w-3.5" />} {t('source.done')}
      </Button>
    ) : (
      <>
        <Button variant="secondary" onClick={() => setDiff(null)}>
          {t('source.back')}
        </Button>
        <Button onClick={() => apply.mutate([...selected])} disabled={apply.isPending || !canEdit}>
          {apply.isPending && <Spinner className="h-3.5 w-3.5" />}
          {selected.size ? t('source.applySelected', { count: selected.size }) : t('source.applyNone')}
        </Button>
      </>
    )
  ) : (
    <>
      <Button variant="secondary" onClick={onClose}>
        {t('source.close')}
      </Button>
      <Button onClick={() => preview.mutate()} disabled={!source || preview.isPending || !canEdit}>
        {preview.isPending ? <Spinner className="h-3.5 w-3.5" /> : <RefreshCw className="h-3.5 w-3.5" />}
        {t('source.fetchChanges')}
      </Button>
    </>
  );

  return (
    <Dialog title={t('source.title', { name: collection.name })} size="xl" onClose={onClose} footer={footer}>
      {loadError ? (
        <Alert tone="error">{errorMessage(loadError)}</Alert>
      ) : !source ? (
        <div className="flex justify-center py-10">
          <Spinner className="h-5 w-5 text-accent" />
        </div>
      ) : applied ? (
        <AppliedSummary result={applied} />
      ) : diff ? (
        <DiffView
          diff={diff}
          selected={selected}
          onSelect={setSelected}
          error={apply.error ? errorMessage(apply.error) : null}
        />
      ) : (
        <div className="space-y-4">
          <SourceSummary source={source} />
          {source.changeDetectedAt && (
            <Alert tone="info">
              {t('source.changeDetected', { time: timeAgo(source.changeDetectedAt) })}
            </Alert>
          )}
          <section className="space-y-1.5">
            <label className="flex items-center gap-3 text-[13px]">
              <span className="font-medium">{t('source.autoCheck')}</span>
              <select
                value={source.checkIntervalHours?.toString() ?? ''}
                disabled={!canEdit || schedule.isPending}
                onChange={(e) => schedule.mutate(e.target.value ? Number(e.target.value) : null)}
                className="h-8 rounded-md border border-line bg-surface px-2 text-[13px]"
              >
                {intervals.map((i) => (
                  <option key={i.value} value={i.value}>
                    {t(i.key)}
                  </option>
                ))}
              </select>
              {schedule.isPending && <Spinner className="h-3.5 w-3.5" />}
            </label>
            <p className="text-xs text-fg-subtle">
              {t('source.autoCheckHint', { local: source.local ? 'yes' : 'no' })}
            </p>
            {source.checkIntervalHours && source.lastCheckedAt && (
              <p className={cn('text-xs', source.lastCheckError ? 'text-danger' : 'text-fg-muted')}>
                {source.lastCheckError
                  ? t('source.lastCheckFailed', {
                      time: timeAgo(source.lastCheckedAt),
                      error: source.lastCheckError,
                    })
                  : t('source.lastCheckOk', { time: timeAgo(source.lastCheckedAt) })}
              </p>
            )}
            {schedule.error && <p className="text-xs text-danger">{errorMessage(schedule.error)}</p>}
          </section>

          <AccessHeaders value={access} onChange={setAccess} disabled={!canEdit} />

          {preview.error && <Alert tone="error">{errorMessage(preview.error)}</Alert>}
          {!canEdit && <p className="text-xs text-fg-subtle">{t('source.needEditor')}</p>}

          <div className="flex items-center justify-between border-t border-line pt-3">
            <p className="text-xs text-fg-subtle">{t('source.preserved')}</p>
            <button
              type="button"
              disabled={!canEdit}
              onClick={() => setConfirmDisconnect(true)}
              className="flex items-center gap-1 text-xs text-fg-muted hover:text-danger disabled:opacity-50"
            >
              <Link2Off className="h-3.5 w-3.5" /> {t('source.disconnect')}
            </button>
          </div>
        </div>
      )}
      {confirmDisconnect && (
        <ConfirmDialog
          title={t('source.disconnectTitle')}
          confirmLabel={t('source.disconnect')}
          onConfirm={async () => {
            await api.sources.disconnect(collection.id);
            await refreshTree();
            onClose();
          }}
          onClose={() => setConfirmDisconnect(false)}
        >
          {t('source.disconnectBody')}
        </ConfirmDialog>
      )}
    </Dialog>
  );
}

function SourceSummary({ source }: { source: CollectionSourceDto }) {
  const t = useT('exchange');
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
      <dt className="text-fg-muted">{t('source.summary.address')}</dt>
      <dd className="flex min-w-0 items-center gap-1.5">
        <span className="truncate font-mono text-xs" title={source.url}>
          {source.url}
        </span>
        <CopyButton text={source.url} label={t('source.summary.copyAddress')} compact />
        {source.local && (
          <span
            className="flex shrink-0 items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[11px] text-fg-muted"
            title={t('source.summary.fromThisComputerTitle')}
          >
            <Laptop className="h-3 w-3" /> {t('source.summary.fromThisComputer')}
          </span>
        )}
      </dd>
      {source.version && (
        <>
          <dt className="text-fg-muted">{t('source.summary.version')}</dt>
          <dd>{source.version}</dd>
        </>
      )}
      <dt className="text-fg-muted">{t('source.summary.importedAt')}</dt>
      <dd>{formatDateTime(source.importedAt)}</dd>
      {source.updatedAt !== source.importedAt && (
        <>
          <dt className="text-fg-muted">{t('source.summary.updatedAt')}</dt>
          <dd>{formatDateTime(source.updatedAt)}</dd>
        </>
      )}
    </dl>
  );
}

function DiffView({
  diff,
  selected,
  onSelect,
  error,
}: {
  diff: SourceDiffDto;
  selected: Set<string>;
  onSelect: (keys: Set<string>) => void;
  error: string | null;
}) {
  const t = useT('exchange');
  const groups = useMemo(
    () =>
      (['added', 'changed', 'removed'] as Group[])
        .map((group) => ({ group, items: diff[group] }))
        .filter((g) => g.items.length > 0),
    [diff],
  );
  const toggle = (keys: string[], on: boolean) => {
    const next = new Set(selected);
    for (const key of keys) {
      if (on) next.add(key);
      else next.delete(key);
    }
    onSelect(next);
  };
  const versionParams = {
    hasVersion: diff.fromVersion && diff.toVersion && diff.fromVersion !== diff.toVersion ? 'yes' : 'no',
    from: diff.fromVersion ?? '',
    to: diff.toVersion ?? '',
  };

  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center">
        <CheckCircle2 className="h-6 w-6 text-success" aria-hidden="true" />
        <p className="font-medium">{t('source.diff.noChangeTitle')}</p>
        <p className="max-w-md text-xs text-fg-muted">{t('source.diff.noChangeBody', versionParams)}</p>
        {error && <Alert tone="error">{error}</Alert>}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-[13px] text-fg-muted">
        {t('source.diff.summary', {
          ...versionParams,
          list: [
            diff.added.length ? t('source.diff.countAdded', { count: diff.added.length }) : '',
            diff.changed.length ? t('source.diff.countChanged', { count: diff.changed.length }) : '',
            diff.removed.length ? t('source.diff.countRemoved', { count: diff.removed.length }) : '',
          ]
            .filter(Boolean)
            .join(t('source.listSeparator')),
        })}
      </p>
      {diff.newVariables.length > 0 && (
        <p className="text-xs text-fg-muted">
          {t('source.diff.newVariables')} <span className="font-mono">{diff.newVariables.join(', ')}</span>
        </p>
      )}
      {diff.warnings.length > 0 && (
        <Alert tone="warning">
          <ul className="list-disc space-y-0.5 ps-4 text-xs">
            {diff.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Alert>
      )}
      {error && <Alert tone="error">{error}</Alert>}
      {groups.map(({ group, items }) => {
        const keys = items.map((i) => i.key);
        const all = keys.every((k) => selected.has(k));
        const some = keys.some((k) => selected.has(k));
        return (
          <section key={group} aria-label={t(groupTitleKeys[group])}>
            <label className="mb-1.5 flex items-center gap-2 text-[13px] font-semibold">
              <input
                type="checkbox"
                checked={all}
                ref={(el) => {
                  if (el) el.indeterminate = some && !all;
                }}
                onChange={(e) => toggle(keys, e.target.checked)}
              />
              {t(groupTitleKeys[group])} ({items.length})
            </label>
            {group === 'removed' && (
              <p className="mb-1.5 text-xs text-fg-subtle">{t('source.diff.removedHint')}</p>
            )}
            <ul className="divide-y divide-line rounded-md border border-line">
              {items.map((item) => (
                <ChangeRow
                  key={item.key}
                  item={item}
                  group={group}
                  checked={selected.has(item.key)}
                  onToggle={(on) => toggle([item.key], on)}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function ChangeRow({
  item,
  group,
  checked,
  onToggle,
}: {
  item: SourceChangeDto;
  group: Group;
  checked: boolean;
  onToggle: (on: boolean) => void;
}) {
  return (
    <li>
      <label className="flex cursor-pointer items-start gap-2.5 px-3 py-2 hover:bg-muted/50">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onToggle(e.target.checked)}
          className="mt-0.5"
          aria-label={`${item.method} ${item.path}`}
        />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-baseline gap-2">
            <span
              className={cn('w-12 shrink-0 font-mono text-[11px] font-semibold', methodColor(item.method))}
            >
              {item.method}
            </span>
            <span className="truncate font-mono text-xs">{item.path}</span>
            <span className="truncate text-xs text-fg-muted">{item.name}</span>
            {item.folder && (
              <span className="shrink-0 rounded bg-muted px-1.5 text-[11px] text-fg-subtle">
                {item.folder}
              </span>
            )}
          </span>
          {group === 'changed' && (
            <span className="mt-1 flex flex-wrap gap-1 ps-14">
              {item.fields.map((f) => (
                <span key={f} className="rounded bg-accent/10 px-1.5 py-0.5 text-[11px] text-accent">
                  {f}
                </span>
              ))}
            </span>
          )}
          {item.notes.map((note) => (
            <span key={note} className="mt-1 flex items-start gap-1 ps-14 text-[11.5px] text-fg-muted">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-warning" aria-hidden="true" />
              {note}
            </span>
          ))}
        </span>
      </label>
    </li>
  );
}

function AppliedSummary({ result }: { result: SourceApplyResult }) {
  const t = useT('exchange');
  const parts = [
    result.added && t('source.applied.added', { count: result.added }),
    result.updated && t('source.applied.updated', { count: result.updated }),
    result.removed && t('source.applied.removed', { count: result.removed }),
    result.variables && t('source.applied.variables', { count: result.variables }),
  ].filter((p): p is string => !!p);
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-center">
      <CheckCircle2 className="h-7 w-7 text-success" aria-hidden="true" />
      <p className="font-medium">
        {parts.length
          ? t('source.applied.sentence', { text: parts.join(t('source.listSeparator')) })
          : t('source.applied.upToDate')}
      </p>
      {result.source.version && (
        <p className="text-xs text-fg-muted">
          {t('source.applied.documentVersion', { version: result.source.version })}
        </p>
      )}
    </div>
  );
}
