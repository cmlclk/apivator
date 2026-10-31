import { msg } from '../i18n';
import { ToolError } from './errors';
import { base64Decode, base64Encode, toHex, utf8Encode } from './encoding';
import { hexToBytes } from './codecs';
import { hasWebCrypto, toBufferSource } from './hash';

export type AesMode = 'AES-GCM' | 'AES-CBC';
export type AesKeySize = 128 | 192 | 256;
/** İkili verinin (anahtar, IV, şifreli metin) metin gösterimi. */
export type BinaryFormat = 'base64' | 'hex';

export const AES_KEY_SIZES: AesKeySize[] = [128, 192, 256];
/** OWASP'ın PBKDF2-HMAC-SHA256 için önerdiği yineleme sayısı. */
export const PBKDF2_DEFAULT_ITERATIONS = 600_000;
/** GCM doğrulama etiketi (bayt); Web Crypto onu şifreli metnin sonuna ekler. */
export const GCM_TAG_LENGTH = 16;
const BLOCK_SIZE = 16;

/** GCM için 12 bayt (NIST önerisi), CBC için blok boyu (16 bayt). */
export function aesIvLength(mode: AesMode): number {
  return mode === 'AES-GCM' ? 12 : BLOCK_SIZE;
}

/** Kriptografik olarak güvenli rastgele baytlar (IV, salt, anahtar). */
export function randomBytes(length: number): Uint8Array {
  requireWebCrypto();
  return globalThis.crypto.getRandomValues(new Uint8Array(length));
}

export function formatBinary(bytes: Uint8Array, format: BinaryFormat): string {
  return format === 'hex' ? toHex(bytes) : base64Encode(bytes);
}

/** Hex ya da Base64 metni baytlara çevirir; hata mesajı hangi alan olduğunu söyler. */
export function parseBinary(text: string, format: BinaryFormat, field: string): Uint8Array {
  const trimmed = text.trim();
  if (!trimmed) throw new ToolError(msg('toolsSecurity.aes.fieldEmpty', '{field} boş.', { field }));
  try {
    return format === 'hex' ? hexToBytes(trimmed) : base64Decode(trimmed);
  } catch (error) {
    const detail = error instanceof ToolError ? ` ${error.message}` : '';
    throw new ToolError(
      msg('toolsSecurity.aes.fieldInvalid', '{field} geçerli {format} değil.{detail}', {
        field,
        format: format === 'hex' ? 'hex' : 'Base64',
        detail,
      }),
    );
  }
}

function requireWebCrypto(): void {
  if (!hasWebCrypto()) {
    throw new ToolError(
      msg(
        'toolsSecurity.aes.webCryptoRequired',
        'AES için Web Crypto gerekir: sayfayı HTTPS ya da localhost üzerinden açın.',
      ),
    );
  }
}

/** PBKDF2-HMAC-SHA256 ile paroladan ham AES anahtarı türetir. */
export async function deriveAesKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
  size: AesKeySize,
): Promise<Uint8Array> {
  requireWebCrypto();
  if (!passphrase) throw new ToolError(msg('toolsSecurity.aes.passphraseEmpty', 'Parola boş olamaz.'));
  if (salt.length === 0) throw new ToolError(msg('toolsSecurity.aes.saltEmpty', 'Salt boş olamaz.'));
  if (!Number.isInteger(iterations) || iterations < 1) {
    throw new ToolError(msg('toolsSecurity.aes.iterations', 'Yineleme sayısı pozitif bir tam sayı olmalı.'));
  }
  const subtle = globalThis.crypto.subtle;
  const base = await subtle.importKey('raw', toBufferSource(utf8Encode(passphrase)), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: toBufferSource(salt), iterations },
    base,
    size,
  );
  return new Uint8Array(bits);
}

export interface AesParams {
  mode: AesMode;
  /** 16, 24 ya da 32 bayt ham anahtar. */
  key: Uint8Array;
  iv: Uint8Array;
  /** Yalnızca GCM: şifrelenmeyen ama doğrulanan ek veri. */
  aad?: Uint8Array;
}

