import { catalogMessage, msg } from '../i18n';
import { ToolError } from './errors';
import { toHex } from './encoding';

/** ASN.1 etiket sınıfları (ilk baytın üst iki biti). */
export const ASN1_UNIVERSAL = 0;
export const ASN1_CONTEXT = 2;

/** Evrensel etiket numaraları. */
export const TAG = {
  BOOLEAN: 1,
  INTEGER: 2,
  BIT_STRING: 3,
  OCTET_STRING: 4,
  NULL: 5,
  OID: 6,
  UTF8_STRING: 12,
  SEQUENCE: 16,
  SET: 17,
  NUMERIC_STRING: 18,
  PRINTABLE_STRING: 19,
  T61_STRING: 20,
  IA5_STRING: 22,
  UTC_TIME: 23,
  GENERALIZED_TIME: 24,
  VISIBLE_STRING: 26,
  UNIVERSAL_STRING: 28,
  BMP_STRING: 30,
} as const;

export interface Asn1Node {
  tagClass: number;
  constructed: boolean;
  tag: number;
  /** Başlık dahil tüm kodlama (imza doğrulama ve karşılaştırma için). */
  der: Uint8Array;
  /** Yalnızca içerik baytları. */
  content: Uint8Array;
  /** Yapılı (constructed) düğümlerin çocukları; ilkel düğümlerde boş. */
  children: Asn1Node[];
}

export interface DerOptions {
  /** İç içe yapı sınırı; kötü niyetli girdi yığını taşırmasın. */
  maxDepth?: number;
  /** Toplam düğüm sınırı. */
  maxNodes?: number;
}

const DEFAULT_MAX_DEPTH = 32;
const DEFAULT_MAX_NODES = 50_000;
/** UUID tabanlı 2.25.<128 bit> OID'leri bile ~20 bayttır. */
const MAX_OID_BYTES = 256;

/**
 * DER kodlu tek bir ASN.1 değerini ağaç olarak okur. Belirsiz uzunluk (BER), taşan uzunluk, sondaki
 * fazla bayt ve sınır aşımı Türkçe ToolError fırlatır.
 */
export function parseDer(bytes: Uint8Array, options: DerOptions = {}): Asn1Node {
  if (!bytes.length) throw new ToolError(msg('toolsSecurity.der.empty', 'DER verisi boş.'));
  const state = {
    maxDepth: options.maxDepth ?? DEFAULT_MAX_DEPTH,
    nodesLeft: options.maxNodes ?? DEFAULT_MAX_NODES,
  };
  const [node, end] = readNode(bytes, 0, 0, state);
  if (end !== bytes.length) {
    throw new ToolError(
      msg('toolsSecurity.der.trailing', 'DER yapısının sonunda {count} bayt fazlalık var.', {
        count: bytes.length - end,
      }),
    );
  }
  return node;
}

function readNode(
  bytes: Uint8Array,
  offset: number,
  depth: number,
  state: { maxDepth: number; nodesLeft: number },
): [Asn1Node, number] {
  if (depth > state.maxDepth)
    throw new ToolError(
      msg('toolsSecurity.der.tooDeep', 'DER yapısı çok derin (en fazla {max} düzey).', {
        max: state.maxDepth,
      }),
    );
  if (--state.nodesLeft < 0)
    throw new ToolError(msg('toolsSecurity.der.tooManyItems', 'DER yapısında çok fazla öğe var.'));
  const start = offset;
  if (offset >= bytes.length)
    throw new ToolError(
      msg('toolsSecurity.der.unexpectedEnd', 'DER beklenmedik biçimde bitti (konum {offset}).', { offset }),
    );
  const first = bytes[offset++]!;
  const tagClass = first >> 6;
  const constructed = (first & 0x20) !== 0;
  let tag = first & 0x1f;
  if (tag === 0x1f) {
    // Yüksek etiket numarası: 7 bitlik gruplar.
    tag = 0;
    for (let i = 0; ; i++) {
      if (offset >= bytes.length || i > 3)
        throw new ToolError(
          msg('toolsSecurity.der.tagCorrupt', 'DER etiketi bozuk (konum {start}).', { start }),
        );
      const b = bytes[offset++]!;
      tag = tag * 128 + (b & 0x7f);
      if (!(b & 0x80)) break;
    }
  }
  if (offset >= bytes.length)
    throw new ToolError(
      msg('toolsSecurity.der.lengthMissing', 'DER uzunluk alanı eksik (konum {start}).', { start }),
    );
  let length = bytes[offset++]!;
  if (length === 0x80)
    throw new ToolError(
      msg('toolsSecurity.der.indefiniteLength', 'Belirsiz uzunluk (BER) DER içinde kullanılamaz.'),
    );
  if (length > 0x80) {
    const count = length & 0x7f;
    if (count > 4)
      throw new ToolError(
        msg('toolsSecurity.der.lengthTooLarge', 'DER uzunluk alanı çok büyük (konum {start}).', { start }),
      );
    length = 0;
    for (let i = 0; i < count; i++) {
      if (offset >= bytes.length)
        throw new ToolError(
          msg('toolsSecurity.der.lengthMissing', 'DER uzunluk alanı eksik (konum {start}).', { start }),
        );
      length = length * 256 + bytes[offset++]!;
    }
  }
  const end = offset + length;
  if (end > bytes.length) {
    throw new ToolError(
      msg(
        'toolsSecurity.der.overflow',
        'DER öğesi verinin dışına taşıyor (konum {start}, uzunluk {length}).',
        { start, length },
      ),
    );
  }
  const content = bytes.subarray(offset, end);
  const children: Asn1Node[] = [];
  if (constructed) {
    let pos = offset;
    while (pos < end) {
      const [child, next] = readNode(bytes.subarray(0, end), pos, depth + 1, state);
      children.push(child);
      pos = next;
    }
  }
  return [{ tagClass, constructed, tag, der: bytes.subarray(start, end), content, children }, end];
}

