import { msg } from '../i18n';
import { ToolError } from './errors';
import { base64Decode } from './encoding';
import { digest, toBufferSource } from './hash';
import {
  TAG,
  expectTag,
  isContext,
  isUniversal,
  parseDer,
  readBitString,
  readIntegerHex,
  readOid,
  readSmallInteger,
  readTime,
} from './asn1';
import type { Asn1Node } from './asn1';
import {
  colonHex,
  ecPrivateKeyInfo,
  readAlgorithmName,
  readExtensions,
  readName,
  readPkcs8,
  readSpki,
  rsaKeyInfo,
  rsaPrivateKeyInfo,
  type CertExtensions,
  type DistinguishedName,
  type KeyInfo,
} from './x509Parts';

export type { CertExtensions, DistinguishedName, DnAttribute, GeneralName, KeyInfo } from './x509Parts';

/** Bir sekmede işlenecek en büyük girdi ve en fazla PEM bloğu. */
const MAX_INPUT = 10 * 1024 * 1024;
const MAX_BLOCKS = 200;
const DAY_MS = 86_400_000;

export interface Certificate {
  version: number;
  /** Seri numarası, büyük harf hex. */
  serial: string;
  signatureAlgorithm: { oid: string; name: string };
  issuer: DistinguishedName;
  subject: DistinguishedName;
  notBefore: Date;
  notAfter: Date;
  publicKey: KeyInfo;
  extensions: CertExtensions;
  /** Konu ve yayıncı aynı (ve varsa AKI = SKI). */
  selfSigned: boolean;
  /** İmza doğrulaması için ham parçalar. */
  der: Uint8Array;
  tbs: Uint8Array;
  spki: Uint8Array;
  signature: Uint8Array;
}

export interface CertificateRequest {
  subject: DistinguishedName;
  publicKey: KeyInfo;
  signatureAlgorithm: { oid: string; name: string };
  extensions: CertExtensions;
}

export type PemItem = { index: number; label: string } & (
  | { kind: 'certificate'; certificate: Certificate; fingerprints: { sha1: string; sha256: string } | null }
  | { kind: 'csr'; csr: CertificateRequest }
  | { kind: 'public-key'; key: KeyInfo }
  /** Özel anahtar: yalnızca tür ve boyut gösterilir; saklanmaz. */
  | { kind: 'private-key'; key: KeyInfo | null; encrypted: boolean }
  | { kind: 'unknown' }
  | { kind: 'error'; error: string }
);

export type ValidityStatus = 'valid' | 'expired' | 'not-yet-valid';

/** Geçerlilik durumu; `days` geçerliyse kalan, dolmuşsa geçen, henüz değilse başlamasına kalan gün. */
export function certificateValidity(
  cert: Certificate,
  now: Date = new Date(),
): { status: ValidityStatus; days: number } {
  const t = now.getTime();
  if (t < cert.notBefore.getTime()) {
    return { status: 'not-yet-valid', days: Math.ceil((cert.notBefore.getTime() - t) / DAY_MS) };
  }
  if (t > cert.notAfter.getTime()) {
    return { status: 'expired', days: Math.floor((t - cert.notAfter.getTime()) / DAY_MS) };
  }
  return { status: 'valid', days: Math.floor((cert.notAfter.getTime() - t) / DAY_MS) };
}

/**
 * Certificate ::= SEQUENCE { tbsCertificate, signatureAlgorithm, signatureValue }
 * tbs ::= SEQUENCE { [0] sürüm?, seri, imza alg., yayıncı, geçerlilik, konu, açık anahtar, …, [3] uzantılar? }
 */