async function importAesKey(mode: AesMode, key: Uint8Array, use: 'encrypt' | 'decrypt'): Promise<CryptoKey> {
  requireWebCrypto();
  if (![16, 24, 32].includes(key.length)) {
    throw new ToolError(
      msg(
        'toolsSecurity.aes.keyLength',
        'AES anahtarı 16, 24 ya da 32 bayt (128/192/256 bit) olmalı; {length} bayt verildi.',
        { length: key.length },
      ),
    );
  }
  try {
    return await globalThis.crypto.subtle.importKey('raw', toBufferSource(key), mode, false, [use]);
  } catch (error) {
    if (key.length === 24) {
      throw new ToolError(
        msg(
          'toolsSecurity.aes.key192Unsupported',
          'Bu tarayıcının Web Crypto API’si 192 bit AES anahtarını desteklemiyor (ör. Chrome / Edge); 128 ya da 256 bit kullanın.',
        ),
      );
    }
    throw new ToolError(
      msg('toolsSecurity.aes.importFailed', 'AES anahtarı içe aktarılamadı: {reason}', {
        reason: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

function algorithm({ mode, iv, aad }: AesParams): AesGcmParams | AesCbcParams {
  const expected = aesIvLength(mode);
  if (mode === 'AES-CBC' && iv.length !== expected) {
    throw new ToolError(
      msg('toolsSecurity.aes.cbcIvLength', 'AES-CBC için IV {expected} bayt olmalı; {length} bayt verildi.', {
        expected,
        length: iv.length,
      }),
    );
  }
  if (mode === 'AES-GCM') {
    if (iv.length === 0) throw new ToolError(msg('toolsSecurity.aes.ivEmpty', 'IV boş olamaz.'));
    const params: AesGcmParams = { name: mode, iv: toBufferSource(iv), tagLength: GCM_TAG_LENGTH * 8 };
    if (aad && aad.length) params.additionalData = toBufferSource(aad);
    return params;
  }
  return { name: mode, iv: toBufferSource(iv) };
}

/** Şifreler. GCM'de dönen değerin son 16 baytı doğrulama etiketidir; CBC'de PKCS#7 dolgusu eklenir. */
export async function aesEncrypt(params: AesParams, plaintext: Uint8Array): Promise<Uint8Array> {
  const key = await importAesKey(params.mode, params.key, 'encrypt');
  const result = await globalThis.crypto.subtle.encrypt(algorithm(params), key, toBufferSource(plaintext));
  return new Uint8Array(result);
}

/** Çözer; yanlış anahtar, değiştirilmiş veri ya da bozuk dolgu anlaşılır bir ToolError olur. */
export async function aesDecrypt(params: AesParams, ciphertext: Uint8Array): Promise<Uint8Array> {
  if (params.mode === 'AES-GCM' && ciphertext.length < GCM_TAG_LENGTH) {
    throw new ToolError(
      msg(
        'toolsSecurity.aes.gcmTooShort',
        "Şifreli veri çok kısa: GCM'de en az {tagLength} baytlık doğrulama etiketi bulunmalı.",
        { tagLength: GCM_TAG_LENGTH },
      ),
    );
  }
  if (params.mode === 'AES-CBC' && (ciphertext.length === 0 || ciphertext.length % BLOCK_SIZE !== 0)) {
    throw new ToolError(
      msg(
        'toolsSecurity.aes.cbcBlockMultiple',
        'AES-CBC şifreli verisi {block} baytın katı olmalı; {length} bayt verildi.',
        { block: BLOCK_SIZE, length: ciphertext.length },
      ),
    );
  }
  const key = await importAesKey(params.mode, params.key, 'decrypt');
  const alg = algorithm(params);
  try {
    return new Uint8Array(await globalThis.crypto.subtle.decrypt(alg, key, toBufferSource(ciphertext)));
  } catch {
    throw new ToolError(
      params.mode === 'AES-GCM'
        ? msg(
            'toolsSecurity.aes.gcmDecryptFailed',
            'Çözülemedi: anahtar, IV ya da AAD yanlış veya veri değiştirilmiş (GCM doğrulama etiketi eşleşmedi).',
          )
        : msg(
            'toolsSecurity.aes.cbcDecryptFailed',
            'Çözülemedi: anahtar ya da IV yanlış veya veri bozuk (PKCS#7 dolgusu geçersiz).',
          ),
    );
  }
}

/** Birleşik biçim: IV ‖ şifreli metin (GCM'de ‖ etiket). */
export function joinIv(iv: Uint8Array, ciphertext: Uint8Array): Uint8Array {
  const out = new Uint8Array(iv.length + ciphertext.length);
  out.set(iv);
  out.set(ciphertext, iv.length);
  return out;
}

/** Birleşik veriyi IV ve şifreli metne ayırır (IV uzunluğu moda göre sabit). */
export function splitIv(mode: AesMode, combined: Uint8Array): { iv: Uint8Array; ciphertext: Uint8Array } {
  const ivLength = aesIvLength(mode);
  if (combined.length <= ivLength) {
    throw new ToolError(
      msg(
        'toolsSecurity.aes.combinedTooShort',
        'Birleşik veri çok kısa: önce {ivLength} baytlık IV, ardından şifreli metin gelmeli.',
        { ivLength },
      ),
    );
  }
  return { iv: combined.slice(0, ivLength), ciphertext: combined.slice(ivLength) };
}
