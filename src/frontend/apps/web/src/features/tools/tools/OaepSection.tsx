import { useState } from 'react';
import { Button } from '@apivator/ui';
import { KEY_HASHES, rsaOaepDecrypt, rsaOaepEncrypt, type KeyHash } from '@apivator/core/tools';
import { CopyButton } from '../../../components/ui/CopyButton';
import { useT } from '../../../i18n';
import { ToolErrorMessage, ToolOptions } from '../ToolLayout';
import { toolErrorText, toolLabelClass, toolSelectClass } from '../toolUtils';
import { useToolInput } from '../toolsStore';

const textareaClass =
  'min-h-20 w-full resize-y rounded-md border border-line bg-surface px-2 py-1.5 font-mono text-xs text-fg ' +
  'placeholder:text-fg-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25';

/** Yapıştırılan PEM anahtarla kısa metni RSA-OAEP şifreler / çözer. */
export function OaepSection({
  generated,
}: {
  /** Az önce üretilen RSA-OAEP çifti (varsa "Üretilen anahtarı kullan" düğmesi görünür). */
  generated: { publicPem: string; privatePem: string; hash: KeyHash } | null;
}) {
  const t = useT('toolsSecurity');
  const [open, setOpen] = useState(false);
  const [direction, setDirection] = useToolInput('key-pair', 'oaepDirection', 'encrypt');
  const [hash, setHash] = useToolInput('key-pair', 'oaepHash', 'SHA-256');
  // Anahtar ve metin diske yazılmaz.
  const [key, setKey] = useToolInput('key-pair', 'oaepKey', '', { remember: false });
  const [text, setText] = useToolInput('key-pair', 'oaepInput', '', { remember: false });
  const [output, setOutput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const encrypting = direction === 'encrypt';

  const run = async () => {
    setBusy(true);
    setError(null);
    setOutput('');
    try {
      setOutput(
        encrypting
          ? await rsaOaepEncrypt(key, hash as KeyHash, text)
          : await rsaOaepDecrypt(key, hash as KeyHash, text),
      );
    } catch (err) {
      setError(toolErrorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-2 rounded-md border border-line p-3">
      <button
        type="button"
        className="self-start text-xs font-semibold text-fg-muted hover:text-fg"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open ? '▾' : '▸'} {t('keyPair.oaep.toggle')}
      </button>
      {open && (
        <>
          <ToolOptions>
            <label className={toolLabelClass}>
              {t('keyPair.oaep.operation')}
              <select
                className={toolSelectClass}
                value={direction}
                onChange={(e) => {
                  setDirection(e.target.value);
                  setOutput('');
                }}
              >
                <option value="encrypt">{t('keyPair.oaep.encryptPublic')}</option>
                <option value="decrypt">{t('keyPair.oaep.decryptPrivate')}</option>
              </select>
            </label>
            <label className={toolLabelClass}>
              {t('keyPair.oaep.hash')}
              <select className={toolSelectClass} value={hash} onChange={(e) => setHash(e.target.value)}>
                {KEY_HASHES.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            {generated && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setKey(encrypting ? generated.publicPem : generated.privatePem);
                  setHash(generated.hash);
                }}
              >
                {t('keyPair.oaep.useGenerated')}
              </Button>
            )}
          </ToolOptions>
          <textarea
            className={textareaClass}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={encrypting ? '-----BEGIN PUBLIC KEY-----' : '-----BEGIN PRIVATE KEY-----'}
            aria-label={t('keyPair.oaep.keyLabel')}
            spellCheck={false}
            autoComplete="off"
          />
          <textarea
            className={textareaClass}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              encrypting ? t('keyPair.oaep.encryptPlaceholder') : t('keyPair.oaep.decryptPlaceholder')
            }
            aria-label={t('keyPair.oaep.inputLabel')}
            spellCheck={false}
          />
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => void run()} loading={busy} disabled={!key.trim() || !text}>
              {encrypting ? t('keyPair.oaep.encrypt') : t('keyPair.oaep.decrypt')}
            </Button>
            {output && <CopyButton text={output} label={t('keyPair.oaep.copyResult')} />}
          </div>
          <ToolErrorMessage error={error} />
          {output && (
            <code
              className="break-all rounded-md bg-muted p-2 font-mono text-xs text-fg"
              aria-label={t('keyPair.oaep.resultLabel')}
            >
              {output}
            </code>
          )}
        </>
      )}
    </section>
  );
}
