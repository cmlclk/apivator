import { describe, expect, it } from 'vitest';
import { ToolError } from './errors';
import {
  analyzeIpInput,
  cidrContains,
  expandIpv6,
  formatIpv6,
  maskToPrefix,
  parseCidr,
  parseIp,
  parseIpv6,
  rangeToCidrs,
  splitCidr,
  type CidrInfo,
} from './cidr';

const info = (text: string): CidrInfo => {
  const result = analyzeIpInput(text);
  if (result.kind !== 'cidr') throw new Error('cidr bekleniyordu');
  return result.info;
};

describe('IP ayrıştırma ve biçimlendirme', () => {
  it('IPv4: baştaki sıfır, büyük sekizli ve eksik bölüm reddedilir', () => {
    expect(parseIp('192.168.1.10').value).toBe(0xc0a8010an);
    expect(() => parseIp('192.168.01.1')).toThrow(/Baştaki sıfır/);
    expect(() => parseIp('256.1.1.1')).toThrow(/255/);
    expect(() => parseIp('1.2.3')).toThrow(/dört bölüm/);
    expect(() => parseIp('1.2.3.x')).toThrow(ToolError);
    expect(() => parseIp('')).toThrow(/boş/);
  });

  it('IPv6: kısaltma, gömülü IPv4, bölge kimliği ve hatalar', () => {
    expect(parseIpv6('::1')).toBe(1n);
    expect(parseIpv6('::')).toBe(0n);
    expect(parseIpv6('fe80::1%eth0')).toBe(parseIpv6('fe80::1'));
    expect(parseIpv6('::ffff:192.0.2.1')).toBe(0xffffc0000201n);
    expect(() => parseIpv6('1::2::3')).toThrow(/bir kez/);
    expect(() => parseIpv6('1:2:3:4:5:6:7')).toThrow(/8 grup/);
    expect(() => parseIpv6('1:2:3:4:5:6:7::8')).toThrow(/en az bir/);
    expect(() => parseIpv6('12345::')).toThrow(/grubu/);
    expect(() => parseIpv6('g::1')).toThrow(ToolError);
  });

  it('RFC 5952 kısa yazım ve uzun yazım', () => {
    const value = parseIpv6('2001:0DB8:0000:0000:0001:0000:0000:0001');
    expect(formatIpv6(value)).toBe('2001:db8::1:0:0:1');
    expect(formatIpv6(parseIpv6('2001:db8:0:1:1:1:1:1'))).toBe('2001:db8:0:1:1:1:1:1');
    expect(formatIpv6(parseIpv6('::ffff:c000:201'))).toBe('::ffff:192.0.2.1');
    expect(expandIpv6(parseIpv6('2001:db8::1'))).toBe('2001:0db8:0000:0000:0000:0000:0000:0001');
  });
});

