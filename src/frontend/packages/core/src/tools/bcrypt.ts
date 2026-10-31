import { msg } from '../i18n';
import { utf8Encode } from './encoding';
import { ToolError } from './errors';

/**
 * bcrypt (Provos ve Mazières, 1999): Blowfish'in pahalı anahtar hazırlığı (EksBlowfishSetup) üzerine kurulu
 * parola özeti. Bağımlılıksız uygulama; çıktısı OpenBSD ile aynıdır.
 */

export type BcryptVersion = '2a' | '2b' | '2y';

export interface BcryptParts {
  version: BcryptVersion;
  cost: number;
  /** 22 karakterlik tuz (bcrypt Base64). */
  salt: string;
  /** 31 karakterlik özet; yalnızca tuz öneki verildiyse yok. */
  digest: string | null;
}

export interface BcryptOptions {
  version?: BcryptVersion;
  /** Tamamlanan tur / toplam tur (2^maliyet). Seyrek çağrılır (en fazla ~64 kez). */
  onProgress?: (done: number, total: number) => void;
}

export const BCRYPT_MIN_COST = 4;
export const BCRYPT_MAX_COST = 31;
/** Parolanın bu kadar baytından (UTF-8) sonrası yok sayılır. */
export const BCRYPT_MAX_BYTES = 72;
const SALT_BYTES = 16;
/** Özetin son baytı atılır (OpenBSD uyumu): 23 bayt = 31 karakter. */
const DIGEST_BYTES = 23;

const ALPHABET = './ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const ALPHABET_INDEX = new Map([...ALPHABET].map((ch, i) => [ch, i]));

/** bcrypt'in Base64'ü: farklı alfabe, dolgu yok; bit sırası standart Base64 ile aynı. */
export function bcryptBase64Encode(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = bytes[i + 1] ?? 0;
    const b2 = bytes[i + 2] ?? 0;
    out += ALPHABET[b0 >> 2]! + ALPHABET[((b0 & 3) << 4) | (b1 >> 4)]!;
    if (i + 1 < bytes.length) out += ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)]!;
    if (i + 2 < bytes.length) out += ALPHABET[b2 & 0x3f]!;
  }
  return out;
}

/** `length` baytı çözer; artan bitler (tuzun son karakterindeki 4 bit gibi) yok sayılır. */
export function bcryptBase64Decode(text: string, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let bits = 0;
  let acc = 0;
  let pos = 0;
  for (const ch of text) {
    const value = ALPHABET_INDEX.get(ch);
    if (value === undefined)
      throw new ToolError(
        msg('toolsSecurity.bcrypt.badChar', 'Geçersiz bcrypt Base64 karakteri: "{ch}".', { ch }),
      );
    acc = ((acc << 6) | value) & 0xffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      if (pos < length) out[pos++] = (acc >> bits) & 0xff;
    }
  }
  if (pos < length)
    throw new ToolError(msg('toolsSecurity.bcrypt.dataTooShort', 'bcrypt Base64 verisi çok kısa.'));
  return out;
}

/** Blowfish başlangıç değerleri: π'nin kesir kısmının onaltılık basamakları (18 P + 4×256 S sözcüğü). */
let piWords: Int32Array | null = null;

function blowfishInit(): Int32Array {
  if (piWords) return piWords;
  const words = 18 + 1024;
  const guard = 64n;
  const one = 1n << BigInt(words * 32 + 64);
  // Machin: π = 16·atan(1/5) − 4·atan(1/239); büyük tamsayıyla ~25 ms.
  const atanInv = (x: bigint) => {
    const x2 = x * x;
    let term = one / x;
    let sum = term;
    for (let k = 1n; term !== 0n; k++) {
      term /= x2;
      sum += (k & 1n ? -term : term) / (2n * k + 1n);
    }
    return sum;
  };
  let frac = ((16n * atanInv(5n) - 4n * atanInv(239n)) >> guard) & ((1n << BigInt(words * 32)) - 1n);
  piWords = new Int32Array(words);
  for (let i = words - 1; i >= 0; i--) {
    piWords[i] = Number(frac & 0xffffffffn) | 0;
    frac >>= 32n;
  }
  return piWords;
}

/** Blowfish durumu: P (18 sözcük) ardından dört S kutusu (S0 0..255, S1 256.., S2 512.., S3 768..). */
class Blowfish {
  readonly p: Int32Array;
  readonly s: Int32Array;
  private readonly lr = new Int32Array(2);

  constructor() {
    const init = blowfishInit();
    this.p = init.slice(0, 18);
    this.s = init.slice(18);
  }

