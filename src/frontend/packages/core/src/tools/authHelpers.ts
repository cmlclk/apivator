import { msg } from '../i18n';
import { ToolError } from './errors';
import { base64Decode, base64Encode, toHex, utf8Decode, utf8Encode } from './encoding';
import { digest } from './hash';

/* ---------------------------------------------------------------- Basic auth (RFC 7617) */

/** `Basic base64(kullanıcı:parola)` (UTF-8); kullanıcı adında ":" olamaz. */
export function basicAuthHeader(user: string, password: string): string {
  if (user.includes(':'))
    throw new ToolError(msg('toolsSecurity.auth.userColon', 'Kullanıcı adı ":" içeremez (RFC 7617).'));
  return `Basic ${base64Encode(utf8Encode(`${user}:${password}`))}`;
}

/** "Authorization: Basic …", "Basic …" ya da yalnızca Base64 kısmını çözer. */
export function decodeBasicAuth(header: string): { user: string; password: string } {
  const value = header
    .trim()
    .replace(/^authorization\s*:\s*/i, '')
    .replace(/^basic(\s+|$)/i, '')
    .trim();
  if (!value) throw new ToolError(msg('toolsSecurity.auth.basicEmpty', 'Çözülecek Basic başlığı boş.'));
  if (/\s/.test(value))
    throw new ToolError(
      msg(
        'toolsSecurity.auth.basicSpaces',
        'Basic değeri boşluk içeremez; yalnızca "Basic <base64>" bekleniyor.',
      ),
    );
  let text: string;
  try {
    text = utf8Decode(base64Decode(value), true);
  } catch {
    throw new ToolError(
      msg('toolsSecurity.auth.basicNotBase64', 'Basic değeri geçerli Base64 (UTF-8) değil.'),
    );
  }
  const colon = text.indexOf(':');
  if (colon < 0)
    throw new ToolError(
      msg('toolsSecurity.auth.basicNoSeparator', 'Çözülen değerde "kullanıcı:parola" ayracı (:) yok.'),
    );
  return { user: text.slice(0, colon), password: text.slice(colon + 1) };
}

/* ---------------------------------------------------------------- Güvenli rastgelelik */

/** [0, max) aralığında düzgün dağılımlı tamsayı: modülo yanlılığı olmasın diye reddetmeli örnekleme. */
export function randomInt(max: number): number {
  if (!Number.isInteger(max) || max < 1 || max > 2 ** 32)
    throw new ToolError(msg('toolsSecurity.auth.randomRange', 'Geçersiz rastgele aralık.'));
  const limit = Math.floor(2 ** 32 / max) * max;
  const buffer = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buffer);
    if (buffer[0]! < limit) return buffer[0]! % max;
  }
}

/**
 * `randomInt` ile aynı (yansız, kriptografik) ama rastgele sözcükleri 1024'lük topluca alır: binlerce çağrıda
 * her seferinde getRandomValues çağırmak çok yavaştır (sahte veri, lorem).
 */
export function bufferedRandomInt(): (max: number) => number {
  const buffer = new Uint32Array(1024);
  let index = buffer.length;
  return (max) => {
    if (!Number.isInteger(max) || max < 1 || max > 2 ** 32)
      throw new ToolError(msg('toolsSecurity.auth.randomRange', 'Geçersiz rastgele aralık.'));
    const limit = Math.floor(2 ** 32 / max) * max;
    for (;;) {
      if (index === buffer.length) {
        crypto.getRandomValues(buffer);
        index = 0;
      }
      const value = buffer[index++]!;
      if (value < limit) return value % max;
    }
  };
}

function pick(chars: string): string {
  return chars[randomInt(chars.length)]!;
}

/* ---------------------------------------------------------------- OAuth 2.0 PKCE (RFC 7636) */

/** code_verifier karakterleri: unreserved = ALPHA / DIGIT / "-" / "." / "_" / "~". */
export const PKCE_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
export const PKCE_MIN_LENGTH = 43;
export const PKCE_MAX_LENGTH = 128;

