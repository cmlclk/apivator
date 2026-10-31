import { msg } from '../i18n';
import { ToolError } from './errors';
import { base64Decode, base64Encode, utf8Decode, utf8Encode } from './encoding';
import { hasWebCrypto, toBufferSource } from './hash';

export type JwtAlgorithm =
  | 'HS256'
  | 'HS384'
  | 'HS512'
  | 'RS256'
  | 'RS384'
  | 'RS512'
  | 'PS256'
  | 'PS384'
  | 'PS512'
  | 'ES256'
  | 'ES384'
  | 'ES512';

export const JWT_ALGORITHMS: JwtAlgorithm[] = [
  'HS256',
  'HS384',
  'HS512',
  'RS256',
  'RS384',
  'RS512',
  'PS256',
  'PS384',
  'PS512',
  'ES256',
  'ES384',
  'ES512',
];

export interface DecodedJwt {
  header: Record<string, unknown>;
  payload: unknown;
  /** Base64url imza, olduğu gibi. */
  signature: string;
  /** `header.payload` — imzanın hesaplandığı metin. */
  signingInput: string;
  /** Payload'daki `exp` / `iat` / `nbf` (saniye) tarihe çevrilmiş hali; geçersiz ya da yoksa alan yok. */
  times: { exp?: Date; iat?: Date; nbf?: Date };
}

function decodePart(part: string, name: string): string {
  if (!part) throw new ToolError(msg('toolsSecurity.jwt.partEmpty', 'JWT {name} bölümü boş.', { name }));
  if (!/^[A-Za-z0-9_-]+=*$/.test(part))
    throw new ToolError(
      msg('toolsSecurity.jwt.partNotBase64url', 'JWT {name} bölümü Base64url değil.', { name }),
    );
  try {
    return utf8Decode(base64Decode(part), true);
  } catch {
    throw new ToolError(
      msg('toolsSecurity.jwt.partUndecodable', 'JWT {name} bölümü çözülemedi (Base64url / UTF-8 hatalı).', {
        name,
      }),
    );
  }
}

/** Üç parçalı JWS'yi çözer (imzayı doğrulamaz); biçim bozuksa hangi parçada olduğunu söyleyen ToolError. */
export function decodeJwt(token: string): DecodedJwt {
  const trimmed = token.trim().replace(/^Bearer\s+/i, '');
  if (!trimmed) throw new ToolError(msg('toolsSecurity.jwt.empty', 'JWT boş.'));
  const parts = trimmed.split('.');
  if (parts.length === 5)
    throw new ToolError(
      msg('toolsSecurity.jwt.encrypted', 'Bu bir şifreli JWT (JWE); yalnızca imzalı JWT (JWS) çözülebilir.'),
    );
  if (parts.length !== 3) {
    throw new ToolError(
      msg(
        'toolsSecurity.jwt.partCount',
        'JWT üç bölümden oluşmalı (header.payload.imza); {count} bölüm bulundu.',
        { count: parts.length },
      ),
    );
  }
  const [headerPart, payloadPart, signature] = parts as [string, string, string];

  let header: unknown;
  try {
    header = JSON.parse(decodePart(headerPart, 'header'));
  } catch (error) {
    if (error instanceof ToolError) throw error;
    throw new ToolError(msg('toolsSecurity.jwt.headerNotJson', 'JWT header bölümü geçerli JSON değil.'));
  }
  if (!header || typeof header !== 'object' || Array.isArray(header)) {
    throw new ToolError(
      msg('toolsSecurity.jwt.headerNotObject', 'JWT header bölümü bir JSON nesnesi olmalı.'),
    );
  }

  const payloadText = decodePart(payloadPart, 'payload');
  let payload: unknown;
  try {
    payload = JSON.parse(payloadText);
  } catch {
    // JWS yükü JSON olmak zorunda değil; metin olarak verilir.
    payload = payloadText;
  }
  if (signature && !/^[A-Za-z0-9_-]+=*$/.test(signature))
    throw new ToolError(msg('toolsSecurity.jwt.signatureNotBase64url', 'JWT imza bölümü Base64url değil.'));

  const times: DecodedJwt['times'] = {};
  if (payload && typeof payload === 'object') {
    for (const key of ['exp', 'iat', 'nbf'] as const) {
      const value = (payload as Record<string, unknown>)[key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        const date = new Date(value * 1000);
        if (!Number.isNaN(date.getTime())) times[key] = date;
      }
    }
  }
  return {
    header: header as Record<string, unknown>,
    payload,
    signature,
    signingInput: `${headerPart}.${payloadPart}`,
    times,
  };
}

export interface JwtVerifyResult {
  valid: boolean;
  /** Geçersizse ya da doğrulanamıyorsa nedeni (ör. "Algoritma desteklenmiyor: none"). */
  reason?: string;
}

type KeyUse = 'verify' | 'sign';

interface AlgSpec {
  import: RsaHashedImportParams | EcKeyImportParams | HmacImportParams;
  sign: AlgorithmIdentifier | RsaPssParams | EcdsaParams;
}