  /** `lr[off]`, `lr[off+1]` bloğunu yerinde şifreler. */
  encipher(lr: Int32Array, off: number): void {
    const { p, s } = this;
    let l = lr[off]! ^ p[0]!;
    let r = lr[off + 1]!;
    for (let i = 1; i <= 16; i += 2) {
      r ^=
        (((s[l >>> 24]! + s[256 | ((l >>> 16) & 0xff)]!) ^ s[512 | ((l >>> 8) & 0xff)]!) +
          s[768 | (l & 0xff)]!) ^
        p[i]!;
      l ^=
        (((s[r >>> 24]! + s[256 | ((r >>> 16) & 0xff)]!) ^ s[512 | ((r >>> 8) & 0xff)]!) +
          s[768 | (r & 0xff)]!) ^
        p[i + 1]!;
    }
    lr[off] = r ^ p[17]!;
    lr[off + 1] = l;
  }

  /**
   * Anahtar genişletme. `salt` verilirse EksBlowfish biçimi: her bloktan önce tuzdan okunan sözcükler
   * karıştırılır; verilmezse standart Blowfish anahtar hazırlığı.
   */
  expand(key: Uint8Array, salt?: Uint8Array): void {
    const { p, s, lr } = this;
    let keyPos = 0;
    let saltPos = 0;
    const word = (data: Uint8Array, pos: number) =>
      (data[pos % data.length]! << 24) |
      (data[(pos + 1) % data.length]! << 16) |
      (data[(pos + 2) % data.length]! << 8) |
      data[(pos + 3) % data.length]!;
    for (let i = 0; i < 18; i++) {
      p[i] = p[i]! ^ word(key, keyPos);
      keyPos = (keyPos + 4) % key.length;
    }
    lr[0] = 0;
    lr[1] = 0;
    const fill = (target: Int32Array) => {
      for (let i = 0; i < target.length; i += 2) {
        if (salt) {
          lr[0] = lr[0]! ^ word(salt, saltPos);
          lr[1] = lr[1]! ^ word(salt, saltPos + 4);
          saltPos = (saltPos + 8) % salt.length;
        }
        this.encipher(lr, 0);
        target[i] = lr[0]!;
        target[i + 1] = lr[1]!;
      }
    };
    fill(p);
    fill(s);
  }
}

/** "OrpheanBeholderScryDoubt": 64 kez şifrelenen sabit metin. */
const MAGIC = utf8Encode('OrpheanBeholderScryDoubt');

function checkCost(cost: number): void {
  if (!Number.isInteger(cost) || cost < BCRYPT_MIN_COST || cost > BCRYPT_MAX_COST) {
    throw new ToolError(
      msg('toolsSecurity.bcrypt.costRange', 'Maliyet {min}–{max} arasında bir tamsayı olmalı.', {
        min: BCRYPT_MIN_COST,
        max: BCRYPT_MAX_COST,
      }),
    );
  }
}

/** Parolanın bcrypt'e giden baytları: UTF-8 + NUL sonlandırıcı, en fazla 72 bayt. */
export function bcryptPasswordBytes(password: string): Uint8Array {
  const encoded = utf8Encode(password);
  const key = new Uint8Array(Math.min(encoded.length + 1, BCRYPT_MAX_BYTES));
  key.set(encoded.subarray(0, key.length));
  return key;
}

/** Ham 23 baytlık özet. */
function bcryptDigest(
  password: string,
  cost: number,
  salt: Uint8Array,
  onProgress?: BcryptOptions['onProgress'],
) {
  checkCost(cost);
  const key = bcryptPasswordBytes(password);
  const state = new Blowfish();
  state.expand(key, salt);
  const total = 2 ** cost;
  const step = Math.max(1, total / 64);
  for (let round = 0; round < total;) {
    state.expand(key);
    state.expand(salt);
    round++;
    if (onProgress && (round % step === 0 || round === total)) onProgress(round, total);
  }
  const view = new DataView(MAGIC.buffer, MAGIC.byteOffset, MAGIC.byteLength);
  const ctext = Int32Array.from({ length: 6 }, (_, i) => view.getInt32(i * 4));
  for (let i = 0; i < 64; i++) for (let j = 0; j < 6; j += 2) state.encipher(ctext, j);
  const out = new Uint8Array(24);
  const outView = new DataView(out.buffer);
  ctext.forEach((word, i) => outView.setInt32(i * 4, word));
  return out.subarray(0, DIGEST_BYTES);
}

