import { useMemo, useState, type FormEvent } from 'react';
import { Alert, Button, Input } from '@apivator/ui';
import type { CollectionTreeDto, FolderDto } from '@apivator/core';
import { Dialog } from '../../components/ui/Dialog';
import { api } from '../../lib/api';
import { useT } from '../../i18n';
import { errorMessage } from '../../lib/errors';

interface Target {
  collectionId: string;
  folderId: string | null;
}

function folderOptions(
  folders: FolderDto[],
  parentId: string | null = null,
  depth = 1,
): { folder: FolderDto; depth: number }[] {
  return folders
    .filter((f) => f.parentFolderId === parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .flatMap((folder) => [{ folder, depth }, ...folderOptions(folders, folder.id, depth + 1)]);
}

/** Yeni bir sekmeyi collection'a (isteğe bağlı olarak bir klasöre) kaydeder. */
export function SaveRequestDialog({
  workspaceId,
  initialName,
  collections,
  onSave,
  onClose,
}: {
  workspaceId: string;
  initialName: string;
  collections: CollectionTreeDto[];
  onSave: (target: Target, name: string) => Promise<void>;
  onClose: () => void;
}) {
  const t = useT('requests');
  const [name, setName] = useState(initialName === t('tabs.newRequest') ? '' : initialName);
  const [target, setTarget] = useState<string>(collections[0] ? `${collections[0].id}|` : '');
  const [newCollection, setNewCollection] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const options = useMemo(
    () =>
      collections.flatMap((c) => [
        { value: `${c.id}|`, label: c.name },
        ...folderOptions(c.folders).map(({ folder, depth }) => ({
          value: `${c.id}|${folder.id}`,
          label: `${'   '.repeat(depth)}↳ ${folder.name}`,
        })),
      ]),
    [collections],
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      let collectionId: string;
      let folderId: string | null = null;
      if (collections.length === 0) {
        collectionId = (await api.collections.create(workspaceId, newCollection.trim() || 'Collection'))?.id;
      } else {
        const [c, f] = target.split('|');
        collectionId = c!;
        folderId = f || null;
      }
      await onSave({ collectionId, folderId }, name.trim());
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={t('saveRequest.title')}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('saveRequest.cancel')}
          </Button>
          <Button type="submit" form="save-request" loading={busy} disabled={!name.trim()}>
            {t('saveRequest.save')}
          </Button>
        </>
      }
    >
      <form id="save-request" onSubmit={submit} className="flex flex-col gap-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Input
          label={t('saveRequest.name')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('saveRequest.namePlaceholder')}
          required
        />
        {collections.length === 0 ? (
          <Input
            label={t('saveRequest.newCollection')}
            value={newCollection}
            onChange={(e) => setNewCollection(e.target.value)}
            placeholder={t('saveRequest.newCollectionPlaceholder')}
            hint={t('saveRequest.newCollectionHint')}
          />
        ) : (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="save-target" className="text-sm font-medium">
              {t('saveRequest.target')}
            </label>
            <select
              id="save-target"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="h-9 rounded-md border border-line bg-surface px-2 text-sm"
            >
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </form>
    </Dialog>
  );
}
