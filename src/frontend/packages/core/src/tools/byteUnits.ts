import { coreLanguage, msg } from '../i18n';
import { ToolError } from './errors';

/**
 * Bayt / bit birimleri. Değerler kesin kesir (bit cinsinden pay/payda, BigInt) olarak tutulur; EB/EiB ve
 * ötesinde de yuvarlama hatası olmaz. SI önekleri 1000 (kB, MB), IEC önekleri 1024 (KiB, MiB) tabanlıdır.
 */

export type ByteUnitKind = 'byte' | 'bit';
export type ByteStandard = 'si' | 'iec';

export interface ByteUnit {
  symbol: string;
  kind: ByteUnitKind;
  /** Önekli birimlerde standart; yalın B ve bit için null. */
  standard: ByteStandard | null;
  /** Birimin bit cinsinden değeri. */
  bits: bigint;
}

const SI_PREFIXES = ['k', 'M', 'G', 'T', 'P', 'E', 'Z', 'Y'];
const IEC_PREFIXES = ['Ki', 'Mi', 'Gi', 'Ti', 'Pi', 'Ei', 'Zi', 'Yi'];
const NAME_PREFIXES: Record<string, [number, ByteStandard]> = {
  kilo: [1, 'si'],
  mega: [2, 'si'],
  giga: [3, 'si'],
  tera: [4, 'si'],
  peta: [5, 'si'],
  exa: [6, 'si'],
  zetta: [7, 'si'],
  yotta: [8, 'si'],
  kibi: [1, 'iec'],
  mebi: [2, 'iec'],
  gibi: [3, 'iec'],
  tebi: [4, 'iec'],
  pebi: [5, 'iec'],
  exbi: [6, 'iec'],
  zebi: [7, 'iec'],
  yobi: [8, 'iec'],
};

function unit(kind: ByteUnitKind, standard: ByteStandard | null, power: number): ByteUnit {
  const base = standard === 'iec' ? 1024n : 1000n;
  const prefix = standard ? (standard === 'iec' ? IEC_PREFIXES : SI_PREFIXES)[power - 1]! : '';
  return {
    symbol: kind === 'byte' ? `${prefix}B` : `${prefix}bit`,
    kind,
    standard,
    bits: base ** BigInt(power) * (kind === 'byte' ? 8n : 1n),
  };
}

function unitList(kind: ByteUnitKind): ByteUnit[] {
  const powers = [1, 2, 3, 4, 5, 6, 7, 8];
  return [
    unit(kind, null, 0),
    ...powers.map((p) => unit(kind, 'si', p)),
    ...powers.map((p) => unit(kind, 'iec', p)),
  ];
}

const MAX_DIGITS = 100;

/** Tüm birimler: B, kB…YB, KiB…YiB, bit, kbit…Ybit, Kibit…Yibit. */
export const BYTE_UNITS: ByteUnit[] = [...unitList('byte'), ...unitList('bit')];

/** Kesin değer: `num / den` bit. */
export interface ByteQuantity {
  num: bigint;
  den: bigint;
}

export interface ByteParseOptions {
  /** `KB`, `MB`, `GB` (büyük harf, `i`siz, bayt) 1024 tabanlı sayılır (Windows / JEDEC alışkanlığı). */
  legacyBinary?: boolean;
}

export interface ParsedByteSize {
  quantity: ByteQuantity;
  unit: ByteUnit;
}

/**
 * Ondalık sayı: `.` ve `,` birlikteyse sondaki ondalık, diğeri binlik ayraçtır; tek ayraç birden çok kez
 * geçiyorsa binliktir, bir kez geçiyorsa ondalıktır (`1,5` Türkçe, `1.5` İngilizce). Tek ayraçtan sonra tam üç
 * rakam varsa ve ayraç etkin dilin binlik ayracıysa (Türkçede `.`, İngilizcede `,`) binliktir: `1.000` Türkçede,
 * `1,000` İngilizcede bin. Boşluk ve `_` yok sayılır.
 */
