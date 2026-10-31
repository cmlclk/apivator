import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Trash2 } from 'lucide-react';
import { Alert, Button, Input, Spinner } from '@apivator/ui';
import type { CreatedApiKeyDto } from '@apivator/core';
import { useT } from '../../i18n';
import { CopyButton } from '../../components/ui/CopyButton';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { serverUrl } from '../../lib/serverUrl';
import { fullTime, timeAgo } from '../activity/activity';
import { selectClass } from '../../lib/teams';

const keysQueryKey = ['api-keys'] as const;

const EXPIRY = [
  { id: 'd30', days: 30 },
  { id: 'd90', days: 90 },
  { id: 'y1', days: 365 },
  { id: 'never', days: null },
] as const;

/** Komut satırı (apivator run) ve CI için kişisel API anahtarları (Hesap ayarları › API anahtarları). */
export function ApiKeysSection() {
  const t = useT('account');
  const queryClient = useQueryClient();
  const { data: keys, isLoading } = useQuery({ queryKey: keysQueryKey, queryFn: api.apiKeys.list });
  const [name, setName] = useState('');
  const [days, setDays] = useState<number | null>(90);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedApiKeyDto | null>(null);
  const server = serverUrl() || window.location.origin;

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setCreated(await api.apiKeys.create(name, days));
      setName('');
      await queryClient.invalidateQueries({ queryKey: keysQueryKey });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setError(null);
    try {
      await api.apiKeys.revoke(id);
      if (created?.key.id === id) setCreated(null);
      await queryClient.invalidateQueries({ queryKey: keysQueryKey });
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const example = t('apiKeys.example', {
    server,
    key: created?.secret ?? t('apiKeys.keyPlaceholder'),
  });

  return (
    <div className="flex flex-col gap-5 text-[13px]">
      <p className="text-fg-muted">
        {t.rich('apiKeys.intro', { code: (c) => <code className="rounded bg-muted px-1">{c}</code> })}
      </p>
      {error && <Alert tone="error">{error}</Alert>}

      {created && (
        <section
          aria-label={t('apiKeys.newKey')}
          className="flex flex-col gap-2 rounded-md border border-success/40 bg-success/5 p-3"
        >
          <p className="font-medium">{t('apiKeys.created', { name: created.key.name })}</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 rounded border border-line bg-surface px-2 py-1.5 font-mono text-xs break-all">
              {created.secret}
            </code>
            <CopyButton text={created.secret} label={t('apiKeys.copyKey')} />
          </div>
          <p className="mt-1 text-fg-muted">{t('apiKeys.ci')}</p>
        </section>
      )}

      <form onSubmit={create} className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <Input
            label={t('apiKeys.newKey')}
            placeholder={t('apiKeys.namePlaceholder')}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          {t('apiKeys.validity')}
          <select
            value={days ?? ''}
            onChange={(e) => setDays(e.target.value ? Number(e.target.value) : null)}
            className={`${selectClass} h-9`}
          >
            {EXPIRY.map((o) => (
              <option key={o.id} value={o.days ?? ''}>
                {t(`apiKeys.expiry.${o.id}`)}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" loading={busy} disabled={!name.trim()}>
          <KeyRound className="h-3.5 w-3.5" /> {t('apiKeys.create')}
        </Button>
      </form>

      <section aria-label={t('apiKeys.yourKeys')}>
        {isLoading ? (
          <Spinner className="mx-auto h-4 w-4 text-fg-subtle" />
        ) : keys && keys.length > 0 ? (
          <ul className="divide-y divide-line rounded-md border border-line">
            {keys.map((k) => (
              <li key={k.id} className="flex items-center gap-3 px-3 py-2">
                <KeyRound className="h-4 w-4 shrink-0 text-fg-subtle" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{k.name}</span>
                  <span className="block truncate text-xs text-fg-subtle">
                    <code>{k.prefix}…</code> · {fullTime(k.createdAt)} ·{' '}
                    {k.lastUsedAt
                      ? t('apiKeys.lastUsed', { time: timeAgo(k.lastUsedAt) })
                      : t('apiKeys.neverUsed')}{' '}
                    ·{' '}
                    {!k.active ? (
                      <span className="text-danger">{t('apiKeys.expired')}</span>
                    ) : k.expiresAt ? (
                      t('apiKeys.until', { date: fullTime(k.expiresAt) })
                    ) : (
                      t('apiKeys.noExpiry')
                    )}
                  </span>
                </span>
                <Button size="sm" variant="ghost" className="text-danger" onClick={() => void revoke(k.id)}>
                  <Trash2 className="h-3.5 w-3.5" /> {t('apiKeys.revoke')}
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-fg-subtle">{t('apiKeys.none')}</p>
        )}
      </section>

      <section aria-label={t('apiKeys.usage')} className="flex flex-col gap-2">
        <h3 className="font-semibold">{t('apiKeys.usage')}</h3>
        <p className="text-fg-muted">
          {t.rich('apiKeys.install', { code: (c) => <code className="rounded bg-muted px-1">{c}</code> })}
        </p>
        <div className="flex items-start gap-2">
          <pre className="min-w-0 flex-1 overflow-x-auto rounded-md border border-line bg-muted/40 p-2 font-mono text-xs">
            {example}
          </pre>
          <CopyButton text={example} label={t('apiKeys.copyCommand')} />
        </div>
        <p className="text-fg-muted">{t('apiKeys.exitCode')}</p>
      </section>
    </div>
  );
}
