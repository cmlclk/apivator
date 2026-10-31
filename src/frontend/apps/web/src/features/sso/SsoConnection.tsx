import { useState, type FormEvent, type ReactNode } from 'react';
import { Alert, Button, Input } from '@apivator/ui';
import { type OrganizationRole, type SsoSettingsDto } from '@apivator/core';
import { useT } from '../../i18n';
import { api } from '../../lib/api';
import { errorMessage, fieldError } from '../../lib/errors';
import { ORGANIZATION_ROLE_LABELS, selectClass } from '../../lib/teams';
import { CopyButton } from '../../components/ui/CopyButton';

const ROLE_CHOICES: OrganizationRole[] = ['Member', 'Admin'];
const FORM_FIELDS = ['authority', 'clientId', 'clientSecret'];

const PROVIDER_HINTS: [string, string | null][] = [
  ['Microsoft Entra ID', 'https://login.microsoftonline.com/{tenant-id}/v2.0'],
  ['Google Workspace', 'https://accounts.google.com'],
  ['Okta / Keycloak', null],
];

export function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-line p-4">
      <h3 className="text-sm font-medium">
        <span className="me-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-muted text-xs">
          {n}
        </span>
        {title}
      </h3>
      {children}
    </section>
  );
}

export function ProviderStep({ redirectUri }: { redirectUri: string }) {
  const t = useT('sso');
  return (
    <Step n={1} title={t('provider.title')}>
      <p className="text-[13px] text-fg-muted">{t('provider.body')}</p>
      <div className="flex items-center gap-2">
        <code
          aria-label={t('provider.redirectUri')}
          className="min-w-0 flex-1 truncate rounded-md border border-line bg-muted px-2 py-1.5 font-mono text-xs"
        >
          {redirectUri}
        </code>
        <CopyButton text={redirectUri} label={t('provider.copy')} />
      </div>
      <ul className="flex flex-col gap-1 text-xs text-fg-muted">
        {PROVIDER_HINTS.map(([name, issuer]) => (
          <li key={name}>
            <span className="font-medium">{name}:</span>{' '}
            <span className="font-mono">{issuer ?? t('provider.issuerExample')}</span>
          </li>
        ))}
      </ul>
    </Step>
  );
}

interface FormState {
  authority: string;
  clientId: string;
  clientSecret: string;
  removeSecret: boolean;
  autoProvision: boolean;
  defaultRole: OrganizationRole;
}

export function ConnectionStep({
  organizationId,
  settings,
  canEdit,
  onSaved,
}: {
  organizationId: string;
  settings: SsoSettingsDto;
  canEdit: boolean;
  onSaved: (next: SsoSettingsDto) => void;
}) {
  const t = useT('sso');
  const [form, setForm] = useState<FormState>({
    authority: settings.authority ?? '',
    clientId: settings.clientId ?? '',
    clientSecret: '',
    removeSecret: false,
    autoProvision: settings.autoProvision,
    defaultRole: settings.defaultRole,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const patch = (changes: Partial<FormState>) => {
    setForm((f) => ({ ...f, ...changes }));
    setSaved(false);
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const next = await api.organizations.sso.update(organizationId, {
        authority: form.authority.trim(),
        clientId: form.clientId.trim(),
        // null: kayıtlı secret korunur; "": silinir.
        clientSecret: form.removeSecret ? '' : form.clientSecret || null,
        autoProvision: form.autoProvision,
        defaultRole: form.defaultRole,
      });
      onSaved(next);
      setForm((f) => ({ ...f, clientSecret: '', removeSecret: false }));
      setSaved(true);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const showGeneral = error != null && !FORM_FIELDS.some((f) => fieldError(error, f));
  return (
    <Step n={2} title={t('connection.title')}>
      <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
        <fieldset disabled={!canEdit || busy} className="flex flex-col gap-3">
          <Input
            label={t('connection.authority')}
            placeholder="https://login.microsoftonline.com/{tenant-id}/v2.0"
            value={form.authority}
            error={fieldError(error, 'authority')}
            onChange={(e) => patch({ authority: e.target.value })}
          />
          <Input
            label={t('connection.clientId')}
            value={form.clientId}
            error={fieldError(error, 'clientId')}
            onChange={(e) => patch({ clientId: e.target.value })}
          />
          <Input
            label={t('connection.clientSecret')}
            type="password"
            autoComplete="new-password"
            placeholder={settings.hasClientSecret && !form.removeSecret ? t('connection.stored') : ''}
            hint={t('connection.secretHint')}
            value={form.clientSecret}
            disabled={form.removeSecret}
            error={fieldError(error, 'clientSecret')}
            onChange={(e) => patch({ clientSecret: e.target.value })}
          />
          {settings.hasClientSecret && (
            <label className="flex items-center gap-2 text-[13px] text-fg-muted">
              <input
                type="checkbox"
                checked={form.removeSecret}
                onChange={(e) => patch({ removeSecret: e.target.checked })}
              />
              {t('connection.removeSecret')}
            </label>
          )}
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-1"
              checked={form.autoProvision}
              onChange={(e) => patch({ autoProvision: e.target.checked })}
            />
            <span>
              <span className="block text-sm font-medium">{t('connection.autoProvision')}</span>
              <span className="block text-[13px] text-fg-muted">{t('connection.autoProvisionHint')}</span>
            </span>
          </label>
          <label className="flex items-center gap-2 text-[13px] text-fg-muted">
            {t('connection.defaultRole')}
            <select
              aria-label={t('connection.defaultRole')}
              value={form.defaultRole}
              onChange={(e) => patch({ defaultRole: e.target.value as OrganizationRole })}
              className={selectClass}
            >
              {ROLE_CHOICES.map((role) => (
                <option key={role} value={role}>
                  {ORGANIZATION_ROLE_LABELS[role]}
                </option>
              ))}
            </select>
          </label>
        </fieldset>
        {showGeneral && <Alert tone="error">{errorMessage(error)}</Alert>}
        {saved && <Alert tone="success">{t('connection.saved')}</Alert>}
        {canEdit && (
          <Button
            type="submit"
            size="sm"
            className="self-start"
            loading={busy}
            disabled={!form.authority.trim() || !form.clientId.trim()}
          >
            {t('connection.save')}
          </Button>
        )}
      </form>
    </Step>
  );
}