const unknownUnit = (raw: string) =>
  new ToolError(msg('toolsMisc.byteUnits.unknownUnit', 'Bilinmeyen birim: "{raw}".', { raw }));
const invalidNumber = (text: string) =>
  new ToolError(msg('toolsMisc.byteUnits.invalidNumber', 'Geçersiz sayı: "{text}".', { text }));

function parseDecimal(text: string): { mantissa: bigint; scale: number } {
  const clean = text.replace(/[\s_]/g, '');
  if (!/^\d[\d.,]*$/.test(clean) && !/^[.,]\d+$/.test(clean)) throw invalidNumber(text);
  const lastDot = clean.lastIndexOf('.');
  const lastComma = clean.lastIndexOf(',');
  let decimal: string | null = null;
  if (lastDot >= 0 && lastComma >= 0) decimal = lastDot > lastComma ? '.' : ',';
  else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? '.' : ',';
    const thousands = coreLanguage() === 'tr' ? '.' : ',';
    const grouped = sep === thousands && /^\d{1,3}[.,]\d{3}$/.test(clean);
    if (clean.indexOf(sep) === clean.lastIndexOf(sep) && !grouped) decimal = sep;
  }
  const cut = decimal ? clean.lastIndexOf(decimal) : clean.length;
  const whole = clean.slice(0, cut);
  const fraction = clean.slice(cut + 1);
  // Binlik ayraçlı tam kısım üçlü gruplardan oluşmalı.
  if (/[.,]/.test(fraction) || (/[.,]/.test(whole) && !/^\d{1,3}([.,]\d{3})+$/.test(whole))) {
    throw invalidNumber(text);
  }
  const digits = whole.replace(/[.,]/g, '') + fraction;
  if (!digits) throw invalidNumber(text);
  // Çok uzun girdide BigInt bölmeleri arayüzü dondurmasın (YiB bile 27 hanedir).
  if (digits.length > MAX_DIGITS)
    throw new ToolError(
      msg('toolsMisc.byteUnits.tooLong', 'Sayı çok uzun: en fazla {max} hane.', { max: String(MAX_DIGITS) }),
    );
  return { mantissa: BigInt(digits), scale: fraction.length };
}

/** Birim yazımını çözer: `B`, `kB`, `KiB`, `Mb`, `Mbit`, `GiB`, `megabayt`, `kibibyte`, `bits`… */
export function parseByteUnit(text: string, options: ByteParseOptions = {}): ByteUnit {
  const raw = text.trim();
  if (!raw) return BYTE_UNITS[0]!;
  const named =
    /^(kilo|mega|giga|tera|peta|exa|zetta|yotta|kibi|mebi|gibi|tebi|pebi|exbi|zebi|yobi)?(bits?|bytes?|bayt)$/i.exec(
      raw,
    );
  if (named) {
    const kind: ByteUnitKind = named[2]!.toLowerCase().startsWith('bit') ? 'bit' : 'byte';
    const prefix = named[1] ? NAME_PREFIXES[named[1].toLowerCase()]! : null;
    return unit(kind, prefix?.[1] ?? null, prefix?.[0] ?? 0);
  }
  const short = /^([kKmMgGtTpPeEzZyY])?(i)?(bits?|b|B|o)$/.exec(raw);
  if (!short) throw unknownUnit(raw);
  const [, prefix, iec, suffix] = short;
  // Tamamı küçük harf önekli yazım (`kb`, `mb`, `gb`) gündelik bayt yazımıdır; bit için önek büyük yazılır
  // (`Mb`, `Gb`) ya da `bit` kullanılır. Yalın `b` bit kalır.
  const casual = Boolean(prefix) && suffix === 'b' && prefix === prefix!.toLowerCase();
  const kind: ByteUnitKind = suffix === 'B' || suffix === 'o' || casual ? 'byte' : 'bit';
  if (!prefix) {
    if (iec) throw unknownUnit(raw);
    return unit(kind, null, 0);
  }
  const power = SI_PREFIXES.findIndex((p) => p.toLowerCase() === prefix.toLowerCase()) + 1;
  const binary =
    Boolean(iec) ||
    (options.legacyBinary === true && kind === 'byte' && (casual || prefix === prefix.toUpperCase()));
  return unit(kind, binary ? 'iec' : 'si', power);
}

