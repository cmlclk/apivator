import { describe, expect, it } from 'vitest';
import { base64Encode, utf8Encode } from './encoding';
import { ToolError } from './errors';
import { decodeJwt, signJwt, verifyJwt } from './jwt';

// jwt.io'daki HS256 örneği (gizli anahtar "your-256-bit-secret")
const JWT_IO =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
const SECRET = 'your-256-bit-secret';

const b64url = (value: unknown) => base64Encode(utf8Encode(JSON.stringify(value)), { urlSafe: true });

function pem(label: string, der: ArrayBuffer): string {
  const body = Buffer.from(der).toString('base64').replace(/.{64}/g, '$&\n');
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----\n`;
}

async function keyPair(params: RsaHashedKeyGenParams | EcKeyGenParams) {
  const pair = (await crypto.subtle.generateKey(params, true, ['sign', 'verify'])) as CryptoKeyPair;
  return {
    privatePem: pem('PRIVATE KEY', await crypto.subtle.exportKey('pkcs8', pair.privateKey)),
    publicPem: pem('PUBLIC KEY', await crypto.subtle.exportKey('spki', pair.publicKey)),
    privateJwk: JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey)),
    publicJwk: JSON.stringify(await crypto.subtle.exportKey('jwk', pair.publicKey)),
  };
}

/** HS256 tokenı Web Crypto ile doğrudan imzalar (signJwt'nin korumalarını atlayarak sahte token üretmek için). */
async function signJwtRaw(header: unknown, payload: unknown, secret: string): Promise<string> {
  const input = `${b64url(header)}.${b64url(payload)}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(input)));
  return `${input}.${base64Encode(signature, { urlSafe: true })}`;
}

const rsa = (hash: string): RsaHashedKeyGenParams => ({
  name: 'RSASSA-PKCS1-v1_5',
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash,
});

describe('decodeJwt', () => {
  it('jwt.io örneğini çözer', () => {
    const decoded = decodeJwt(JWT_IO);
    expect(decoded.header).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(decoded.payload).toEqual({ sub: '1234567890', name: 'John Doe', iat: 1516239022 });
    expect(decoded.signature).toBe('SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c');
    expect(decoded.signingInput).toBe(JWT_IO.slice(0, JWT_IO.lastIndexOf('.')));
    expect(decoded.times.iat).toEqual(new Date(1516239022 * 1000));
    expect(decoded.times.exp).toBeUndefined();
  });

  it('exp / nbf tarihe çevrilir, geçersiz değer atlanır', () => {
    const token = `${b64url({ alg: 'HS256' })}.${b64url({ exp: 1800000000, nbf: 1700000000, iat: 'dün' })}.x`;
    const { times } = decodeJwt(token);
    expect(times.exp).toEqual(new Date(1800000000 * 1000));
    expect(times.nbf).toEqual(new Date(1700000000 * 1000));
    expect(times.iat).toBeUndefined();
  });

  it('bozuk biçimde ToolError', () => {
    expect(() => decodeJwt('abc')).toThrow(ToolError);
    expect(() => decodeJwt('a.b')).toThrow(ToolError);
    expect(() => decodeJwt(`!!!.${b64url({})}.x`)).toThrow(ToolError);
    expect(() => decodeJwt(`${b64url({ alg: 'HS256' })}.!!!.x`)).toThrow(ToolError);
  });

  it('JSON olmayan payload metin olarak verilir (JWS yükü JSON olmak zorunda değil)', () => {
    expect(decodeJwt(`${b64url({ alg: 'HS256' })}.bm90LWpzb24.x`).payload).toBe('not-json');
  });

  it('hata mesajı bozuk parçayı söyler', () => {
    expect(() => decodeJwt(`${b64url({ alg: 'HS256' })}.!!!.x`)).toThrow(/payload/i);
    expect(() => decodeJwt(`bm90LWpzb24.${b64url({})}.x`)).toThrow(/header/i);
  });
});

describe('verifyJwt', () => {
  it('jwt.io HS256 örneğini doğrular, yanlış anahtarı reddeder', async () => {
    expect(await verifyJwt(JWT_IO, SECRET)).toEqual({ valid: true });
    const wrong = await verifyJwt(JWT_IO, 'yanlış');
    expect(wrong.valid).toBe(false);
  });

  it('değiştirilmiş payload imzayı bozar', async () => {
    const [h, , s] = JWT_IO.split('.');
    const tampered = `${h}.${b64url({ sub: '1234567890', name: 'Jane Doe', iat: 1516239022 })}.${s}`;
    expect((await verifyJwt(tampered, SECRET)).valid).toBe(false);
  });

  it('alg none reddedilir', async () => {
    const token = `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({ sub: 'x' })}.`;
    const result = await verifyJwt(token, '');
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/none/);
  });

  it('desteklenmeyen algoritmada neden döner', async () => {
    const token = `${b64url({ alg: 'XY999' })}.${b64url({})}.c2ln`;
    const result = await verifyJwt(token, 'k');
    expect(result.valid).toBe(false);
    expect(result.reason).toBeTruthy();
  });
});