describe('CIDR bilgisi: IPv4', () => {
  it('192.168.1.10/24', () => {
    const c = info('192.168.1.10/24');
    expect(c).toMatchObject({
      cidr: '192.168.1.0/24',
      network: '192.168.1.0',
      broadcast: '192.168.1.255',
      firstUsable: '192.168.1.1',
      lastUsable: '192.168.1.254',
      netmask: '255.255.255.0',
      wildcard: '0.0.0.255',
      totalAddresses: 256n,
      usableHosts: 254n,
      addressClass: 'C',
      reverseDns: '10.1.168.192.in-addr.arpa',
      reverseZone: '1.168.192.in-addr.arpa',
    });
    expect(c.types[0]).toMatchObject({ label: 'Özel ağ', rfc: 'RFC 1918' });
    expect(c.binary.netmask).toEqual(['11111111', '11111111', '11111111', '00000000']);
    expect(c.notes.join()).toMatch(/ağ adresi 192\.168\.1\.0/);
  });

  it('maske yazımları: boşluklu, eğik çizgili; joker ve bitişik olmayan maske', () => {
    expect(info('10.0.0.0 255.255.255.0').cidr).toBe('10.0.0.0/24');
    expect(info('10.0.0.0/255.255.0.0').cidr).toBe('10.0.0.0/16');
    expect(maskToPrefix('255.255.255.255')).toBe(32);
    expect(maskToPrefix('0.0.0.0')).toBe(0);
    expect(() => maskToPrefix('0.0.0.255')).toThrow(/joker.*255\.255\.255\.0/);
    expect(() => maskToPrefix('255.0.255.0')).toThrow(/bitişik değil/);
  });

  it('/0, /31, /32 kenar durumları', () => {
    expect(info('0.0.0.0/0')).toMatchObject({
      totalAddresses: 4294967296n,
      usableHosts: 4294967294n,
      netmask: '0.0.0.0',
      reverseZone: 'in-addr.arpa',
    });
    const p2p = info('10.0.0.0/31');
    expect(p2p).toMatchObject({
      broadcast: null,
      firstUsable: '10.0.0.0',
      lastUsable: '10.0.0.1',
      usableHosts: 2n,
    });
    expect(p2p.notes.join()).toMatch(/RFC 3021/);
    const host = info('8.8.8.8');
    expect(host).toMatchObject({ prefix: 32, broadcast: null, firstUsable: '8.8.8.8', usableHosts: 1n });
    expect(host.types[0]?.label).toMatch(/Genel/);
  });

  it('önek hataları', () => {
    expect(() => parseCidr('10.0.0.0/33')).toThrow(/0–32/);
    expect(() => parseCidr('10.0.0.0/abc')).toThrow(/önek/);
    expect(() => parseCidr('2001:db8:: 255.255.0.0')).toThrow(/IPv6/);
    expect(() => parseCidr('  ')).toThrow(ToolError);
  });

  it('adres türleri', () => {
    const label = (text: string) => info(text).types[0]?.label;
    expect(label('100.64.1.1')).toMatch(/CGNAT/);
    expect(label('127.0.0.1')).toMatch(/loopback/);
    expect(label('169.254.10.1')).toMatch(/link-local/);
    expect(label('192.0.2.5')).toMatch(/TEST-NET-1/);
    expect(label('203.0.113.9')).toMatch(/TEST-NET-3/);
    expect(label('239.1.1.1')).toMatch(/multicast/);
    expect(info('239.1.1.1').addressClass).toBe('D');
    expect(label('172.31.255.1')).toBe('Özel ağ');
    expect(label('172.32.0.1')).toMatch(/Genel/);
    expect(label('255.255.255.255')).toMatch(/Sınırlı yayın/);
  });
});

describe('CIDR bilgisi: IPv6', () => {
  it('2001:db8::/32 ve /64', () => {
    const c = info('2001:db8:abcd:12::1/64');
    expect(c).toMatchObject({
      network: '2001:db8:abcd:12::',
      broadcast: null,
      firstUsable: '2001:db8:abcd:12::',
      lastUsable: '2001:db8:abcd:12:ffff:ffff:ffff:ffff',
      netmask: 'ffff:ffff:ffff:ffff::',
      totalAddresses: 18446744073709551616n,
      addressClass: null,
      expanded: '2001:0db8:abcd:0012:0000:0000:0000:0001',
      reverseZone: '2.1.0.0.d.c.b.a.8.b.d.0.1.0.0.2.ip6.arpa',
    });
    expect(c.types[0]).toMatchObject({ label: 'Belgeleme', rfc: 'RFC 3849' });
    expect(c.reverseDns).toMatch(/^1\.0\.0\.0\..*\.ip6\.arpa$/);
    expect(c.binary.address).toHaveLength(8);
  });

  it('/0, /128, ULA, link-local, IPv4 eşlemeli', () => {
    expect(info('::/0').totalAddresses).toBe(2n ** 128n);
    expect(info('::1/128')).toMatchObject({ usableHosts: 1n, network: '::1' });
    expect(info('::1').types[0]?.label).toMatch(/loopback/);
    expect(info('fd12:3456::1/48').types[0]?.label).toMatch(/ULA/);
    expect(info('fe80::1').types[0]?.label).toMatch(/link-local/);
    expect(info('::ffff:10.0.0.1').mappedIpv4).toBe('10.0.0.1');
    expect(info('2606:4700::1111').types[0]?.label).toMatch(/global unicast/);
    expect(() => parseCidr('::/129')).toThrow(/0–128/);
  });
});

