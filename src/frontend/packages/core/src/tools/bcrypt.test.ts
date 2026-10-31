import { describe, expect, it } from 'vitest';
import {
  bcryptBase64Decode,
  bcryptBase64Encode,
  bcryptPasswordBytes,
  hashBcrypt,
  parseBcrypt,
  verifyBcrypt,
} from './bcrypt';
import { ToolError } from './errors';

/** OpenBSD / jBCrypt test vektörleri (düşük maliyetli olanlar: test takımı hızlı kalsın). */
const vectors: [string, string][] = [
  ['', '$2a$06$DCq7YPn5Rq63x1Lad4cll.TV4S6ytwfsfvkgY8jIucDrjc8deX1s.'],
  ['a', '$2a$06$m0CrhHm10qJ3lXRY.5zDGO3rS2KdeeWLuGmsfGlMfOxih58VYVfxe'],
  ['abc', '$2a$06$If6bvum7DFjUnE9p2uDeDu0YHzrHM6tf.iqN8.yx.jNN1ILEf7h0i'],
  ['abcdefghijklmnopqrstuvwxyz', '$2a$06$.rCVZVOThsIa97pEDOxvGuRRgzG64bvtJ0938xuqzv18d3ZpQhstC'],
  ['~!@#$%^&*()      ~!@#$%^&*()PNBFRD', '$2a$06$fPIsBO8qRqkjj273rfaOI.HtSV9jLDpTbZn782DC6/t7qT67P6FfO'],
];

const saltOf = (hash: string) => hash.slice(7, 29);

describe('hashBcrypt', () => {
  it.each(vectors)('bilinen vektör: %j', (password, expected) => {
    expect(hashBcrypt(password, 6, saltOf(expected), { version: '2a' })).toBe(expected);
  });

  it('$2b$ ve $2y$ aynı özeti verir (yalnızca önek farklı)', () => {
    const [password, hash] = vectors[2]!;
    expect(hashBcrypt(password, 6, saltOf(hash))).toBe(hash.replace('$2a$', '$2b$'));
    expect(hashBcrypt(password, 6, saltOf(hash), { version: '2y' })).toBe(hash.replace('$2a$', '$2y$'));
  });

  it('rastgele tuz: her seferinde farklı, biçim doğru', () => {
    const a = hashBcrypt('parola', 4);
    const b = hashBcrypt('parola', 4);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^\$2b\$04\$[./A-Za-z0-9]{53}$/);
  });

  it('72 bayttan sonrası yok sayılır (UTF-8 bayt)', () => {
    const salt = saltOf(vectors[0]![1]);
    const base = 'x'.repeat(72);
    expect(hashBcrypt(base + 'fazlası', 4, salt)).toBe(hashBcrypt(base, 4, salt));
    expect(hashBcrypt('x'.repeat(71), 4, salt)).not.toBe(hashBcrypt(base, 4, salt));
    // "ğ" 2 bayt: 36 tanesi tam 72 bayt.
    expect(hashBcrypt('ğ'.repeat(36) + 'a', 4, salt)).toBe(hashBcrypt('ğ'.repeat(40), 4, salt));
  });

  it('ilerleme bildirir', () => {
    const progress: number[] = [];
    hashBcrypt('a', 4, saltOf(vectors[0]![1]), { onProgress: (done) => progress.push(done) });
    expect(progress.at(-1)).toBe(16);
    const big: [number, number][] = [];
    hashBcrypt('a', 8, saltOf(vectors[0]![1]), { onProgress: (done, total) => big.push([done, total]) });
    expect(big).toHaveLength(64);
    expect(big.at(-1)).toEqual([256, 256]);
  });

  it('geçersiz maliyet ve tuz', () => {
    expect(() => hashBcrypt('a', 3)).toThrow(ToolError);
    expect(() => hashBcrypt('a', 32)).toThrow(ToolError);
    expect(() => hashBcrypt('a', 4.5)).toThrow(ToolError);
    expect(() => hashBcrypt('a', 4, 'kısa')).toThrow(ToolError);
    expect(() => hashBcrypt('a', 4, new Uint8Array(8))).toThrow(ToolError);
  });
});

describe('verifyBcrypt', () => {
  it.each(vectors)('bilinen vektör eşleşir: %j', (password, hash) => {
    expect(verifyBcrypt(password, hash)).toBe(true);
    expect(verifyBcrypt(password + '!', hash)).toBe(false);
  });

  it('$2b$/$2y$ önekiyle ve boşluklu girişle doğrular', () => {
    const [password, hash] = vectors[1]!;
    expect(verifyBcrypt(password, hash.replace('$2a$', '$2b$'))).toBe(true);
    expect(verifyBcrypt(password, ` ${hash.replace('$2a$', '$2y$')}\n`)).toBe(true);
  });

  it('kendi ürettiğini doğrular', () => {
    const hash = hashBcrypt('Şifre 🔐', 5);
    expect(verifyBcrypt('Şifre 🔐', hash)).toBe(true);
    expect(verifyBcrypt('Sifre 🔐', hash)).toBe(false);
  });

  it('tam özet olmadan hata', () => {
    expect(() => verifyBcrypt('a', vectors[0]![1].slice(0, 29))).toThrow(/tam özet/);
  });
});

describe('parseBcrypt', () => {
  it('parçalar', () => {
    expect(parseBcrypt(vectors[0]![1])).toEqual({
      version: '2a',
      cost: 6,
      salt: 'DCq7YPn5Rq63x1Lad4cll.',
      digest: 'TV4S6ytwfsfvkgY8jIucDrjc8deX1s.',
    });
    expect(parseBcrypt('$2b$12$DCq7YPn5Rq63x1Lad4cll.')).toMatchObject({ cost: 12, digest: null });
  });

  it.each([
    ['md5 özeti', 'd41d8cd98f00b204e9800998ecf8427e', /bcrypt özeti değil/],
    ['eski sürüm', '$2x$06$DCq7YPn5Rq63x1Lad4cll.TV4S6ytwfsfvkgY8jIucDrjc8deX1s.', /desteklenmiyor/],
    ['düşük maliyet', '$2b$03$DCq7YPn5Rq63x1Lad4cll.TV4S6ytwfsfvkgY8jIucDrjc8deX1s.', /Maliyet/],
    ['tek basamak', '$2b$6$DCq7YPn5Rq63x1Lad4cll.TV4S6ytwfsfvkgY8jIucDrjc8deX1s.', /iki basamaklı/],
    ['kısa', '$2b$06$DCq7YPn5Rq63x1Lad4cll.TV4S6', /53 karakter/],
    ['geçersiz karakter', '$2b$06$DCq7YPn5Rq63x1Lad4cll.TV4S6ytwfsfvkgY8jIucDrjc8deX1s+', /Base64/],
  ])('%s reddedilir', (_, hash, message) => {
    expect(() => parseBcrypt(hash)).toThrow(message);
  });
});

describe('bcrypt Base64', () => {
  it('gidiş-dönüş', () => {
    for (let n = 0; n <= 24; n++) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 73 + 5) & 0xff);
      expect(bcryptBase64Decode(bcryptBase64Encode(bytes), n)).toEqual(bytes);
    }
    expect(bcryptBase64Encode(new Uint8Array(16))).toBe('......................');
  });

  it('parola baytları NUL ile biter ve 72 baytta kesilir', () => {
    expect([...bcryptPasswordBytes('ab')]).toEqual([0x61, 0x62, 0]);
    expect(bcryptPasswordBytes('a'.repeat(100))).toHaveLength(72);
    expect(bcryptPasswordBytes('a'.repeat(72)).at(-1)).toBe(0x61);
  });
});
