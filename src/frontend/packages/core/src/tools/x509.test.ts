import { describe, expect, it } from 'vitest';
import { ToolError } from './errors';
import { base64Decode } from './encoding';
import { parseDer, readTime } from './asn1';
import {
  analyzeChain,
  certificateValidity,
  inspectPem,
  parseCertificate,
  splitPem,
  type Certificate,
  type PemItem,
} from './x509';
import {
  EXPIRED_PEM,
  EXPIRED_RSA_KEY_PEM,
  INTERMEDIATE_PEM,
  LEAF_CSR_PEM,
  LEAF_EC_KEY_PEM,
  LEAF_PEM,
  LEAF_PKCS8_PEM,
  LEAF_PUBLIC_KEY_PEM,
  ROOT_PEM,
} from './x509.fixtures';

const der = (pem: string) => base64Decode(splitPem(pem)[0]!.body);
const cert = (pem: string) => parseCertificate(der(pem));
function only<K extends PemItem['kind']>(items: PemItem[], kind: K): Extract<PemItem, { kind: K }> {
  expect(items).toHaveLength(1);
  expect(items[0]!.kind).toBe(kind);
  return items[0] as Extract<PemItem, { kind: K }>;
}

describe('ASN.1 / DER okuyucu', () => {
  it('bozuk ve sınır dışı verilerde Türkçe ToolError', () => {
    expect(() => parseDer(new Uint8Array())).toThrow(ToolError);
    expect(() => parseDer(new Uint8Array([0x30, 0x05, 0x02, 0x01]))).toThrow(/taşıyor/);
    expect(() => parseDer(new Uint8Array([0x30, 0x80, 0x00, 0x00]))).toThrow(/Belirsiz uzunluk/);
    expect(() => parseDer(new Uint8Array([0x02, 0x01, 0x05, 0xff]))).toThrow(/fazlalık/);
    expect(() => parseDer(new Uint8Array([0x30, 0x85, 1, 1, 1, 1, 1]))).toThrow(/çok büyük/);
    // 40 düzey iç içe SEQUENCE
    const nested: number[] = [];
    for (let i = 0; i < 40; i++) nested.push(0x30, 2 * (40 - i - 1));
    expect(() => parseDer(new Uint8Array(nested))).toThrow(/çok derin/);
  });

  it('UTCTime ve GeneralizedTime', () => {
    const utc = parseDer(new Uint8Array([0x17, 13, ...new TextEncoder().encode('491231235959Z')]));
    expect(readTime(utc).toISOString()).toBe('2049-12-31T23:59:59.000Z');
    const old = parseDer(new Uint8Array([0x17, 13, ...new TextEncoder().encode('991231235959Z')]));
    expect(readTime(old).getUTCFullYear()).toBe(1999);
    const gen = parseDer(new Uint8Array([0x18, 15, ...new TextEncoder().encode('21261005190349Z')]));
    expect(readTime(gen).toISOString()).toBe('2126-10-05T19:03:49.000Z');
  });
});