/** Kriptografik rastgele 16 baytlık tuz. */
export function bcryptSalt(): Uint8Array {
  if (typeof globalThis.crypto?.getRandomValues !== 'function') {
    throw new ToolError(
      msg(
        'toolsSecurity.bcrypt.randomUnsupported',
        'Rastgele tuz için tarayıcının crypto.getRandomValues desteği gerekir.',
      ),
    );
  }
  return globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES));
}

function saltBytes(salt: Uint8Array | string): Uint8Array {
  if (typeof salt === 'string') {
    if (!/^[./A-Za-z0-9]{22}$/.test(salt))
      throw new ToolError(msg('toolsSecurity.bcrypt.saltChars', 'Tuz 22 karakterlik bcrypt Base64 olmalı.'));
    return bcryptBase64Decode(salt, SALT_BYTES);
  }
  if (salt.length !== SALT_BYTES)
    throw new ToolError(msg('toolsSecurity.bcrypt.saltBytes', 'Tuz 16 bayt olmalı.'));
  return salt;
}

/**
 * `$2b$10$<22 karakter tuz><31 karakter özet>` biçiminde bcrypt özeti üretir. Tuz verilmezse rastgele seçilir.
 * Maliyet 12 ve üstü saniyeler sürebilir: arayüzde Worker'da çağrılmalı.
 */
export function hashBcrypt(
  password: string,
  cost: number,
  salt?: Uint8Array | string,
  { version = '2b', onProgress }: BcryptOptions = {},
): string {
  checkCost(cost);
  const saltRaw = salt === undefined ? bcryptSalt() : saltBytes(salt);
  const digest = bcryptDigest(password, cost, saltRaw, onProgress);
  return `$${version}$${String(cost).padStart(2, '0')}$${bcryptBase64Encode(saltRaw)}${bcryptBase64Encode(digest)}`;
}

/** bcrypt özetini (ya da yalnızca 29 karakterlik tuz önekini) parçalarına ayırır. */
export function parseBcrypt(hash: string): BcryptParts {
  const text = hash.trim();
  const match = /^\$(2[a-z]?)\$(\d{1,2})\$(.*)$/.exec(text);
  if (!match)
    throw new ToolError(
      msg('toolsSecurity.bcrypt.notHash', 'bcrypt özeti değil: "$2b$10$…" biçiminde olmalı.'),
    );
  const [, version, costText, rest] = match as unknown as [string, string, string, string];
  if (version !== '2a' && version !== '2b' && version !== '2y') {
    throw new ToolError(
      msg(
        'toolsSecurity.bcrypt.version',
        '${version}$ sürümü desteklenmiyor; $2a$, $2b$ ya da $2y$ olmalı.',
        { version },
      ),
    );
  }
  if (costText.length !== 2)
    throw new ToolError(
      msg('toolsSecurity.bcrypt.costTwoDigits', 'Maliyet iki basamaklı olmalı (ör. 04, 10).'),
    );
  const cost = Number(costText);
  checkCost(cost);
  if (!/^[./A-Za-z0-9]*$/.test(rest))
    throw new ToolError(
      msg('toolsSecurity.bcrypt.restChars', 'Tuz ve özet yalnızca bcrypt Base64 karakterleri içermeli.'),
    );
  if (rest.length !== 22 && rest.length !== 53) {
    throw new ToolError(
      msg(
        'toolsSecurity.bcrypt.restLength',
        'Tuz ve özet 53 karakter olmalı (22 tuz + 31 özet); {count} karakter var.',
        { count: rest.length },
      ),
    );
  }
  return { version, cost, salt: rest.slice(0, 22), digest: rest.length === 53 ? rest.slice(22) : null };
}

/** Parolayı özetle karşılaştırır; özet baytları sabit zamanda karşılaştırılır. */
export function verifyBcrypt(
  password: string,
  hash: string,
  { onProgress }: Pick<BcryptOptions, 'onProgress'> = {},
) {
  const parts = parseBcrypt(hash);
  if (!parts.digest)
    throw new ToolError(
      msg('toolsSecurity.bcrypt.fullHash', 'Doğrulama için tam özet gerekir (60 karakter).'),
    );
  const expected = bcryptBase64Decode(parts.digest, DIGEST_BYTES);
  const actual = bcryptDigest(password, parts.cost, saltBytes(parts.salt), onProgress);
  let diff = 0;
  for (let i = 0; i < DIGEST_BYTES; i++) diff |= expected[i]! ^ actual[i]!;
  return diff === 0;
}
