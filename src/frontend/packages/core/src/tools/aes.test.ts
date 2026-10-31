import { describe, expect, it } from 'vitest';
import { hexToBytes } from './codecs';
import { toHex, utf8Decode, utf8Encode } from './encoding';
import { ToolError } from './errors';
import {
  aesDecrypt,
  aesEncrypt,
  aesIvLength,
  deriveAesKey,
  formatBinary,
  joinIv,
  parseBinary,
  randomBytes,
  splitIv,
} from './aes';

const h = hexToBytes;

describe('Web Crypto ortamı', () => {
  it('vitest ortamında globalThis.crypto.subtle var', () => {
    expect(typeof globalThis.crypto?.subtle?.encrypt).toBe('function');
  });
});

describe('AES-GCM (McGrew–Viega GCM belirtimi test vektörleri)', () => {
  it('Test 1: boş metin, yalnızca etiket', async () => {
    const out = await aesEncrypt(
      { mode: 'AES-GCM', key: new Uint8Array(16), iv: new Uint8Array(12) },
      new Uint8Array(),
    );
    expect(toHex(out)).toBe('58e2fccefa7e3061367f1d57a4e7455a');
  });

  it('Test 2: sıfır blok', async () => {
    const out = await aesEncrypt(
      { mode: 'AES-GCM', key: new Uint8Array(16), iv: new Uint8Array(12) },
      new Uint8Array(16),
    );
    expect(toHex(out)).toBe('0388dace60b6a392f328c2b971b2fe78' + 'ab6e47d42cec13bdf53a67b21257bddf');
  });

  const key = h('feffe9928665731c6d6a8f9467308308');
  const iv = h('cafebabefacedbaddecaf888');
  const plain60 =
    'd9313225f88406e5a55909c5aff5269a86a7a9531534f7da2e4c303d8a318a72' +
    '1c3c0c95956809532fcf0e2449a6b525b16aedf5aa0de657ba637b39';
  const cipher60 =
    '42831ec2217774244b7221b784d0d49ce3aa212f2c02a4e035c17e2329aca12e' +
    '21d514b25466931c7d8f6a5aac84aa051ba30b396a0aac973d58e091';

  it('Test 3: 64 bayt', async () => {
    const out = await aesEncrypt({ mode: 'AES-GCM', key, iv }, h(plain60 + '1aafd255'));
    expect(toHex(out)).toBe(cipher60 + '473f5985' + '4d5c2af327cd64a62cf35abd2ba6fab4');
  });

  it('Test 4: AAD ile; çözme ve değiştirilmiş veri', async () => {
    const aad = h('feedfacedeadbeeffeedfacedeadbeefabaddad2');
    const params = { mode: 'AES-GCM' as const, key, iv, aad };
    const out = await aesEncrypt(params, h(plain60));
    expect(toHex(out)).toBe(cipher60 + '5bc94fbc3221a5db94fae95ae7121a47');
    expect(toHex(await aesDecrypt(params, out))).toBe(plain60);

    const tampered = out.slice();
    tampered[0]! ^= 1;
    await expect(aesDecrypt(params, tampered)).rejects.toThrow(/GCM doğrulama etiketi/);
    await expect(aesDecrypt({ ...params, aad: undefined }, out)).rejects.toThrow(ToolError);
    await expect(aesDecrypt({ ...params, key: new Uint8Array(16) }, out)).rejects.toThrow(/Çözülemedi/);
  });

  it('AES-256 gidiş-dönüş', async () => {
    const params = { mode: 'AES-GCM' as const, key: randomBytes(32), iv: randomBytes(12) };
    const out = await aesEncrypt(params, utf8Encode('Merhaba dünya ğüşiöç'));
    expect(utf8Decode(await aesDecrypt(params, out))).toBe('Merhaba dünya ğüşiöç');
  });

  it('kısa veriyi reddeder', async () => {
    await expect(
      aesDecrypt({ mode: 'AES-GCM', key: new Uint8Array(16), iv: new Uint8Array(12) }, new Uint8Array(5)),
    ).rejects.toThrow(/çok kısa/);
  });
});

