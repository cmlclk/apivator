import { useState, type FormEvent } from 'react';
import { Alert, Button, Input } from '@apivator/ui';
import type { MockServerDto } from '@apivator/core';
import { Dialog } from '../../components/ui/Dialog';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { useT } from '../../i18n';
import { selectClass } from '../../lib/teams';
import { useCollections } from '../collections/useCollections';
import { useEnvironments } from '../environments/useVariables';

/** Yeni mock oluşturma ya da var olanın ayarları. */
export function MockSettingsDialog({
  workspaceId,
  mock,
  collectionId: initialCollectionId,
  onSaved,
  onClose,
}: {
  workspaceId: string;
  /** Verilirse düzenleme. */
  mock?: MockServerDto;
  /** Yeni mock için önceden seçili collection. */
  collectionId?: string;
  onSaved: (mock: MockServerDto) => void;
  onClose: () => void;
}) {
  const t = useT('mocks');
  const { data: collections } = useCollections(workspaceId);
  const { data: environments } = useEnvironments(workspaceId);
  const [collectionId, setCollectionId] = useState(mock?.collectionId ?? initialCollectionId ?? '');
  const initialName = mock?.name ?? collections?.find((c) => c.id === initialCollectionId)?.name ?? '';
  const [name, setName] = useState(initialName);
  const [environmentId, setEnvironmentId] = useState(mock?.environmentId ?? '');
  const [isPrivate, setIsPrivate] = useState(mock?.isPrivate ?? false);
  const [delay, setDelay] = useState(String(mock?.delayMs ?? 0));
  const [enabled, setEnabled] = useState(mock?.enabled ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = collectionId || collections?.[0]?.id || '';
  const defaultName = collections?.find((c) => c.id === selected)?.name ?? '';
  const delayMs = Number(delay);
  const delayValid = Number.isInteger(delayMs) && delayMs >= 0 && delayMs <= 60_000;

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const settings = {
      name: name.trim() || defaultName,
      environmentId: environmentId || null,
      isPrivate,
      delayMs,
    };
    try {
      onSaved(
        mock
          ? await api.mocks.update(mock.id, { ...settings, enabled })
          : await api.mocks.create(workspaceId, selected, settings),
      );
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={mock ? t('settings.titleEdit', { name: mock.name }) : t('settings.titleNew')}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('settings.cancel')}
          </Button>
          <Button type="submit" form="mock-settings" loading={busy} disabled={!selected || !delayValid}>
            {mock ? t('settings.save') : t('settings.create')}
          </Button>
        </>
      }
    >
      <form id="mock-settings" onSubmit={save} className="flex flex-col gap-4 text-[13px]">
        {!mock && <p className="text-fg-muted">{t('settings.intro')}</p>}
        {error && <Alert tone="error">{error}</Alert>}

        <label className="flex flex-col gap-1.5 text-sm font-medium">
          {t('settings.collection')}
          <select
            value={selected}
            disabled={Boolean(mock)}
            onChange={(e) => setCollectionId(e.target.value)}
            className={`${selectClass} h-9`}
          >
            {collections?.length === 0 && <option value="">{t('settings.noCollections')}</option>}
            {collections?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <Input
          label={t('settings.name')}
          placeholder={defaultName}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
        />

        <label className="flex flex-col gap-1.5 text-sm font-medium">
          {t('settings.environment')}
          <select
            value={environmentId}
            onChange={(e) => setEnvironmentId(e.target.value)}
            className={`${selectClass} h-9`}
          >
            <option value="">{t('settings.environmentNone')}</option>
            {environments?.map((env) => (
              <option key={env.id} value={env.id}>
                {env.name}
              </option>
            ))}
          </select>
          <span className="text-xs font-normal text-fg-subtle">
            {t('settings.environmentHint', { token: `{{${t('settings.variableName')}}}` })}
          </span>
        </label>

        <Input
          label={t('settings.delay')}
          type="number"
          min={0}
          max={60000}
          step={50}
          value={delay}
          onChange={(e) => setDelay(e.target.value)}
          error={delayValid ? undefined : t('settings.delayError')}
          hint={t('settings.delayHint')}
        />

        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={isPrivate}
            onChange={(e) => setIsPrivate(e.target.checked)}
          />
          <span>
            <span className="font-medium">{t('settings.private')}</span>
            <span className="block text-fg-subtle">
              {t.rich('settings.privateHint', {
                code: (c) => <code className="rounded bg-muted px-1">{c}</code>,
              })}
            </span>
          </span>
        </label>

        {mock && (
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            <span>
              <span className="font-medium">{t('settings.enabled')}</span>
              <span className="block text-fg-subtle">{t('settings.enabledHint')}</span>
            </span>
          </label>
        )}
      </form>
    </Dialog>
  );
}
