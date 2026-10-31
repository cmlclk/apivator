import { useState } from 'react';
import { Eye, EyeOff, Lock, LockOpen, Trash2 } from 'lucide-react';
import { Alert, Button, cn } from '@apivator/ui';
import type { Variable } from '@apivator/core';
import { Dialog } from '../../components/ui/Dialog';
import { useT } from '../../i18n';
import { errorMessage } from '../../lib/errors';

interface Row extends Variable {
  /** Bu kullanıcının yerel güncel değeri ('' = başlangıç değerini kullan). */
  current: string;
}

const cell =
  'h-8 w-full min-w-0 bg-transparent px-2 font-mono text-[12.5px] text-fg placeholder:text-fg-subtle focus:bg-surface focus:outline-none focus:ring-1 focus:ring-inset focus:ring-accent/50';

const emptyRow = (): Row => ({ key: '', value: '', enabled: true, isSecret: false, current: '' });

/**
 * Değişken tablosu: başlangıç değeri ekiple paylaşılır, güncel değer yalnızca bu tarayıcıda kalır.
 * Environment, collection ve globals için ortak.
 */
export function VariablesDialog({
  title,
  description,
  name,
  variables,
  currentValues,
  onSave,
  onClose,
  readOnly = false,
}: {
  title: string;
  description: string;
  /** Verilirse (environment) ad düzenlenebilir. */
  name?: string;
  variables: Variable[];
  currentValues: Record<string, string>;
  onSave: (result: {
    name: string;
    variables: Variable[];
    currentValues: Record<string, string>;
  }) => Promise<void>;
  onClose: () => void;
  readOnly?: boolean;
}) {
  const t = useT('environments');
  const [envName, setEnvName] = useState(name ?? '');
  const [rows, setRows] = useState<Row[]>(() =>
    variables.map((v) => ({ ...v, current: currentValues[v.key] ?? '' })),
  );
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const all = [...rows, emptyRow()];

  function update(index: number, patch: Partial<Row>) {
    if (index === rows.length) setRows([...rows, { ...emptyRow(), ...patch }]);
    else setRows(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const kept = rows.filter((r) => r.key.trim());
      const keys = kept.map((r) => r.key.trim());
      const duplicate = keys.find((k, i) => keys.indexOf(k) !== i);
      if (duplicate) throw new Error(t('variables.errors.duplicate', { name: duplicate }));

      const current: Record<string, string> = {};
      for (const r of kept) if (r.current !== '') current[r.key.trim()] = r.current;

      await onSave({
        name: envName.trim(),
        variables: kept.map(({ key, value, enabled, isSecret }) => ({
          key: key.trim(),
          value,
          enabled,
          isSecret,
        })),
        currentValues: current,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error && !('status' in e) ? e.message : errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <Dialog
      size="xl"
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {readOnly ? t('variables.close') : t('variables.cancel')}
          </Button>
          {!readOnly && (
            <Button loading={busy} onClick={save} disabled={name !== undefined && !envName.trim()}>
              {t('variables.save')}
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {name !== undefined && (
          <div className="flex items-center gap-3">
            <label htmlFor="env-name" className="w-16 text-[13px] text-fg-muted">
              {t('variables.name')}
            </label>
            <input
              id="env-name"
              value={envName}
              onChange={(e) => setEnvName(e.target.value)}
              disabled={readOnly}
              className="h-9 w-72 rounded-md border border-line bg-surface px-3 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </div>
        )}

        <div className="flex items-start justify-between gap-4">
          <p className="text-[13px] text-fg-muted">{description}</p>
          <button
            type="button"
            onClick={() => setReveal((r) => !r)}
            className="flex shrink-0 items-center gap-1.5 rounded px-2 py-1 text-xs text-fg-subtle hover:bg-muted hover:text-fg"
          >
            {reveal ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            {reveal ? t('variables.hideSecrets') : t('variables.showSecrets')}
          </button>
        </div>

        {error && <Alert tone="error">{error}</Alert>}

        <table className="w-full table-fixed border-collapse text-sm" aria-label={t('variables.tableLabel')}>
          <thead>
            <tr className="text-start text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
              <th className="w-8 border border-line" />
              <th className="w-[22%] border border-line px-2 py-1.5 font-medium">{t('variables.colName')}</th>
              <th className="border border-line px-2 py-1.5 font-medium">
                {t('variables.colInitial')}{' '}
                <span className="normal-case tracking-normal text-fg-subtle">
                  {t('variables.colInitialHint')}
                </span>
              </th>
              <th className="border border-line px-2 py-1.5 font-medium">
                {t('variables.colCurrent')}{' '}
                <span className="normal-case tracking-normal text-fg-subtle">
                  {t('variables.colCurrentHint')}
                </span>
              </th>
              <th className="w-16 border border-line" />
            </tr>
          </thead>
          <tbody>
            {all.map((row, index) => {
              const placeholder = index === rows.length;
              const masked = row.isSecret && !reveal;
              return (
                <tr key={index} className={row.enabled || placeholder ? '' : 'opacity-50'}>
                  <td className="border border-line text-center">
                    {!placeholder && (
                      <input
                        type="checkbox"
                        checked={row.enabled}
                        disabled={readOnly}
                        onChange={(e) => update(index, { enabled: e.target.checked })}
                        aria-label={t('variables.rowEnabled', {
                          name: row.key || t('variables.fallbackName'),
                        })}
                        className="h-3.5 w-3.5 accent-[var(--app-accent)]"
                      />
                    )}
                  </td>
                  <td className="border border-line p-0">
                    <input
                      className={cell}
                      value={row.key}
                      disabled={readOnly}
                      placeholder={placeholder ? t('variables.newPlaceholder') : ''}
                      aria-label={t('variables.keyLabel', { n: index + 1 })}
                      onChange={(e) => update(index, { key: e.target.value })}
                    />
                  </td>
                  <td className="border border-line p-0">
                    <input
                      className={cell}
                      type={masked ? 'password' : 'text'}
                      value={row.value}
                      disabled={readOnly}
                      autoComplete="off"
                      aria-label={t('variables.initialLabel', { n: index + 1 })}
                      onChange={(e) => update(index, { value: e.target.value })}
                    />
                  </td>
                  <td className="border border-line p-0">
                    <input
                      className={cell}
                      type={masked ? 'password' : 'text'}
                      value={row.current}
                      autoComplete="off"
                      placeholder={placeholder || masked ? '' : row.value || ''}
                      aria-label={t('variables.currentLabel', { n: index + 1 })}
                      onChange={(e) => update(index, { current: e.target.value })}
                    />
                  </td>
                  <td className="border border-line">
                    {!placeholder && (
                      <div className="flex items-center justify-center gap-0.5">
                        <button
                          type="button"
                          disabled={readOnly}
                          onClick={() => update(index, { isSecret: !row.isSecret })}
                          aria-label={
                            row.isSecret
                              ? t('variables.unmarkSecret', { name: row.key })
                              : t('variables.markSecret', { name: row.key })
                          }
                          title={row.isSecret ? t('variables.secretTitle') : t('variables.makeSecret')}
                          className={cn(
                            'rounded p-1 hover:bg-muted',
                            row.isSecret ? 'text-warning' : 'text-fg-subtle hover:text-fg',
                          )}
                        >
                          {row.isSecret ? (
                            <Lock className="h-3.5 w-3.5" />
                          ) : (
                            <LockOpen className="h-3.5 w-3.5" />
                          )}
                        </button>
                        <button
                          type="button"
                          disabled={readOnly}
                          onClick={() => setRows(rows.filter((_, i) => i !== index))}
                          aria-label={t('variables.rowDelete', {
                            name: row.key || t('variables.fallbackDelete'),
                          })}
                          className="rounded p-1 text-fg-subtle hover:bg-danger/10 hover:text-danger"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <p className="text-xs text-fg-subtle">
          {t.rich(
            'variables.footnote',
            { code: (c) => <code className="rounded bg-muted px-1 font-mono">{c}</code> },
            { token: `{{${t('variables.exampleName')}}}` },
          )}
        </p>
      </div>
    </Dialog>
  );
}