export function isUniversal(node: Asn1Node | undefined, tag: number): node is Asn1Node {
  return node !== undefined && node.tagClass === ASN1_UNIVERSAL && node.tag === tag;
}

export function isContext(node: Asn1Node | undefined, tag: number): node is Asn1Node {
  return node !== undefined && node.tagClass === ASN1_CONTEXT && node.tag === tag;
}

/** Beklenen evrensel etiketi doğrular; değilse `what` adıyla ToolError. */
export function expectTag(node: Asn1Node | undefined, tag: number, what: string): Asn1Node {
  if (!isUniversal(node, tag))
    throw new ToolError(
      msg('toolsSecurity.der.unexpectedStructure', '{what} okunamadı: beklenmeyen ASN.1 yapısı.', { what }),
    );
  return node;
}

export function readOid(node: Asn1Node): string {
  const bytes = node.content;
  if (!bytes.length) throw new ToolError(msg('toolsSecurity.der.oidEmpty', 'Boş nesne tanımlayıcısı (OID).'));
  // Dev bir OID büyük tamsayı kaydırmasıyla karesel zaman alır (arayüz donar); gerçek OID'ler çok kısadır.
  if (bytes.length > MAX_OID_BYTES)
    throw new ToolError(msg('toolsSecurity.der.oidTooLong', 'Nesne tanımlayıcısı (OID) çok uzun.'));
  const parts: string[] = [];
  let value = 0n;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    value = (value << 7n) | BigInt(b & 0x7f);
    if (b & 0x80) {
      if (i === bytes.length - 1)
        throw new ToolError(msg('toolsSecurity.der.oidTruncated', 'Nesne tanımlayıcısı (OID) yarım kalmış.'));
      continue;
    }
    if (!parts.length) {
      // İlk alt tanımlayıcı iki sayıyı birlikte taşır: 40 * X + Y.
      const head = value < 80n ? value / 40n : 2n;
      parts.push(String(head), String(value - head * 40n));
    } else parts.push(String(value));
    value = 0n;
  }
  return parts.join('.');
}

/** INTEGER içeriği büyük-sonlu hex; pozitif sayılardaki işaret baytı (00) atılır. */
export function readIntegerHex(node: Asn1Node): string {
  let bytes = node.content;
  while (bytes.length > 1 && bytes[0] === 0) bytes = bytes.subarray(1);
  return toHex(bytes).toUpperCase();
}

/** Küçük INTEGER'lar (sürüm, pathLen, üs) için; güvenli tamsayıyı aşarsa null. */
export function readSmallInteger(node: Asn1Node): number | null {
  const bytes = node.content;
  if (!bytes.length || bytes.length > 6) return null;
  let value = 0;
  for (const b of bytes) value = value * 256 + b;
  // İkiye tümleyen: en üst bit işarettir.
  if (bytes[0]! & 0x80) value -= 256 ** bytes.length;
  return value;
}

/** INTEGER'ın bit uzunluğu (RSA modülü, DSA p). */
export function integerBitLength(node: Asn1Node): number {
  let bytes = node.content;
  while (bytes.length > 1 && bytes[0] === 0) bytes = bytes.subarray(1);
  if (!bytes.length || (bytes.length === 1 && bytes[0] === 0)) return 0;
  return (bytes.length - 1) * 8 + (32 - Math.clz32(bytes[0]!));
}

export function readBoolean(node: Asn1Node): boolean {
  return node.content.length > 0 && node.content[0] !== 0;
}

