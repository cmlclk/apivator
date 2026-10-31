import { useState, type FormEvent } from 'react';
import { Server } from 'lucide-react';
import { Alert, Button, Input } from '@apivator/ui';
import { useT } from '../i18n';
import { normalizeServerUrl, serverUrl, setServerUrl } from '../lib/serverUrl';

/** Masaüstü: hangi Apivator sunucusuna bağlanılacağı (giriş ekranlarında). */
export function ServerSetting() {
  const t = useT('shell');
  const tc = useT('common');
  const [current, setCurrent] = useState(serverUrl);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(current);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    const normalized = normalizeServerUrl(value);
    if ('error' in normalized) {
      setError(normalized.error);
      return;
    }
    setChecking(true);
    setError(null);
    try {
      const response = await fetch(`${normalized.url}/health/live`, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error(String(response.status));
      setServerUrl(normalized.url);
      setCurrent(normalized.url);
      setEditing(false);
    } catch {
      setError(t('server.unreachable'));
    } finally {
      setChecking(false);
    }
  }

  if (!editing) {
    return (
      <p className="mt-8 flex items-center gap-2 border-t border-line pt-4 text-xs text-fg-muted">
        <Server className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 truncate">
          {t('server.current')} <span className="font-mono text-fg">{current}</span>
        </span>
        <button
          type="button"
          onClick={() => {
            setValue(current);
            setEditing(true);
          }}
          className="ms-auto shrink-0 font-medium text-accent hover:underline"
        >
          {t('server.change')}
        </button>
      </p>
    );
  }

  return (
    <form onSubmit={save} className="mt-8 flex flex-col gap-3 border-t border-line pt-4" noValidate>
      {error && <Alert tone="error">{error}</Alert>}
      <Input
        label={t('server.address')}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="https://apivator.sirket.com"
        autoFocus
      />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
          {tc('actions.cancel')}
        </Button>
        <Button type="submit" size="sm" loading={checking}>
          {t('server.connect')}
        </Button>
      </div>
    </form>
  );
}
