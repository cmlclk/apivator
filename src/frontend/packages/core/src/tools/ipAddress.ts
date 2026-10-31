import { msg } from '../i18n';
import { ToolError } from './errors';

/** IPv4 ve IPv6 adresleri BigInt olarak; ayrıştırma, biçimlendirme ve adres türleri (cidr.ts kullanır). */

export type IpVersion = 4 | 6;

export interface IpAddress {
  version: IpVersion;
  value: bigint;
}

export const ipBits = (version: IpVersion) => (version === 4 ? 32 : 128);
export const ipMax = (version: IpVersion) => (1n << BigInt(ipBits(version))) - 1n;

/** Kesin IPv4: dört ondalık sekizli, 0–255, baştaki sıfır yok (sekizlik sayı belirsizliği). */
export function parseIpv4(text: string): bigint {
  const parts = text.split('.');
  if (parts.length !== 4)
    throw new ToolError(
      msg('toolsNet.ip.badV4', 'Geçersiz IPv4 adresi (dört bölüm olmalı): {text}', { text }),
    );
  let value = 0n;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part))
      throw new ToolError(
        msg('toolsNet.ip.badV4Part', 'Geçersiz IPv4 bölümü: "{part}" ({text})', { part, text }),
      );
    if (part.length > 1 && part.startsWith('0')) {
      throw new ToolError(
        msg(
          'toolsNet.ip.leadingZero',
          'Baştaki sıfır kabul edilmez: "{part}" sekizlik sayı sanılabilir ({text})',
          { part, text },
        ),
      );
    }
    const n = Number(part);
    if (n > 255)
      throw new ToolError(
        msg('toolsNet.ip.v4TooBig', "IPv4 bölümü 255'ten büyük olamaz: {part} ({text})", { part, text }),
      );
    value = (value << 8n) | BigInt(n);
  }
  return value;
}

/** IPv6: `::` kısaltması, sondaki gömülü IPv4 (::ffff:1.2.3.4) ve bölge kimliği (%eth0, yok sayılır). */
export function parseIpv6(text: string): bigint {
  const address = text.replace(/^\[|\]$/g, '').replace(/%[\w.-]+$/, '');
  if (!/^[0-9a-fA-F:.]+$/.test(address))
    throw new ToolError(msg('toolsNet.ip.badV6', 'Geçersiz IPv6 adresi: {text}', { text }));
  const halves = address.split('::');
  if (halves.length > 2)
    throw new ToolError(
      msg('toolsNet.ip.doubleColonOnce', '"::" yalnızca bir kez kullanılabilir: {text}', { text }),
    );
  const groups = (part: string): bigint[] => {
    if (!part) return [];
    const result: bigint[] = [];
    const pieces = part.split(':');
    pieces.forEach((piece, i) => {
      if (piece.includes('.')) {
        if (i !== pieces.length - 1)
          throw new ToolError(
            msg('toolsNet.ip.embeddedV4', 'Gömülü IPv4 yalnızca sonda olabilir: {text}', { text }),
          );
        const v4 = parseIpv4(piece);
        result.push(v4 >> 16n, v4 & 0xffffn);
      } else if (/^[0-9a-fA-F]{1,4}$/.test(piece)) {
        result.push(BigInt(`0x${piece}`));
      } else {
        throw new ToolError(
          msg('toolsNet.ip.badV6Group', 'Geçersiz IPv6 grubu: "{piece}" ({text})', { piece, text }),
        );
      }
    });
    return result;
  };
  const head = groups(halves[0]!);
  const tail = halves.length === 2 ? groups(halves[1]!) : [];
  if (halves.length === 1 && head.length !== 8) {
    throw new ToolError(
      msg('toolsNet.ip.v6Groups', 'IPv6 adresi 8 grup olmalı (ya da "::" kullanın): {text}', { text }),
    );
  }
  if (halves.length === 2 && head.length + tail.length > 7) {
    throw new ToolError(
      msg('toolsNet.ip.doubleColonZero', '"::" en az bir sıfır grubunu temsil etmeli: {text}', { text }),
    );
  }
  const all = [...head, ...Array<bigint>(8 - head.length - tail.length).fill(0n), ...tail];
  return all.reduce((acc, g) => (acc << 16n) | g, 0n);
}

/** Sürümü otomatik seçerek adres ayrıştırır. */
export function parseIp(text: string): IpAddress {
  const value = text.trim();
  if (!value) throw new ToolError(msg('toolsNet.ip.empty', 'Adres boş.'));
  return value.includes(':')
    ? { version: 6, value: parseIpv6(value) }
    : { version: 4, value: parseIpv4(value) };
}

