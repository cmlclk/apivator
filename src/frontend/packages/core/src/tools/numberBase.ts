import { msg } from '../i18n';
import { ToolError } from './errors';

/**
 * Tamsayı taban dönüşümü (2–36), BigInt ile keyfi büyüklükte. Ondalık kesirler desteklenmez:
 * `1.5` gibi girdiler ToolError verir (onlu tabanda `1.000.000` / `1,000,000` binlik ayraç sayılır).
 */

export const BIT_WIDTHS = [8, 16, 32, 64, 128] as const;
export type BitWidth = (typeof BIT_WIDTHS)[number];

/** Donmayı önlemek için girdi hane sınırı. */
const MAX_DIGITS = 10_000;

const PREFIX_BASES: Record<string, number> = { b: 2, o: 8, x: 16 };

function digitValue(char: string): number {
  const code = char.toLowerCase().charCodeAt(0);
  if (code >= 48 && code <= 57) return code - 48;
  if (code >= 97 && code <= 122) return code - 87;
  return -1;
}

const tooLong = () =>
  new ToolError(
    msg('toolsMisc.numberBase.tooLong', 'Sayı çok uzun: en fazla {max} hane.', { max: String(MAX_DIGITS) }),
  );

function checkBase(base: number): void {
  if (!Number.isInteger(base) || base < 2 || base > 36) {
    throw new ToolError(
      msg('toolsMisc.numberBase.invalidBase', 'Geçersiz taban: {base} (2–36 arası olmalı).', {
        base: String(base),
      }),
    );
  }
}

export interface ParsedInteger {
  value: bigint;
  /** Kullanılan taban: `0x`/`0b`/`0o` öneki seçili tabanı geçersiz kılabilir. */
  base: number;
}

/**
 * `-`/`+` işareti, `0b`/`0o`/`0x` öneki, `_` ve boşluk ayraçlarını kabul eder. Önek yalnızca seçili tabanla
 * aynıysa ya da önek harfi o tabanda hane değilse önek sayılır (16'lık tabanda `0b1` bir sayıdır).
 * Geçersiz hane ToolError fırlatır (konum 1'den başlar).
 */
export function parseInteger(text: string, base = 10): ParsedInteger {
  checkBase(base);
  let i = 0;
  while (i < text.length && /\s/.test(text[i]!)) i++;
  let negative = false;
  if (text[i] === '-' || text[i] === '+') {
    negative = text[i] === '-';
    i++;
  }
  let effective = base;
  const letter = text[i + 1]?.toLowerCase();
  const prefixBase = letter ? PREFIX_BASES[letter] : undefined;
  if (text[i] === '0' && prefixBase && (prefixBase === base || digitValue(letter!) >= base)) {
    effective = prefixBase;
    i += 2;
  }
  const body = text.slice(i).trimEnd();
  if (effective === 10 && /[.,]/.test(body))
    return { value: parseGroupedDecimal(body, i, negative), base: 10 };
  const big = BigInt(effective);
  let value = 0n;
  let digits = 0;
  for (let j = 0; j < body.length; j++) {
    const char = body[j]!;
    if (char === '_' || char === ' ') continue;
    const d = digitValue(char);
    if (d < 0 || d >= effective) {
      throw new ToolError(
        msg(
          'toolsMisc.numberBase.invalidDigit',
          '{base} tabanında geçersiz hane: "{char}" (konum {position}).',
          {
            base: String(effective),
            char,
            position: String(i + j + 1),
          },
        ),
      );
    }
    if (++digits > MAX_DIGITS) throw tooLong();
    value = value * big + BigInt(d);
  }
  if (!digits) {
    throw new ToolError(
      text.trim()
        ? msg('toolsMisc.numberBase.noDigits', 'Sayı hanesi yok.')
        : msg('toolsMisc.numberBase.empty', 'Sayı girilmedi.'),
    );
  }
  return { value: negative ? -value : value, base: effective };
}

/** `1.000.000` (Türkçe) ya da `1,000,000` (İngilizce) binlik gruplu onlu sayı; diğer kullanım kesirdir. */
function parseGroupedDecimal(body: string, offset: number, negative: boolean): bigint {
  const match = /^(\d{1,3})((?:([.,])\d{3})(?:\3\d{3})*)$/.exec(body.replace(/[ _]/g, ''));
  if (!match) {
    const pos = body.search(/[.,]/);
    throw new ToolError(
      msg(
        'toolsMisc.numberBase.fraction',
        'Ondalık kesirler desteklenmez: "{char}" (konum {position}). Binlik ayraç için 1.000.000 ya da 1,000,000 yazın.',
        { char: body[pos], position: String(offset + pos + 1) },
      ),
    );
  }
  const digits = match[1]! + match[2]!.replace(/[.,]/g, '');
  if (digits.length > MAX_DIGITS) throw tooLong();
  const value = BigInt(digits);
  return negative ? -value : value;
}