function algSpec(alg: unknown): AlgSpec {
  if (typeof alg !== 'string' || !JWT_ALGORITHMS.includes(alg as JwtAlgorithm)) {
    throw new ToolError(
      msg('toolsSecurity.jwt.unsupportedAlgorithm', 'Algoritma desteklenmiyor: {alg}', { alg: String(alg) }),
    );
  }
  const bits = alg.slice(2);
  const hash = `SHA-${bits}`;
  switch (alg.slice(0, 2)) {
    case 'HS':
      return { import: { name: 'HMAC', hash }, sign: 'HMAC' };
    case 'RS':
      return { import: { name: 'RSASSA-PKCS1-v1_5', hash }, sign: 'RSASSA-PKCS1-v1_5' };
    case 'PS':
      return { import: { name: 'RSA-PSS', hash }, sign: { name: 'RSA-PSS', saltLength: Number(bits) / 8 } };
    default: {
      const namedCurve = bits === '512' ? 'P-521' : `P-${bits}`;
      return { import: { name: 'ECDSA', namedCurve }, sign: { name: 'ECDSA', hash } };
    }
  }
}

/** DER uzunluk alanı. */
function derLength(length: number): number[] {
  if (length < 0x80) return [length];
  const bytes: number[] = [];
  for (let n = length; n > 0; n = Math.floor(n / 256)) bytes.unshift(n % 256);
  return [0x80 | bytes.length, ...bytes];
}

