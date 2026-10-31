import { useEffect, useMemo, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { Alert, Button, Input, Spinner } from '@apivator/ui';
import {
  AES_KEY_SIZES,
  GCM_TAG_LENGTH,
  PBKDF2_DEFAULT_ITERATIONS,
  aesIvLength,
  formatBinary,
  hasWebCrypto,
  parseBinary,
  randomBytes,
  toHex,
  type AesKeySize,
  type AesMode,
  type BinaryFormat,
} from '@apivator/core/tools';
import { CopyButton } from '../../../components/ui/CopyButton';
import { useT } from '../../../i18n';
import { SwapButton, ToolErrorMessage, ToolOptions, ToolPane, TwoPanes } from '../ToolLayout';
import { toolErrorText, toolLabelClass, toolSelectClass } from '../toolUtils';
import { useToolInput } from '../toolsStore';
import { useAesResult, useDerivedKey } from './aesToolHooks';

const SALT_BYTES = 16;
const inputClass = 'h-7 text-xs font-mono';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className={toolLabelClass}>
      <span className="shrink-0">{label}</span>
      {children}
    </label>
  );
}

/** Ham anahtarı çözer; boyu seçilen anahtar boyuyla eşleşmeli. */
function useRawKey(enabled: boolean, text: string, format: BinaryFormat, size: AesKeySize) {
  const t = useT('toolsSecurity');
  return useMemo<{ key: Uint8Array | null; error: string | null }>(() => {
    if (!enabled || !text.trim()) return { key: null, error: null };
    try {
      const key = parseBinary(text, format, t('aes.labels.key'));
      if (key.length * 8 !== size) {
        return {
          key: null,
          error: t('aes.keyLength', { bytes: size / 8, bits: size, actual: key.length }),
        };
      }
      return { key, error: null };
    } catch (error) {
      return { key: null, error: toolErrorText(error) };
    }
  }, [enabled, text, format, size, t]);
}

