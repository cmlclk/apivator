import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { publicationQueryKey, usePublication } from './publication';
import { Globe, Building2, RefreshCw } from 'lucide-react';
import { Alert, Button, Spinner, cn } from '@apivator/ui';
import type { DocPublicationDto, DocVisibility, EnvironmentDto } from '@apivator/core';
import { Dialog } from '../../components/ui/Dialog';
import { CopyButton } from '../../components/ui/CopyButton';
import { api } from '../../lib/api';
import { useT } from '../../i18n';
import { errorMessage } from '../../lib/errors';

const OPTIONS: { id: DocVisibility; key: 'organization' | 'public'; icon: typeof Globe }[] = [
  { id: 'Organization', key: 'organization', icon: Building2 },
  { id: 'Public', key: 'public', icon: Globe },
];

/**
 * Dokümanı yayınlama: görünürlük ve değişken değerleri için environment. Doküman canlıdır; collection'daki her
 * değişiklik bağlantıda hemen görünür. Gizli değişken değerleri, yetkilendirme bilgileri ve script'ler yayınlanmaz.
 */
export function PublishDialog({
  collectionId,
  collectionName,
  environments,
  isAdmin,
  canEdit,
  onClose,
}: {
  collectionId: string;
  collectionName: string;
  environments: EnvironmentDto[];
  isAdmin: boolean;
  canEdit: boolean;
  onClose: () => void;
}) {
  const t = useT('docs');
  const queryClient = useQueryClient();
  const { data: publication, isLoading } = usePublication(collectionId);
  const [visibility, setVisibility] = useState<DocVisibility | null>(null);
  const [environmentId, setEnvironmentId] = useState<string | null | undefined>(undefined);
  const chosenVisibility = visibility ?? publication?.visibility ?? 'Organization';
  const chosenEnvironment =
    environmentId === undefined ? (publication?.environmentId ?? null) : environmentId;

  const update = (next: DocPublicationDto | null) =>
    queryClient.setQueryData(publicationQueryKey(collectionId), next);
  const publish = useMutation({
    mutationFn: () =>
      api.docs.publish(collectionId, { visibility: chosenVisibility, environmentId: chosenEnvironment }),
    onSuccess: (next) => {
      update(next);
      setVisibility(null);
      setEnvironmentId(undefined);
    },
  });
  const regenerate = useMutation({ mutationFn: () => api.docs.regenerate(collectionId), onSuccess: update });
  const unpublish = useMutation({
    mutationFn: () => api.docs.unpublish(collectionId),
    onSuccess: () => update(null),
  });
  const error = publish.error ?? regenerate.error ?? unpublish.error;
  const busy = publish.isPending || regenerate.isPending || unpublish.isPending;
  const changed =
    !publication ||
    chosenVisibility !== publication.visibility ||
    chosenEnvironment !== publication.environmentId;

  return (
    <Dialog
      title={t('publish.title', { name: collectionName })}
      size="lg"
      onClose={onClose}
      footer={
        <>
          {publication && canEdit && (
            <Button
              variant="ghost"
              className="me-auto text-danger"
              disabled={busy}
              onClick={() => unpublish.mutate()}
            >
              {t('publish.unpublish')}
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            {t('publish.close')}
          </Button>
          {canEdit && (
            <Button onClick={() => publish.mutate()} disabled={busy || isLoading || !changed}>
              {publish.isPending && <Spinner className="h-3.5 w-3.5" />}
              {publication ? t('publish.saveChanges') : t('publish.publish')}
            </Button>
          )}
        </>
      }
    >
      {error && (
        <Alert tone="error" className="mb-3">
          {errorMessage(error)}
        </Alert>
      )}
      {isLoading ? (
        <Spinner className="mx-auto my-6 h-5 w-5" />
      ) : (
        <div className="flex flex-col gap-4 text-sm">
          {publication ? (
            <div className="rounded-md border border-success/30 bg-success/5 p-3">
              <p className="text-xs font-medium text-success">
                {t('publish.status', { visibility: publication.visibility, by: publication.publishedBy })}
              </p>
              <div className="mt-2 flex items-center gap-2">
                <a
                  href={publication.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-accent underline"
                >
                  {publication.url}
                </a>
                <CopyButton text={publication.url} label={t('publish.copyLink')} />
                {canEdit && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => regenerate.mutate()}
                    title={t('publish.regenerateTitle')}
                  >
                    <RefreshCw className="h-3.5 w-3.5" /> {t('publish.regenerate')}
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <p className="text-fg-muted">{t('publish.intro')}</p>
          )}

          <fieldset disabled={!canEdit}>
            <legend className="mb-1.5 font-medium">{t('publish.whoCanSee')}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {OPTIONS.map((o) => {
                const disabled = o.id === 'Public' && !isAdmin;
                return (
                  <label
                    key={o.id}
                    className={cn(
                      'flex cursor-pointer gap-2 rounded-md border p-3',
                      chosenVisibility === o.id
                        ? 'border-accent bg-accent/5'
                        : 'border-line hover:bg-muted/50',
                      disabled && 'cursor-not-allowed opacity-60',
                    )}
                  >
                    <input
                      type="radio"
                      name="visibility"
                      value={o.id}
                      checked={chosenVisibility === o.id}
                      disabled={disabled}
                      onChange={() => setVisibility(o.id)}
                      className="mt-0.5"
                    />
                    <span>
                      <span className="flex items-center gap-1.5 font-medium">
                        <o.icon className="h-3.5 w-3.5" aria-hidden="true" />{' '}
                        {t(`publish.visibility.${o.key}.label`)}
                      </span>
                      <span className="mt-0.5 block text-xs text-fg-muted">
                        {t(`publish.visibility.${o.key}.hint`)}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <label className="flex flex-col gap-1">
            <span className="font-medium">{t('publish.variableValues')}</span>
            <select
              value={chosenEnvironment ?? ''}
              disabled={!canEdit}
              onChange={(e) => setEnvironmentId(e.target.value || null)}
              aria-label={t('publish.environmentLabel')}
              className="h-9 rounded-md border border-line bg-surface px-2 focus:border-accent focus:outline-none"
            >
              <option value="">{t('publish.collectionVariablesOnly')}</option>
              {environments.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
            <span className="text-xs text-fg-subtle">
              {t('publish.variableHint', { example: '{{baseUrl}}' })}
            </span>
          </label>
        </div>
      )}
    </Dialog>
  );
}
