import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Spinner } from '@apivator/ui';
import { type OrganizationDto, type SsoSettingsDto } from '@apivator/core';
import { useT } from '../../i18n';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { ConnectionStep, ProviderStep, Step } from './SsoConnection';
import { DomainsStep } from './SsoDomains';

const ssoQueryKey = (organizationId: string) => ['organizations', organizationId, 'sso'] as const;

function StateStep({
  organizationId,
  settings,
  canEdit,
  onChanged,
}: {
  organizationId: string;
  settings: SsoSettingsDto;
  canEdit: boolean;
  onChanged: (next: SsoSettingsDto) => void;
}) {
  const t = useT('sso');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasVerified = settings.domains.some((d) => d.verified);
  const ready = settings.configured && hasVerified;

  async function change(enabled: boolean, enforced: boolean) {
    setBusy(true);
    setError(null);
    try {
      onChanged(await api.organizations.sso.setState(organizationId, { enabled, enforced }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Step n={4} title={t('state.title')}>
      {!ready && <p className="text-[13px] text-fg-muted">{t('state.notReady')}</p>}
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-1"
          checked={settings.enabled}
          disabled={!canEdit || busy || (!ready && !settings.enabled)}
          onChange={(e) => void change(e.target.checked, e.target.checked ? settings.enforced : false)}
        />
        <span>
          <span className="block text-sm font-medium">{t('state.enable')}</span>
          <span className="block text-[13px] text-fg-muted">{t('state.enableHint')}</span>
        </span>
      </label>
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-1"
          checked={settings.enforced}
          disabled={!canEdit || busy || !settings.enabled}
          onChange={(e) => void change(settings.enabled, e.target.checked)}
        />
        <span>
          <span className="block text-sm font-medium">{t('state.enforce')}</span>
          <span className="block text-[13px] text-fg-muted">{t('state.enforceHint')}</span>
        </span>
      </label>
      {error && <Alert tone="error">{error}</Alert>}
    </Step>
  );
}

/** Organizasyonun OIDC tek oturum açma ayarları: yönetici görür, yalnızca sahip değiştirir. */
export function SsoTab({ organization }: { organization: OrganizationDto }) {
  const t = useT('sso');
  const queryClient = useQueryClient();
  const canEdit = organization.role === 'Owner';
  const { data, error, isLoading } = useQuery({
    queryKey: ssoQueryKey(organization.id),
    queryFn: () => api.organizations.sso.get(organization.id),
  });
  const update = (next: SsoSettingsDto) => queryClient.setQueryData(ssoQueryKey(organization.id), next);

  if (isLoading) return <Spinner className="mx-auto h-4 w-4 text-fg-subtle" />;
  if (error || !data) return <Alert tone="error">{errorMessage(error)}</Alert>;
  return (
    <div className="flex flex-col gap-3">
      {!canEdit && <Alert tone="info">{t('ownerOnly')}</Alert>}
      <ProviderStep redirectUri={data.redirectUri} />
      <ConnectionStep organizationId={organization.id} settings={data} canEdit={canEdit} onSaved={update} />
      <DomainsStep organizationId={organization.id} settings={data} canEdit={canEdit} onChanged={update} />
      <StateStep organizationId={organization.id} settings={data} canEdit={canEdit} onChanged={update} />
    </div>
  );
}