export function parseCertificate(der: Uint8Array): Certificate {
  const root = expectTag(parseDer(der), TAG.SEQUENCE, 'Sertifika');
  const [tbs, sigAlg, sigValue] = root.children;
  expectTag(tbs, TAG.SEQUENCE, msg('toolsSecurity.x509.what.tbs', 'Sertifika gövdesi (TBS)'));
  if (!sigAlg || !isUniversal(sigValue, TAG.BIT_STRING))
    throw new ToolError(msg('toolsSecurity.x509.signatureUnreadable', 'Sertifika imzası okunamadı.'));
  const fields = tbs!.children;
  let i = 0;
  let version = 1;
  if (isContext(fields[0], 0)) {
    const v = fields[0].children[0];
    version = (v && isUniversal(v, TAG.INTEGER) ? (readSmallInteger(v) ?? 0) : 0) + 1;
    i++;
  }
  const serial = expectTag(fields[i++], TAG.INTEGER, msg('toolsSecurity.x509.what.serial', 'Seri numarası'));
  i++; // TBS içindeki imza algoritması dıştakinin kopyası.
  const issuer = readName(fields[i++]!);
  const validity = expectTag(
    fields[i++],
    TAG.SEQUENCE,
    msg('toolsSecurity.x509.what.validity', 'Geçerlilik süresi'),
  );
  const subject = readName(fields[i++]!);
  const spki = fields[i++];
  if (!spki || validity.children.length !== 2)
    throw new ToolError(msg('toolsSecurity.x509.bodyIncomplete', 'Sertifika gövdesi eksik.'));
  const extNode = fields.slice(i).find((f) => isContext(f, 3))?.children[0];
  const extensions = readExtensions(extNode);
  const { subjectKeyId: ski, authorityKeyId: aki } = extensions;
  return {
    version,
    serial: readIntegerHex(serial),
    signatureAlgorithm: readAlgorithmName(sigAlg),
    issuer,
    subject,
    notBefore: readTime(validity.children[0]!),
    notAfter: readTime(validity.children[1]!),
    publicKey: readSpki(spki),
    extensions,
    selfSigned: issuer.normalized === subject.normalized && (!aki || !ski || aki === ski),
    der: root.der,
    tbs: tbs!.der,
    spki: spki.der,
    signature: readBitString(sigValue).bytes,
  };
}

/** CertificationRequest ::= SEQUENCE { info { sürüm, konu, açık anahtar, [0] öznitelikler }, alg., imza }. */
export function parseCertificateRequest(der: Uint8Array): CertificateRequest {
  const root = expectTag(parseDer(der), TAG.SEQUENCE, 'CSR');
  const [info, sigAlg] = root.children;
  expectTag(info, TAG.SEQUENCE, msg('toolsSecurity.x509.what.csrBody', 'CSR gövdesi'));
  const [version, subjectNode, spki, attributes] = info!.children;
  if (!isUniversal(version, TAG.INTEGER) || !subjectNode || !spki || !sigAlg) {
    throw new ToolError(msg('toolsSecurity.x509.csrIncomplete', 'CSR gövdesi eksik.'));
  }
  let extNode: Asn1Node | undefined;
  for (const attr of isContext(attributes, 0) ? attributes.children : []) {
    const [type, values] = attr.children;
    // extensionRequest: istenen SAN vb. uzantılar.
    if (isUniversal(type, TAG.OID) && readOid(type) === '1.2.840.113549.1.9.14')
      extNode = values?.children[0];
  }
  return {
    subject: readName(subjectNode),
    publicKey: readSpki(spki),
    signatureAlgorithm: readAlgorithmName(sigAlg),
    extensions: readExtensions(extNode),
  };
}

function isPrivateLabel(label: string): boolean {
  return label.includes('PRIVATE KEY');
}

