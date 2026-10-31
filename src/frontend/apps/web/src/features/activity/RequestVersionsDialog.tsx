import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw } from 'lucide-react';
import { Alert, Button, Spinner, cn } from '@apivator/ui';
import { emptyDefinition, type RequestSnapshot, type VersionDto } from '@apivator/core';
import { useT } from '../../i18n';
import { Dialog } from '../../components/ui/Dialog';
import { SegmentedTabs } from '../../components/ui/SegmentedTabs';
import { api } from '../../lib/api';
import { requestDiff } from '../../lib/diff';
import { errorMessage } from '../../lib/errors';
import { initials, presenceColor } from '../../lib/presence';
import { collectionsQueryKey } from '../collections/useCollections';
import { isDirty, useTabs, type RequestTab } from '../requests/tabsStore';
import { ACTION_LABELS, activityQueryKey, fullTime, timeAgo, versionsQueryKey } from './activity';
import { DiffSections } from './DiffSections';

type Compare = 'previous' | 'draft';

const asSide = (v: VersionDto<RequestSnapshot> | undefined) =>
  v?.snapshot
    ? { name: v.snapshot.name, definition: v.snapshot.definition }
    : { name: '', definition: emptyDefinition() };

/** Bir isteğin kaydedilen sürümleri: kim, ne zaman, ne değişti; eski bir sürüme dönme. */
export function RequestVersionsDialog({
  tab,
  canEdit,
  onClose,
}: {
  tab: RequestTab;
  canEdit: boolean;
  onClose: () => void;
}) {
  const t = useT('activity');
  const requestId = tab.requestId!;
  const queryClient = useQueryClient();
  const {
    data: versions,
    isLoading,
    error,
  } = useQuery({
    queryKey: versionsQueryKey('request', requestId),
    queryFn: () => api.requests.versions(requestId),
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [compare, setCompare] = useState<Compare>('previous');
  const [busy, setBusy] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const withSnapshot = versions?.filter((v) => v.snapshot) ?? [];
  const index = Math.max(
    0,
    withSnapshot.findIndex((v) => v.id === selectedId),
  );
  const selected = withSnapshot[index];
  const previous = withSnapshot[index + 1];
  const isCurrent = selected?.version === tab.saved?.version;

  const sections = selected
    ? compare === 'previous'
      ? requestDiff(asSide(previous), asSide(selected))
      : requestDiff({ name: tab.name, definition: tab.draft }, asSide(selected))
    : [];

  async function restore() {
    if (!selected || !tab.saved) return;
    // Sekmede kaydedilmemiş değişiklik varsa ikinci tıklamayla onaylanır.
    if (isDirty(tab) && !confirming) {
      setConfirming(true);
      return;
    }
    setBusy(true);
    setRestoreError(null);
    try {
      const restored = await api.requests.restore(requestId, selected.id, tab.saved.version);
      useTabs.getState().markSaved(tab.id, restored);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: versionsQueryKey('request', requestId) }),
        queryClient.invalidateQueries({ queryKey: collectionsQueryKey(tab.workspaceId) }),
        queryClient.invalidateQueries({ queryKey: activityQueryKey(tab.workspaceId) }),
      ]);
      onClose();
    } catch (e) {
      setRestoreError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={t('versions.title', { name: tab.name })}
      size="xl"
      onClose={onClose}
      footer={
        canEdit && selected ? (
          <>
            <span className="me-auto self-center text-xs text-fg-subtle">
              {isCurrent
                ? t('versions.isLatest')
                : confirming
                  ? t('versions.confirmDiscard')
                  : t('versions.restoreNote')}
            </span>
            <Button onClick={() => void restore()} loading={busy} disabled={isCurrent}>
              <RotateCcw className="h-3.5 w-3.5" />{' '}
              {t(confirming ? 'versions.restoreVersionConfirm' : 'versions.restoreVersion', {
                version: selected.version,
              })}
            </Button>
          </>
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
        <div className="flex min-h-[420px] gap-4">
          <ol
            aria-label={t('versions.list')}
            className="w-64 shrink-0 overflow-y-auto border-e border-line pe-2"
          >
            {withSnapshot.map((v, i) => (
              <li key={v.id}>
                <button
                  type="button"
                  aria-current={i === index ? 'true' : undefined}
                  onClick={() => {
                    setSelectedId(v.id);
                    setConfirming(false);
                  }}
                  title={fullTime(v.createdAt)}
                  className={cn(
                    'flex w-full items-start gap-2 rounded-md px-2 py-2 text-start text-[12.5px]',
                    i === index ? 'bg-accent/10' : 'hover:bg-muted',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white',
                      presenceColor(v.userId ?? v.userName),
                    )}
                  >
                    {initials(v.userName)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="font-medium">v{v.version}</span>
                      <span className="text-fg-muted">{ACTION_LABELS[v.action]}</span>
                      {v.action === 'Restored' && v.detail && (
                        <span className="text-fg-subtle">({v.detail})</span>
                      )}
                    </span>
                    <span className="block truncate text-[11px] text-fg-subtle">
                      {v.userName} · {timeAgo(v.createdAt)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
            {versions.length >= 100 && (
              <li className="px-2 py-2 text-[11px] text-fg-subtle">{t('versions.olderNotKept')}</li>
            )}
          </ol>
          <div className="min-w-0 flex-1">
            <div className="mb-3 border-b border-line">
              <SegmentedTabs<Compare>
                label={t('versions.compare')}
                value={compare}
                onChange={setCompare}
                tabs={[
                  { id: 'previous', label: t('versions.comparePrevious') },
                  { id: 'draft', label: t('versions.compareDraft') },
                ]}
              />
            </div>
            <DiffSections
              sections={sections}
              empty={
                compare === 'previous'
                  ? previous
                    ? t('versions.emptyNoChange')
                    : t('versions.emptyFirst')
                  : t('versions.emptyDraftSame')
              }
            />
          </div>
        </div>
      )}
    </Dialog>
  );
}
