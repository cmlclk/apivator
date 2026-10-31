import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button, Input } from '@apivator/ui';
import {
  PASSWORD_MAX_LENGTH,
  TOKEN_MAX_BYTES,
  generatePassphrase,
  generatePassword,
  passphraseEntropy,
  passwordEntropy,
  randomToken,
  type PasswordOptions,
  type TokenFormat,
} from '@apivator/core/tools';
import { formatNumber, useT } from '../../../i18n';
import { ToolErrorMessage, ToolOptions, ToolPane } from '../ToolLayout';
import { toolErrorText, toolLabelClass, toolSelectClass } from '../toolUtils';
import { useToolInput } from '../toolsStore';

const MAX_COUNT = 100;
const CLASS_CHARS = { upper: 'A-Z', lower: 'a-z', digits: '0-9' } as const;

function clamp(value: string, min: number, max: number, fallback: number): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  min: number;
  max: number;
}) {
  return (
    <label className={toolLabelClass}>
      {label}
      <Input
        type="number"
        min={min}
        max={max}
        className="h-7 w-20 text-xs"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
      />
    </label>
  );
}

function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className={toolLabelClass}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

const CLASS_OPTIONS = ['upper', 'lower', 'digits', 'symbols'] as const;

/** Entropi eşiklerine göre güç etiketi anahtarı. */
function strengthKey(bits: number) {
  if (bits < 40) return 'password.strength.weak';
  if (bits < 64) return 'password.strength.medium';
  if (bits < 100) return 'password.strength.strong';
  return 'password.strength.veryStrong';
}

export default function PasswordTool() {
  const t = useT('toolsSecurity');
  // Yalnızca seçenekler tutulur; üretilen şifreler bileşen durumunda kalır, hiç diske yazılmaz.
  const [mode, setMode] = useToolInput('password', 'mode', 'password');
  const [countText, setCountText] = useToolInput('password', 'count', '5');
  const [lengthText, setLengthText] = useToolInput('password', 'length', '20');
  const [flags, setFlags] = useToolInput('password', 'flags', 'upper,lower,digits,symbols,requireEach');
  const [wordsText, setWordsText] = useToolInput('password', 'words', '5');
  const [separator, setSeparator] = useToolInput('password', 'separator', '-');
  const [bytesText, setBytesText] = useToolInput('password', 'bytes', '32');
  const [format, setFormat] = useToolInput('password', 'format', 'base64url');
  const [values, setValues] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const flagSet = new Set(flags.split(',').filter(Boolean));
  const toggle = (flag: string, on: boolean) => {
    const next = new Set(flagSet);
    if (on) next.add(flag);
    else next.delete(flag);
    setFlags([...next].join(','));
  };
  const count = clamp(countText, 1, MAX_COUNT, 5);
  const words = clamp(wordsText, 1, 64, 5);
  const bytes = clamp(bytesText, 1, TOKEN_MAX_BYTES, 32);
  const options: PasswordOptions = {
    length: clamp(lengthText, 1, PASSWORD_MAX_LENGTH, 20),
    upper: flagSet.has('upper'),
    lower: flagSet.has('lower'),
    digits: flagSet.has('digits'),
    symbols: flagSet.has('symbols'),
    excludeAmbiguous: flagSet.has('excludeAmbiguous'),
    requireEach: flagSet.has('requireEach'),
  };

  const entropy =
    mode === 'password'
      ? passwordEntropy(options)
      : mode === 'passphrase'
        ? passphraseEntropy(words)
        : bytes * 8;

  const regenerate = () => {
    try {
      const make =
        mode === 'passphrase'
          ? () => generatePassphrase(words, separator)
          : mode === 'token'
            ? () => randomToken(bytes, format as TokenFormat)
            : () => generatePassword(options);
      setValues(Array.from({ length: count }, make));
      setError(null);
    } catch (e) {
      setValues([]);
      setError(toolErrorText(e));
    }
  };

  // Seçenek değişince yeniden üretilir.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(regenerate, [mode, count, flags, lengthText, words, separator, bytes, format]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <ToolOptions>
        <label className={toolLabelClass}>
          {t('password.type')}
          <select className={toolSelectClass} value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="password">{t('password.typePassword')}</option>
            <option value="passphrase">{t('password.typePassphrase')}</option>
            <option value="token">{t('password.typeToken')}</option>
          </select>
        </label>
        <NumberField
          label={t('password.count')}
          value={countText}
          onChange={setCountText}
          min={1}
          max={MAX_COUNT}
        />
        <Button size="sm" onClick={regenerate}>
          <RefreshCw className="h-3.5 w-3.5" /> {t('password.regenerate')}
        </Button>
        <span className="text-xs text-fg-muted" aria-label={t('password.entropy')}>
          {t('password.entropyText', {
            bits: formatNumber(Math.floor(entropy)),
            strength: t(strengthKey(entropy)),
          })}
        </span>
      </ToolOptions>
      <ToolOptions>
        {mode === 'password' && (
          <>
            <NumberField
              label={t('password.length')}
              value={lengthText}
              onChange={setLengthText}
              min={1}
              max={PASSWORD_MAX_LENGTH}
            />
            {CLASS_OPTIONS.map((flag) => (
              <Check
                key={flag}
                label={flag === 'symbols' ? t('password.symbols') : CLASS_CHARS[flag]}
                checked={flagSet.has(flag)}
                onChange={(on) => toggle(flag, on)}
              />
            ))}
            <Check
              label={t('password.excludeAmbiguous')}
              checked={flagSet.has('excludeAmbiguous')}
              onChange={(on) => toggle('excludeAmbiguous', on)}
            />
            <Check
              label={t('password.requireEach')}
              checked={flagSet.has('requireEach')}
              onChange={(on) => toggle('requireEach', on)}
            />
          </>
        )}
        {mode === 'passphrase' && (
          <>
            <NumberField
              label={t('password.words')}
              value={wordsText}
              onChange={setWordsText}
              min={1}
              max={64}
            />
            <label className={toolLabelClass}>
              {t('password.separator')}
              <Input
                className="h-7 w-14 text-xs"
                value={separator}
                maxLength={3}
                onChange={(e) => setSeparator(e.target.value)}
                aria-label={t('password.separator')}
              />
            </label>
          </>
        )}
        {mode === 'token' && (
          <>
            <NumberField
              label={t('password.bytes')}
              value={bytesText}
              onChange={setBytesText}
              min={1}
              max={TOKEN_MAX_BYTES}
            />
            <label className={toolLabelClass}>
              {t('password.format')}
              <select className={toolSelectClass} value={format} onChange={(e) => setFormat(e.target.value)}>
                <option value="hex">Hex</option>
                <option value="base64">Base64</option>
                <option value="base64url">Base64url</option>
              </select>
            </label>
          </>
        )}
      </ToolOptions>
      <ToolErrorMessage error={error} />
      <ToolPane label={t('password.generated', { count: values.length })} value={values.join('\n')} output />
      <p className="text-[11px] text-fg-subtle">{t('password.note')}</p>
    </div>
  );
}
