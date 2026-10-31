import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, Button } from '@apivator/ui';
import type { CollectionTreeDto } from '@apivator/core';
import { Dialog } from '../../components/ui/Dialog';
import { useT } from '../../i18n';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { groupWorkspaces, selectClass } from '../../lib/teams';
import { useWorkspaces } from '../../lib/useWorkspaces';
import { useUi } from '../../stores/ui';
import { useTabs } from '../requests/tabsStore';
import { collectionsQueryKey } from './useCollections';

/**
 * Collection'ı başka bir workspace'e kopyalar ya da taşır (ör. kişisel taslağı takıma açmak).
 * Hedefte düzenleme yetkisi gerekir; taşımada kaynakta da.
 */
export function MoveCollectionDialog({
  collection,
  sourceWorkspaceId,
  canMove,
  onClose,
}: {
  collection: CollectionTreeDto;
  sourceWorkspaceId: string;
  canMove: boolean;
  onClose: () => void;
}) {
  const t = useT('collections');
  const { workspaces } = useWorkspaces();
  const queryClient = useQueryClient();
  const targets = workspaces.filter((w) => w.id !== sourceWorkspaceId && w.role !== 'Viewer');
  const [targetId, setTargetId] = useState(targets[0]?.id ?? '');
  const [mode, setMode] = useState<'copy' | 'move'>(canMove ? 'move' : 'copy');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const target = targets.find((w) => w.id === targetId);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'move') {
        await api.collections.moveTo(collection.id, targetId);
        // Açık sekmeler eski workspace'e bağlı; yeni yerinden yeniden açılırlar.
        useTabs.getState().closeByRequestIds(collection.requests.map((r) => r.id));
      } else {
        await api.collections.copyTo(collection.id, targetId);
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: collectionsQueryKey(sourceWorkspaceId) }),
        queryClient.invalidateQueries({ queryKey: collectionsQueryKey(targetId) }),
      ]);
      useUi.getState().setCurrentWorkspaceId(targetId);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={t('move.title', { name: collection.name })}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('move.cancel')}
          </Button>
          <Button onClick={() => void submit()} loading={busy} disabled={!target}>
            {mode === 'move' ? t('move.move') : t('move.copy')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 text-[13px]">
        {error && <Alert tone="error">{error}</Alert>}
        {targets.length === 0 ? (
          <Alert tone="info">{t('move.noTargets')}</Alert>
        ) : (
          <>
            <label className="flex flex-col gap-1.5 font-medium">
              {t('move.target')}
              <select
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                className={`${selectClass} h-9 font-normal`}
              >
                {groupWorkspaces(targets).map((group) => (
                  <optgroup
                    key={group.personal ? 'personal' : group.name}
                    label={group.personal ? t('move.personal') : group.name}
                  >
                    {group.items.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1.5 font-medium">{t('move.action')}</legend>
              <label className="flex items-start gap-2">
                <input
                  type="radio"
                  name="mode"
                  checked={mode === 'move'}
                  disabled={!canMove}
                  onChange={() => setMode('move')}
                  className="mt-0.5"
                />
                <span>
                  {t('move.move')}
                  <span className="block text-xs text-fg-subtle">
                    {canMove ? t('move.moveHint') : t('move.copyOnlyHint')}
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input
                  type="radio"
                  name="mode"
                  checked={mode === 'copy'}
                  onChange={() => setMode('copy')}
                  className="mt-0.5"
                />
                <span>
                  {t('move.copy')}
                  <span className="block text-xs text-fg-subtle">{t('move.copyHint')}</span>
                </span>
              </label>
            </fieldset>
            {target?.type === 'Team' && (
              <p className="text-xs text-fg-subtle">{t('move.teamNotice', { name: target.name })}</p>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