export default function AesTool() {
  const t = useT('toolsSecurity');
  const [direction, setDirection] = useToolInput('aes', 'direction', 'encrypt');
  const [modeValue, setMode] = useToolInput('aes', 'mode', 'AES-GCM');
  const [keySource, setKeySource] = useToolInput('aes', 'keySource', 'raw');
  const [keyFormat, setKeyFormat] = useToolInput('aes', 'keyFormat', 'hex');
  const [keySizeValue, setKeySize] = useToolInput('aes', 'keySize', '256');
  const [salt, setSalt] = useToolInput('aes', 'salt');
  const [iterations, setIterations] = useToolInput('aes', 'iterations', String(PBKDF2_DEFAULT_ITERATIONS));
  const [showDerived, setShowDerived] = useToolInput('aes', 'showDerived', '');
  const [dataFormat, setDataFormat] = useToolInput('aes', 'dataFormat', 'base64');
  const [layout, setLayout] = useToolInput('aes', 'layout', 'combined');
  const [aad, setAad] = useToolInput('aes', 'aad');
  // IV de hatırlanmaz: her açılışta yeni rastgele IV (aynı anahtarla eski IV'nin yeniden kullanılmaması için).
  const [iv, setIv] = useToolInput('aes', 'iv', '', { remember: false });
  // Anahtar, parola ve düz metin diske yazılmaz; yalnızca oturum boyunca bellekte kalır.
  const [rawKey, setRawKey] = useToolInput('aes', 'key', '', { remember: false });
  const [passphrase, setPassphrase] = useToolInput('aes', 'passphrase', '', { remember: false });
  const [input, setInput] = useToolInput('aes', 'input', '', { remember: false });

  const webCrypto = hasWebCrypto();
  const mode = modeValue as AesMode;
  const keySize = Number(keySizeValue) as AesKeySize;
  const fromPassphrase = keySource === 'passphrase';
  const encrypting = direction === 'encrypt';
  const combined = layout === 'combined';
  const gcm = mode === 'AES-GCM';
  const ivLength = aesIvLength(mode);
  const format = dataFormat as BinaryFormat;

  const raw = useRawKey(!fromPassphrase, rawKey, keyFormat as BinaryFormat, keySize);
  const derived = useDerivedKey(fromPassphrase, passphrase, salt, iterations, keySize);
  const key = fromPassphrase ? derived.key : raw.key;
  const keyError = fromPassphrase ? derived.error : raw.error;
  const result = useAesResult(
    {
      direction: encrypting ? 'encrypt' : 'decrypt',
      mode,
      key,
      ivHex: iv,
      aad,
      input,
      dataFormat: format,
      combined,
    },
    keyError,
  );

  // İlk açılışta rastgele IV ve salt.
  useEffect(() => {
    if (!webCrypto) return;
    if (!iv) setIv(toHex(randomBytes(aesIvLength(mode))));
    if (!salt) setSalt(toHex(randomBytes(SALT_BYTES)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const newIv = (forMode: AesMode = mode) => setIv(toHex(randomBytes(aesIvLength(forMode))));
  const changeMode = (next: AesMode) => {
    setMode(next);
    if (webCrypto) newIv(next);
  };
  const swap = () => {
    setInput(result.binaryOutput ? '' : result.output);
    setDirection(encrypting ? 'decrypt' : 'encrypt');
  };

  const formatName = format === 'hex' ? 'hex' : 'Base64';
  const layoutParams = { format: formatName, iv: ivLength, tag: GCM_TAG_LENGTH };
  const layoutHelp = combined
    ? t(gcm ? 'aes.layoutCombinedGcm' : 'aes.layoutCombinedCbc', layoutParams)
    : t(gcm ? 'aes.layoutSeparateGcm' : 'aes.layoutSeparateCbc', layoutParams);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
      {!webCrypto && <Alert tone="warning">{t('aes.webCryptoWarning')}</Alert>}
      <p className="text-xs text-fg-muted">{t('aes.localOnly')}</p>
      <ToolOptions>
        <Field label={t('aes.operation')}>
          <select
            className={toolSelectClass}
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
          >
            <option value="encrypt">{t('aes.encrypt')}</option>
            <option value="decrypt">{t('aes.decrypt')}</option>
          </select>
        </Field>
        <Field label={t('aes.mode')}>
          <select
            className={toolSelectClass}
            value={mode}
            onChange={(e) => changeMode(e.target.value as AesMode)}
          >
            <option value="AES-GCM">{t('aes.modeGcm')}</option>
            <option value="AES-CBC">{t('aes.modeCbc')}</option>
          </select>
        </Field>
        <Field label={t('aes.keySize')}>
          <select
            className={toolSelectClass}
            value={keySizeValue}
            onChange={(e) => setKeySize(e.target.value)}
          >
            {AES_KEY_SIZES.map((size) => (
              <option key={size} value={size}>
                {t('aes.bits', { size })}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('aes.dataFormat')}>
          <select
            className={toolSelectClass}
            value={dataFormat}
            onChange={(e) => setDataFormat(e.target.value)}
          >
            <option value="base64">Base64</option>
            <option value="hex">Hex</option>
          </select>
        </Field>
        <Field label={t('aes.layout')}>
          <select className={toolSelectClass} value={layout} onChange={(e) => setLayout(e.target.value)}>
            <option value="combined">{t('aes.layoutCombined')}</option>
            <option value="separate">{t('aes.layoutSeparate')}</option>
          </select>
        </Field>
        {(result.busy || derived.busy) && <Spinner className="h-3.5 w-3.5" />}
      </ToolOptions>

      <section className="flex flex-col gap-2 rounded-md border border-line p-3">
        <ToolOptions>
          <Field label={t('aes.key')}>
            <select
              className={toolSelectClass}
              value={keySource}
              onChange={(e) => setKeySource(e.target.value)}
            >
              <option value="raw">{t('aes.keyRaw')}</option>
              <option value="passphrase">{t('aes.keyPassphrase')}</option>
            </select>
          </Field>
          {!fromPassphrase && (
            <>
              <select
                className={toolSelectClass}
                value={keyFormat}
                onChange={(e) => setKeyFormat(e.target.value)}
                aria-label={t('aes.keyFormat')}
              >
                <option value="hex">Hex</option>
                <option value="base64">Base64</option>
              </select>
              <Input
                className={`${inputClass} w-96 max-w-full`}
                value={rawKey}
                onChange={(e) => setRawKey(e.target.value)}
                placeholder={t('aes.keyPlaceholder', { bytes: keySize / 8 })}
                aria-label={t('aes.keyAria')}
                autoComplete="off"
                spellCheck={false}
              />
              <Button
                size="sm"
                variant="secondary"
                disabled={!webCrypto}
                onClick={() => setRawKey(formatBinary(randomBytes(keySize / 8), keyFormat as BinaryFormat))}
              >
                <RefreshCw className="h-3.5 w-3.5" /> {t('aes.randomKey')}
              </Button>
            </>
          )}
        </ToolOptions>
        {fromPassphrase && (
          <ToolOptions>
            <Input
              type="password"
              className="h-7 w-56 text-xs"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder={t('aes.passphrase')}
              aria-label={t('aes.passphrase')}
              autoComplete="off"
            />
            <Field label={t('aes.saltHex')}>
              <Input
                className={`${inputClass} w-72`}
                value={salt}
                onChange={(e) => setSalt(e.target.value)}
                aria-label={t('aes.labels.salt')}
                spellCheck={false}
              />
            </Field>
            <Button
              size="sm"
              variant="ghost"
              disabled={!webCrypto}
              onClick={() => setSalt(toHex(randomBytes(SALT_BYTES)))}
            >
              <RefreshCw className="h-3.5 w-3.5" /> {t('aes.newSalt')}
            </Button>
            <Field label={t('aes.iterations')}>
              <Input
                type="number"
                min={1}
                className="h-7 w-28 text-xs"
                value={iterations}
                onChange={(e) => setIterations(e.target.value)}
                aria-label={t('aes.iterationsAria')}
              />
            </Field>
            <label className={toolLabelClass}>
              <input
                type="checkbox"
                checked={showDerived === '1'}
                onChange={(e) => setShowDerived(e.target.checked ? '1' : '')}
              />
              {t('aes.showDerived')}
            </label>
          </ToolOptions>
        )}
        {fromPassphrase && showDerived === '1' && derived.key && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-fg-muted">{t('aes.derivedKey')}</span>
            <code className="min-w-0 break-all font-mono text-fg">{toHex(derived.key)}</code>
            <CopyButton text={toHex(derived.key)} label={t('aes.copyDerived')} compact />
          </div>
        )}
        <ToolOptions>
          {(encrypting || !combined) && (
            <>
              <Field label={t('aes.ivLabel', { length: ivLength })}>
                <Input
                  className={`${inputClass} w-72`}
                  value={iv}
                  onChange={(e) => setIv(e.target.value)}
                  aria-label={t('aes.labels.iv')}
                  spellCheck={false}
                />
              </Field>
              <Button size="sm" variant="ghost" disabled={!webCrypto} onClick={() => newIv()}>
                <RefreshCw className="h-3.5 w-3.5" /> {t('aes.newIv')}
              </Button>
              <CopyButton text={iv} label={t('aes.copyIv')} compact />
            </>
          )}
          {gcm && (
            <Field label={t('aes.aad')}>
              <Input
                className="h-7 w-56 text-xs"
                value={aad}
                onChange={(e) => setAad(e.target.value)}
                placeholder={t('aes.aadPlaceholder')}
                aria-label="AAD"
                spellCheck={false}
              />
            </Field>
          )}
        </ToolOptions>
        <p className="text-[11px] text-fg-subtle">
          {layoutHelp}
          {encrypting && gcm && ` ${t('aes.ivReuse')}`}
        </p>
      </section>

      <ToolErrorMessage error={result.error} />
      {result.binaryOutput && <Alert tone="info">{t('aes.binaryOutput')}</Alert>}
      <TwoPanes>
        <ToolPane
          label={encrypting ? t('aes.plaintext') : t('aes.ciphertext')}
          value={input}
          onChange={setInput}
          placeholder={
            encrypting
              ? t('aes.plaintextPlaceholder')
              : t('aes.ciphertextPlaceholder', { format: formatName })
          }
          className="min-h-48"
        />
        <ToolPane
          label={encrypting ? t('aes.ciphertext') : t('aes.plaintext')}
          value={result.output}
          output
          className="min-h-48"
          toolbar={<SwapButton onClick={swap} title={encrypting ? t('aes.toDecrypt') : t('aes.toEncrypt')} />}
        />
      </TwoPanes>
    </div>
  );
}
