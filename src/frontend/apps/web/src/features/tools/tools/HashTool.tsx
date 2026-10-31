import { useEffect, useMemo, useRef, useState } from 'react';
import { FileUp, X } from 'lucide-react';
import { Alert, Button, Input, Spinner } from '@apivator/ui';
import { hasWebCrypto, utf8Encode } from '@apivator/core/tools';
import { CopyButton } from '../../../components/ui/CopyButton';
import { formatNumber, useT } from '../../../i18n';
import { ToolErrorMessage, ToolOptions, ToolPane, TwoPanes } from '../ToolLayout';
import { toolLabelClass, toolSelectClass } from '../toolUtils';
import { useToolInput } from '../toolsStore';
import { hashRows, type BytesJob, type HashRow } from './bytesWorker';
import { useBytesWorker } from './useBytesWorker';

/** Yazarken her tuşta yeniden hesaplanmasın. */
const DEBOUNCE_MS = 150;
/** Dosya Worker'da tamamen belleğe okunur (MD5 için bir kopya daha); daha büyüğü sekmeyi çökertebilir. */
const MAX_FILE_MB = 512;

export default function HashTool() {
  const t = useT('toolsSecurity');
  const [input, setInput] = useToolInput('hash', 'input');
  const [source, setSource] = useToolInput('hash', 'source', 'text');
  const [mode, setMode] = useToolInput('hash', 'mode', 'hash');
  const [uppercase, setUppercase] = useToolInput('hash', 'uppercase', '');
  // Anahtar diske yazılmaz; dosya yalnızca bu bileşende tutulur.
  const [key, setKey] = useToolInput('hash', 'hmacKey', '', { remember: false });
  const [file, setFile] = useState<File | null>(null);
  const [textRows, setTextRows] = useState<HashRow[]>([]);
  const [textBusy, setTextBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const webCrypto = hasWebCrypto();
  const fromFile = source === 'file';
  const isHmac = mode === 'hmac';

  // Metin girdisi küçüktür; aynı iş parçacığında hesaplanır.
  useEffect(() => {
    if (fromFile || !input) {
      setTextRows([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      setTextBusy(true);
      void hashRows(utf8Encode(input), isHmac ? utf8Encode(key) : null).then((next) => {
        if (cancelled) return;
        setTextRows(next);
        setTextBusy(false);
      });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      setTextBusy(false);
    };
  }, [fromFile, input, isHmac, key]);

  const job = useMemo<BytesJob | null>(
    () => (fromFile && file ? { op: 'hash', file, hmacKey: isHmac ? utf8Encode(key) : null } : null),
    [fromFile, file, isHmac, key],
  );
  const fileJob = useBytesWorker(job);
  const fileRows = fileJob.result?.type === 'hash' ? fileJob.result.rows : [];
  const fileBusy = fileJob.status === 'busy';
  const rows = fromFile ? fileRows : textRows;
  const busy = fromFile ? fileBusy : textBusy;
  const jobError = fromFile && fileJob.result?.type === 'error' ? fileJob.result.error : null;

  const loadFile = (picked: File) => {
    setError(null);
    if (picked.size > MAX_FILE_MB * 1024 * 1024) {
      setError(t('hash.tooBig', { max: MAX_FILE_MB }));
      return;
    }
    setFile(picked);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {!webCrypto && <Alert tone="warning">{t('hash.webCryptoWarning')}</Alert>}
      <ToolOptions>
        <label className={toolLabelClass}>
          {t('hash.source')}
          <select className={toolSelectClass} value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="text">{t('hash.sourceText')}</option>
            <option value="file">{t('hash.sourceFile')}</option>
          </select>
        </label>
        <label className={toolLabelClass}>
          {t('hash.mode')}
          <select className={toolSelectClass} value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="hash">Hash</option>
            <option value="hmac">HMAC</option>
          </select>
        </label>
        {isHmac && (
          <label className={toolLabelClass}>
            {t('hash.key')}
            <Input
              className="h-7 w-56 text-xs"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={t('hash.keyPlaceholder')}
              aria-label={t('hash.keyLabel')}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
        )}
        <label className={toolLabelClass}>
          <input
            type="checkbox"
            checked={uppercase === '1'}
            onChange={(e) => setUppercase(e.target.checked ? '1' : '')}
          />
          {t('hash.uppercase')}
        </label>
        {busy && <Spinner className="h-3.5 w-3.5" />}
      </ToolOptions>
      <ToolErrorMessage error={error ?? jobError} />
      <TwoPanes>
        {fromFile ? (
          <section className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-3 rounded-md border border-dashed border-line p-4 text-center">
            <input
              ref={fileInput}
              type="file"
              className="hidden"
              aria-label={t('hash.fileLabel')}
              onChange={(e) => {
                const picked = e.target.files?.[0];
                e.target.value = '';
                if (picked) loadFile(picked);
              }}
            />
            <p className="text-sm text-fg-muted">
              {file ? (
                <>
                  <span className="font-medium text-fg">{file.name}</span> (
                  {t('hash.fileSize', { size: formatNumber(file.size) })})
                </>
              ) : (
                t('hash.pickHint', { max: MAX_FILE_MB })
              )}
            </p>
            {fileBusy ? (
              <div className="flex items-center gap-2 text-sm text-fg-muted" role="status">
                <Spinner className="h-3.5 w-3.5" />
                {t('hash.computing')}
                {fileJob.progress && ` (${fileJob.progress.done}/${fileJob.progress.total})`}
                <Button size="sm" variant="secondary" onClick={fileJob.cancel}>
                  <X className="h-3.5 w-3.5" /> {t('hash.cancel')}
                </Button>
              </div>
            ) : fileJob.status === 'cancelled' ? (
              <div className="flex items-center gap-2 text-sm text-fg-muted" role="status">
                {t('hash.cancelled')}
                <Button size="sm" variant="secondary" onClick={fileJob.retry}>
                  {t('hash.retry')}
                </Button>
              </div>
            ) : null}
            <Button size="sm" variant="secondary" onClick={() => fileInput.current?.click()}>
              <FileUp className="h-3.5 w-3.5" /> {file ? t('hash.pickOther') : t('hash.pick')}
            </Button>
          </section>
        ) : (
          <ToolPane
            label={t('hash.textLabel')}
            value={input}
            onChange={setInput}
            placeholder={t('hash.textPlaceholder')}
          />
        )}
        <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto rounded-md border border-line">
          {rows.length === 0 ? (
            <p className="p-3 text-sm text-fg-muted">{t('hash.empty')}</p>
          ) : (
            <ul className="divide-y divide-line">
              {rows.map((row) => (
                <HashResult key={row.algorithm} row={row} isHmac={isHmac} uppercase={uppercase === '1'} />
              ))}
            </ul>
          )}
        </section>
      </TwoPanes>
    </div>
  );
}

function HashResult({ row, isHmac, uppercase }: { row: HashRow; isHmac: boolean; uppercase: boolean }) {
  const name = isHmac ? `HMAC-${row.algorithm}` : row.algorithm;
  const hex = row.hex && uppercase ? row.hex.toUpperCase() : row.hex;
  return (
    <li className="flex flex-col gap-1 p-3">
      <h4 className="text-xs font-semibold text-fg-muted">{name}</h4>
      {row.error ? (
        <p className="text-xs text-danger">{row.error}</p>
      ) : (
        <>
          <ValueLine label="Hex" value={hex ?? ''} name={name} />
          <ValueLine label="Base64" value={row.base64 ?? ''} name={name} />
        </>
      )}
    </li>
  );
}

function ValueLine({ label, value, name }: { label: string; value: string; name: string }) {
  const t = useT('toolsSecurity');
  return (
    <div className="flex items-center gap-2">
      <span className="w-12 shrink-0 text-[11px] text-fg-muted">{label}</span>
      <code className="min-w-0 flex-1 break-all font-mono text-xs text-fg">{value}</code>
      <CopyButton text={value} label={t('hash.copyValue', { name, label })} compact />
    </div>
  );
}