describe('aralık → CIDR', () => {
  it('en az sayıda blok', () => {
    const result = analyzeIpInput('192.168.1.10 - 192.168.1.20');
    expect(result).toMatchObject({
      kind: 'range',
      total: 11n,
      cidrs: ['192.168.1.10/31', '192.168.1.12/30', '192.168.1.16/30', '192.168.1.20/32'],
    });
    expect(analyzeIpInput('10.0.0.0-10.0.255.255')).toMatchObject({ cidrs: ['10.0.0.0/16'] });
    expect(analyzeIpInput('0.0.0.0 - 255.255.255.255')).toMatchObject({ cidrs: ['0.0.0.0/0'] });
    expect(analyzeIpInput('2001:db8:: - 2001:db8::ff')).toMatchObject({ cidrs: ['2001:db8::/120'] });
  });

  it('hatalı aralıklar', () => {
    expect(() => rangeToCidrs(parseIp('10.0.0.5'), parseIp('10.0.0.1'))).toThrow(/büyük olamaz/);
    expect(() => rangeToCidrs(parseIp('10.0.0.1'), parseIp('::1'))).toThrow(/aynı IP sürümünde/);
  });
});

describe('içerme denetimi', () => {
  it('IPv4, IPv6 ve IPv4 eşlemeli', () => {
    expect(cidrContains('10.0.0.0/8', '10.255.1.2')).toBe(true);
    expect(cidrContains('10.0.0.0/8', '11.0.0.1')).toBe(false);
    expect(cidrContains('0.0.0.0/0', '1.2.3.4')).toBe(true);
    expect(cidrContains('2001:db8::/32', '2001:db8:ffff::1')).toBe(true);
    expect(cidrContains('192.168.0.0/16', '::ffff:192.168.5.5')).toBe(true);
    expect(() => cidrContains('10.0.0.0/8', '::1')).toThrow(/Sürüm uyuşmuyor/);
  });
});

describe('alt ağlara bölme', () => {
  it('sayıya ve öneke göre', () => {
    const byCount = splitCidr('192.168.0.0/24', { count: 3 });
    expect(byCount).toMatchObject({ prefix: 26, total: 4n, size: 64n, truncated: false });
    expect(byCount.rows[1]).toEqual({
      cidr: '192.168.0.64/26',
      network: '192.168.0.64',
      first: '192.168.0.65',
      last: '192.168.0.126',
      broadcast: '192.168.0.127',
    });
    expect(splitCidr('10.0.0.0/8', { prefix: 24 })).toMatchObject({ total: 65536n, truncated: true });
    expect(splitCidr('10.0.0.0/8', { prefix: 24 }).rows).toHaveLength(256);
    expect(splitCidr('2001:db8::/32', { prefix: 48 }, 4).rows.map((r) => r.cidr)).toEqual([
      '2001:db8::/48',
      '2001:db8:1::/48',
      '2001:db8:2::/48',
      '2001:db8:3::/48',
    ]);
  });

  it('geçersiz bölme', () => {
    expect(() => splitCidr('10.0.0.0/24', { prefix: 20 })).toThrow(/arasında/);
    expect(() => splitCidr('10.0.0.0/30', { count: 8 })).toThrow(/arasında/);
    expect(() => splitCidr('10.0.0.0/24', { count: 0 })).toThrow(/pozitif/);
  });
});