export interface BitString {
  unusedBits: number;
  bytes: Uint8Array;
}

export function readBitString(node: Asn1Node): BitString {
  if (!node.content.length) throw new ToolError(msg('toolsSecurity.der.bitStringEmpty', 'BIT STRING boş.'));
  const unusedBits = node.content[0]!;
  if (unusedBits > 7)
    throw new ToolError(
      msg('toolsSecurity.der.bitStringUnused', 'BIT STRING kullanılmayan bit sayısı geçersiz.'),
    );
  return { unusedBits, bytes: node.content.subarray(1) };
}

/** Bit dizisinde 1 olan bitlerin konumları (0 = ilk baytın en anlamlı biti). */
export function setBits({ unusedBits, bytes }: BitString): number[] {
  const out: number[] = [];
  const total = bytes.length * 8 - unusedBits;
  for (let i = 0; i < total; i++) if (bytes[i >> 3]! & (0x80 >> (i & 7))) out.push(i);
  return out;
}

function decodeUtf8OrLatin1(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return Array.from(bytes, (b) => String.fromCharCode(b)).join('');
  }
}

/** Metin türleri: UTF8String, PrintableString, IA5String, T61String, BMPString, UniversalString… */
export function readString(node: Asn1Node): string {
  const bytes = node.content;
  switch (node.tagClass === ASN1_UNIVERSAL ? node.tag : -1) {
    case TAG.BMP_STRING: {
      let out = '';
      for (let i = 0; i + 1 < bytes.length; i += 2)
        out += String.fromCharCode((bytes[i]! << 8) | bytes[i + 1]!);
      return out;
    }
    case TAG.UNIVERSAL_STRING: {
      let out = '';
      for (let i = 0; i + 3 < bytes.length; i += 4) {
        const code = ((bytes[i]! << 24) | (bytes[i + 1]! << 16) | (bytes[i + 2]! << 8) | bytes[i + 3]!) >>> 0;
        out += code <= 0x10ffff ? String.fromCodePoint(code) : '�';
      }
      return out;
    }
    // T61 (Teletex) uygulamada çoğunlukla UTF-8 ya da Latin-1 taşır.
    default:
      return decodeUtf8OrLatin1(bytes);
  }
}

/** UTCTime (YYMMDDHHMM[SS]Z; YY ≥ 50 → 19YY) ve GeneralizedTime (YYYYMMDDHHMMSS[.f]Z). */
export function readTime(node: Asn1Node): Date {
  const text = readString(node);
  const utc = node.tag === TAG.UTC_TIME;
  const re = utc
    ? /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?(Z|[+-]\d{4})$/
    : /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?(?:[.,](\d+))?(Z|[+-]\d{4})?$/;
  const m = re.exec(text);
  if (!m)
    throw new ToolError(msg('toolsSecurity.der.dateUnreadable', 'Tarih okunamadı: "{text}".', { text }));
  let year = Number(m[1]);
  if (utc) year += year >= 50 ? 1900 : 2000;
  // Date.UTC aralık dışı alanları sessizce taşırır (13. ay → sonraki yıl); bozuk tarih reddedilir.
  const [month, day, hour, minute, second] = [m[2], m[3], m[4], m[5], m[6] ?? '0'].map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth || hour > 23 || minute > 59 || second > 60) {
    throw new ToolError(msg('toolsSecurity.der.dateInvalid', 'Tarih geçersiz: "{text}".', { text }));
  }
  const fraction = utc ? undefined : m[7];
  const zone = utc ? m[7] : m[8];
  let ms = Date.UTC(year, month - 1, day, hour, minute, second);
  if (fraction) ms += Math.round(Number(`0.${fraction}`) * 1000);
  if (zone && zone !== 'Z') {
    const sign = zone[0] === '-' ? -1 : 1;
    ms -= sign * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(3, 5))) * 60_000;
  }
  const date = new Date(ms);
  if (Number.isNaN(date.getTime()))
    throw new ToolError(msg('toolsSecurity.der.dateInvalid', 'Tarih geçersiz: "{text}".', { text }));
  return date;
}