export function formatIpv4(value: bigint): string {
  return [24n, 16n, 8n, 0n].map((shift) => String((value >> shift) & 0xffn)).join('.');
}

function ipv6Groups(value: bigint): number[] {
  return Array.from({ length: 8 }, (_, i) => Number((value >> BigInt((7 - i) * 16)) & 0xffffn));
}

/** RFC 5952 kısa yazım: küçük harf, en uzun (≥ 2) sıfır dizisi "::", IPv4 eşlemeli adres ::ffff:a.b.c.d. */
export function formatIpv6(value: bigint): string {
  if (value >> 32n === 0xffffn) return `::ffff:${formatIpv4(value & 0xffffffffn)}`;
  const groups = ipv6Groups(value);
  let bestStart = -1;
  let bestLength = 1;
  for (let i = 0; i < 8;) {
    if (groups[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && groups[j] === 0) j++;
    if (j - i > bestLength) {
      bestStart = i;
      bestLength = j - i;
    }
    i = j;
  }
  const hex = groups.map((g) => g.toString(16));
  if (bestStart < 0) return hex.join(':');
  return `${hex.slice(0, bestStart).join(':')}::${hex.slice(bestStart + bestLength).join(':')}`;
}

/** Uzun yazım: 8 grup, her biri 4 hane. */
export function expandIpv6(value: bigint): string {
  return ipv6Groups(value)
    .map((g) => g.toString(16).padStart(4, '0'))
    .join(':');
}

export function formatIp(ip: IpAddress): string {
  return ip.version === 4 ? formatIpv4(ip.value) : formatIpv6(ip.value);
}

/** İkili gösterim: IPv4'te 8, IPv6'da 16 bitlik gruplar. */
export function ipBinaryGroups(ip: IpAddress): string[] {
  const size = ip.version === 4 ? 8 : 16;
  const bits = ip.value.toString(2).padStart(ipBits(ip.version), '0');
  return Array.from({ length: bits.length / size }, (_, i) => bits.slice(i * size, (i + 1) * size));
}

/** Ters DNS adı: 4.3.2.1.in-addr.arpa ya da nibble ters sıralı ….ip6.arpa. */
export function reverseDnsName(ip: IpAddress): string {
  if (ip.version === 4) return `${formatIpv4(ip.value).split('.').reverse().join('.')}.in-addr.arpa`;
  return `${ip.value.toString(16).padStart(32, '0').split('').reverse().join('.')}.ip6.arpa`;
}

export interface IpRangeType {
  label: string;
  /** Tanımlayan belge (RFC 1918 gibi). */
  rfc: string;
  /** Aralığın CIDR yazımı. */
  cidr: string;
}

type RangeEntry = [string, number, () => string, string];

const V4_RANGES: RangeEntry[] = [
  ['0.0.0.0', 8, () => msg('toolsNet.ipRange.thisNetwork', 'Bu ağ (yalnızca kaynak)'), 'RFC 791'],
  ['10.0.0.0', 8, () => msg('toolsNet.ipRange.private', 'Özel ağ'), 'RFC 1918'],
  ['100.64.0.0', 10, () => msg('toolsNet.ipRange.cgnat', 'Taşıyıcı NAT (CGNAT) paylaşımlı alan'), 'RFC 6598'],
  ['127.0.0.0', 8, () => msg('toolsNet.ipRange.loopback', 'Geri döngü (loopback)'), 'RFC 1122'],
  [
    '169.254.0.0',
    16,
    () => msg('toolsNet.ipRange.linkLocalApipa', 'Bağlantı yerel (link-local, APIPA)'),
    'RFC 3927',
  ],
  ['172.16.0.0', 12, () => msg('toolsNet.ipRange.private', 'Özel ağ'), 'RFC 1918'],
  ['192.0.0.0', 24, () => msg('toolsNet.ipRange.ietf', 'IETF protokol atamaları'), 'RFC 6890'],
  ['192.0.2.0', 24, () => msg('toolsNet.ipRange.testNet1', 'Belgeleme (TEST-NET-1)'), 'RFC 5737'],
  [
    '192.88.99.0',
    24,
    () => msg('toolsNet.ipRange.relay6to4', '6to4 aktarım (kullanımdan kalktı)'),
    'RFC 7526',
  ],
  ['192.168.0.0', 16, () => msg('toolsNet.ipRange.private', 'Özel ağ'), 'RFC 1918'],
  ['198.18.0.0', 15, () => msg('toolsNet.ipRange.benchmark', 'Kıyaslama testleri'), 'RFC 2544'],
  ['198.51.100.0', 24, () => msg('toolsNet.ipRange.testNet2', 'Belgeleme (TEST-NET-2)'), 'RFC 5737'],
  ['203.0.113.0', 24, () => msg('toolsNet.ipRange.testNet3', 'Belgeleme (TEST-NET-3)'), 'RFC 5737'],
  ['224.0.0.0', 4, () => msg('toolsNet.ipRange.multicast', 'Çok noktaya yayın (multicast)'), 'RFC 5771'],
  ['240.0.0.0', 4, () => msg('toolsNet.ipRange.reservedE', 'Ayrılmış (E sınıfı)'), 'RFC 1112'],
  ['255.255.255.255', 32, () => msg('toolsNet.ipRange.broadcast', 'Sınırlı yayın (broadcast)'), 'RFC 919'],
];

const V6_RANGES: RangeEntry[] = [
  ['::', 128, () => msg('toolsNet.ipRange.unspecified', 'Belirtilmemiş adres'), 'RFC 4291'],
  ['::1', 128, () => msg('toolsNet.ipRange.loopback', 'Geri döngü (loopback)'), 'RFC 4291'],
  ['::ffff:0:0', 96, () => msg('toolsNet.ipRange.v4Mapped', 'IPv4 eşlemeli adres'), 'RFC 4291'],
  ['64:ff9b::', 96, () => msg('toolsNet.ipRange.nat64', 'NAT64 iyi bilinen önek'), 'RFC 6052'],
  ['64:ff9b:1::', 48, () => msg('toolsNet.ipRange.nat64Local', 'Yerel NAT64'), 'RFC 8215'],
  ['100::', 64, () => msg('toolsNet.ipRange.discard', 'Atma (discard) öneki'), 'RFC 6666'],
  ['2001::', 32, () => msg('toolsNet.ipRange.teredo', 'Teredo'), 'RFC 4380'],
  ['2001:db8::', 32, () => msg('toolsNet.ipRange.documentation', 'Belgeleme'), 'RFC 3849'],
  ['2002::', 16, () => msg('toolsNet.ipRange.sixToFour', '6to4'), 'RFC 3056'],
  ['3fff::', 20, () => msg('toolsNet.ipRange.documentation', 'Belgeleme'), 'RFC 9637'],
  [
    '2000::',
    3,
    () => msg('toolsNet.ipRange.globalUnicast', 'Genel tek noktaya yayın (global unicast)'),
    'RFC 4291',
  ],
  ['fc00::', 7, () => msg('toolsNet.ipRange.ula', 'Benzersiz yerel adres (ULA)'), 'RFC 4193'],
  ['fe80::', 10, () => msg('toolsNet.ipRange.linkLocal', 'Bağlantı yerel (link-local)'), 'RFC 4291'],
  ['ff00::', 8, () => msg('toolsNet.ipRange.multicast', 'Çok noktaya yayın (multicast)'), 'RFC 4291'],
];

/** Adresin içinde bulunduğu özel aralıklar, en dar olan önce. Hiçbiri değilse IPv4'te "Genel (public)". */
export function ipRangeTypes(ip: IpAddress): IpRangeType[] {
  const table = ip.version === 4 ? V4_RANGES : V6_RANGES;
  const bits = BigInt(ipBits(ip.version));
  const matches = table
    .filter(([base, prefix]) => {
      const shift = bits - BigInt(prefix);
      return ip.value >> shift === parseIp(base).value >> shift;
    })
    .sort((a, b) => b[1] - a[1])
    .map(([base, prefix, label, rfc]) => ({ label: label(), rfc, cidr: `${base}/${prefix}` }));
  if (!matches.length) {
    return [
      ip.version === 4
        ? { label: msg('toolsNet.ipRange.public', 'Genel (public) adres'), rfc: '', cidr: '' }
        : {
            label: msg('toolsNet.ipRange.reservedV6', 'Ayrılmış / atanmamış alan'),
            rfc: 'RFC 4291',
            cidr: '',
          },
    ];
  }
  return matches;
}

/** Sınıflı adresleme (tarihsel): A–E. */
export function ipv4Class(value: bigint): 'A' | 'B' | 'C' | 'D' | 'E' {
  const firstOctet = Number(value >> 24n);
  if (firstOctet < 128) return 'A';
  if (firstOctet < 192) return 'B';
  if (firstOctet < 224) return 'C';
  if (firstOctet < 240) return 'D';
  return 'E';
}
