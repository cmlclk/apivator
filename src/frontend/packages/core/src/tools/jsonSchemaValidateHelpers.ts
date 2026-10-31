/** JSON Schema doğrulayıcısının değer yardımcıları: eşitlik, tür adı, `multipleOf`, uzunluk, JSON pointer. */

export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Değerin JSON türü (`integer` ayrıca denetlenir). */
export function jsonType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value === 'object' ? 'object' : typeof value;
}

export function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'object':
      return isObject(value);
    default:
      return jsonType(value) === type;
  }
}

/** JSON eşitliği: nesnelerde anahtar sırası önemsiz, sayılar değerce (1 ile 1.0 eşit). */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const other = b as unknown[];
    return a.length === other.length && a.every((item, i) => deepEqual(item, other[i]));
  }
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  const keys = Object.keys(x);
  if (keys.length !== Object.keys(y).length) return false;
  return keys.every((key) => Object.hasOwn(y, key) && deepEqual(x[key], y[key]));
}

/** Anahtarları sıralı JSON: eşit değerler aynı metni verir (`uniqueItems` için). */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isObject(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Sayının ondalık gösterimi: `mantissa / 10^scale` (üslü yazımlar dahil). */
function decimal(n: number): { mantissa: bigint; scale: number } | null {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(String(n));
  if (!match) return null;
  const fraction = match[3] ?? '';
  let scale = fraction.length - Number(match[4] ?? 0);
  let digits = `${match[2]}${fraction}`;
  if (scale < 0) {
    digits += '0'.repeat(-scale);
    scale = 0;
  }
  if (scale > 400 || digits.length > 400) return null;
  return { mantissa: BigInt(`${match[1]}${digits}`), scale };
}

/**
 * Kayan nokta hatası olmadan `value`, `divisor`'ın katı mı: iki sayı da ondalık gösterimleriyle tam sayıya
 * ölçeklenir (0.3 / 0.1 doğru sonuç verir). Çok büyük/küçük üslerde bölüm yaklaşık denetlenir.
 */
export function isMultipleOf(value: number, divisor: number): boolean {
  if (!(divisor > 0) || !Number.isFinite(value)) return false;
  if (Number.isInteger(value) && Number.isInteger(divisor) && Number.isSafeInteger(value))
    return value % divisor === 0;
  const a = decimal(value);
  const b = decimal(divisor);
  if (!a || !b) {
    const quotient = value / divisor;
    return Number.isFinite(quotient) && Math.abs(quotient - Math.round(quotient)) < 1e-9;
  }
  const scale = Math.max(a.scale, b.scale);
  const x = a.mantissa * 10n ** BigInt(scale - a.scale);
  const y = b.mantissa * 10n ** BigInt(scale - b.scale);
  return x % y === 0n;
}

/** Metnin kod noktası sayısı (vekil çiftler tek karakter). */
export function codePointLength(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) i++;
    }
    count++;
  }
  return count;
}

/** JSON pointer parçası kaçışı (RFC 6901). */
export const escapePointer = (key: string | number) => String(key).replace(/~/g, '~0').replace(/\//g, '~1');

/** Hata mesajı için kısa değer gösterimi. */
export function short(value: unknown, max = 60): string {
  const text = JSON.stringify(value) ?? String(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
