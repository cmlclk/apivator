import { msg } from '../i18n';
import { ToolError } from './errors';
import { toHex } from './encoding';
import {
  TAG,
  expectTag,
  integerBitLength,
  isContext,
  isUniversal,
  oidName,
  parseDer,
  readBitString,
  readBoolean,
  readOid,
  readSmallInteger,
  readString,
  setBits,
  type Asn1Node,
} from './asn1';

/** X.509 / CSR / anahtar ayrıştırmasının ortak parçaları: DN, açık anahtar, uzantılar. */

export interface DnAttribute {
  oid: string;
  /** Kısa ad (CN, O, C…); bilinmiyorsa OID. */
  name: string;
  value: string;
}

export interface DistinguishedName {
  attributes: DnAttribute[];
  /** "C=TR, O=Örnek, CN=api.ornek.test" (kodlandığı sırayla). */
  text: string;
  /** Karşılaştırma için: küçük harf, boşlukları sadeleştirilmiş. */
  normalized: string;
}

export interface KeyInfo {
  /** RSA, EC, Ed25519, DSA… ya da bilinmiyorsa OID. */
  algorithm: string;
  oid: string;
  /** RSA modülü / DSA p bit uzunluğu ya da eğri boyutu. */
  bits?: number;
  /** EC eğrisi (P-256…). */
  curve?: string;
  /** RSA genel üssü (65537). */
  exponent?: number;
}

export interface GeneralName {
  type: 'DNS' | 'IP' | 'email' | 'URI' | 'DirName' | 'RID' | 'other';
  value: string;
}

export interface CertExtensions {
  subjectAltNames: GeneralName[];
  keyUsage: string[];
  extendedKeyUsage: { oid: string; name: string }[];
  basicConstraints?: { ca: boolean; pathLength?: number; critical: boolean };
  subjectKeyId?: string;
  authorityKeyId?: string;
  crlDistributionPoints: string[];
  /** OCSP ve CA Issuers adresleri (yalnızca gösterilir; hiçbir zaman istenmez). */
  authorityInfoAccess: { method: string; location: string }[];
  policies: { oid: string; name?: string }[];
  /** Tüm uzantılar: OID, ad, kritik mi. */
  all: { oid: string; name: string; critical: boolean }[];
}

const CURVE_BITS: Record<string, number> = { 'P-256': 256, 'P-384': 384, 'P-521': 521, secp256k1: 256 };
const OKP_BITS: Record<string, number> = { Ed25519: 256, Ed448: 456, X25519: 256, X448: 448 };

const KEY_USAGE_NAMES = [
  'digitalSignature',
  'nonRepudiation',
  'keyEncipherment',
  'dataEncipherment',
  'keyAgreement',
  'keyCertSign',
  'cRLSign',
  'encipherOnly',
  'decipherOnly',
];

/** Name ::= SEQUENCE OF SET OF {OID, değer}. */
export function readName(node: Asn1Node): DistinguishedName {
  expectTag(node, TAG.SEQUENCE, 'Ad (DN)');
  const attributes: DnAttribute[] = [];
  for (const rdn of node.children) {
    for (const atv of rdn.children) {
      const [type, value] = atv.children;
      if (!isUniversal(type, TAG.OID) || !value)
        throw new ToolError(msg('toolsSecurity.x509.dnCorrupt', 'Ad (DN) özniteliği bozuk.'));
      const oid = readOid(type);
      attributes.push({ oid, name: oidName(oid) ?? oid, value: readString(value) });
    }
  }
  const text = attributes.map((a) => `${a.name}=${a.value}`).join(', ');
  return { attributes, text, normalized: text.toLowerCase().replace(/\s+/g, ' ') };
}

/** EC parametresindeki eğri OID'sinin adı (P-256…). */
function curveFromParams(params: Asn1Node | undefined): string | undefined {
  if (!isUniversal(params, TAG.OID)) return undefined;
  const oid = readOid(params);
  return oidName(oid) ?? oid;
}