/** PEM etiketine göre DER'i ayrıştırır; tanınmayan etiket `unknown`. */
async function parseBlock(
  index: number,
  label: string,
  der: Uint8Array,
  encrypted: boolean,
): Promise<PemItem> {
  const base = { index, label };
  if (isPrivateLabel(label)) {
    if (encrypted || label.startsWith('ENCRYPTED') || label.startsWith('OPENSSH')) {
      return {
        ...base,
        kind: 'private-key',
        key: null,
        encrypted: encrypted || label.startsWith('ENCRYPTED'),
      };
    }
    const tree = parseDer(der);
    const key =
      label === 'RSA PRIVATE KEY'
        ? rsaPrivateKeyInfo(tree)
        : label === 'EC PRIVATE KEY'
          ? ecPrivateKeyInfo(tree)
          : label === 'PRIVATE KEY'
            ? readPkcs8(tree)
            : null;
    return { ...base, kind: 'private-key', key, encrypted: false };
  }
  switch (label) {
    case 'CERTIFICATE':
    case 'X509 CERTIFICATE': {
      const certificate = parseCertificate(der);
      return { ...base, kind: 'certificate', certificate, fingerprints: await fingerprints(certificate.der) };
    }
    case 'CERTIFICATE REQUEST':
    case 'NEW CERTIFICATE REQUEST':
      return { ...base, kind: 'csr', csr: parseCertificateRequest(der) };
    case 'PUBLIC KEY':
      return { ...base, kind: 'public-key', key: readSpki(parseDer(der)) };
    case 'RSA PUBLIC KEY':
      return {
        ...base,
        kind: 'public-key',
        key: rsaKeyInfo(
          expectTag(parseDer(der), TAG.SEQUENCE, msg('toolsSecurity.x509.what.rsaKey', 'RSA anahtarı')),
        ),
      };
    default:
      return { ...base, kind: 'unknown' };
  }
}

/** Etiketsiz DER: sırayla sertifika, CSR, açık anahtar, PKCS#8 ve PKCS#1 özel anahtar denenir. */
async function classifyDer(der: Uint8Array): Promise<PemItem> {
  const attempts: [string, (tree: Asn1Node) => void][] = [
    ['CERTIFICATE', () => parseCertificate(der)],
    ['CERTIFICATE REQUEST', () => parseCertificateRequest(der)],
    ['PUBLIC KEY', (tree) => readSpki(tree)],
    ['PRIVATE KEY', (tree) => readPkcs8(tree)],
    ['RSA PRIVATE KEY', (tree) => rsaPrivateKeyInfo(tree)],
  ];
  const tree = parseDer(der);
  for (const [label, attempt] of attempts) {
    try {
      attempt(tree);
      return await parseBlock(0, label, der, false);
    } catch {
      // Sonraki yapıyı dene.
    }
  }
  throw new ToolError(
    msg('toolsSecurity.x509.unknownDer', 'Tanınmayan DER yapısı: sertifika, CSR ya da anahtar değil.'),
  );
}

/** PEM bloklarını ayırır; Proc-Type / DEK-Info gibi başlık satırları atlanır. */
export function splitPem(text: string): { label: string; body: string; encrypted: boolean }[] {
  const blocks: { label: string; body: string; encrypted: boolean }[] = [];
  const re = /-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (blocks.length >= MAX_BLOCKS)
      throw new ToolError(
        msg('toolsSecurity.x509.tooManyBlocks', 'En fazla {max} PEM bloğu işlenebilir.', {
          max: MAX_BLOCKS,
        }),
      );
    const lines = m[2]!.split(/\r?\n/);
    const headers = lines.filter((l) => l.includes(':'));
    blocks.push({
      label: m[1]!,
      body: lines.filter((l) => !l.includes(':')).join(''),
      encrypted: headers.some((h) => /^Proc-Type:.*ENCRYPTED/i.test(h.trim())),
    });
  }
  return blocks;
}

/**
 * Sertifika aracının girdisi: bir ya da çok PEM bloğu (zincir), Base64 DER ya da dosya baytları
 * (.cer/.crt/.der/.pem). Bozuk bloklar `error` öğesi olur; hiçbir şey okunamazsa ToolError.
 */
