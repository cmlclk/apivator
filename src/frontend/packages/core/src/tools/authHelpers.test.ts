import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToolError } from './errors';
import {
  PASSPHRASE_WORDS,
  PKCE_CHARSET,
  basicAuthHeader,
  bufferedRandomInt,
  createPkceVerifier,
  decodeBasicAuth,
  generatePassphrase,
  generatePassword,
  passphraseEntropy,
  passwordEntropy,
  pkceChallenge,
  pkceVerifierProblem,
  randomInt,
  randomToken,
  strengthLabel,
  type PasswordOptions,
} from './authHelpers';

const ALL: PasswordOptions = {
  length: 20,
  upper: true,
  lower: true,
  digits: true,
  symbols: true,
  excludeAmbiguous: false,
  requireEach: true,
};

afterEach(() => vi.restoreAllMocks());

describe('Basic auth', () => {
  it('UTF-8 kodlar ve geri çözer', () => {
    expect(basicAuthHeader('Aladdin', 'open sesame')).toBe('Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ==');
    const header = basicAuthHeader('çağrı', 'şifre:ğ');
    expect(decodeBasicAuth(header)).toEqual({ user: 'çağrı', password: 'şifre:ğ' });
    expect(decodeBasicAuth(`Authorization: ${header}`)).toEqual({ user: 'çağrı', password: 'şifre:ğ' });
    expect(decodeBasicAuth('QWxhZGRpbjpvcGVuIHNlc2FtZQ==').user).toBe('Aladdin');
    expect(decodeBasicAuth(basicAuthHeader('', ''))).toEqual({ user: '', password: '' });
  });

  it('hatalı girdide ToolError', () => {
    expect(() => basicAuthHeader('a:b', 'x')).toThrow(ToolError);
    expect(() => decodeBasicAuth('Basic ')).toThrow(/boş/);
    expect(() => decodeBasicAuth('Basic bWVyaGFiYQ==')).toThrow(/ayracı/);
    expect(() => decodeBasicAuth('Basic %%%')).toThrow(/Base64/);
  });
});

describe('PKCE', () => {
  it('RFC 7636 Ek B test vektörü', async () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    expect(await pkceChallenge(verifier)).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    expect(await pkceChallenge(verifier, 'plain')).toBe(verifier);
  });

  it('verifier uzunluğu ve karakter kümesi', async () => {
    for (const length of [43, 64, 128]) {
      const v = createPkceVerifier(length);
      expect(v).toHaveLength(length);
      expect([...v].every((c) => PKCE_CHARSET.includes(c))).toBe(true);
      expect(pkceVerifierProblem(v)).toBeNull();
    }
    expect(() => createPkceVerifier(42)).toThrow(ToolError);
    expect(() => createPkceVerifier(129)).toThrow(ToolError);
    expect(pkceVerifierProblem('kısa')).toMatch(/43–128/);
    expect(pkceVerifierProblem('a'.repeat(42) + '+')).toMatch(/"\+"/);
    await expect(pkceChallenge('abc')).rejects.toThrow(ToolError);
  });
});

describe('Rastgelelik', () => {
  it('randomInt reddetmeli örnekleme: sınır üstündeki değer atılır', () => {
    // max = 3 → limit = 4294967295; 0xFFFFFFFF reddedilir, ardından 5 % 3 = 2.
    const values = [0xffffffff, 5];
    vi.spyOn(crypto, 'getRandomValues').mockImplementation(((array: Uint32Array) => {
      array[0] = values.shift()!;
      return array;
    }) as typeof crypto.getRandomValues);
    expect(randomInt(3)).toBe(2);
    expect(values).toEqual([]);
  });

  it('randomInt aralık dışına çıkmaz', () => {
    for (let i = 0; i < 500; i++) expect(randomInt(7)).toBeLessThan(7);
    expect(() => randomInt(0)).toThrow(ToolError);
  });

  it('bufferedRandomInt toplu alır, yine reddetmeli örnekler', () => {
    const spy = vi.spyOn(crypto, 'getRandomValues').mockImplementation(((array: Uint32Array) => {
      array.fill(5);
      array[0] = 0xffffffff;
      return array;
    }) as typeof crypto.getRandomValues);
    const next = bufferedRandomInt();
    // İlk sözcük (0xFFFFFFFF) max = 3 için sınır üstünde, atılır.
    expect(next(3)).toBe(2);
    for (let i = 0; i < 2000; i++) next(7);
    // 1024'lük tampon: ~2000 değer için iki çağrı.
    expect(spy).toHaveBeenCalledTimes(2);
    expect(() => next(0)).toThrow(ToolError);
  });
});

describe('Şifre üretici', () => {
  it('her sınıftan en az bir karakter; uzunluk doğru', () => {
    for (let i = 0; i < 50; i++) {
      const p = generatePassword({ ...ALL, length: 4 });
      expect(p).toHaveLength(4);
      expect(p).toMatch(/[A-Z]/);
      expect(p).toMatch(/[a-z]/);
      expect(p).toMatch(/[0-9]/);
      expect(p).toMatch(/[^A-Za-z0-9]/);
    }
  });

  it('karıştırılabilen karakterler çıkarılır; yalnızca rakam', () => {
    for (let i = 0; i < 20; i++) {
      expect(generatePassword({ ...ALL, length: 64, excludeAmbiguous: true })).not.toMatch(/[Il1O0]/);
    }
    expect(generatePassword({ ...ALL, upper: false, lower: false, symbols: false, length: 12 })).toMatch(
      /^\d{12}$/,
    );
  });

  it('entropi ve hatalar', () => {
    expect(passwordEntropy({ ...ALL, length: 10, upper: false, symbols: false })).toBeCloseTo(
      10 * Math.log2(36),
    );
    expect(strengthLabel(30)).toBe('zayıf');
    expect(strengthLabel(128)).toBe('çok güçlü');
    expect(() =>
      generatePassword({ ...ALL, upper: false, lower: false, digits: false, symbols: false }),
    ).toThrow(/sınıf/);
    expect(() => generatePassword({ ...ALL, length: 3 })).toThrow(/en az 4/);
    expect(() => generatePassword({ ...ALL, length: 0 })).toThrow(ToolError);
  });

  it('parola cümlesi', () => {
    expect(new Set(PASSPHRASE_WORDS).size).toBe(PASSPHRASE_WORDS.length);
    expect(PASSPHRASE_WORDS.every((w) => /^[a-z]+$/.test(w))).toBe(true);
    const phrase = generatePassphrase(5, ' ');
    expect(phrase.split(' ')).toHaveLength(5);
    expect(passphraseEntropy(5)).toBeCloseTo(5 * Math.log2(PASSPHRASE_WORDS.length));
    expect(() => generatePassphrase(0)).toThrow(ToolError);
  });
});

describe('Rastgele token', () => {
  it('hex / base64 / base64url', () => {
    expect(randomToken(16, 'hex')).toMatch(/^[0-9a-f]{32}$/);
    expect(randomToken(32, 'base64')).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    expect(randomToken(32, 'base64url')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(() => randomToken(0, 'hex')).toThrow(ToolError);
  });
});