function algorithmOf(algId: Asn1Node): { oid: string; params?: Asn1Node } {
  expectTag(algId, TAG.SEQUENCE, msg('toolsSecurity.x509.what.algorithm', 'Algoritma tanımı'));
  const oid = expectTag(
    algId.children[0],
    TAG.OID,
    msg('toolsSecurity.x509.what.algorithm', 'Algoritma tanımı'),
  );
  return { oid: readOid(oid), params: algId.children[1] };
}

export function readAlgorithmName(algId: Asn1Node): { oid: string; name: string } {
  const { oid } = algorithmOf(algId);
  return { oid, name: oidName(oid) ?? oid };
}

/** RSAPublicKey ::= SEQUENCE { modulus, publicExponent } (PKCS#1). */
export function rsaKeyInfo(seq: Asn1Node, oid = '1.2.840.113549.1.1.1'): KeyInfo {
  const [modulus, exponent] = seq.children;
  if (!isUniversal(modulus, TAG.INTEGER) || !isUniversal(exponent, TAG.INTEGER)) {
    throw new ToolError(msg('toolsSecurity.x509.rsaUnreadable', 'RSA anahtarı okunamadı.'));
  }
  return {
    algorithm: oidName(oid) ?? 'RSA',
    oid,
    bits: integerBitLength(modulus),
    exponent: readSmallInteger(exponent) ?? undefined,
  };
}

/** SubjectPublicKeyInfo ::= SEQUENCE { AlgorithmIdentifier, BIT STRING }. */
export function readSpki(node: Asn1Node): KeyInfo {
  expectTag(node, TAG.SEQUENCE, msg('toolsSecurity.x509.what.publicKey', 'Açık anahtar'));
  const [algId, keyBits] = node.children;
  if (!algId || !isUniversal(keyBits, TAG.BIT_STRING))
    throw new ToolError(msg('toolsSecurity.x509.publicKeyCorrupt', 'Açık anahtar bilgisi bozuk.'));
  const { oid, params } = algorithmOf(algId);
  const key = readBitString(keyBits).bytes;
  const name = oidName(oid) ?? oid;
  if (name === 'RSA' || name === 'RSASSA-PSS') return rsaKeyInfo(parseDer(key), oid);
  if (name === 'EC') {
    const curve = curveFromParams(params);
    // Sıkıştırılmamış nokta: 04 || X || Y.
    const bits =
      (curve ? CURVE_BITS[curve] : undefined) ?? (key.length > 1 ? ((key.length - 1) / 2) * 8 : undefined);
    return { algorithm: 'EC', oid, curve, bits };
  }
  if (name === 'DSA' && params?.children[0]) {
    return { algorithm: 'DSA', oid, bits: integerBitLength(params.children[0]) };
  }
  if (OKP_BITS[name]) return { algorithm: name, oid, bits: OKP_BITS[name] };
  return { algorithm: name, oid };
}

/** PKCS#8 PrivateKeyInfo ::= SEQUENCE { version, AlgorithmIdentifier, OCTET STRING, … }. */
export function readPkcs8(node: Asn1Node): KeyInfo {
  expectTag(node, TAG.SEQUENCE, msg('toolsSecurity.x509.what.privateKey', 'Özel anahtar'));
  const [version, algId, keyOctets] = node.children;
  if (!isUniversal(version, TAG.INTEGER) || !algId || !isUniversal(keyOctets, TAG.OCTET_STRING)) {
    throw new ToolError(msg('toolsSecurity.x509.pkcs8Corrupt', 'PKCS#8 özel anahtarı bozuk.'));
  }
  const { oid, params } = algorithmOf(algId);
  const name = oidName(oid) ?? oid;
  if (name === 'RSA' || name === 'RSASSA-PSS') return rsaPrivateKeyInfo(parseDer(keyOctets.content), oid);
  if (name === 'EC') {
    const inner = ecPrivateKeyInfo(parseDer(keyOctets.content));
    const curve = curveFromParams(params) ?? inner.curve;
    return { ...inner, curve, bits: (curve ? CURVE_BITS[curve] : undefined) ?? inner.bits };
  }
  if (name === 'DSA' && params?.children[0]) {
    return { algorithm: 'DSA', oid, bits: integerBitLength(params.children[0]) };
  }
  if (OKP_BITS[name]) return { algorithm: name, oid, bits: OKP_BITS[name] };
  return { algorithm: name, oid };
}

