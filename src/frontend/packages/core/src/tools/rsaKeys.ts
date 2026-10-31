import { msg } from '../i18n';
import { ToolError } from './errors';
import { base64Decode, base64Encode, toHex, utf8Decode, utf8Encode } from './encoding';
import { hasWebCrypto, toBufferSource } from './hash';

export type KeyPairAlgorithm = 'RSA-OAEP' | 'RSASSA-PKCS1-v1_5' | 'RSA-PSS' | 'ECDSA' | 'Ed25519';
export type RsaModulusLength = 2048 | 3072 | 4096;
export type KeyHash = 'SHA-256' | 'SHA-384' | 'SHA-512';
export type EcCurve = 'P-256' | 'P-384' | 'P-521';

export const KEY_PAIR_ALGORITHMS: KeyPairAlgorithm[] = [
  'RSA-OAEP',
  'RSASSA-PKCS1-v1_5',
  'RSA-PSS',
  'ECDSA',
  'Ed25519',
];
export const RSA_MODULUS_LENGTHS: RsaModulusLength[] = [2048, 3072, 4096];
export const KEY_HASHES: KeyHash[] = ['SHA-256', 'SHA-384', 'SHA-512'];
export const EC_CURVES: EcCurve[] = ['P-256', 'P-384', 'P-521'];

export interface KeyPairOptions {
  algorithm: KeyPairAlgorithm;
  /** Yalnızca RSA (varsayılan 2048). */
  modulusLength?: RsaModulusLength;
  /** Yalnızca RSA (varsayılan SHA-256). */
  hash?: KeyHash;
  /** Yalnızca ECDSA (varsayılan P-256). */
  namedCurve?: EcCurve;
}

export interface GeneratedKeyPair {
  /** PKCS#8 "PRIVATE KEY". */
  privatePem: string;
  /** SPKI "PUBLIC KEY". */
  publicPem: string;
  privateJwk: string;
  publicJwk: string;
  /** SPKI'nin SHA-256 özeti. */
  fingerprint: { hex: string; base64: string };
}

function requireWebCrypto(): void {
  if (!hasWebCrypto()) {
    throw new ToolError(
      msg(
        'toolsSecurity.rsa.webCryptoRequired',
        'Anahtar üretimi için Web Crypto gerekir: sayfayı HTTPS ya da localhost üzerinden açın.',
      ),
    );
  }
}