describe('X.509 sertifika', () => {
  it('yaprak: Türkçe DN, seri, tarih, EC anahtar, SAN, KU/EKU, AKI/SKI, AIA, CRL, politika', () => {
    const leaf = cert(LEAF_PEM);
    expect(leaf.version).toBe(3);
    expect(leaf.subject.text).toBe('C=TR, L=İstanbul, O=Örnek Şirketi Ğüç, CN=api.ornek.test');
    expect(leaf.issuer.text).toBe('C=TR, O=Apivator Test, CN=Apivator Ara CA E1');
    expect(leaf.serial).toBe('0A1B2C3D4E5F');
    expect(leaf.notBefore.toISOString()).toBe('2026-10-29T19:03:49.000Z');
    expect(leaf.notAfter.toISOString()).toBe('2036-10-26T19:03:49.000Z');
    expect(leaf.publicKey).toMatchObject({ algorithm: 'EC', curve: 'P-256', bits: 256 });
    expect(leaf.signatureAlgorithm.name).toBe('ecdsa-with-SHA256');
    const ext = leaf.extensions;
    expect(ext.subjectAltNames).toEqual([
      { type: 'DNS', value: 'api.ornek.test' },
      { type: 'DNS', value: '*.ornek.test' },
      { type: 'IP', value: '192.0.2.10' },
      { type: 'IP', value: '2001:db8::1' },
      { type: 'email', value: 'destek@ornek.test' },
      { type: 'URI', value: 'https://ornek.test/' },
    ]);
    expect(ext.keyUsage).toEqual(['digitalSignature']);
    expect(ext.extendedKeyUsage.map((e) => e.oid)).toEqual(['1.3.6.1.5.5.7.3.1', '1.3.6.1.5.5.7.3.2']);
    expect(ext.basicConstraints).toEqual({ ca: false, critical: true, pathLength: undefined });
    expect(ext.subjectKeyId).toBe('6D:32:5A:25:1A:67:FA:6C:49:DD:FC:FF:0C:8C:8A:BA:33:9E:94:77');
    expect(ext.authorityKeyId).toBe('FC:06:DF:73:45:B8:39:8D:72:7E:26:0D:7E:9B:BB:46:08:F3:F3:3C');
    expect(ext.authorityInfoAccess).toEqual([
      { method: 'OCSP', location: 'http://ocsp.apivator.test' },
      { method: 'CA Issuers', location: 'http://ca.apivator.test/e1.crt' },
    ]);
    expect(ext.crlDistributionPoints).toEqual(['http://ca.apivator.test/e1.crl']);
    expect(ext.policies).toEqual([{ oid: '2.23.140.1.2.2', name: 'OV (Organization Validated)' }]);
    expect(leaf.selfSigned).toBe(false);
  });

  it('kök: RSA 2048, öz-imzalı, CA, GeneralizedTime bitiş; ara CA pathLen 0', () => {
    const root = cert(ROOT_PEM);
    expect(root.subject.text).toBe('C=TR, O=Apivator Test, CN=Apivator Test Kök CA');
    expect(root.publicKey).toMatchObject({ algorithm: 'RSA', bits: 2048, exponent: 65537 });
    expect(root.signatureAlgorithm.name).toBe('sha256WithRSAEncryption');
    expect(root.selfSigned).toBe(true);
    expect(root.extensions.basicConstraints?.ca).toBe(true);
    expect(root.extensions.keyUsage).toEqual(['keyCertSign', 'cRLSign']);
    expect(root.notAfter.toISOString()).toBe('2126-10-05T19:03:49.000Z');
    const int = cert(INTERMEDIATE_PEM);
    expect(int.extensions.basicConstraints).toEqual({ ca: true, critical: true, pathLength: 0 });
    expect(int.extensions.policies[0]?.oid).toBe('2.23.140.1.2.1');
  });

  it('geçerlilik durumu ve kalan gün', () => {
    const leaf = cert(LEAF_PEM);
    expect(certificateValidity(leaf, new Date('2026-10-29T19:03:48Z')).status).toBe('not-yet-valid');
    expect(certificateValidity(leaf, new Date('2036-10-16T19:03:49Z'))).toEqual({
      status: 'valid',
      days: 10,
    });
    expect(certificateValidity(cert(EXPIRED_PEM), new Date('2001-01-11T00:00:00Z'))).toEqual({
      status: 'expired',
      days: 10,
    });
  });

  it('parmak izleri openssl ile aynı', async () => {
    const item = only(await inspectPem(LEAF_PEM), 'certificate');
    expect(item.fingerprints).toEqual({
      sha1: 'F5:AD:50:CE:A2:C1:72:A7:F6:4C:3C:03:6F:D0:62:FB:46:5D:D4:E0',
      sha256:
        '1E:7C:1F:6C:88:6F:C7:CF:59:1C:53:05:29:67:59:DD:4F:9A:BE:B2:B4:A0:FF:7B:92:72:99:80:53:0A:08:B8',
    });
  });
});

