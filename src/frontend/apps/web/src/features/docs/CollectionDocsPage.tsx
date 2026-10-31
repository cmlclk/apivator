import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Share2 } from 'lucide-react';
import { Alert, Button, Spinner } from '@apivator/ui';
import { api } from '../../lib/api';
import { useT } from '../../i18n';
import { errorMessage } from '../../lib/errors';
import { useWorkspaces } from '../../lib/useWorkspaces';
import { useCollections } from '../collections/useCollections';
import { canEditCollection } from '../collections/collectionAccess';
import { useActiveEnvironment, useEnvironments } from '../environments/useVariables';
import { DocsView } from './DocsView';
import { PublishDialog } from './PublishDialog';
import { usePublication } from './publication';

/** Uygulama içindeki doküman görünümü: environment seçilir, buradan yayınlanır. */
export function CollectionDocsPage() {
  const t = useT('docs');
  const { collectionId = '' } = useParams();
  const { current } = useWorkspaces();
  const { data: collections = [] } = useCollections(current?.id);
  const collection = collections.find((c) => c.id === collectionId);
  const { data: environments = [] } = useEnvironments(current?.id);
  const active = useActiveEnvironment(current?.id);
  const [environmentId, setEnvironmentId] = useState<string | null | undefined>(undefined);
  const chosen = environmentId === undefined ? (active?.id ?? null) : environmentId;
  const [publishOpen, setPublishOpen] = useState(false);
  const { data: publication } = usePublication(collectionId);

  const {
    data: doc,
    error,
    isLoading,
  } = useQuery({
    queryKey: ['documentation', collectionId, chosen],
    queryFn: () => api.docs.get(collectionId, chosen),
    placeholderData: (previous) => previous,
  });

  if (isLoading && !doc) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner className="h-5 w-5" />
      </div>
    );
  }
  if (!doc) {
    return (
      <div className="p-6">
        <Alert tone="error">{error ? errorMessage(error) : t('page.loadFailed')}</Alert>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1">
      <DocsView
        doc={doc}
        toolbar={
          <>
            <select
              value={chosen ?? ''}
              onChange={(e) => setEnvironmentId(e.target.value || null)}
              aria-label={t('page.environmentLabel')}
              className="h-8 rounded-md border border-line bg-surface px-2 text-xs focus:border-accent focus:outline-none"
            >
              <option value="">{t('page.noEnvironment')}</option>
              {environments.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              variant={publication ? 'secondary' : 'primary'}
              onClick={() => setPublishOpen(true)}
            >
              <Share2 className="h-3.5 w-3.5" /> {publication ? t('page.published') : t('page.publish')}
            </Button>
            <Link
              to="/"
              className="flex h-8 items-center gap-1 rounded-md px-2 text-xs text-fg-muted hover:bg-muted hover:text-fg"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> {t('page.backToRequests')}
            </Link>
          </>
        }
      />
      {publishOpen && (
        <PublishDialog
          collectionId={collectionId}
          collectionName={doc.name}
          environments={environments}
          isAdmin={current?.role === 'Admin'}
          canEdit={canEditCollection(collection, current?.role)}
          onClose={() => setPublishOpen(false)}
        />
      )}
    </div>
  );
}