export type PkceMethod = 'S256' | 'plain';

/** 43–128 karakterlik, kriptografik rastgele code_verifier. */
export function createPkceVerifier(length = 64): string {
  if (!Number.isInteger(length) || length < PKCE_MIN_LENGTH || length > PKCE_MAX_LENGTH) {
    throw new ToolError(
      msg('toolsSecurity.auth.verifierLength', 'code_verifier uzunluğu {min}–{max} olmalı.', {
        min: PKCE_MIN_LENGTH,
        max: PKCE_MAX_LENGTH,
      }),
    );
  }
  let out = '';
  for (let i = 0; i < length; i++) out += pick(PKCE_CHARSET);
  return out;
}

/** RFC 7636'ya uymayan verifier'da açıklama, uyuyorsa null. */
export function pkceVerifierProblem(verifier: string): string | null {
  if (verifier.length < PKCE_MIN_LENGTH || verifier.length > PKCE_MAX_LENGTH) {
    return msg(
      'toolsSecurity.auth.verifierChars',
      'code_verifier {min}–{max} karakter olmalı (şu an {length}).',
      { min: PKCE_MIN_LENGTH, max: PKCE_MAX_LENGTH, length: verifier.length },
    );
  }
  const bad = [...verifier].find((c) => !PKCE_CHARSET.includes(c));
  if (bad !== undefined)
    return msg(
      'toolsSecurity.auth.verifierBadChar',
      'code_verifier izin verilmeyen karakter içeriyor: "{bad}" (yalnızca A-Z a-z 0-9 - . _ ~).',
      { bad },
    );
  return null;
}

/** S256: BASE64URL(SHA-256(ASCII(verifier))); plain: verifier'ın kendisi. */
export async function pkceChallenge(verifier: string, method: PkceMethod = 'S256'): Promise<string> {
  const problem = pkceVerifierProblem(verifier);
  if (problem) throw new ToolError(problem);
  if (method === 'plain') return verifier;
  return base64Encode(await digest('SHA-256', utf8Encode(verifier)), { urlSafe: true });
}

/* ---------------------------------------------------------------- Şifre üretici */

export interface PasswordOptions {
  length: number;
  upper: boolean;
  lower: boolean;
  digits: boolean;
  symbols: boolean;
  /** Karıştırılabilen I l 1 O 0 karakterleri çıkarılır. */
  excludeAmbiguous: boolean;
  /** Seçilen her sınıftan en az bir karakter. */
  requireEach: boolean;
}

export const PASSWORD_MAX_LENGTH = 1024;
const AMBIGUOUS = 'Il1O0';
const CLASSES = {
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  lower: 'abcdefghijklmnopqrstuvwxyz',
  digits: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{};:,.<>?/~',
} as const;

function passwordClasses(options: PasswordOptions): string[] {
  return (Object.keys(CLASSES) as (keyof typeof CLASSES)[])
    .filter((name) => options[name])
    .map((name) =>
      options.excludeAmbiguous
        ? [...CLASSES[name]].filter((c) => !AMBIGUOUS.includes(c)).join('')
        : CLASSES[name],
    );
}

export function generatePassword(options: PasswordOptions): string {
  const classes = passwordClasses(options);
  if (!classes.length)
    throw new ToolError(msg('toolsSecurity.auth.classRequired', 'En az bir karakter sınıfı seçin.'));
  const { length } = options;
  if (!Number.isInteger(length) || length < 1 || length > PASSWORD_MAX_LENGTH) {
    throw new ToolError(
      msg('toolsSecurity.auth.passwordLength', 'Uzunluk 1–{max} olmalı.', {
        max: PASSWORD_MAX_LENGTH,
      }),
    );
  }
  if (options.requireEach && length < classes.length) {
    throw new ToolError(
      msg(
        'toolsSecurity.auth.passwordMinPerClass',
        'Her sınıftan bir karakter için uzunluk en az {count} olmalı.',
        { count: classes.length },
      ),
    );
  }
  const pool = classes.join('');
  const chars = options.requireEach ? classes.map(pick) : [];
  while (chars.length < length) chars.push(pick(pool));
  // Zorunlu karakterler başta kalmasın: Fisher–Yates karıştırma.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join('');
}