/** `1.5 GB`, `1,5 GB`, `1536 KiB`, `100 Mbit`, `2 megabayt`; birimsiz sayı bayttır. */
export function parseByteSize(text: string, options: ByteParseOptions = {}): ParsedByteSize {
  const trimmed = text.trim();
  if (!trimmed) throw new ToolError(msg('toolsMisc.byteUnits.sizeEmpty', 'Boyut girilmedi.'));
  if (trimmed.startsWith('-'))
    throw new ToolError(msg('toolsMisc.byteUnits.sizeNegative', 'Boyut negatif olamaz.'));
  const match = /^\+?([\d.,_\s]*?)\s*([A-Za-z]*)$/.exec(trimmed);
  if (!match || !match[1])
    throw new ToolError(
      msg('toolsMisc.byteUnits.unknownSize', 'Boyut tanınmadı: "{text}". Örnek: 1,5 GB ya da 1536 KiB.', {
        text: trimmed,
      }),
    );
  const { mantissa, scale } = parseDecimal(match[1]);
  const u = parseByteUnit(match[2]!, options);
  return { quantity: { num: mantissa * u.bits, den: 10n ** BigInt(scale) }, unit: u };
}

/** Bayt sayısını kesin değere çevirir. */
export function bytesQuantity(bytes: bigint | number): ByteQuantity {
  if (typeof bytes === 'number') {
    if (!Number.isFinite(bytes) || bytes < 0)
      throw new ToolError(msg('toolsMisc.byteUnits.invalidBytes', 'Geçersiz bayt sayısı.'));
    const { mantissa, scale } = parseDecimal(bytes.toFixed(Number.isInteger(bytes) ? 0 : 6));
    return { num: mantissa * 8n, den: 10n ** BigInt(scale) };
  }
  return { num: bytes * 8n, den: 1n };
}

export interface DecimalFormatOptions {
  /** Ondalık hane; tam kısım 0 ise en az bu kadar anlamlı hane gösterilecek şekilde uzar (en çok 40). */
  precision?: number;
  /** Ondalık ayraç (Türkçe `,`). */
  decimalSeparator?: '.' | ',';
  /** Sondaki sıfırlar atılır (varsayılan açık). */
  trim?: boolean;
}

/** `num / den` kesrini yarım yukarı yuvarlayarak ondalık metne çevirir. */
export function formatRatio(num: bigint, den: bigint, options: DecimalFormatOptions = {}): string {
  const { precision = 4, decimalSeparator = '.', trim = true } = options;
  let places = precision;
  const whole = num / den;
  if (whole === 0n && num !== 0n) {
    // İlk anlamlı haneye kadar sıfır sayısı kadar uzat.
    let leading = 0;
    let scaled = num * 10n;
    while (scaled < den && leading < 40) {
      scaled *= 10n;
      leading++;
    }
    places = Math.min(40, leading + precision);
  }
  const factor = 10n ** BigInt(places);
  const rounded = (num * factor * 2n + den) / (den * 2n);
  const int = (rounded / factor).toString();
  let frac = places ? (rounded % factor).toString().padStart(places, '0') : '';
  if (trim) frac = frac.replace(/0+$/, '');
  return frac ? `${int}${decimalSeparator}${frac}` : int;
}

/** Değeri verilen birimde ondalık metin olarak yazar. */
export function convertByteSize(
  quantity: ByteQuantity,
  target: ByteUnit,
  options: DecimalFormatOptions = {},
): string {
  return formatRatio(quantity.num, quantity.den * target.bits, options);
}

