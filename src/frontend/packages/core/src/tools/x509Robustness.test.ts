import { describe, expect, it } from 'vitest';
import { ToolError } from './errors';
import { base64Decode, base64Encode } from './encoding';
import { parseDer, readOid, readString, readTime } from './asn1';
import { inspectPem, parseCertificate, splitPem } from './x509';
import { INTERMEDIATE_PEM, LEAF_PEM, ROOT_PEM } from './x509.fixtures';

const der = (pem: string) => base64Decode(splitPem(pem)[0]!.body);
const ascii = (text: string) => [...new TextEncoder().encode(text)];

/** Uzun biçimli DER uzunluğu (dev içerikler için). */
function tlv(tag: number, content: Uint8Array): Uint8Array {
  const n = content.length;
  const len = n < 0x80 ? [n] : [0x84, (n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
  const out = new Uint8Array(1 + len.length + n);
  out.set([tag, ...len]);
  out.set(content, 1 + len.length);
  return out;
}

/** Tekrarlanabilir rastgelelik (xorshift32): başarısız tur yeniden üretilebilsin. */
function rng(seed: number) {
  let x = seed >>> 0 || 1;
  return (max: number) => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x % max;
  };
}

describe('ASN.1 sağlamlık', () => {
  it('dev OID hızla ToolError verir (karesel BigInt kaydırması yok)', () => {
    const body = new Uint8Array(2_000_000).fill(0xff);
    body[body.length - 1] = 0x01;
    const node = parseDer(tlv(0x06, body));
    const started = performance.now();
    expect(() => readOid(node)).toThrow(/çok uzun/);
    expect(performance.now() - started).toBeLessThan(100);
  });

  it('büyük ama makul OID arkları okunur (UUID tabanlı 2.25.x)', () => {
    // 2.25.<2^127>: ilk alt tanımlayıcı 2*40+25 = 105.
    const arc = 2n ** 127n;
    const groups: number[] = [];
    for (let v = arc; v > 0n; v >>= 7n) groups.unshift(Number(v & 0x7fn));
    const encoded = groups.map((g, i) => (i < groups.length - 1 ? g | 0x80 : g));
    expect(readOid(parseDer(new Uint8Array([0x06, encoded.length + 1, 105, ...encoded])))).toBe(
      `2.25.${arc}`,
    );
  });

  it('UTCTime 49/50 eşiği; aralık dışı ay, gün ve saat reddedilir', () => {
    const time = (tag: number, text: string) =>
      readTime(parseDer(new Uint8Array([tag, text.length, ...ascii(text)])));
    expect(time(0x17, '500101000000Z').getUTCFullYear()).toBe(1950);
    expect(time(0x17, '490101000000Z').getUTCFullYear()).toBe(2049);
    expect(time(0x17, '240229120000Z').toISOString()).toBe('2024-02-29T12:00:00.000Z');
    expect(time(0x18, '20240101000000.5+0130').toISOString()).toBe('2023-12-31T22:30:00.500Z');
    for (const bad of ['251301000000Z', '250230000000Z', '230229000000Z', '250101240000Z', '250101006000Z']) {
      expect(() => time(0x17, bad), bad).toThrow(ToolError);
    }
  });

  it('BMPString (vekil çiftleri dahil) ve T61 Latin-1 çözülür', () => {
    const bmp = parseDer(new Uint8Array([0x1e, 6, 0x00, 0xc7, 0xd8, 0x3d, 0xde, 0x00]));
    expect(readString(bmp)).toBe('Ç😀');
    const t61 = parseDer(new Uint8Array([0x14, 3, 0x47, 0xfc, 0x6c]));
    expect(readString(t61)).toBe('Gül');
  });

  it('2^53 üstü uzunluk, uzun etiket ve kesik veri ToolError', () => {
    expect(() =>
      parseDer(new Uint8Array([0x04, 0x88, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff])),
    ).toThrow(ToolError);
    expect(() => parseDer(new Uint8Array([0x04, 0x84, 0xff, 0xff, 0xff, 0xff, 0x00]))).toThrow(/taşıyor/);
    expect(() => parseDer(new Uint8Array([0x1f, 0x81, 0x81, 0x81, 0x81, 0x81, 0x01, 0x00]))).toThrow(
      ToolError,
    );
    expect(() => parseDer(new Uint8Array([0x30]))).toThrow(ToolError);
  });

  it('çok sayıda öğe sınırı', () => {
    const many = new Uint8Array(60_000 * 2).fill(0);
    for (let i = 0; i < many.length; i += 2) many[i] = 0x05;
    expect(() => parseDer(tlv(0x30, many))).toThrow(/çok fazla öğe/);
  });

  it('bulanık test: bozulmuş sertifikalar ya ayrışır ya ToolError verir, hızlıca', async () => {
    const fixtures = [LEAF_PEM, INTERMEDIATE_PEM, ROOT_PEM].map(der);
    const next = rng(0x7a11);
    const started = performance.now();
    for (let round = 0; round < 600; round++) {
      const source = fixtures[round % fixtures.length]!;
      let bytes = source.slice();
      const kind = next(4);
      if (kind === 0) {
        // Rastgele bayt değişiklikleri.
        for (let k = 0, n = 1 + next(8); k < n; k++) bytes[next(bytes.length)] = next(256);
      } else if (kind === 1) {
        // Kesme.
        bytes = bytes.slice(0, next(bytes.length));
      } else if (kind === 2) {
        // Uzunluk baytlarını büyüt (uzun biçim önekleri).
        for (let k = 0, n = 1 + next(4); k < n; k++) bytes[1 + next(bytes.length - 1)] = 0x80 | next(9);
      } else {
        // Bir bölümü çoğalt.
        const at = next(bytes.length);
        const piece = bytes.slice(at, at + next(64));
        const out = new Uint8Array(bytes.length + piece.length);
        out.set(bytes.subarray(0, at));
        out.set(piece, at);
        out.set(bytes.subarray(at), at + piece.length);
        bytes = out;
      }
      try {
        parseCertificate(bytes);
      } catch (error) {
        expect(error, `tur ${round}: ${String(error)}`).toBeInstanceOf(ToolError);
      }
      // Araç girdisi yolu: hiçbir zaman ToolError dışında fırlatmamalı (bozuk bloklar `error` öğesi olur).
      const pem = `-----BEGIN CERTIFICATE-----\n${base64Encode(bytes, { lineLength: 64 })}\n-----END CERTIFICATE-----`;
      const items = await inspectPem(pem);
      expect(items).toHaveLength(1);
      // ToolError dışındaki hatalar genel "Blok okunamadı." mesajına düşer: o mesaj beklenmeyen bir çöküştür.
      if (items[0]!.kind === 'error') expect(items[0]!.error, `tur ${round}`).not.toBe('Blok okunamadı.');
      try {
        await inspectPem(bytes);
      } catch (error) {
        expect(error, `tur ${round} (DER): ${String(error)}`).toBeInstanceOf(ToolError);
      }
    }
    expect(performance.now() - started).toBeLessThan(15_000);
  }, 30_000);
});
