import { useEffect, useState } from 'react';
import {
  aesDecrypt,
  aesEncrypt,
  deriveAesKey,
  formatBinary,
  joinIv,
  parseBinary,
  splitIv,
  toHex,
  utf8Decode,
  utf8Encode,
  type AesKeySize,
  type AesMode,
  type BinaryFormat,
} from '@apivator/core/tools';
import { translate } from '../../../i18n';
import { toolErrorText } from '../toolUtils';

/** Yazarken her tuşta yeniden hesaplanmasın. */
const DEBOUNCE_MS = 150;
/** PBKDF2 600 000 yinelemede yüz milisaniyeler sürer; parola yazılırken beklenir. */
const DERIVE_DEBOUNCE_MS = 300;

export interface DerivedKey {
  key: Uint8Array | null;
  error: string | null;
  busy: boolean;
}

/** Paroladan PBKDF2-SHA256 ile anahtar türetir (yalnızca `enabled` iken). */
export function useDerivedKey(
  enabled: boolean,
  passphrase: string,
  saltHex: string,
  iterations: string,
  size: AesKeySize,
): DerivedKey {
  const [state, setState] = useState<DerivedKey>({ key: null, error: null, busy: false });
  useEffect(() => {
    if (!enabled || !passphrase) {
      setState({ key: null, error: null, busy: false });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, busy: true }));
    const timer = setTimeout(() => {
      const run = async () => {
        const salt = parseBinary(saltHex, 'hex', translate('toolsSecurity', 'aes.labels.salt'));
        const count = Number(iterations);
        return deriveAesKey(passphrase, salt, count, size);
      };
      run().then(
        (key) => !cancelled && setState({ key, error: null, busy: false }),
        (error: unknown) => !cancelled && setState({ key: null, error: toolErrorText(error), busy: false }),
      );
    }, DERIVE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [enabled, passphrase, saltHex, iterations, size]);
  return state;
}

export interface AesRequest {
  direction: 'encrypt' | 'decrypt';
  mode: AesMode;
  key: Uint8Array | null;
  /** Ayrı düzende ya da şifrelerken kullanılan IV (hex). */
  ivHex: string;
  aad: string;
  input: string;
  dataFormat: BinaryFormat;
  combined: boolean;
}

export interface AesResult {
  output: string;
  error: string | null;
  /** Çözülen veri UTF-8 değilse hex gösterilir. */
  binaryOutput: boolean;
  busy: boolean;
}

async function runAes(req: AesRequest): Promise<{ output: string; binaryOutput: boolean }> {
  const aad = req.mode === 'AES-GCM' && req.aad ? utf8Encode(req.aad) : undefined;
  if (req.direction === 'encrypt') {
    const iv = parseBinary(req.ivHex, 'hex', translate('toolsSecurity', 'aes.labels.iv'));
    const ciphertext = await aesEncrypt({ mode: req.mode, key: req.key!, iv, aad }, utf8Encode(req.input));
    const data = req.combined ? joinIv(iv, ciphertext) : ciphertext;
    return { output: formatBinary(data, req.dataFormat), binaryOutput: false };
  }
  const data = parseBinary(req.input, req.dataFormat, translate('toolsSecurity', 'aes.labels.ciphertext'));
  const { iv, ciphertext } = req.combined
    ? splitIv(req.mode, data)
    : { iv: parseBinary(req.ivHex, 'hex', translate('toolsSecurity', 'aes.labels.iv')), ciphertext: data };
  const plain = await aesDecrypt({ mode: req.mode, key: req.key!, iv, aad }, ciphertext);
  try {
    return { output: utf8Decode(plain, true), binaryOutput: false };
  } catch {
    return { output: toHex(plain), binaryOutput: true };
  }
}

/** Girdi ya da seçenekler değişince (kısa bir gecikmeyle) şifreler / çözer. */
export function useAesResult(req: AesRequest, keyError: string | null): AesResult {
  const [result, setResult] = useState<AesResult>({
    output: '',
    error: null,
    binaryOutput: false,
    busy: false,
  });
  const { direction, mode, key, ivHex, aad, input, dataFormat, combined } = req;
  useEffect(() => {
    if (!input || (direction === 'decrypt' && !input.trim())) {
      setResult({ output: '', error: null, binaryOutput: false, busy: false });
      return;
    }
    if (keyError || !key) {
      setResult({ output: '', error: keyError, binaryOutput: false, busy: false });
      return;
    }
    let cancelled = false;
    setResult((r) => ({ ...r, busy: true }));
    const timer = setTimeout(() => {
      runAes({ direction, mode, key, ivHex, aad, input, dataFormat, combined }).then(
        (next) => !cancelled && setResult({ ...next, error: null, busy: false }),
        (error: unknown) =>
          !cancelled &&
          setResult({ output: '', error: toolErrorText(error), binaryOutput: false, busy: false }),
      );
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [direction, mode, key, ivHex, aad, input, dataFormat, combined, keyError]);
  return result;
}
