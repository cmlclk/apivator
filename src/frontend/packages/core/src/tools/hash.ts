import { ToolError } from './errors';
import { msg } from '../i18n';

export type HashAlgorithm = 'MD5' | 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512';

/** Her turun kaydırma miktarları (RFC 1321). */
const MD5_SHIFTS = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9,
  14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15,
  21, 6, 10, 15, 21,
];
const MD5_K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);

/** MD5 Web Crypto'da yok: saf JavaScript uygulaması. */
export function md5(bytes: Uint8Array): Uint8Array {
  // Dolgu: 0x80, sıfırlar ve bit cinsinden uzunluk (64 bit, little-endian).
  const padded = new Uint8Array((((bytes.length + 8) >> 6) + 1) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  const bitLength = bytes.length * 8;
  view.setUint32(padded.length - 8, bitLength >>> 0, true);
  view.setUint32(padded.length - 4, Math.floor(bitLength / 2 ** 32), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;
  const m = new Uint32Array(16);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let j = 0; j < 16; j++) m[j] = view.getUint32(offset + j * 4, true);
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) & 15;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) & 15;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) & 15;
      }
      const sum = (a + f + MD5_K[i]! + m[g]!) | 0;
      const s = MD5_SHIFTS[i]!;
      a = d;
      d = c;
      c = b;
      b = (b + ((sum << s) | (sum >>> (32 - s)))) | 0;
    }
    a0 = (a0 + a) | 0;
    b0 = (b0 + b) | 0;
    c0 = (c0 + c) | 0;
    d0 = (d0 + d) | 0;
  }
  const out = new Uint8Array(16);
  const outView = new DataView(out.buffer);
  [a0, b0, c0, d0].forEach((word, i) => outView.setUint32(i * 4, word >>> 0, true));
  return out;
}

function subtle(): SubtleCrypto {
  if (!hasWebCrypto()) {
    throw new ToolError(
      msg(
        'toolsData.hash.needsWebCrypto',
        'SHA ve HMAC için Web Crypto gerekir: sayfayı HTTPS ya da localhost üzerinden açın.',
      ),
    );
  }
  return globalThis.crypto.subtle;
}

/** Web Crypto'ya verilecek, kendi ArrayBuffer'ına sahip kopya. */
export function toBufferSource(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

/** SHA ailesi Web Crypto ile (güvenli bağlam gerekir), MD5 saf uygulamayla. */
export async function digest(algorithm: HashAlgorithm, bytes: Uint8Array): Promise<Uint8Array> {
  if (algorithm === 'MD5') return md5(bytes);
  return new Uint8Array(await subtle().digest(algorithm, toBufferSource(bytes)));
}

/** RFC 2104 HMAC; SHA ailesi Web Crypto ile, HMAC-MD5 saf uygulamayla. */
export async function hmac(algorithm: HashAlgorithm, key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  if (algorithm === 'MD5') return hmacMd5(key, data);
  // Web Crypto boş anahtarı reddeder; RFC 2104'e göre blok boyunda sıfırlarla aynı sonucu verir.
  if (key.length === 0) key = new Uint8Array(algorithm === 'SHA-384' || algorithm === 'SHA-512' ? 128 : 64);
  const cryptoKey = await subtle().importKey(
    'raw',
    toBufferSource(key),
    { name: 'HMAC', hash: algorithm },
    false,
    ['sign'],
  );
  return new Uint8Array(await subtle().sign('HMAC', cryptoKey, toBufferSource(data)));
}

function hmacMd5(key: Uint8Array, data: Uint8Array): Uint8Array {
  const blockSize = 64;
  const block = new Uint8Array(blockSize);
  block.set(key.length > blockSize ? md5(key) : key);
  const inner = new Uint8Array(blockSize + data.length);
  const outer = new Uint8Array(blockSize + 16);
  for (let i = 0; i < blockSize; i++) {
    inner[i] = block[i]! ^ 0x36;
    outer[i] = block[i]! ^ 0x5c;
  }
  inner.set(data, blockSize);
  outer.set(md5(inner), blockSize);
  return md5(outer);
}

/** Web Crypto kullanılabilir mi (HTTP üzerinden açılan sayfalarda değil). */
export function hasWebCrypto(): boolean {
  return typeof globalThis.crypto?.subtle?.digest === 'function';
}