export async function inspectPem(input: string | Uint8Array): Promise<PemItem[]> {
  if (input.length > MAX_INPUT)
    throw new ToolError(msg('toolsSecurity.x509.inputTooLarge', 'Girdi çok büyük: en fazla 10 MB.'));
  if (input instanceof Uint8Array) {
    if (input[0] === 0x30) return [await classifyDer(input)];
    return inspectPem(new TextDecoder().decode(input));
  }
  const text = input.trim();
  if (!text) return [];
  const blocks = splitPem(text);
  if (!blocks.length) {
    if (text.includes('-----BEGIN'))
      throw new ToolError(
        msg('toolsSecurity.x509.pemMismatch', 'PEM bloğu okunamadı: BEGIN / END satırları eşleşmiyor.'),
      );
    const compact = text.replace(/\s+/g, '');
    let der: Uint8Array;
    if (/^([0-9a-f]{2}:?)+$/i.test(compact) && compact.startsWith('30')) {
      der = Uint8Array.from(compact.replace(/:/g, '').match(/../g)!, (h) => parseInt(h, 16));
    } else {
      try {
        der = base64Decode(compact);
      } catch {
        throw new ToolError(
          msg('toolsSecurity.x509.notPemOrDer', 'Girdi PEM, Base64 DER ya da hex DER değil.'),
        );
      }
    }
    return [await classifyDer(der)];
  }
  const items: PemItem[] = [];
  for (const [index, block] of blocks.entries()) {
    try {
      const der = block.encrypted ? new Uint8Array() : base64Decode(block.body);
      items.push(await parseBlock(index, block.label, der, block.encrypted));
    } catch (error) {
      const message =
        error instanceof ToolError
          ? error.message
          : msg('toolsSecurity.x509.blockUnreadable', 'Blok okunamadı.');
      items.push({ index, label: block.label, kind: 'error', error: message });
    }
  }
  return items;
}

/** SHA-1 ve SHA-256 parmak izi (AA:BB:…); Web Crypto yoksa null. */
export async function fingerprints(der: Uint8Array): Promise<{ sha1: string; sha256: string } | null> {
  try {
    const [sha1, sha256] = await Promise.all([digest('SHA-1', der), digest('SHA-256', der)]);
    return { sha1: colonHex(sha1), sha256: colonHex(sha256) };
  } catch {
    return null;
  }
}

export interface ChainLink {
  /** `certs` dizisindeki konum. */
  index: number;
  /** Zincirde bir üstteki sertifika; yoksa (kök ya da eksik) null. */
  parent: number | null;
  /** Yayıncı adı üstteki sertifikanın konusuyla eşleşiyor mu. */
  nameMatch: boolean;
  /** AKI = üstün SKI'si; ikisinden biri yoksa undefined. */
  keyIdMatch?: boolean;
  /** Web Crypto ile imza doğrulaması; desteklenmeyen algoritmada null. */
  signatureValid: boolean | null;
}

export interface ChainReport {
  /** Yapraktan köke sıralı konumlar. */
  order: number[];
  /** Girdi zaten yapraktan köke sıralı mı. */
  inOrder: boolean;
  links: ChainLink[];
  /** Zincir öz-imzalı bir kökle bitiyor mu. */
  endsAtRoot: boolean;
}

/** Sertifikaları yapraktan köke sıralar ve her halkanın ad / anahtar kimliği / imza bağını denetler. */
export async function analyzeChain(certs: Certificate[]): Promise<ChainReport> {
  const issuerOf = (c: Certificate) =>
    certs.findIndex((p) => p !== c && p.subject.normalized === c.issuer.normalized);
  // Yaprak: başka hiçbir sertifikanın yayıncısı olmayan.
  const isIssuer = new Set(certs.map((c) => (c.selfSigned ? -1 : issuerOf(c))));
  const order: number[] = [];
  let current = certs.findIndex((_, i) => !isIssuer.has(i));
  if (current < 0) current = 0;
  while (current >= 0 && !order.includes(current)) {
    order.push(current);
    current = certs[current]!.selfSigned ? -1 : issuerOf(certs[current]!);
  }
  for (let i = 0; i < certs.length; i++) if (!order.includes(i)) order.push(i);

  const links: ChainLink[] = [];
  for (const [pos, index] of order.entries()) {
    const cert = certs[index]!;
    const nextIndex = order[pos + 1];
    const next = nextIndex === undefined ? undefined : certs[nextIndex];
    const parentIndex = cert.selfSigned
      ? index
      : next && next.subject.normalized === cert.issuer.normalized
        ? nextIndex!
        : null;
    const parent = parentIndex === null ? undefined : certs[parentIndex];
    const aki = cert.extensions.authorityKeyId;
    const ski = parent?.extensions.subjectKeyId;
    links.push({
      index,
      parent: cert.selfSigned ? null : parentIndex,
      nameMatch: Boolean(parent),
      keyIdMatch: aki && ski ? aki === ski : undefined,
      signatureValid: parent ? await verifyCertificateSignature(cert, parent) : null,
    });
  }
  const last = certs[order[order.length - 1]!];
  return {
    order,
    inOrder: order.every((v, i) => v === i),
    links,
    endsAtRoot:
      Boolean(last?.selfSigned) && links.every((l, i) => i === links.length - 1 || l.parent !== null),
  };
}

