/**
 * Ad dönüşümleri: JSON alan adlarından (snake_case, kebab-case, camelCase, Türkçe karakterli) dillerin
 * tanımlayıcılarına. Tanımlayıcılar her dilde güvenli olsun diye ASCII'ye çevrilir; JSON adı öznitelik/etiketle
 * korunur.
 */

const TURKISH: Record<string, string> = {
  ç: 'c',
  Ç: 'C',
  ğ: 'g',
  Ğ: 'G',
  ı: 'i',
  İ: 'I',
  ö: 'o',
  Ö: 'O',
  ş: 's',
  Ş: 'S',
  ü: 'u',
  Ü: 'U',
};

/** Türkçe ve aksanlı harfleri ASCII karşılığına çevirir; kalan ASCII dışı karakterler ayırıcı sayılır. */
export function toAscii(text: string): string {
  return text
    .replace(/[çÇğĞıİöÖşŞüÜ]/g, (c) => TURKISH[c]!)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7E]/g, ' ');
}

/** Kelimelere böler: `customer_name`, `customerName`, `Customer-Name`, `URLValue` → [customer, name] … */
export function words(name: string): string[] {
  return toAscii(name)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
}

const capitalize = (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();

export function pascalCase(name: string, fallback = 'Value'): string {
  const result = words(name).map(capitalize).join('');
  if (!result) return fallback;
  return /^[0-9]/.test(result) ? `N${result}` : result;
}

export function camelCase(name: string, fallback = 'value'): string {
  const pascal = pascalCase(name, fallback.charAt(0).toUpperCase() + fallback.slice(1));
  if (pascal.startsWith('N') && /^[0-9]/.test(words(name).join(''))) return `n${pascal.slice(1)}`;
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

export function snakeCase(name: string, fallback = 'value'): string {
  const result = words(name)
    .map((w) => w.toLowerCase())
    .join('_');
  if (!result) return fallback;
  return /^[0-9]/.test(result) ? `n_${result}` : result;
}

/** Go'daki gibi yaygın kısaltmalar büyük harfle (Id → ID, Url → URL). */
const INITIALISMS = new Set([
  'ID',
  'URL',
  'URI',
  'HTTP',
  'HTTPS',
  'API',
  'UUID',
  'JSON',
  'XML',
  'IP',
  'SQL',
  'HTML',
  'TCP',
  'UDP',
]);

export function goName(name: string, fallback = 'Value'): string {
  const parts = words(name).map((w) => (INITIALISMS.has(w.toUpperCase()) ? w.toUpperCase() : capitalize(w)));
  const result = parts.join('');
  if (!result) return fallback;
  return /^[0-9]/.test(result) ? `N${result}` : result;
}

/**
 * Çoğul alan adından tekil sınıf adı: `items` → Item, `categories` → Category, `addresses` → Address,
 * `satırlar` → Satir, `kullanicilar` → Kullanici.
 */
export function singular(name: string): string {
  const ascii = toAscii(name).trim();
  const lower = ascii.toLowerCase();
  if (/(lar|ler)$/.test(lower) && lower.length > 4) return ascii.slice(0, -3);
  if (/ies$/.test(lower) && lower.length > 4) return `${ascii.slice(0, -3)}y`;
  if (/(sses|shes|ches|xes|zes)$/.test(lower)) return ascii.slice(0, -2);
  if (/ses$/.test(lower) && lower.length > 4) return ascii.slice(0, -2);
  if (/[^s]s$/.test(lower) && !/(us|is|ss)$/.test(lower) && lower.length > 3) return ascii.slice(0, -1);
  return ascii;
}

/** Aynı kapsamda tekrarlanan adlara sayı ekler (`Name`, `Name2`). */
export function uniqueName(name: string, used: Set<string>, caseInsensitive = false): string {
  const key = (n: string) => (caseInsensitive ? n.toLowerCase() : n);
  let result = name;
  for (let i = 2; used.has(key(result)); i++) result = `${name}${i}`;
  used.add(key(result));
  return result;
}

export const RESERVED: Record<string, ReadonlySet<string>> = {
  csharp: new Set(
    'abstract as base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new null object operator out override params private protected public readonly ref return sbyte sealed short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using virtual void volatile while'.split(
      ' ',
    ),
  ),
  java: new Set(
    'abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null var record yield sealed permits'.split(
      ' ',
    ),
  ),
  kotlin: new Set(
    'as break class continue do else false for fun if in interface is null object package return super this throw true try typealias typeof val var when while'.split(
      ' ',
    ),
  ),
  typescript: new Set(
    'break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with'.split(
      ' ',
    ),
  ),
  python: new Set(
    'False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case type'.split(
      ' ',
    ),
  ),
  go: new Set(
    'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var'.split(
      ' ',
    ),
  ),
  swift: new Set(
    'associatedtype class deinit enum extension fileprivate func import init inout internal let open operator private protocol public rethrows static struct subscript typealias var break case continue default defer do else fallthrough for guard if in repeat return switch where while as Any catch false is nil super self Self throw throws true try Type'.split(
      ' ',
    ),
  ),
  dart: new Set(
    'abstract as assert async await break case catch class const continue covariant default deferred do dynamic else enum export extends extension external factory false final finally for Function get hide if implements import in interface is late library mixin new null on operator part required rethrow return set show static super switch sync this throw true try typedef var void while with yield'.split(
      ' ',
    ),
  ),
};

/**
 * Dillerin yerleşik ya da üretilen dosyada import edilen tip adları. Bu adlarla sınıf üretilirse (ör. `data` alanı →
 * `Data`, Lombok'un `@Data`'sı) çakışır; sonuna `Model` eklenir.
 */
const TYPE_NAME_CLASHES = new Set(
  (
    'String Object Integer Long Double Float Boolean Byte Short Character Number List Map Set Collection Iterable Optional ' +
    'UUID Date LocalDate OffsetDateTime BigDecimal JsonNode JsonElement JToken JValue Record Data NoArgsConstructor ' +
    'AllArgsConstructor Class Enum Exception Error Result Type Array Dictionary Guid DateTime DateTimeOffset DateOnly ' +
    'TimeSpan Decimal Int Int64 Bool Any Unit Pair Nothing Codable Decoder Encoder JSONValue Time Duration BaseModel ' +
    'Field ConfigDict Callable TypeVar Promise Function Symbol Serializable SerialName Math System Console Task'
  ).split(' '),
);

/** Sınıf adı: PascalCase, yerleşik tiplerle çakışırsa sonuna `Model`. */
export function typeName(name: string, fallback = 'Item'): string {
  const base = pascalCase(name, fallback);
  return TYPE_NAME_CLASHES.has(base) ? `${base}Model` : base;
}