/** Yaklaşık entropi: uzunluk × log2(havuz). */
export function passwordEntropy(options: PasswordOptions): number {
  const pool = passwordClasses(options).join('').length;
  return pool ? options.length * Math.log2(pool) : 0;
}

export function strengthLabel(bits: number): string {
  if (bits < 40) return msg('toolsSecurity.auth.strength.weak', 'zayıf');
  if (bits < 64) return msg('toolsSecurity.auth.strength.fair', 'orta');
  if (bits < 100) return msg('toolsSecurity.auth.strength.strong', 'güçlü');
  return msg('toolsSecurity.auth.strength.veryStrong', 'çok güçlü');
}

/** Parola cümlesi için kısa, aksansız kelimeler (yazması kolay). */
export const PASSPHRASE_WORDS = (
  'ada agac akis alan anahtar ani araba arka armut avlu ayna ayva bahar bahce bakir balik bal bardak bayrak ' +
  'bebek beyaz bilet bina bisiklet bulut buz cadde cam cami canta cay cep cetvel cicek cilek cinar cizgi ' +
  'corap cuma dag dal dalga damla dans defter deniz derin dere devam dikis dilek dolap domates dost duvar ' +
  'dunya ekmek elma erik eski ev fener fidan film firin fistik gazete gece gemi gol gonul gok gul gunes ' +
  'gurultu haber hali hamur harita hava hayal hece hediye hirka hizli horoz ilac incir inek irmak isik ' +
  'iskele istasyon jilet kabak kadeh kagit kalem kale kanat kapi kar karpuz kasik kavak kaya kedi kemer ' +
  'kent kiraz kitap koltuk kopru korku kova koy kum kupa kurek kus lale lamba liman limon maden makas ' +
  'mangal masa mavi meltem merdiven mektup mevsim meyve misir mum muz nane nehir nar ocak oda okul orman ' +
  'oyun ozan pamuk pancar papatya pazar pencere pera pide pinar portakal posta radyo resim ruzgar saat ' +
  'sabah sahil saksi sal sandal sapka sarki sehir sepet ses sicak simit soba sokak somun sorun su sulu ' +
  'tabak tarla tas tavuk tepe tilki toprak tren tuz uzum vagon vazo yaka yaprak yastik yayla yazi yel ' +
  'yelken yildiz yol yorgan yumurta yunus zaman zeytin zil'
).split(' ');

export function generatePassphrase(words: number, separator = '-'): string {
  if (!Number.isInteger(words) || words < 1 || words > 64)
    throw new ToolError(msg('toolsSecurity.auth.wordCount', 'Kelime sayısı 1–64 olmalı.'));
  return Array.from({ length: words }, () => PASSPHRASE_WORDS[randomInt(PASSPHRASE_WORDS.length)]!).join(
    separator,
  );
}

export function passphraseEntropy(words: number): number {
  return words * Math.log2(PASSPHRASE_WORDS.length);
}

/* ---------------------------------------------------------------- Rastgele token */

export type TokenFormat = 'hex' | 'base64' | 'base64url';
export const TOKEN_MAX_BYTES = 1024;

export function randomToken(bytes: number, format: TokenFormat): string {
  if (!Number.isInteger(bytes) || bytes < 1 || bytes > TOKEN_MAX_BYTES) {
    throw new ToolError(
      msg('toolsSecurity.auth.byteCount', 'Bayt sayısı 1–{max} olmalı.', { max: TOKEN_MAX_BYTES }),
    );
  }
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  if (format === 'hex') return toHex(data);
  return base64Encode(data, { urlSafe: format === 'base64url' });
}
