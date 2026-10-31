import { useState } from 'react';
import { KeyRound, Plus, X } from 'lucide-react';
import { useT } from '../../i18n';
import type { AccessState } from './access';

/**
 * Korumalı belgeler için erişim bilgisi. Değerler yalnızca bu istekte kullanılır, saklanmaz; header'lar yalnızca
 * belgenin sunucusuna gönderilir.
 */
export function AccessHeaders({
  value,
  onChange,
  disabled,
}: {
  value: AccessState;
  onChange: (value: AccessState) => void;
  disabled?: boolean;
}) {
  const t = useT('exchange');
  const [open, setOpen] = useState(value.token !== '' || value.headers.length > 0);
  const setHeader = (index: number, change: Partial<{ key: string; value: string }>) =>
    onChange({ ...value, headers: value.headers.map((h, i) => (i === index ? { ...h, ...change } : h)) });

  const inputClass =
    'h-8 min-w-0 rounded-md border border-line bg-surface px-2.5 text-[13px] focus:border-accent focus:ring-2 focus:ring-accent/25 focus:outline-none';

  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      className="rounded-md border border-line"
    >
      <summary className="flex cursor-pointer items-center gap-1.5 px-3 py-2 text-[13px] font-medium select-none">
        <KeyRound className="h-3.5 w-3.5 text-fg-subtle" aria-hidden="true" />
        {t('access.summary')} <span className="font-normal text-fg-subtle">{t('access.summaryHint')}</span>
      </summary>
      <div className="space-y-2 border-t border-line px-3 py-3">
        <label className="flex flex-col gap-1 text-xs font-medium">
          {t('access.bearerToken')}
          <input
            type="password"
            autoComplete="off"
            value={value.token}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, token: e.target.value })}
            placeholder="eyJhbGciOi…"
            className={`${inputClass} font-mono`}
          />
        </label>
        {value.headers.map((h, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              aria-label={t('access.headerName', { n: i + 1 })}
              value={h.key}
              disabled={disabled}
              onChange={(e) => setHeader(i, { key: e.target.value })}
              placeholder="X-Api-Key"
              className={`${inputClass} w-40 font-mono`}
            />
            <input
              aria-label={t('access.headerValue', { n: i + 1 })}
              value={h.value}
              disabled={disabled}
              onChange={(e) => setHeader(i, { value: e.target.value })}
              placeholder={t('access.valuePlaceholder')}
              className={`${inputClass} flex-1 font-mono`}
            />
            <button
              type="button"
              aria-label={t('access.removeHeader', { n: i + 1 })}
              onClick={() => onChange({ ...value, headers: value.headers.filter((_, j) => j !== i) })}
              className="rounded p-1 text-fg-subtle hover:bg-muted hover:text-fg"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange({ ...value, headers: [...value.headers, { key: '', value: '' }] })}
            className="flex items-center gap-1 text-xs text-accent hover:underline"
          >
            <Plus className="h-3 w-3" /> {t('access.addHeader')}
          </button>
          <span className="text-[11px] text-fg-subtle">{t('access.notStored')}</span>
        </div>
      </div>
    </details>
  );
}
