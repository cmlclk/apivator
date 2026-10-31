import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Input } from '@apivator/ui';
import type { CollectionTreeDto, ForkInfoDto } from '@apivator/core';
import { Dialog } from '../../components/ui/Dialog';
import { useT } from '../../i18n';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { selectClass } from '../../lib/teams';
import { useWorkspaces } from '../../lib/useWorkspaces';
import { collectionsQueryKey } from '../collections/useCollections';
import { workspaceForksQueryKey } from './useForks';

/** Collection'ı düzenleme yetkisi olan bir workspace'e fork'lar (görüntüleyiciler de kendi kopyalarında çalışabilir). */
export function ForkCollectionDialog({
  collection,
  onForked,
  onClose,
}: {
  collection: CollectionTreeDto;
  onForked: (fork: ForkInfoDto) => void;
  onClose: () => void;
}) {
  const t = useT('forks');
  const queryClient = useQueryClient();
  const { workspaces } = useWorkspaces();
  const targets = workspaces.filter((w) => w.role !== 'Viewer');
  const personal = targets.find((w) => w.type === 'Personal');
  const [target, setTarget] = useState(personal?.id ?? targets[0]?.id ?? '');
  const [name, setName] = useState(() => t('fork.defaultName', { name: collection.name }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const fork = await api.forks.create(collection.id, target, name.trim());
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: collectionsQueryKey(target) }),
        queryClient.invalidateQueries({ queryKey: workspaceForksQueryKey(target) }),
      ]);
      onForked(fork);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={t('fork.title', { name: collection.name })}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('fork.cancel')}
          </Button>
          <Button type="submit" form="fork-collection" loading={busy} disabled={!target || !name.trim()}>
            {t('fork.submit')}
          </Button>
        </>
      }
    >
      <form id="fork-collection" onSubmit={submit} className="flex flex-col gap-4 text-[13px]">
        <p className="text-fg-muted">{t('fork.intro')}</p>
        {error && <Alert tone="error">{error}</Alert>}
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          {t('fork.target')}
          <select value={target} onChange={(e) => setTarget(e.target.value)} className={`${selectClass} h-9`}>
            {targets.map((w) => (
              <option key={w.id} value={w.id}>
                {w.type === 'Personal' ? w.name : `${w.organizationName} / ${w.name}`}
              </option>
            ))}
          </select>
        </label>
        <Input
          label={t('fork.name')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
        />
      </form>
    </Dialog>
  );
}
