import { msg } from '../i18n';
import { ToolError } from './errors';
import {
  expandIpv6,
  formatIp,
  ipBinaryGroups,
  ipBits,
  ipMax,
  ipRangeTypes,
  ipv4Class,
  parseIp,
  parseIpv4,
  reverseDnsName,
  type IpAddress,
  type IpRangeType,
  type IpVersion,
} from './ipAddress';

export {
  expandIpv6,
  formatIp,
  formatIpv4,
  formatIpv6,
  ipBinaryGroups,
  ipRangeTypes,
  ipv4Class,
  parseIp,
  parseIpv4,
  parseIpv6,
  reverseDnsName,
  type IpAddress,
  type IpRangeType,
  type IpVersion,
} from './ipAddress';

/** IP / CIDR hesaplayıcı: ağ, yayın, kullanılabilir aralık, maske, alt ağlara bölme, aralık → CIDR. */

export interface CidrBlock {
  version: IpVersion;
  /** Ağ adresi (host bitleri sıfırlanmış). */
  network: bigint;
  prefix: number;
}

export interface CidrInfo {
  version: IpVersion;
  /** Girilen adres (host bitleri sıfırlanmamış). */
  address: string;
  prefix: number;
  /** `ağ/önek` yazımı. */
  cidr: string;
  network: string;
  /** Yalnızca IPv4; IPv6'da yayın adresi yoktur. */
  broadcast: string | null;
  firstUsable: string;
  lastUsable: string;
  netmask: string;
  wildcard: string;
  totalAddresses: bigint;
  usableHosts: bigint;
  /** Yalnızca IPv4 (tarihsel sınıf). */
  addressClass: string | null;
  types: IpRangeType[];
  binary: { address: string[]; netmask: string[] };
  reverseDns: string;
  /** Ağın ters DNS bölgesi (sekizli/nibble sınırına yuvarlanmış). */
  reverseZone: string;
  /** IPv6 uzun yazım; IPv4'te null. */
  expanded: string | null;
  /** IPv4 eşlemeli IPv6 ise içindeki IPv4. */
  mappedIpv4: string | null;
  notes: string[];
}

export type IpInputResult =
  | { kind: 'cidr'; info: CidrInfo }
  | { kind: 'range'; version: IpVersion; start: string; end: string; total: bigint; cidrs: string[] };

const hostMask = (version: IpVersion, prefix: number) => (1n << BigInt(ipBits(version) - prefix)) - 1n;
const netMask = (version: IpVersion, prefix: number) => ipMax(version) ^ hostMask(version, prefix);
const ip = (version: IpVersion, value: bigint): IpAddress => ({ version, value });
const fmt = (version: IpVersion, value: bigint) => formatIp(ip(version, value));

function parsePrefix(text: string, version: IpVersion): number {
  const bits = ipBits(version);
  if (!/^\d{1,3}$/.test(text)) {
    if (version === 4 && text.includes('.')) return maskToPrefix(text);
    throw new ToolError(msg('toolsNet.cidr.badPrefix', 'Geçersiz önek uzunluğu: /{text}', { text }));
  }
  const prefix = Number(text);
  if (prefix > bits)
    throw new ToolError(
      msg('toolsNet.cidr.prefixRange', 'IPv{version} öneki 0–{bits} arasında olmalı: /{text}', {
        version,
        bits,
        text,
      }),
    );
  return prefix;
}

/** 255.255.255.0 → 24. Bitişik olmayan maske ToolError; joker maske (0.0.0.255) için ipucu verir. */
export function maskToPrefix(mask: string): number {
  const value = parseIpv4(mask.trim());
  const bits = value.toString(2).padStart(32, '0');
  if (/^1*0*$/.test(bits)) return bits.indexOf('0') < 0 ? 32 : bits.indexOf('0');
  if (/^0*1*$/.test(bits)) {
    throw new ToolError(
      msg(
        'toolsNet.cidr.wildcardMask',
        '{mask} bir joker (wildcard) maske gibi; ağ maskesi {netmask} olur.',
        { mask, netmask: fmt(4, value ^ ipMax(4)) },
      ),
    );
  }
  throw new ToolError(msg('toolsNet.cidr.nonContiguous', 'Ağ maskesi bitişik değil: {mask}', { mask }));
}

/** `adres/önek`, `adres/maske`, `adres maske` ya da yalın adres (/32, /128). */
export function parseCidr(text: string): { address: IpAddress; prefix: number } {
  const value = text.trim();
  if (!value) throw new ToolError(msg('toolsNet.cidr.empty', 'Adres ya da CIDR girin.'));
  const match = /^(\S+?)(?:\s*\/\s*(\S+)|\s+(\d+\.\d+\.\d+\.\d+))?$/.exec(value);
  if (!match) throw new ToolError(msg('toolsNet.cidr.unrecognized', 'Tanınmayan biçim: {value}', { value }));
  const address = parseIp(match[1]!);
  const prefixText = match[2] ?? match[3];
  if (match[3] && address.version === 6)
    throw new ToolError(msg('toolsNet.cidr.v6NeedsPrefix', 'IPv6 için önek uzunluğu kullanın (/64 gibi).'));
  return {
    address,
    prefix: prefixText === undefined ? ipBits(address.version) : parsePrefix(prefixText, address.version),
  };
}