export interface ByteFormatOptions extends DecimalFormatOptions {
  standard?: ByteStandard;
  /** Bit birimleriyle yaz (bant genişliği gibi). */
  bits?: boolean;
}

/** Okunur boyut: 1'den büyük kalan en büyük birim (`1,5 GiB`, `12 Mbit`). Varsayılan IEC, 2 hane. */
export function formatByteSize(
  value: ByteQuantity | bigint | number,
  options: ByteFormatOptions = {},
): string {
  const { standard = 'iec', bits = false, precision = 2, ...rest } = options;
  const quantity = typeof value === 'object' ? value : bytesQuantity(value);
  const kind: ByteUnitKind = bits ? 'bit' : 'byte';
  const candidates = BYTE_UNITS.filter(
    (u) => u.kind === kind && (u.standard === standard || u.standard === null),
  );
  let chosen = candidates[0]!;
  for (const u of candidates) if (quantity.num >= quantity.den * u.bits) chosen = u;
  return `${convertByteSize(quantity, chosen, { precision, ...rest })} ${chosen.symbol}`;
}

/** Bant genişliği: `100 Mbps`, `100 Mbit/s`, `12,5 MB/s`, `1 Gbps`; birimsiz sayı Mbit/s sayılır. Bit/sn döner. */
export function parseBandwidth(text: string): ByteQuantity {
  const trimmed = text.trim();
  if (!trimmed) throw new ToolError(msg('toolsMisc.byteUnits.bandwidthEmpty', 'Bant genişliği girilmedi.'));
  const withUnit = /[A-Za-z]/.test(trimmed) ? trimmed : `${trimmed} Mbit`;
  // Küçük `b` ile `bps` saniyede bittir (`100 mbps` = 100 Mbit/s; `MBps` bayttır); küçük harfli bayt kuralı
  // burada uygulanmaz.
  const normalized = withUnit.replace(/b[pP][sS]$/, 'bit').replace(/\s*(\/\s*s(n|ec)?|ps)$/i, '');
  const { quantity } = parseByteSize(normalized);
  if (quantity.num === 0n)
    throw new ToolError(msg('toolsMisc.byteUnits.bandwidthZero', 'Bant genişliği sıfır olamaz.'));
  return quantity;
}

export interface TransferEstimate {
  seconds: number;
  /** "2 sa 5 dk 3,2 sn" gibi Türkçe süre. */
  text: string;
}

/** Verilen boyutun bant genişliğinde (bit/sn) aktarım süresi; ek yük hesaba katılmaz. */
export function transferTime(size: ByteQuantity, bandwidth: ByteQuantity): TransferEstimate {
  const seconds = Number((size.num * bandwidth.den * 1000n) / (size.den * bandwidth.num)) / 1000;
  return { seconds, text: formatSeconds(seconds) };
}

function formatSeconds(total: number): string {
  if (total < 1) return `${formatNumber(Math.round(total * 1000) / 1000)} ${secondUnit()}`;
  const parts: string[] = [];
  let rest = total;
  for (const [size, label] of [
    [86400, msg('toolsMisc.byteUnits.day', 'gün')],
    [3600, msg('toolsMisc.byteUnits.hour', 'sa')],
    [60, msg('toolsMisc.byteUnits.minute', 'dk')],
  ] as const) {
    const count = Math.floor(rest / size);
    if (count) parts.push(`${count} ${label}`);
    rest -= count * size;
  }
  const secs = Math.round(rest * 10) / 10;
  if (secs || !parts.length) parts.push(`${formatNumber(secs)} ${secondUnit()}`);
  return parts.join(' ');
}

const secondUnit = () => msg('toolsMisc.byteUnits.second', 'sn');
/** Ondalık ayraç etkin dile göre: Türkçe `,`, İngilizce `.`. */
const formatNumber = (n: number) => (coreLanguage() === 'tr' ? String(n).replace('.', ',') : String(n));