/** DER içeriğini 64 sütunluk PEM bloğuna sarar. */
export function toPem(label: string, der: Uint8Array): string {
  const body = base64Encode(der, { lineLength: 64 });
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----\n`;
}

/** PEM bloğunu DER'e çevirir; `label` verilirse etiket de denetlenir. */
export function pemToDer(pem: string, label?: string): Uint8Array {
  const match = /-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/.exec(pem);
  if (!match)
    throw new ToolError(
      msg('toolsSecurity.rsa.pemUnreadable', 'PEM okunamadı (BEGIN / END satırları eşleşmiyor).'),
    );
  if (label && match[1] !== label) {
    throw new ToolError(
      msg('toolsSecurity.rsa.expectedLabel', '-----BEGIN {label}----- bekleniyordu; {given} verildi.', {
        label,
        given: match[1],
      }),
    );
  }
  try {
    return base64Decode(match[2]!);
  } catch {
    throw new ToolError(msg('toolsSecurity.rsa.pemBase64Broken', 'PEM içeriğindeki Base64 bozuk.'));
  }
}

function generateParams(options: KeyPairOptions): {
  params: RsaHashedKeyGenParams | EcKeyGenParams | Algorithm;
  usages: KeyUsage[];
} {
  const { algorithm } = options;
  if (algorithm === 'ECDSA') {
    return {
      params: { name: algorithm, namedCurve: options.namedCurve ?? 'P-256' },
      usages: ['sign', 'verify'],
    };
  }
  if (algorithm === 'Ed25519') return { params: { name: algorithm }, usages: ['sign', 'verify'] };
  return {
    params: {
      name: algorithm,
      modulusLength: options.modulusLength ?? 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: options.hash ?? 'SHA-256',
    },
    usages: algorithm === 'RSA-OAEP' ? ['encrypt', 'decrypt'] : ['sign', 'verify'],
  };
}

/** SPKI açık anahtarının SHA-256 parmak izi. */
export async function spkiFingerprint(spki: Uint8Array): Promise<{ hex: string; base64: string }> {
  requireWebCrypto();
  const hash = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', toBufferSource(spki)));
  return { hex: toHex(hash), base64: base64Encode(hash) };
}

/** Anahtar çifti üretir ve PEM / JWK olarak dışa aktarır. RSA 4096 birkaç saniye sürebilir. */
export async function generateKeyPair(options: KeyPairOptions): Promise<GeneratedKeyPair> {
  requireWebCrypto();
  const subtle = globalThis.crypto.subtle;
  const { params, usages } = generateParams(options);
  let pair: CryptoKeyPair;
  try {
    pair = (await subtle.generateKey(params, true, usages)) as CryptoKeyPair;
  } catch (error) {
    if (options.algorithm === 'Ed25519') {
      throw new ToolError(
        msg(
          'toolsSecurity.rsa.ed25519Unsupported',
          'Bu tarayıcı Web Crypto’da Ed25519 desteklemiyor; ECDSA ya da RSA seçin.',
        ),
      );
    }
    throw new ToolError(
      msg('toolsSecurity.rsa.generateFailed', 'Anahtar üretilemedi: {reason}', {
        reason: error instanceof Error ? error.message : String(error),
      }),
    );
  }
  const pkcs8 = new Uint8Array(await subtle.exportKey('pkcs8', pair.privateKey));
  const spki = new Uint8Array(await subtle.exportKey('spki', pair.publicKey));
  const [privateJwk, publicJwk, fingerprint] = await Promise.all([
    subtle.exportKey('jwk', pair.privateKey),
    subtle.exportKey('jwk', pair.publicKey),
    spkiFingerprint(spki),
  ]);
  return {
    privatePem: toPem('PRIVATE KEY', pkcs8),
    publicPem: toPem('PUBLIC KEY', spki),
    privateJwk: JSON.stringify(privateJwk, null, 2),
    publicJwk: JSON.stringify(publicJwk, null, 2),
    fingerprint,
  };
}

let ed25519Support: Promise<boolean> | null = null;

/** Tarayıcının Web Crypto'su Ed25519 üretebiliyor mu (sonuç önbelleğe alınır). */
export function supportsEd25519(): Promise<boolean> {
  if (!hasWebCrypto()) return Promise.resolve(false);
  ed25519Support ??= globalThis.crypto.subtle
    .generateKey({ name: 'Ed25519' }, false, ['sign', 'verify'])
    .then(
      () => true,
      () => false,
    );
  return ed25519Support;
}

/** RSA-OAEP ile tek blokta şifrelenebilecek en uzun ileti (bayt): k − 2·hLen − 2. */
export function rsaOaepMaxBytes(modulusBits: number, hash: KeyHash): number {
  const hashBytes = Number(hash.slice(4)) / 8;
  return modulusBits / 8 - 2 * hashBytes - 2;
}

async function importOaepKey(pem: string, hash: KeyHash, use: 'encrypt' | 'decrypt'): Promise<CryptoKey> {
  requireWebCrypto();
  const label = use === 'encrypt' ? 'PUBLIC KEY' : 'PRIVATE KEY';
  const der = pemToDer(pem, label);
  try {
    return await globalThis.crypto.subtle.importKey(
      use === 'encrypt' ? 'spki' : 'pkcs8',
      toBufferSource(der),
      { name: 'RSA-OAEP', hash },
      false,
      [use],
    );
  } catch {
    throw new ToolError(
      msg(
        'toolsSecurity.rsa.oaepImportFailed',
        'Anahtar RSA-OAEP için içe aktarılamadı (RSA {kind, select, public {açık} other {özel}} anahtar mı?).',
        { kind: use === 'encrypt' ? 'public' : 'private' },
      ),
    );
  }
}

/** Kısa bir metni PEM açık anahtarla RSA-OAEP şifreler; Base64 döner. */
export async function rsaOaepEncrypt(publicPem: string, hash: KeyHash, text: string): Promise<string> {
  const key = await importOaepKey(publicPem, hash, 'encrypt');
  const algorithm = key.algorithm as RsaHashedKeyAlgorithm;
  const data = utf8Encode(text);
  const max = rsaOaepMaxBytes(algorithm.modulusLength, hash);
  if (data.length > max) {
    throw new ToolError(
      msg(
        'toolsSecurity.rsa.textTooLong',
        'Metin çok uzun: {bits} bit anahtar ve {hash} ile en fazla {max} bayt şifrelenebilir ({given} bayt verildi).',
        { bits: algorithm.modulusLength, hash, max, given: data.length },
      ),
    );
  }
  const result = await globalThis.crypto.subtle.encrypt({ name: 'RSA-OAEP' }, key, toBufferSource(data));
  return base64Encode(new Uint8Array(result));
}

/** Base64 RSA-OAEP şifreli veriyi PEM özel anahtarla çözer. */
export async function rsaOaepDecrypt(privatePem: string, hash: KeyHash, ciphertext: string): Promise<string> {
  const key = await importOaepKey(privatePem, hash, 'decrypt');
  let data: Uint8Array;
  try {
    data = base64Decode(ciphertext.trim());
  } catch {
    throw new ToolError(msg('toolsSecurity.rsa.cipherNotBase64', 'Şifreli veri geçerli Base64 değil.'));
  }
  let result: ArrayBuffer;
  try {
    result = await globalThis.crypto.subtle.decrypt({ name: 'RSA-OAEP' }, key, toBufferSource(data));
  } catch {
    throw new ToolError(
      msg(
        'toolsSecurity.rsa.decryptFailed',
        'Çözülemedi: anahtar ya da özet algoritması yanlış veya veri bozuk.',
      ),
    );
  }
  return utf8Decode(new Uint8Array(result));
}
