import { useState, type FormEvent } from 'react';
import { BadgeCheck, Trash2 } from 'lucide-react';
import { Alert, Button, Input } from '@apivator/ui';
import { type SsoDomainDto, type SsoSettingsDto } from '@apivator/core';
import { useT } from '../../i18n';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { CopyButton } from '../../components/ui/CopyButton';
import { Step } from './SsoConnection';

function DomainRow({
  domain,
  canEdit,
  busy,
  onVerify,
  onRemove,
}: {
  domain: SsoDomainDto;
  canEdit: boolean;
  busy: boolean;
  onVerify: () => void;
  onRemove: () => void;
}) {
  const t = useT('sso');
  return (
    <li className="flex flex-col gap-2 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[13px] font-medium">{domain.domain}</span>
        {domain.verified ? (
          <span className="inline-flex items-center gap-1 text-xs text-success">
            <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" /> {t('domains.verified')}
          </span>
        ) : (
          <span className="text-xs text-warning">{t('domains.pending')}</span>
        )}
        <div className="flex-1" />
        {canEdit && !domain.verified && (
          <Button size="sm" variant="secondary" disabled={busy} onClick={onVerify}>
            {t('domains.verify')}
          </Button>
        )}
        {canEdit && (
          <Button
            size="icon"
            variant="ghost"
            aria-label={t('domains.remove', { domain: domain.domain })}
            disabled={busy}
            onClick={onRemove}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      {!domain.verified && (
        <dl className="grid grid-cols-[max-content_1fr_auto] items-center gap-x-3 gap-y-1 text-xs">
          <dt className="text-fg-subtle">{t('domains.recordName')}</dt>
          <dd className="min-w-0 break-all font-mono text-fg-muted">{domain.recordName}</dd>
          <CopyButton compact text={domain.recordName} label={t('domains.copyName')} />
          <dt className="text-fg-subtle">{t('domains.recordValue')}</dt>
          <dd className="min-w-0 break-all font-mono text-fg-muted">{domain.recordValue}</dd>
          <CopyButton compact text={domain.recordValue} label={t('domains.copyValue')} />
        </dl>
      )}
    </li>
  );
}

export function DomainsStep({
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
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<SsoSettingsDto>, after?: () => void) {
    setBusy(true);
    setError(null);
    try {
      onChanged(await action());
      after?.();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function add(event: FormEvent) {
    event.preventDefault();
    void run(
      () => api.organizations.sso.addDomain(organizationId, name.trim()),
      () => setName(''),
    );
  }

  return (
    <Step n={3} title={t('domains.title')}>
      <p className="text-[13px] text-fg-muted">{t('domains.body')}</p>
      {settings.domains.length > 0 && (
        <ul aria-label={t('domains.list')} className="divide-y divide-line rounded-md border border-line">
          {settings.domains.map((d) => (
            <DomainRow
              key={d.id}
              domain={d}
              canEdit={canEdit}
              busy={busy}
              onVerify={() => void run(() => api.organizations.sso.verifyDomain(organizationId, d.id))}
              onRemove={() => void run(() => api.organizations.sso.removeDomain(organizationId, d.id))}
            />
          ))}
        </ul>
      )}
      {error && <Alert tone="error">{error}</Alert>}
      {canEdit && (
        <form onSubmit={add} className="flex items-end gap-2" noValidate>
          <Input
            aria-label={t('domains.name')}
            placeholder="firma.com"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-64"
          />
          <Button type="submit" size="sm" variant="secondary" disabled={busy || !name.trim()}>
            {t('domains.add')}
          </Button>
        </form>
      )}
    </Step>
  );
}