function der(tag: number, ...contents: Uint8Array[]): Uint8Array {
  const length = contents.reduce((sum, c) => sum + c.length, 0);
  const head = [tag, ...derLength(length)];
  const out = new Uint8Array(head.length + length);
  out.set(head);
  let offset = head.length;
  for (const c of contents) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/** AlgorithmIdentifier { rsaEncryption, NULL } */
const RSA_ALGORITHM_ID = new Uint8Array([
  0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00,
]);

function parsePem(pem: string): { label: string; der: Uint8Array } {
  const match = /-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/.exec(pem);
  if (!match)
    throw new ToolError(
      msg('toolsSecurity.jwt.pemUnreadable', 'PEM anahtarı okunamadı (BEGIN / END satırları eşleşmiyor).'),
    );
  try {
    return { label: match[1]!, der: base64Decode(match[2]!) };
  } catch {
    throw new ToolError(msg('toolsSecurity.jwt.pemBase64Broken', 'PEM anahtarının Base64 içeriği bozuk.'));
  }
}

const PRIVATE_JWK_FIELDS = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth'];

async function importKey(key: string, spec: AlgSpec, use: KeyUse): Promise<CryptoKey> {
  const subtle = globalThis.crypto.subtle;
  const text = key.trim();
  const isHmac = spec.import.name === 'HMAC';

  let jwk: Record<string, unknown> | null = null;
  if (text.startsWith('{')) {
    try {
      jwk = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // HS* gizli anahtarı "{" ile başlayabilir; o zaman düz metin sayılır.
      if (!isHmac) throw new ToolError(msg('toolsSecurity.jwt.jwkNotJson', 'JWK geçerli JSON değil.'));
    }
  }
  if (isHmac && (text.includes('-----BEGIN') || (jwk && jwk.kty !== 'oct'))) {
    throw new ToolError(
      msg(
        'toolsSecurity.jwt.algConfusion',
        'Header HS* diyor ama verilen anahtar bir açık/özel anahtar; bu bir algoritma karışıklığı (alg confusion) saldırısı olabilir.',
      ),
    );
  }
  if (jwk) {
    // Kullanım kısıtları yok sayılır; doğrulamada özel anahtar verilse de açık kısmı kullanılır.
    const clean: Record<string, unknown> = { ...jwk };
    delete clean.key_ops;
    delete clean.use;
    delete clean.alg;
    if (use === 'verify' && !isHmac) for (const field of PRIVATE_JWK_FIELDS) delete clean[field];
    return subtle.importKey('jwk', clean as JsonWebKey, spec.import, false, [use]);
  }

  if (isHmac) {
    if (!key) throw new ToolError(msg('toolsSecurity.jwt.secretEmpty', 'Gizli anahtar boş olamaz.'));
    return subtle.importKey('raw', toBufferSource(utf8Encode(key)), spec.import, false, [use]);
  }

  if (!text)
    throw new ToolError(
      use === 'verify'
        ? msg('toolsSecurity.jwt.publicKeyRequired', 'Açık anahtar gerekli.')
        : msg('toolsSecurity.jwt.privateKeyRequired', 'Özel anahtar gerekli.'),
    );
  if (!text.includes('-----BEGIN'))
    throw new ToolError(msg('toolsSecurity.jwt.keyFormat', 'Anahtar PEM ya da JWK (JSON) biçiminde olmalı.'));
  const { label, der: body } = parsePem(text);
  const isRsa = spec.import.name !== 'ECDSA';
  if (use === 'verify') {
    if (label === 'PUBLIC KEY')
      return subtle.importKey('spki', toBufferSource(body), spec.import, false, [use]);
    if (label === 'RSA PUBLIC KEY' && isRsa) {
      const spki = der(0x30, RSA_ALGORITHM_ID, der(0x03, new Uint8Array([0]), body));
      return subtle.importKey('spki', toBufferSource(spki), spec.import, false, [use]);
    }
    if (label === 'CERTIFICATE')
      throw new ToolError(
        msg('toolsSecurity.jwt.certificateInsteadOfKey', 'Sertifika yerine açık anahtar (PUBLIC KEY) girin.'),
      );
    throw new ToolError(
      msg(
        'toolsSecurity.jwt.verifyNeedsPublic',
        'Doğrulama için açık anahtar (-----BEGIN PUBLIC KEY-----) gerekir.',
      ),
    );
  }
  if (label === 'PRIVATE KEY')
    return subtle.importKey('pkcs8', toBufferSource(body), spec.import, false, [use]);
  if (label === 'RSA PRIVATE KEY' && isRsa) {
    const pkcs8 = der(0x30, new Uint8Array([0x02, 0x01, 0x00]), RSA_ALGORITHM_ID, der(0x04, body));
    return subtle.importKey('pkcs8', toBufferSource(pkcs8), spec.import, false, [use]);
  }
  throw new ToolError(
    msg(
      'toolsSecurity.jwt.signNeedsPrivate',
      'İmzalamak için PKCS#8 özel anahtar (-----BEGIN PRIVATE KEY-----) gerekir.',
    ),
  );
}

function cryptoErrorText(error: unknown): string {
  if (error instanceof ToolError) return error.message;
  const message = error instanceof Error ? error.message : String(error);
  return message
    ? msg('toolsSecurity.jwt.keyUnusableReason', 'Anahtar bu algoritmayla kullanılamadı: {message}', {
        message,
      })
    : msg('toolsSecurity.jwt.keyUnusable', 'Anahtar bu algoritmayla kullanılamadı.');
}

function requireWebCrypto(): void {
  if (!hasWebCrypto()) {
    throw new ToolError(
      msg(
        'toolsSecurity.jwt.webCryptoRequired',
        'İmza işlemleri için Web Crypto gerekir: sayfayı HTTPS ya da localhost üzerinden açın.',
      ),
    );
  }
}

/**
 * İmzayı Web Crypto ile doğrular. HS*: `key` paylaşılan gizli anahtar (metin).
 * RS* / PS* / ES*: `key` PEM açık anahtar (SPKI "PUBLIC KEY") ya da JWK (JSON).
 */
export async function verifyJwt(token: string, key: string): Promise<JwtVerifyResult> {
  let decoded: DecodedJwt;
  let spec: AlgSpec;
  try {
    decoded = decodeJwt(token);
    spec = algSpec(decoded.header.alg);
    requireWebCrypto();
  } catch (error) {
    return { valid: false, reason: cryptoErrorText(error) };
  }
  if (!decoded.signature)
    return { valid: false, reason: msg('toolsSecurity.jwt.signatureEmpty', 'JWT imzası boş.') };

  let cryptoKey: CryptoKey;
  try {
    cryptoKey = await importKey(key, spec, 'verify');
  } catch (error) {
    return { valid: false, reason: cryptoErrorText(error) };
  }
  try {
    const ok = await globalThis.crypto.subtle.verify(
      spec.sign,
      cryptoKey,
      toBufferSource(base64Decode(decoded.signature)),
      toBufferSource(utf8Encode(decoded.signingInput)),
    );
    return ok
      ? { valid: true }
      : { valid: false, reason: msg('toolsSecurity.jwt.signatureMismatch', 'İmza eşleşmiyor.') };
  } catch (error) {
    return { valid: false, reason: cryptoErrorText(error) };
  }
}

function base64UrlJson(value: unknown): string {
  return base64Encode(utf8Encode(JSON.stringify(value)), { urlSafe: true });
}

/**
 * Test için JWT üretir. `header.alg` belirleyicidir; `typ` yoksa "JWT" eklenir.
 * HS*: `key` gizli anahtar; RS* / PS* / ES*: PEM özel anahtar (PKCS#8 "PRIVATE KEY") ya da JWK.
 */
export async function signJwt(
  header: Record<string, unknown>,
  payload: unknown,
  key: string,
): Promise<string> {
  const spec = algSpec(header.alg);
  requireWebCrypto();
  const fullHeader = { alg: header.alg, typ: 'JWT', ...header };
  const signingInput = `${base64UrlJson(fullHeader)}.${base64UrlJson(payload)}`;
  let signature: ArrayBuffer;
  try {
    const cryptoKey = await importKey(key, spec, 'sign');
    signature = await globalThis.crypto.subtle.sign(
      spec.sign,
      cryptoKey,
      toBufferSource(utf8Encode(signingInput)),
    );
  } catch (error) {
    throw new ToolError(cryptoErrorText(error));
  }
  return `${signingInput}.${base64Encode(new Uint8Array(signature), { urlSafe: true })}`;
}
