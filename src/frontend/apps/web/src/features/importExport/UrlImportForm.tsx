import { useState, type FormEvent } from 'react';
import { Globe, Laptop } from 'lucide-react';
import { Alert, Button, Input, Spinner } from '@apivator/ui';
import type { ImportResult, SpecChoice } from '@apivator/core';
import { useT } from '../../i18n';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { AccessHeaders } from './AccessHeaders';
import { accessHeaders, emptyAccess, type AccessState } from './access';

/**
 * OpenAPI/Swagger belgesini adresinden içe aktarma: belge adresi, Swagger UI sayfası ya da yalnızca sunucu adresi.
 * Birden çok sürüm (v1, v2) varsa seçtirilir. Masaüstünde belge bu bilgisayardan çekilir.
 */
export function UrlImportForm({
  workspaceId,
  onImported,
}: {
  workspaceId: string;
  onImported: (result: ImportResult, source: string) => void;
}) {
  const t = useT('exchange');
  const [url, setUrl] = useState('');
  const [access, setAccess] = useState<AccessState>(emptyAccess);
  const [choices, setChoices] = useState<SpecChoice[] | null>(null);
  const [choice, setChoice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const target = choices ? choice : url.trim();
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      const response = await api.importExport.importFromUrl(workspaceId, target, accessHeaders(access));
      if (response.choices?.length) {
        setChoices(response.choices);
        setChoice(response.choices[0]!.url);
      } else if (response.result) {
        onImported(response.result, target);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-3">
      <Input
        label={t('urlImport.address')}
        type="text"
        inputMode="url"
        autoComplete="off"
        spellCheck={false}
        value={url}
        onChange={(e) => {
          setUrl(e.target.value);
          setChoices(null);
        }}
        placeholder={t('urlImport.placeholder')}
        className="font-mono text-[13px]"
        hint={t('urlImport.hint')}
      />

      {choices && (
        <fieldset className="rounded-md border border-line p-3">
          <legend className="px-1 text-[13px] font-medium">
            {t('urlImport.choices', { count: choices.length })}
          </legend>
          <div className="space-y-1.5">
            {choices.map((c) => (
              <label key={c.url} className="flex cursor-pointer items-start gap-2 text-[13px]">
                <input
                  type="radio"
                  name="spec-choice"
                  value={c.url}
                  checked={choice === c.url}
                  onChange={() => setChoice(c.url)}
                  className="mt-0.5"
                />
                <span className="min-w-0">
                  <span className="block font-medium">{c.name}</span>
                  <span className="block truncate font-mono text-[11px] text-fg-subtle">{c.url}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <AccessHeaders value={access} onChange={setAccess} disabled={busy} />

      {error && <Alert tone="error">{error}</Alert>}

      <div className="flex items-center justify-between gap-3">
        <p className="flex items-start gap-1.5 text-xs text-fg-subtle">
          {api.local ? (
            <>
              <Laptop className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {t('urlImport.fetchedLocally')}
            </>
          ) : (
            <>
              <Globe className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {t('urlImport.fetchedByServer')}
            </>
          )}
        </p>
        <Button type="submit" disabled={busy || !(choices ? choice : url.trim())} className="shrink-0">
          {busy && <Spinner className="h-3.5 w-3.5" />}
          {choices ? t('urlImport.importChosen') : t('urlImport.import')}
        </Button>
      </div>
      <p className="text-xs text-fg-subtle">{t('urlImport.footnote')}</p>
    </form>
  );
}