describe('Girdi biçimleri', () => {
  it('Base64 DER, hex DER ve ikili dosya baytları', async () => {
    const body = splitPem(ROOT_PEM)[0]!.body;
    expect(only(await inspectPem(body), 'certificate').certificate.serial).toBe('1001');
    const bytes = der(ROOT_PEM);
    expect(only(await inspectPem(bytes), 'certificate').certificate.selfSigned).toBe(true);
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(':');
    expect(only(await inspectPem(hex), 'certificate').label).toBe('CERTIFICATE');
    // PEM metni dosya olarak
    expect((await inspectPem(new TextEncoder().encode(LEAF_PEM)))[0]!.kind).toBe('certificate');
  });

  it('CSR: konu ve SAN', async () => {
    const { csr } = only(await inspectPem(LEAF_CSR_PEM), 'csr');
    expect(csr.subject.text).toBe('C=TR, L=İstanbul, O=Örnek Şirketi Ğüç, CN=api.ornek.test');
    expect(csr.publicKey.curve).toBe('P-256');
    expect(csr.extensions.subjectAltNames).toEqual([
      { type: 'DNS', value: 'api.ornek.test' },
      { type: 'IP', value: '192.0.2.10' },
    ]);
  });

  it('açık ve özel anahtarlar (PKCS#8, SEC1, PKCS#1, şifreli)', async () => {
    expect(only(await inspectPem(LEAF_PUBLIC_KEY_PEM), 'public-key').key).toMatchObject({ curve: 'P-256' });
    expect(only(await inspectPem(LEAF_PKCS8_PEM), 'private-key').key).toMatchObject({
      algorithm: 'EC',
      curve: 'P-256',
    });
    expect(only(await inspectPem(LEAF_EC_KEY_PEM), 'private-key').key).toMatchObject({ curve: 'P-256' });
    expect(only(await inspectPem(EXPIRED_RSA_KEY_PEM), 'private-key').key).toMatchObject({
      algorithm: 'RSA',
      bits: 1024,
    });
    const encrypted = only(
      await inspectPem('-----BEGIN ENCRYPTED PRIVATE KEY-----\nMIIB\n-----END ENCRYPTED PRIVATE KEY-----'),
      'private-key',
    );
    expect(encrypted).toMatchObject({ key: null, encrypted: true });
    const legacy = only(
      await inspectPem(
        '-----BEGIN RSA PRIVATE KEY-----\nProc-Type: 4,ENCRYPTED\nDEK-Info: AES-128-CBC,00\n\nAAAA\n-----END RSA PRIVATE KEY-----',
      ),
      'private-key',
    );
    expect(legacy.encrypted).toBe(true);
  });

  it('bozuk blok diğerlerini engellemez; tanınmayan girdi ToolError', async () => {
    const items = await inspectPem(
      `${LEAF_PEM}\n-----BEGIN CERTIFICATE-----\nMIIBAA==\n-----END CERTIFICATE-----\n-----BEGIN FOO-----\nAA==\n-----END FOO-----`,
    );
    expect(items.map((i) => i.kind)).toEqual(['certificate', 'error', 'unknown']);
    expect(items[1]).toMatchObject({ kind: 'error' });
    await expect(inspectPem('merhaba dünya!')).rejects.toThrow(ToolError);
    await expect(inspectPem('MAMCAQA=')).rejects.toThrow(/Tanınmayan DER/);
    await expect(inspectPem('-----BEGIN CERTIFICATE-----\nAAAA')).rejects.toThrow(/BEGIN \/ END/);
    expect(await inspectPem('   ')).toEqual([]);
  });
});

describe('Zincir', () => {
  const certsOf = async (text: string) =>
    (await inspectPem(text)).flatMap((i) =>
      i.kind === 'certificate' ? [i.certificate] : ([] as Certificate[]),
    );

  it('yaprak → ara → kök: ad, anahtar kimliği ve imza doğrulanır', async () => {
    const certs = await certsOf([LEAF_PEM, INTERMEDIATE_PEM, ROOT_PEM].join('\n'));
    const report = await analyzeChain(certs);
    expect(report.order).toEqual([0, 1, 2]);
    expect(report.inOrder).toBe(true);
    expect(report.endsAtRoot).toBe(true);
    expect(report.links.map((l) => [l.parent, l.nameMatch, l.keyIdMatch, l.signatureValid])).toEqual([
      [1, true, true, true],
      [2, true, true, true],
      // Kökte AKI yok.
      [null, true, undefined, true],
    ]);
  });

  it('karışık sıra düzeltilir; eksik halka işaretlenir', async () => {
    const shuffled = await certsOf([ROOT_PEM, LEAF_PEM, INTERMEDIATE_PEM].join('\n'));
    const report = await analyzeChain(shuffled);
    expect(report.order).toEqual([1, 2, 0]);
    expect(report.inOrder).toBe(false);
    const broken = await analyzeChain(await certsOf([LEAF_PEM, ROOT_PEM].join('\n')));
    expect(broken.links[0]).toMatchObject({ parent: null, nameMatch: false, signatureValid: null });
    expect(broken.endsAtRoot).toBe(false);
  });

  it('yanlış yayıncı anahtarıyla imza geçersiz', async () => {
    const [leaf, , root] = await certsOf([LEAF_PEM, INTERMEDIATE_PEM, ROOT_PEM].join('\n'));
    const { verifyCertificateSignature } = await import('./x509');
    // Yaprağın imzası ECDSA; kökün RSA anahtarıyla denenemez.
    expect(await verifyCertificateSignature(leaf!, root!)).toBeNull();
    const int = cert(INTERMEDIATE_PEM);
    const tampered = { ...int, tbs: int.tbs.slice() };
    tampered.tbs[20] = tampered.tbs[20]! ^ 1;
    expect(await verifyCertificateSignature(tampered, root!)).toBe(false);
  });
});