const RSA_HASHES: Record<string, string> = {
  '1.2.840.113549.1.1.5': 'SHA-1',
  '1.2.840.113549.1.1.11': 'SHA-256',
  '1.2.840.113549.1.1.12': 'SHA-384',
  '1.2.840.113549.1.1.13': 'SHA-512',
};
const ECDSA_HASHES: Record<string, string> = {
  '1.2.840.10045.4.1': 'SHA-1',
  '1.2.840.10045.4.3.2': 'SHA-256',
  '1.2.840.10045.4.3.3': 'SHA-384',
  '1.2.840.10045.4.3.4': 'SHA-512',
};
const CURVE_BYTES: Record<string, number> = { 'P-256': 32, 'P-384': 48, 'P-521': 66 };

/** ECDSA DER imzası (SEQUENCE { r, s }) → Web Crypto'nun beklediği r || s. */
function ecdsaRaw(signature: Uint8Array, size: number): Uint8Array {
  const [r, s] = parseDer(signature).children;
  const out = new Uint8Array(size * 2);
  for (const [i, part] of [r, s].entries()) {
    let bytes = part!.content;
    while (bytes.length > size && bytes[0] === 0) bytes = bytes.subarray(1);
    if (bytes.length > size)
      throw new ToolError(msg('toolsSecurity.x509.ecdsaSize', 'ECDSA imzası eğri boyutuna uymuyor.'));
    out.set(bytes, (i + 1) * size - bytes.length);
  }
  return out;
}

/**
 * `cert` imzasını `issuer` açık anahtarıyla Web Crypto üzerinden doğrular (RSA PKCS#1 v1.5, ECDSA
 * P-256/384/521, Ed25519). Algoritma desteklenmiyorsa ya da Web Crypto yoksa null.
 */
export async function verifyCertificateSignature(
  cert: Certificate,
  issuer: Certificate,
): Promise<boolean | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  const oid = cert.signatureAlgorithm.oid;
  try {
    let importAlg: RsaHashedImportParams | EcKeyImportParams | { name: string };
    let verifyAlg: AlgorithmIdentifier | EcdsaParams;
    let signature = cert.signature;
    if (RSA_HASHES[oid]) {
      importAlg = { name: 'RSASSA-PKCS1-v1_5', hash: RSA_HASHES[oid] };
      verifyAlg = 'RSASSA-PKCS1-v1_5';
    } else if (ECDSA_HASHES[oid]) {
      const curve = issuer.publicKey.curve;
      if (!curve || !CURVE_BYTES[curve]) return null;
      importAlg = { name: 'ECDSA', namedCurve: curve };
      verifyAlg = { name: 'ECDSA', hash: ECDSA_HASHES[oid] };
      signature = ecdsaRaw(signature, CURVE_BYTES[curve]);
    } else if (oid === '1.3.101.112') {
      importAlg = { name: 'Ed25519' };
      verifyAlg = 'Ed25519';
    } else return null;
    const key = await subtle.importKey('spki', toBufferSource(issuer.spki), importAlg, false, ['verify']);
    return await subtle.verify(verifyAlg, key, toBufferSource(signature), toBufferSource(cert.tbs));
  } catch {
    // Anahtar türü uyuşmuyor ya da tarayıcı algoritmayı desteklemiyor.
    return null;
  }
}