/** RSAPrivateKey ::= SEQUENCE { version, n, e, d, … } (PKCS#1). */
export function rsaPrivateKeyInfo(seq: Asn1Node, oid = '1.2.840.113549.1.1.1'): KeyInfo {
  expectTag(seq, TAG.SEQUENCE, msg('toolsSecurity.x509.what.rsaPrivateKey', 'RSA özel anahtarı'));
  return rsaKeyInfo({ ...seq, children: seq.children.slice(1) }, oid);
}

/** ECPrivateKey ::= SEQUENCE { 1, OCTET STRING, [0] eğri OID?, [1] açık anahtar? } (SEC1). */
export function ecPrivateKeyInfo(seq: Asn1Node): KeyInfo {
  expectTag(seq, TAG.SEQUENCE, msg('toolsSecurity.x509.what.ecPrivateKey', 'EC özel anahtarı'));
  const priv = seq.children[1];
  if (!isUniversal(priv, TAG.OCTET_STRING))
    throw new ToolError(msg('toolsSecurity.x509.ecPrivateCorrupt', 'EC özel anahtarı bozuk.'));
  const params = seq.children.find((c) => isContext(c, 0));
  const curve = curveFromParams(params?.children[0]);
  return {
    algorithm: 'EC',
    oid: '1.2.840.10045.2.1',
    curve,
    bits: (curve ? CURVE_BITS[curve] : undefined) ?? priv.content.length * 8,
  };
}

function formatIp(bytes: Uint8Array): string {
  if (bytes.length === 4) return Array.from(bytes).join('.');
  if (bytes.length === 16) {
    const groups: string[] = [];
    for (let i = 0; i < 16; i += 2) groups.push(((bytes[i]! << 8) | bytes[i + 1]!).toString(16));
    // En uzun sıfır dizisi "::" ile kısaltılır (RFC 5952).
    let best = -1;
    let bestLen = 1;
    for (let i = 0; i < 8;) {
      let j = i;
      while (j < 8 && groups[j] === '0') j++;
      if (j - i > bestLen) [best, bestLen] = [i, j - i];
      i = j === i ? i + 1 : j;
    }
    if (best < 0) return groups.join(':');
    return `${groups.slice(0, best).join(':')}::${groups.slice(best + bestLen).join(':')}`;
  }
  // Ad kısıtlamalarındaki adres/maske çiftleri gibi.
  return toHex(bytes);
}

/** GeneralName CHOICE (örtük etiketli). */
export function readGeneralName(node: Asn1Node): GeneralName {
  if (node.tagClass !== 2) return { type: 'other', value: toHex(node.content) };
  const text = () => new TextDecoder().decode(node.content);
  switch (node.tag) {
    case 1:
      return { type: 'email', value: text() };
    case 2:
      return { type: 'DNS', value: text() };
    case 4:
      return { type: 'DirName', value: node.children[0] ? readName(node.children[0]).text : '' };
    case 6:
      return { type: 'URI', value: text() };
    case 7:
      return { type: 'IP', value: formatIp(node.content) };
    case 8:
      return { type: 'RID', value: readOid({ ...node, tagClass: 0, tag: TAG.OID }) };
    default:
      return { type: 'other', value: `[${node.tag}] ${toHex(node.content)}` };
  }
}

export function colonHex(bytes: Uint8Array): string {
  return (toHex(bytes).toUpperCase().match(/../g) ?? []).join(':');
}