/** Adres ve önekten tüm hesaplanan alanlar. */
export function cidrInfo(address: IpAddress, prefix: number): CidrInfo {
  const { version } = address;
  const bits = ipBits(version);
  const mask = netMask(version, prefix);
  const network = address.value & mask;
  const last = network | hostMask(version, prefix);
  const total = 1n << BigInt(bits - prefix);
  const notes: string[] = [];
  let first = network;
  let lastUsable = last;
  let usable = total;
  if (version === 4) {
    if (prefix === 32)
      notes.push(
        msg('toolsNet.cidr.note.slash32', '/32 tek bir adrestir (host yolu); ağ ve yayın adresi yoktur.'),
      );
    else if (prefix === 31)
      notes.push(
        msg(
          'toolsNet.cidr.note.slash31',
          '/31 noktadan noktaya bağlantıdır (RFC 3021): iki adres de kullanılabilir.',
        ),
      );
    else {
      first = network + 1n;
      lastUsable = last - 1n;
      usable = total - 2n;
    }
  } else if (prefix < 127) {
    notes.push(
      msg(
        'toolsNet.cidr.note.v6NoBroadcast',
        'IPv6’da yayın yoktur; ilk adres Subnet-Router anycast adresidir (RFC 4291).',
      ),
    );
  } else if (prefix === 127) {
    notes.push(
      msg('toolsNet.cidr.note.slash127', '/127 noktadan noktaya bağlantılar için önerilir (RFC 6164).'),
    );
  }
  if (address.value !== network)
    notes.push(
      msg('toolsNet.cidr.note.notNetwork', 'Girilen adres ağ adresi değil; ağ adresi {network}.', {
        network: fmt(version, network),
      }),
    );
  if (version === 6 && prefix > 64 && prefix < 127) {
    notes.push(msg('toolsNet.cidr.note.slaac', '/64’ten küçük IPv6 alt ağlarında SLAAC çalışmaz.'));
  }
  const zoneUnit = version === 4 ? 8 : 4;
  const zoneDigits = Math.floor(prefix / zoneUnit);
  // Ters ad: önce host basamakları, sonra ağ basamakları ve in-addr.arpa / ip6.arpa.
  const reverseZone = reverseDnsName(ip(version, network))
    .split('.')
    .slice(bits / zoneUnit - zoneDigits)
    .join('.');
  if (prefix % zoneUnit !== 0 && version === 4 && prefix > 24) {
    notes.push(
      msg(
        'toolsNet.cidr.note.classless',
        'Önek sekizli sınırında değil: ters DNS için RFC 2317 sınıfsız yetkilendirme gerekir.',
      ),
    );
  }
  const mapped =
    version === 6 && address.value >> 32n === 0xffffn ? fmt(4, address.value & 0xffffffffn) : null;
  return {
    version,
    address: formatIp(address),
    prefix,
    cidr: `${fmt(version, network)}/${prefix}`,
    network: fmt(version, network),
    broadcast: version === 4 && prefix < 31 ? fmt(4, last) : null,
    firstUsable: fmt(version, first),
    lastUsable: fmt(version, lastUsable),
    netmask: fmt(version, mask),
    wildcard: fmt(version, hostMask(version, prefix)),
    totalAddresses: total,
    usableHosts: usable,
    addressClass: version === 4 ? ipv4Class(address.value) : null,
    types: ipRangeTypes(address),
    binary: { address: ipBinaryGroups(address), netmask: ipBinaryGroups(ip(version, mask)) },
    reverseDns: reverseDnsName(address),
    reverseZone,
    expanded: version === 6 ? expandIpv6(address.value) : null,
    mappedIpv4: mapped,
    notes,
  };
}

/** Başlangıç–bitiş aralığını kapsayan en az sayıda CIDR bloğu. */
export function rangeToCidrs(start: IpAddress, end: IpAddress): CidrBlock[] {
  if (start.version !== end.version)
    throw new ToolError(msg('toolsNet.cidr.rangeVersion', 'Aralığın iki ucu aynı IP sürümünde olmalı.'));
  if (start.value > end.value)
    throw new ToolError(msg('toolsNet.cidr.rangeOrder', 'Aralığın başlangıcı bitişinden büyük olamaz.'));
  const { version } = start;
  const bits = ipBits(version);
  const blocks: CidrBlock[] = [];
  let current = start.value;
  while (current <= end.value) {
    // Hizalama: current'ın sondaki sıfır bit sayısı kadar büyük blok olabilir.
    let size = bits;
    while (size > 0 && (current & ((1n << BigInt(size)) - 1n)) !== 0n) size--;
    while (size > 0 && current + (1n << BigInt(size)) - 1n > end.value) size--;
    blocks.push({ version, network: current, prefix: bits - size });
    current += 1n << BigInt(size);
  }
  return blocks;
}