describe('signJwt → verifyJwt', () => {
  it('HS256/384/512 gidiş-dönüş, typ eklenir', async () => {
    for (const alg of ['HS256', 'HS384', 'HS512']) {
      const token = await signJwt({ alg }, { sub: 'çağrı', n: 1 }, 'gizli');
      const decoded = decodeJwt(token);
      expect(decoded.header).toEqual({ alg, typ: 'JWT' });
      expect(decoded.payload).toEqual({ sub: 'çağrı', n: 1 });
      expect(await verifyJwt(token, 'gizli')).toEqual({ valid: true });
      expect((await verifyJwt(token, 'başka')).valid).toBe(false);
    }
  });

  it('HS256 jwt.io imzasını birebir üretir', async () => {
    const token = await signJwt(
      { alg: 'HS256', typ: 'JWT' },
      { sub: '1234567890', name: 'John Doe', iat: 1516239022 },
      SECRET,
    );
    expect(token).toBe(JWT_IO);
  });

  it('RS256 PEM (PKCS#8 / SPKI) ve JWK ile', async () => {
    const keys = await keyPair(rsa('SHA-256'));
    const token = await signJwt({ alg: 'RS256' }, { sub: 'rs' }, keys.privatePem);
    expect(await verifyJwt(token, keys.publicPem)).toEqual({ valid: true });
    expect(await verifyJwt(token, keys.publicJwk)).toEqual({ valid: true });
    const viaJwk = await signJwt({ alg: 'RS256' }, { sub: 'rs' }, keys.privateJwk);
    expect(await verifyJwt(viaJwk, keys.publicPem)).toEqual({ valid: true });

    const other = await keyPair(rsa('SHA-256'));
    expect((await verifyJwt(token, other.publicPem)).valid).toBe(false);
  }, 20_000);

  it('PS256 gidiş-dönüş', async () => {
    const keys = await keyPair({ ...rsa('SHA-256'), name: 'RSA-PSS' });
    const token = await signJwt({ alg: 'PS256' }, { sub: 'ps' }, keys.privatePem);
    expect(await verifyJwt(token, keys.publicPem)).toEqual({ valid: true });
  }, 20_000);

  it('ES256 gidiş-dönüş; imza JOSE biçiminde 64 bayt', async () => {
    const keys = await keyPair({ name: 'ECDSA', namedCurve: 'P-256' });
    const token = await signJwt({ alg: 'ES256' }, { sub: 'es' }, keys.privatePem);
    expect(Buffer.from(token.split('.')[2]!, 'base64url')).toHaveLength(64);
    expect(await verifyJwt(token, keys.publicPem)).toEqual({ valid: true });
    expect(await verifyJwt(token, keys.publicJwk)).toEqual({ valid: true });

    const other = await keyPair({ name: 'ECDSA', namedCurve: 'P-256' });
    expect((await verifyJwt(token, other.publicJwk)).valid).toBe(false);
  });

  it('ES384 gidiş-dönüş', async () => {
    const keys = await keyPair({ name: 'ECDSA', namedCurve: 'P-384' });
    const token = await signJwt({ alg: 'ES384' }, { sub: 'es' }, keys.privatePem);
    expect(await verifyJwt(token, keys.publicPem)).toEqual({ valid: true });
  });

  it('bozuk anahtarda doğrulama fırlatmaz, geçersiz döner', async () => {
    const token = await signJwt({ alg: 'HS256' }, {}, 'k');
    const rs = `${b64url({ alg: 'RS256' })}.${token.split('.')[1]}.${token.split('.')[2]}`;
    expect((await verifyJwt(rs, 'PEM değil')).valid).toBe(false);
  });

  it('yanlış imzada neden "İmza eşleşmiyor."', async () => {
    expect(await verifyJwt(JWT_IO, 'yanlış')).toEqual({ valid: false, reason: 'İmza eşleşmiyor.' });
  });

  it('alg confusion: HS256 başlığı açık anahtarla (PEM / RSA JWK) doğrulanmaz, imzalanmaz', async () => {
    const keys = await keyPair(rsa('SHA-256'));
    // Saldırgan açık anahtarın PEM metnini HMAC gizli anahtarı gibi kullanır.
    const forged = await signJwtRaw({ alg: 'HS256', typ: 'JWT' }, { admin: true }, keys.publicPem);
    for (const key of [keys.publicPem, keys.publicJwk]) {
      const result = await verifyJwt(forged, key);
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/alg confusion/);
    }
    await expect(signJwt({ alg: 'HS256' }, {}, keys.publicPem)).rejects.toThrow(/alg confusion/);
    await expect(signJwt({ alg: 'HS256' }, {}, keys.publicPem)).rejects.toThrow(ToolError);
  });
});
