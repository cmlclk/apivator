import { lazy, Suspense } from 'react';
import type { CollectionTreeDto } from '@apivator/core';
import { useSourceUi } from './sourceUi';

const SourceDialog = lazy(() => import('./SourceDialog').then((m) => ({ default: m.SourceDialog })));

/** Açık kaynak penceresi (ayrı parçada yüklenir); collection listesi CollectionsPanel'den gelir. */
export function SourceDialogHost({
  collections,
  canEdit,
}: {
  collections: CollectionTreeDto[] | undefined;
  canEdit: (collection: CollectionTreeDto) => boolean;
}) {
  const collectionId = useSourceUi((s) => s.collectionId);
  const close = useSourceUi((s) => s.close);
  const collection = collections?.find((c) => c.id === collectionId);
  if (!collection) return null;
  return (
    <Suspense fallback={null}>
      <SourceDialog collection={collection} canEdit={canEdit(collection)} onClose={close} />
    </Suspense>
  );
}
