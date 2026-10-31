import { describe, expect, it } from 'vitest';
import { toHex, utf8Encode } from './encoding';
import { digest, hasWebCrypto, hmac, md5, type HashAlgorithm } from './hash';

const fill = (length: number, value: number) => new Uint8Array(length).fill(value);

describe('md5', () => {
  // RFC 1321 A.5 test grubu
  const vectors: [string, string][] = [
    ['', 'd41d8cd98f00b204e9800998ecf8427e'],
    ['a', '0cc175b9c0f1b6a831c399e269772661'],
    ['abc', '900150983cd24fb0d6963f7d28e17f72'],
    ['message digest', 'f96b697d7cb7938d525a2f31aaf161d0'],
    ['abcdefghijklmnopqrstuvwxyz', 'c3fcd3d76192e4007dfb496cca67e13b'],
    ['1234567890'.repeat(8), '57edf4a22be3c955ac49da2e2107b67a'],
  ];

  it('RFC 1321 vektörleri', () => {
    for (const [input, expected] of vectors) expect(toHex(md5(utf8Encode(input)))).toBe(expected);
  });

  it('blok sınırındaki uzunluklar (55, 56, 64 bayt)', () => {
    expect(toHex(md5(fill(55, 0x61)))).toBe('ef1772b6dff9a122358552954ad0df65');
    expect(toHex(md5(fill(56, 0x61)))).toBe('3b0c8ac703f828b04c6c197006d17218');
    expect(toHex(md5(fill(64, 0x61)))).toBe('014842d480b571495a4a0363793f7367');
  });
});

describe('digest', () => {
  const abc = utf8Encode('abc');

  it('hasWebCrypto Node ortamında true', () => {
    expect(hasWebCrypto()).toBe(true);
  });

  it('FIPS 180 "abc" ve boş girdi vektörleri', async () => {
    const expected: Record<HashAlgorithm, string> = {
      MD5: '900150983cd24fb0d6963f7d28e17f72',
      'SHA-1': 'a9993e364706816aba3e25717850c26c9cd0d89d',
      'SHA-256': 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      'SHA-384':
        'cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7',
      'SHA-512':
        'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f',
    };
    for (const [algorithm, hex] of Object.entries(expected))
      expect(toHex(await digest(algorithm as HashAlgorithm, abc))).toBe(hex);
    expect(toHex(await digest('SHA-256', new Uint8Array(0)))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(toHex(await digest('MD5', new Uint8Array(0)))).toBe('d41d8cd98f00b204e9800998ecf8427e');
  });
});

describe('hmac', () => {
  it('RFC 4231 HMAC-SHA256 durum 1 ve 2', async () => {
    expect(toHex(await hmac('SHA-256', fill(20, 0x0b), utf8Encode('Hi There')))).toBe(
      'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7',
    );
    expect(toHex(await hmac('SHA-256', utf8Encode('Jefe'), utf8Encode('what do ya want for nothing?')))).toBe(
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    );
  });

  it('RFC 2202 HMAC-MD5 durum 1, 2 ve blok boyundan uzun anahtar (6)', async () => {
    expect(toHex(await hmac('MD5', fill(16, 0x0b), utf8Encode('Hi There')))).toBe(
      '9294727a3638bb1c13f48ef8158bfc9d',
    );
    expect(toHex(await hmac('MD5', utf8Encode('Jefe'), utf8Encode('what do ya want for nothing?')))).toBe(
      '750c783e6ab0b503eaa86e310a5db738',
    );
    expect(
      toHex(
        await hmac(
          'MD5',
          fill(80, 0xaa),
          utf8Encode('Test Using Larger Than Block-Size Key - Hash Key First'),
        ),
      ),
    ).toBe('6b1ab7fe4bd7bf8f0b62e6ce61b9d0cd');
  });

  it('boş anahtarla HMAC (Web Crypto boş anahtarı reddeder; yine de çalışmalı)', async () => {
    const data = utf8Encode('abc');
    const empty = new Uint8Array(0);
    expect(toHex(await hmac('SHA-256', empty, data))).toBe(
      'fd7adb152c05ef80dccf50a1fa4c05d5a3ec6da95575fc312ae7c5d091836351',
    );
    expect(toHex(await hmac('SHA-1', empty, data))).toBe('9b4a918f398d74d3e367970aba3cbe54e4d2b5d9');
    expect(toHex(await hmac('SHA-512', empty, data))).toBe(
      '29689f6b79a8dd686068c2eeae97fd8769ad3ba65cb5381f838358a8045a358ee3ba1739c689c7805e31734fb6072f87261d1256995370d55725cba00d10bdd0',
    );
    expect(toHex(await hmac('MD5', empty, data))).toBe('dd2701993d29fdd0b032c233cec63403');
  });

  it('RFC 2202 HMAC-SHA1 durum 2', async () => {
    expect(toHex(await hmac('SHA-1', utf8Encode('Jefe'), utf8Encode('what do ya want for nothing?')))).toBe(
      'effcdf6ae5eb2fa2d27416d5f184df9c259a7c79',
    );
  });
});