export interface IntegerFormatOptions {
  upper?: boolean;
  /** Sağdan bu kadar hanede bir ayraç (0 ya da verilmezse gruplama yok). */
  group?: number;
  /** Grup ayracı (varsayılan boşluk). */
  separator?: string;
  /** Baştan sıfırla doldurulacak en az hane. */
  minDigits?: number;
}

export function formatInteger(value: bigint, base: number, options: IntegerFormatOptions = {}): string {
  checkBase(base);
  const { upper = false, group = 0, separator = ' ', minDigits = 0 } = options;
  const negative = value < 0n;
  let digits = (negative ? -value : value).toString(base).padStart(minDigits, '0');
  if (upper) digits = digits.toUpperCase();
  if (group > 0) {
    const parts: string[] = [];
    for (let end = digits.length; end > 0; end -= group)
      parts.unshift(digits.slice(Math.max(0, end - group), end));
    digits = parts.join(separator);
  }
  return negative ? `-${digits}` : digits;
}

/** Değeri verilen genişlikte ikiye tümleyen bit desenine çevirir; işaretli ya da işaretsiz sığmazsa ToolError. */
export function toTwosComplement(value: bigint, width: number): bigint {
  const w = BigInt(width);
  if (value < -(1n << (w - 1n)) || value >= 1n << w) {
    throw new ToolError(
      msg('toolsMisc.numberBase.widthOverflow', 'Değer {width} bit genişliğine sığmaz.', {
        width: String(width),
      }),
    );
  }
  return BigInt.asUintN(width, value);
}

/** Bit desenini işaretli (ikiye tümleyen) ya da işaretsiz yorumlar. */
export function fromTwosComplement(pattern: bigint, width: number, signed: boolean): bigint {
  return signed ? BigInt.asIntN(width, pattern) : BigInt.asUintN(width, pattern);
}

export type ThousandsSeparator = ',' | '.' | ' ';

export interface NumberBaseOptions {
  /** Girdinin tabanı (2–36). */
  base: number;
  /** Sabit bit genişliği; verilirse ikili/sekizli/onaltılı çıktılar ikiye tümleyen bit desenidir. */
  width?: BitWidth | null;
  /** Sabit genişlikte onlu değerin işaretli yorumu (varsayılan açık). */
  signed?: boolean;
  /** İkili 4'lü (nibble), onaltılı 2'li (bayt), sekizli 3'lü, onlu binlik gruplama. */
  group?: boolean;
  /** Onlu binlik ayraç (Türkçe `.`). */
  thousands?: ThousandsSeparator;
  upper?: boolean;
  /** Ek çıktı tabanı (2–36). */
  customBase?: number;
}

export interface NumberBaseResult {
  /** Yorumlanan değer (sabit genişlikte işaretli/işaretsiz yoruma göre). */
  value: bigint;
  /** Girdinin gerçekte okunduğu taban. */
  inputBase: number;
  /** Sabit genişlikte işaretsiz bit deseni. */
  pattern: bigint | null;
  /** Bit görünümünün genişliği: sabit genişlik ya da negatif olmayan değer için 8'in katı (en çok 128); yoksa null. */
  viewWidth: number | null;
  /** Değerin büyüklüğünü yazmak için gereken bit sayısı (işaretsiz mutlak değer). */
  bitLength: number;
  binary: string;
  octal: string;
  decimal: string;
  hex: string;
  custom: string | null;
}

export function convertNumberBase(input: string, options: NumberBaseOptions): NumberBaseResult {
  const { width = null, signed = true, group = false, thousands = ',', upper = true, customBase } = options;
  const parsed = parseInteger(input, options.base);
  const pattern = width ? toTwosComplement(parsed.value, width) : null;
  const value = pattern !== null && width ? fromTwosComplement(pattern, width, signed) : parsed.value;
  // Sabit genişlikte taban gösterimleri bit desenidir (her zaman negatif olmayan).
  const shown = pattern ?? value;
  const fmt = (base: number, size: number, minDigits = 0, separator = ' ') =>
    formatInteger(shown, base, { upper, group: group ? size : 0, separator, minDigits });
  const magnitude = value < 0n ? -value : value;
  const bitLength = magnitude === 0n ? 0 : magnitude.toString(2).length;
  const autoWidth = Math.max(8, Math.ceil(bitLength / 8) * 8);
  return {
    value,
    inputBase: parsed.base,
    pattern,
    viewWidth: width ?? (value >= 0n && autoWidth <= 128 ? autoWidth : null),
    bitLength,
    binary: fmt(2, 4, width ?? 0),
    octal: fmt(8, 3, width ? Math.ceil(width / 3) : 0),
    decimal: formatInteger(value, 10, { group: group ? 3 : 0, separator: thousands }),
    hex: fmt(16, 2, width ? width / 4 : 0),
    custom: customBase ? fmt(customBase, 4) : null,
  };
}