function parseExtension(oid: string, value: Asn1Node, critical: boolean, out: CertExtensions) {
  switch (oid) {
    case '2.5.29.17':
      out.subjectAltNames.push(...value.children.map(readGeneralName));
      break;
    case '2.5.29.15':
      out.keyUsage = setBits(readBitString(value)).map((bit) => KEY_USAGE_NAMES[bit] ?? `bit ${bit}`);
      break;
    case '2.5.29.37':
      out.extendedKeyUsage = value.children.map((c) => {
        const eku = readOid(c);
        return { oid: eku, name: oidName(eku) ?? eku };
      });
      break;
    case '2.5.29.19': {
      const ca = isUniversal(value.children[0], TAG.BOOLEAN) && readBoolean(value.children[0]);
      const len = value.children.find((c) => isUniversal(c, TAG.INTEGER));
      out.basicConstraints = {
        ca,
        critical,
        pathLength: len ? (readSmallInteger(len) ?? undefined) : undefined,
      };
      break;
    }
    case '2.5.29.14':
      out.subjectKeyId = colonHex(value.content);
      break;
    case '2.5.29.35': {
      const keyId = value.children.find((c) => isContext(c, 0));
      if (keyId) out.authorityKeyId = colonHex(keyId.content);
      break;
    }
    case '2.5.29.31':
      // DistributionPoint → [0] distributionPoint → [0] fullName → GeneralName'ler.
      for (const point of value.children) {
        const fullName = point.children.find((c) => isContext(c, 0))?.children.find((c) => isContext(c, 0));
        for (const name of fullName?.children ?? [])
          out.crlDistributionPoints.push(readGeneralName(name).value);
      }
      break;
    case '1.3.6.1.5.5.7.1.1':
      for (const access of value.children) {
        const [method, location] = access.children;
        if (!isUniversal(method, TAG.OID) || !location) continue;
        const m = readOid(method);
        out.authorityInfoAccess.push({ method: oidName(m) ?? m, location: readGeneralName(location).value });
      }
      break;
    case '2.5.29.32':
      for (const info of value.children) {
        if (!isUniversal(info.children[0], TAG.OID)) continue;
        const policy = readOid(info.children[0]);
        out.policies.push({ oid: policy, name: oidName(policy) });
      }
      break;
  }
}

/** Extensions ::= SEQUENCE OF { OID, critical BOOLEAN DEFAULT FALSE, OCTET STRING }. */
export function readExtensions(node: Asn1Node | undefined): CertExtensions {
  const out: CertExtensions = {
    subjectAltNames: [],
    keyUsage: [],
    extendedKeyUsage: [],
    crlDistributionPoints: [],
    authorityInfoAccess: [],
    policies: [],
    all: [],
  };
  if (!node) return out;
  expectTag(node, TAG.SEQUENCE, msg('toolsSecurity.x509.what.extensions', 'Uzantılar'));
  for (const ext of node.children) {
    const [idNode, second, third] = ext.children;
    if (!isUniversal(idNode, TAG.OID))
      throw new ToolError(msg('toolsSecurity.x509.extensionNoOid', 'Uzantı bozuk: OID yok.'));
    const oid = readOid(idNode);
    const critical = isUniversal(second, TAG.BOOLEAN) && readBoolean(second);
    const octets = isUniversal(second, TAG.OCTET_STRING) ? second : third;
    if (!isUniversal(octets, TAG.OCTET_STRING))
      throw new ToolError(msg('toolsSecurity.x509.extensionCorrupt', 'Uzantı bozuk: {oid}.', { oid }));
    out.all.push({ oid, name: oidName(oid) ?? oid, critical });
    try {
      parseExtension(oid, parseDer(octets.content), critical, out);
    } catch {
      // Tek bir bozuk uzantı sertifikanın geri kalanını gizlemesin; listede adıyla görünür.
    }
  }
  return out;
}