describe('AES-CBC (NIST SP 800-38A F.2)', () => {
  const iv = h('000102030405060708090a0b0c0d0e0f');
  const plain =
    '6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e51' +
    '30c81c46a35ce411e5fbc1191a0a52eff69f2445df4f9b17ad2b417be66c3710';

  it('F.2.1 CBC-AES128 (PKCS#7 dolgu bloğu eklenir)', async () => {
    const params = { mode: 'AES-CBC' as const, key: h('2b7e151628aed2a6abf7158809cf4f3c'), iv };
    const out = await aesEncrypt(params, h(plain));
    expect(out.length).toBe(80);
    expect(toHex(out.slice(0, 64))).toBe(
      '7649abac8119b246cee98e9b12e9197d5086cb9b507219ee95db113a917678b2' +
        '73bed6b8e3c1743b7116e69e222295163ff1caa1681fac09120eca307586e1a7',
    );
    expect(toHex(await aesDecrypt(params, out))).toBe(plain);
  });

  it('F.2.5 CBC-AES256', async () => {
    const key = h('603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4');
    const out = await aesEncrypt({ mode: 'AES-CBC', key, iv }, h(plain));
    expect(toHex(out.slice(0, 16))).toBe('f58c4c04d6e5f1ba779eabfb5f7bfbd6');
  });

  it('bozuk dolgu, yanlış blok uzunluğu ve IV boyu', async () => {
    const params = { mode: 'AES-CBC' as const, key: randomBytes(16), iv: randomBytes(16) };
    const out = await aesEncrypt(params, utf8Encode('gizli'));
    // Rastgele yanlış anahtar ~1/256 olasılıkla geçerli dolgu üretir; sabit anahtarla sonuç her zaman aynı.
    const fixed = { mode: 'AES-CBC' as const, key: new Uint8Array(16).fill(1), iv: new Uint8Array(16) };
    const fixedOut = await aesEncrypt(fixed, utf8Encode('gizli'));
    await expect(aesDecrypt({ ...fixed, key: new Uint8Array(16).fill(2) }, fixedOut)).rejects.toThrow(
      /PKCS#7|Çözülemedi/,
    );
    await expect(aesDecrypt(params, out.slice(0, 15))).rejects.toThrow(/16 baytın katı/);
    await expect(aesEncrypt({ ...params, iv: randomBytes(12) }, out)).rejects.toThrow(/IV 16 bayt/);
  });
});

describe('anahtar ve biçimler', () => {
  it('geçersiz anahtar uzunluğu', async () => {
    await expect(
      aesEncrypt({ mode: 'AES-GCM', key: new Uint8Array(10), iv: new Uint8Array(12) }, new Uint8Array(1)),
    ).rejects.toThrow(/16, 24 ya da 32 bayt/);
  });

  it('PBKDF2-HMAC-SHA256 (RFC 7914 §11 vektörü)', async () => {
    const key = await deriveAesKey('passwd', utf8Encode('salt'), 1, 256);
    expect(toHex(key)).toBe('55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc');
    await expect(deriveAesKey('', utf8Encode('salt'), 1, 128)).rejects.toThrow(/Parola/);
    await expect(deriveAesKey('p', utf8Encode('salt'), 0, 128)).rejects.toThrow(/Yineleme/);
  });

  it('birleşik biçim: IV ‖ şifreli metin', () => {
    const joined = joinIv(h('0102'), h('0304'));
    expect(toHex(joined)).toBe('01020304');
    const split = splitIv('AES-GCM', new Uint8Array(30));
    expect(split.iv.length).toBe(aesIvLength('AES-GCM'));
    expect(split.ciphertext.length).toBe(18);
    expect(() => splitIv('AES-CBC', new Uint8Array(16))).toThrow(/çok kısa/);
  });

  it('hex / Base64 dönüşümleri ve alan adlı hata', () => {
    const bytes = h('deadbeef');
    expect(formatBinary(bytes, 'hex')).toBe('deadbeef');
    expect(formatBinary(bytes, 'base64')).toBe('3q2+7w==');
    expect(toHex(parseBinary('3q2+7w==', 'base64', 'IV'))).toBe('deadbeef');
    expect(() => parseBinary('zz', 'hex', 'Anahtar')).toThrow(/Anahtar geçerli hex değil/);
    expect(() => parseBinary(' ', 'hex', 'IV')).toThrow('IV boş.');
  });
});
