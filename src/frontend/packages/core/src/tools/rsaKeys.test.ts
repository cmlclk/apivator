import { describe, expect, it } from 'vitest';
import { ToolError } from './errors';
import {
  generateKeyPair,
  pemToDer,
  rsaOaepDecrypt,
  rsaOaepEncrypt,
  rsaOaepMaxBytes,
  spkiFingerprint,
  supportsEd25519,
  toPem,
} from './rsaKeys';

describe('PEM yardımcıları', () => {
  it('64 sütunla sarar ve geri okur', () => {
    const der = new Uint8Array(100).map((_, i) => i);
    const pem = toPem('PUBLIC KEY', der);
    const lines = pem.trim().split('\n');
    expect(lines[0]).toBe('-----BEGIN PUBLIC KEY-----');
    expect(lines[1]).toHaveLength(64);
    expect(lines.at(-1)).toBe('-----END PUBLIC KEY-----');
    expect(pemToDer(pem, 'PUBLIC KEY')).toEqual(der);
    expect(() => pemToDer(pem, 'PRIVATE KEY')).toThrow(/PRIVATE KEY/);
    expect(() => pemToDer('merhaba')).toThrow(ToolError);
  });
});

describe('anahtar çifti üretme', () => {
  it('RSA-PSS 2048: PEM, JWK ve parmak izi', async () => {
    const pair = await generateKeyPair({ algorithm: 'RSA-PSS', modulusLength: 2048, hash: 'SHA-384' });
    expect(pair.privatePem).toMatch(/^-----BEGIN PRIVATE KEY-----\n/);
    expect(pair.publicPem).toMatch(/^-----BEGIN PUBLIC KEY-----\n/);
    const jwk = JSON.parse(pair.publicJwk) as JsonWebKey;
    expect(jwk.kty).toBe('RSA');
    expect(jwk.alg).toBe('PS384');
    expect(jwk.d).toBeUndefined();
    expect((JSON.parse(pair.privateJwk) as JsonWebKey).d).toBeTruthy();
    expect(pair.fingerprint.hex).toMatch(/^[0-9a-f]{64}$/);
    const again = await spkiFingerprint(pemToDer(pair.publicPem));
    expect(again).toEqual(pair.fingerprint);

    // Üretilen anahtar Web Crypto'ya geri aktarılabilir.
    const key = await crypto.subtle.importKey(
      'pkcs8',
      pemToDer(pair.privatePem).slice().buffer as ArrayBuffer,
      { name: 'RSA-PSS', hash: 'SHA-384' },
      false,
      ['sign'],
    );
    expect((key.algorithm as RsaHashedKeyAlgorithm).modulusLength).toBe(2048);
  });

  it('ECDSA P-384 ve P-521', async () => {
    const p384 = await generateKeyPair({ algorithm: 'ECDSA', namedCurve: 'P-384' });
    expect((JSON.parse(p384.publicJwk) as JsonWebKey).crv).toBe('P-384');
    const p521 = await generateKeyPair({ algorithm: 'ECDSA', namedCurve: 'P-521' });
    expect((JSON.parse(p521.privateJwk) as JsonWebKey).crv).toBe('P-521');
  });

  it('Ed25519 (destekleniyorsa)', async () => {
    if (!(await supportsEd25519())) return;
    const pair = await generateKeyPair({ algorithm: 'Ed25519' });
    expect((JSON.parse(pair.publicJwk) as JsonWebKey).crv).toBe('Ed25519');
    // Ed25519 SPKI: 12 bayt başlık + 32 bayt anahtar.
    expect(pemToDer(pair.publicPem)).toHaveLength(44);
  });

  it('SPKI parmak izi bilinen değer (boş girdi = SHA-256(""))', async () => {
    const fp = await spkiFingerprint(new Uint8Array());
    expect(fp.hex).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(fp.base64).toBe('47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=');
  });
});

describe('RSA-OAEP', () => {
  it('şifreler ve çözer; uzunluk ve anahtar hataları', async () => {
    const pair = await generateKeyPair({ algorithm: 'RSA-OAEP', modulusLength: 2048, hash: 'SHA-256' });
    const ct = await rsaOaepEncrypt(pair.publicPem, 'SHA-256', 'gizli ğüş');
    expect(await rsaOaepDecrypt(pair.privatePem, 'SHA-256', ct)).toBe('gizli ğüş');

    expect(rsaOaepMaxBytes(2048, 'SHA-256')).toBe(190);
    await expect(rsaOaepEncrypt(pair.publicPem, 'SHA-256', 'x'.repeat(191))).rejects.toThrow(/en fazla 190/);
    await expect(rsaOaepDecrypt(pair.privatePem, 'SHA-512', ct)).rejects.toThrow(/Çözülemedi/);
    await expect(rsaOaepEncrypt(pair.privatePem, 'SHA-256', 'x')).rejects.toThrow(/PUBLIC KEY/);
  });
});