/** Sık kullanılan OID'lerin okunur adları (DN öznitelikleri, algoritmalar, uzantılar, EKU, eğriler). */
export const OID_NAMES: Record<string, string> = {
  // DN öznitelikleri
  '2.5.4.3': 'CN',
  '2.5.4.4': 'SN',
  '2.5.4.5': 'serialNumber',
  '2.5.4.6': 'C',
  '2.5.4.7': 'L',
  '2.5.4.8': 'ST',
  '2.5.4.9': 'street',
  '2.5.4.10': 'O',
  '2.5.4.11': 'OU',
  '2.5.4.12': 'title',
  '2.5.4.15': 'businessCategory',
  '2.5.4.17': 'postalCode',
  '2.5.4.42': 'GN',
  '2.5.4.43': 'initials',
  '2.5.4.46': 'dnQualifier',
  '2.5.4.97': 'organizationIdentifier',
  '1.2.840.113549.1.9.1': 'emailAddress',
  '0.9.2342.19200300.100.1.1': 'UID',
  '0.9.2342.19200300.100.1.25': 'DC',
  '1.3.6.1.4.1.311.60.2.1.1': 'jurisdictionL',
  '1.3.6.1.4.1.311.60.2.1.2': 'jurisdictionST',
  '1.3.6.1.4.1.311.60.2.1.3': 'jurisdictionC',
  // Açık anahtar algoritmaları
  '1.2.840.113549.1.1.1': 'RSA',
  '1.2.840.113549.1.1.10': 'RSASSA-PSS',
  '1.2.840.10045.2.1': 'EC',
  '1.2.840.10040.4.1': 'DSA',
  '1.3.101.110': 'X25519',
  '1.3.101.111': 'X448',
  '1.3.101.112': 'Ed25519',
  '1.3.101.113': 'Ed448',
  // İmza algoritmaları
  '1.2.840.113549.1.1.4': 'md5WithRSAEncryption',
  '1.2.840.113549.1.1.5': 'sha1WithRSAEncryption',
  '1.2.840.113549.1.1.11': 'sha256WithRSAEncryption',
  '1.2.840.113549.1.1.12': 'sha384WithRSAEncryption',
  '1.2.840.113549.1.1.13': 'sha512WithRSAEncryption',
  '1.2.840.10045.4.1': 'ecdsa-with-SHA1',
  '1.2.840.10045.4.3.2': 'ecdsa-with-SHA256',
  '1.2.840.10045.4.3.3': 'ecdsa-with-SHA384',
  '1.2.840.10045.4.3.4': 'ecdsa-with-SHA512',
  '2.16.840.1.101.3.4.3.2': 'dsa-with-SHA256',
  // Eğriler
  '1.2.840.10045.3.1.7': 'P-256',
  '1.3.132.0.34': 'P-384',
  '1.3.132.0.35': 'P-521',
  '1.3.132.0.10': 'secp256k1',
  '1.3.36.3.3.2.8.1.1.7': 'brainpoolP256r1',
  // Uzantılar
  '2.5.29.14': 'Subject Key Identifier',
  '2.5.29.15': 'Key Usage',
  '2.5.29.17': 'Subject Alternative Name',
  '2.5.29.18': 'Issuer Alternative Name',
  '2.5.29.19': 'Basic Constraints',
  '2.5.29.30': 'Name Constraints',
  '2.5.29.31': 'CRL Distribution Points',
  '2.5.29.32': 'Certificate Policies',
  '2.5.29.35': 'Authority Key Identifier',
  '2.5.29.37': 'Extended Key Usage',
  '1.3.6.1.5.5.7.1.1': 'Authority Information Access',
  '1.3.6.1.4.1.11129.2.4.2': 'CT Precertificate SCTs',
  '1.3.6.1.5.5.7.1.24': 'TLS Feature (OCSP Must-Staple)',
  // EKU
  '1.3.6.1.5.5.7.3.1': 'serverAuth (TLS sunucu)',
  '1.3.6.1.5.5.7.3.2': 'clientAuth (TLS istemci)',
  '1.3.6.1.5.5.7.3.3': 'codeSigning (kod imzalama)',
  '1.3.6.1.5.5.7.3.4': 'emailProtection (e-posta)',
  '1.3.6.1.5.5.7.3.8': 'timeStamping (zaman damgası)',
  '1.3.6.1.5.5.7.3.9': 'OCSPSigning',
  '2.5.29.37.0': 'anyExtendedKeyUsage',
  // AIA erişim yöntemleri
  '1.3.6.1.5.5.7.48.1': 'OCSP',
  '1.3.6.1.5.5.7.48.2': 'CA Issuers',
  // Politikalar
  '2.5.29.32.0': 'anyPolicy',
  '2.23.140.1.1': 'EV (Extended Validation)',
  '2.23.140.1.2.1': 'DV (Domain Validated)',
  '2.23.140.1.2.2': 'OV (Organization Validated)',
  '2.23.140.1.2.3': 'IV (Individual Validated)',
  // CSR öznitelikleri
  '1.2.840.113549.1.9.14': 'extensionRequest',
  '1.2.840.113549.1.9.7': 'challengePassword',
};

export function oidName(oid: string): string | undefined {
  return catalogMessage('toolsSecurity.oid.' + oid.replaceAll('.', '_')) ?? OID_NAMES[oid];
}