export const formatCidrBlock = (block: CidrBlock) => `${fmt(block.version, block.network)}/${block.prefix}`;

/** Araç girdisi: CIDR / adres+maske / yalın adres ya da `a - b` aralığı. */
export function analyzeIpInput(text: string): IpInputResult {
  const value = text.trim();
  const range = /^(\S+)\s*(?:-|–|\.\.)\s*(\S+)$/.exec(value);
  if (range && !value.includes('/') && (range[1]!.includes('.') || range[1]!.includes(':'))) {
    const start = parseIp(range[1]!);
    const end = parseIp(range[2]!);
    const blocks = rangeToCidrs(start, end);
    return {
      kind: 'range',
      version: start.version,
      start: formatIp(start),
      end: formatIp(end),
      total: end.value - start.value + 1n,
      cidrs: blocks.map(formatCidrBlock),
    };
  }
  const { address, prefix } = parseCidr(value);
  return { kind: 'cidr', info: cidrInfo(address, prefix) };
}

/** Adres CIDR'ın içinde mi? IPv4 eşlemeli IPv6 adres IPv4 bloğuyla karşılaştırılabilir. */
export function cidrContains(cidrText: string, ipText: string): boolean {
  const { address, prefix } = parseCidr(cidrText);
  let target = parseIp(ipText);
  if (address.version === 4 && target.version === 6 && target.value >> 32n === 0xffffn) {
    target = ip(4, target.value & 0xffffffffn);
  }
  if (address.version !== target.version) {
    throw new ToolError(
      msg('toolsNet.cidr.versionMismatch', 'Sürüm uyuşmuyor: blok IPv{block}, adres IPv{address}.', {
        block: address.version,
        address: target.version,
      }),
    );
  }
  const mask = netMask(address.version, prefix);
  return (address.value & mask) === (target.value & mask);
}

export interface SubnetRow {
  cidr: string;
  network: string;
  first: string;
  last: string;
  broadcast: string | null;
}

export interface SubnetSplit {
  prefix: number;
  /** Oluşan alt ağ sayısı. */
  total: bigint;
  /** Her alt ağdaki adres sayısı. */
  size: bigint;
  rows: SubnetRow[];
  /** Satırlar `limit` ile kesildiyse true. */
  truncated: boolean;
}

/**
 * Bloğu alt ağlara böler: `{ count }` en az o kadar alt ağ (2'nin kuvvetine yuvarlanır) ya da
 * `{ prefix }` yeni önek. En fazla `limit` satır listelenir.
 */
export function splitCidr(
  cidrText: string,
  by: { count: number } | { prefix: number },
  limit = 256,
): SubnetSplit {
  const { address, prefix } = parseCidr(cidrText);
  const { version } = address;
  const bits = ipBits(version);
  let newPrefix: number;
  if ('count' in by) {
    if (!Number.isInteger(by.count) || by.count < 1)
      throw new ToolError(msg('toolsNet.cidr.subnetCount', 'Alt ağ sayısı pozitif tam sayı olmalı.'));
    newPrefix = prefix + Math.ceil(Math.log2(by.count));
  } else {
    newPrefix = by.prefix;
  }
  if (!Number.isInteger(newPrefix) || newPrefix < prefix || newPrefix > bits) {
    throw new ToolError(
      msg(
        'toolsNet.cidr.newPrefixRange',
        'Yeni önek /{prefix} ile /{bits} arasında olmalı (istenen: /{requested}).',
        { prefix, bits, requested: String(newPrefix) },
      ),
    );
  }
  const network = address.value & netMask(version, prefix);
  const total = 1n << BigInt(newPrefix - prefix);
  const size = 1n << BigInt(bits - newPrefix);
  const rows: SubnetRow[] = [];
  for (let i = 0n; i < total && i < BigInt(limit); i++) {
    const start = network + i * size;
    const end = start + size - 1n;
    const info = cidrInfo(ip(version, start), newPrefix);
    rows.push({
      cidr: info.cidr,
      network: info.network,
      first: info.firstUsable,
      last: info.lastUsable,
      broadcast: version === 4 && newPrefix < 31 ? fmt(4, end) : null,
    });
  }
  return { prefix: newPrefix, total, size, rows, truncated: total > BigInt(limit) };
}
