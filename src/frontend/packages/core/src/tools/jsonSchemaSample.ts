/**
 * JSON Schema'dan (ya da OpenAPI belgesindeki bir şemadan) örnek JSON verisi üretir. `const`, `examples`/`example`,
 * `default` ve `enum` önceliklidir; sonra tip, biçim (`format`), sınırlar ve basit `pattern` dikkate alınır.
 * `allOf` birleştirilir, `oneOf`/`anyOf` için ilk seçenek alınır. Yalnızca belge içi `$ref` çözülür; harici
 * başvurular hata verir (ağ isteği yapılmaz). Varsayılan çıktı belirlenimcidir; `random` ile tohumlu rastgele.
 */
import { isOpenApiDocument, openApiSchemaNames } from '../models/schema';
import { ToolError } from './errors';
import { msg } from '../i18n';
import { sampleFromPattern, type Random } from './jsonSchemaPattern';

type Schema = Record<string, unknown>;

export interface SampleOptions {
  /** Yalnızca `required` alanlar üretilsin (varsayılan: tüm özellikler). */
  requiredOnly?: boolean;
  /** Değerler tohumdan türetilen rastgele seçilsin. */
  random?: boolean;
  /** Rastgele üretimin tohumu (aynı tohum aynı çıktı). */
  seed?: number;
  /** İç içe derinlik sınırı (özyinelemeli şemalarda da güvence). */
  maxDepth?: number;
  /** OpenAPI belgesinde örneği üretilecek şema; yoksa ilki. */
  schemaName?: string;
}

export const DEFAULT_SAMPLE_DEPTH = 8;
/** `minItems` ne olursa olsun en fazla bu kadar eleman üretilir. */
const MAX_ITEMS = 100;
const MAX_ALLOF_DEPTH = 32;
/** Üretilen toplam değer sınırı: iç içe büyük `minItems` arayüzü dondurmasın; aşılınca atlanabilenler atlanır. */
const MAX_NODES = 10_000;
/** İç içe çözüm sınırı (`oneOf` içinden kendine dönen `$ref` gibi derinlik artırmayan döngüler). */
const MAX_NESTING = 200;
/** `minLength` ne olursa olsun en uzun örnek metin; tüm metinlerin toplamı da sınırlı. */
const MAX_STRING_LENGTH = 10_000;
const MAX_TOTAL_TEXT = 1_000_000;

const isObject = (value: unknown): value is Schema =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Tohumlu, hızlı sözde rastgele üreteç (mulberry32). */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Belge içi `$ref` (`#/$defs/A`, `#/definitions/A`, `#/components/schemas/A` …) hedefi. */
function resolveRef(root: unknown, ref: string): Schema | boolean {
  if (!ref.startsWith('#')) {
    throw new ToolError(
      msg('toolsData.schema.externalRef', 'Harici $ref desteklenmiyor (ağ isteği yapılmaz): {ref}', { ref }),
    );
  }
  const pointer = ref.slice(1);
  if (pointer && !pointer.startsWith('/'))
    throw new ToolError(msg('toolsData.schema.unresolvedRef', 'Çözülemeyen başvuru: {ref}', { ref }));
  let current: unknown = root;
  for (const raw of pointer ? pointer.slice(1).split('/') : []) {
    let key: string;
    try {
      key = decodeURIComponent(raw).replace(/~1/g, '/').replace(/~0/g, '~');
    } catch {
      throw new ToolError(msg('toolsData.schema.unresolvedRef', 'Çözülemeyen başvuru: {ref}', { ref }));
    }
    if (typeof current !== 'object' || current === null || !Object.hasOwn(current, key)) {
      throw new ToolError(msg('toolsData.schema.unresolvedRef', 'Çözülemeyen başvuru: {ref}', { ref }));
    }
    current = (current as Record<string, unknown>)[key];
  }
  if (!isObject(current) && typeof current !== 'boolean')
    throw new ToolError(msg('toolsData.schema.unresolvedRef', 'Çözülemeyen başvuru: {ref}', { ref }));
  return current;
}

const OMIT = Symbol('omit');

/** Konum bilgisi: derinlik, özellik adı (örnek metin seçimi için), dizi sırası ve atlanabilirlik. */
interface At {
  depth: number;
  name?: string;
  variant: number;
  optional: boolean;
}

const NAMES = ['Ayşe Yılmaz', 'Mehmet Demir', 'Zeynep Kaya', 'Can Öztürk', 'Elif Şahin'];
const FIRST = ['Ayşe', 'Mehmet', 'Zeynep', 'Can', 'Elif'];
const LAST = ['Yılmaz', 'Demir', 'Kaya', 'Öztürk', 'Şahin'];
const EMAILS = [
  'ayse.yilmaz@ornek.com',
  'mehmet.demir@ornek.com',
  'zeynep.kaya@ornek.com',
  'can.ozturk@ornek.com',
];
const CITIES = ['İstanbul', 'Ankara', 'İzmir', 'Bursa', 'Antalya'];
const WORDS = ['örnek metin', 'merhaba dünya', 'çay ve simit', 'güneşli gün', 'yeni kayıt'];

/** Özellik adına göre anlamlı örnek metinler (ilk eşleşen). */
const NAME_HINTS: [RegExp, string[]][] = [
  [/e-?mail|eposta/, EMAILS],
  [/url|uri|link|website/, ['https://ornek.com/kaynak/1', 'https://ornek.com/kaynak/2']],
  [/phone|telefon|gsm|mobile/, ['+90 532 123 45 67', '+90 212 555 00 11']],
  [/first_?name|^ad$|^isim$/, FIRST],
  [/last_?name|surname|soyad/, LAST],
  [/name|adsoyad|ad_soyad|fullname/, NAMES],
  [/city|sehir|şehir/, CITIES],
  [/country|ulke|ülke/, ['Türkiye']],
  [/address|adres/, ['Atatürk Cad. No:1, Kadıköy', 'Cumhuriyet Mah. 5. Sok. No:3']],
  [/description|aciklama|açıklama|summary|ozet|özet/, ['Örnek açıklama metni']],
  [/title|baslik|başlık/, ['Örnek başlık']],
  [/status|durum/, ['aktif', 'pasif']],
  [/colou?r|renk/, ['kırmızı', 'mavi', 'yeşil']],
  [/currency|para_?birimi/, ['TRY', 'USD', 'EUR']],
  [/lang|dil$/, ['tr', 'en']],
];

const NUMBER_HINTS: [RegExp, number][] = [
  [/age|yas|yaş/, 30],
  [/year|yil|yıl/, 2024],
  [/price|fiyat|amount|tutar|ucret|ücret|total|toplam/, 99.9],
  [/port/, 8080],
];

function inferType(schema: Schema): string | null {
  const has = (...keys: string[]) => keys.some((k) => schema[k] !== undefined);
  if (has('properties', 'additionalProperties', 'required', 'patternProperties', 'minProperties'))
    return 'object';
  if (has('items', 'prefixItems', 'minItems', 'maxItems')) return 'array';
  if (has('format', 'pattern', 'minLength', 'maxLength')) return 'string';
  if (has('minimum', 'maximum', 'multipleOf', 'exclusiveMinimum', 'exclusiveMaximum')) return 'number';
  return null;
}

/** Şemanın verilen anahtarlar dışındaki kopyası. */
const omit = (schema: Schema, ...keys: string[]): Schema =>
  Object.fromEntries(Object.entries(schema).filter(([key]) => !keys.includes(key)));

/** Anahtarı her zaman kendi özelliği olarak yazar: `__proto__` prototipi değiştirmez. */
function setOwn(target: Record<string, unknown>, key: string, value: unknown) {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/** Şemadan örnek veri üretir. */
export function sampleFromSchema(doc: unknown, options: SampleOptions = {}): unknown {
  if (doc === false)
    throw new ToolError(msg('toolsData.sample.falseSchema', '`false` şemasına uyan bir değer yok.'));
  if (doc === true) return null;
  if (!isObject(doc))
    throw new ToolError(msg('toolsData.schema.mustBeObject', 'Şema bir JSON nesnesi olmalı.'));

  let rootSchema: unknown = doc;
  if (isOpenApiDocument(doc)) {
    const names = openApiSchemaNames(doc);
    if (!names.length)
      throw new ToolError(
        msg('toolsData.schema.noOpenApiSchemas', 'OpenAPI belgesinde şema (components.schemas) yok.'),
      );
    const name = options.schemaName && names.includes(options.schemaName) ? options.schemaName : names[0]!;
    const base =
      isObject(doc.components) && isObject(doc.components.schemas) ? 'components/schemas' : 'definitions';
    rootSchema = { $ref: `#/${base}/${name.replace(/~/g, '~0').replace(/\//g, '~1')}` };
  }

  const rng: Random = options.random ? seededRandom(options.seed ?? 1) : null;
  const maxDepth = options.maxDepth ?? DEFAULT_SAMPLE_DEPTH;
  const refStack: string[] = [];
  let nodes = 0;
  let nesting = 0;
  let textLeft = MAX_TOTAL_TEXT;

  const pick = <T>(list: readonly T[], variant: number): T =>
    list[rng ? Math.floor(rng() * list.length) : variant % list.length]!;

  /** `$ref` ve iç içe `allOf` çözülmüş düz şema (yalnızca birleştirme için). */
  function flatten(part: unknown, guard: number): Schema {
    if (guard > MAX_ALLOF_DEPTH)
      throw new ToolError(msg('toolsData.sample.allOfTooDeep', 'allOf çok derin ya da döngüsel.'));
    if (!isObject(part)) return {};
    let schema = part;
    if (typeof schema.$ref === 'string') {
      const target = resolveRef(doc, schema.$ref);
      const rest = omit(schema, '$ref');
      schema = { ...flatten(target, guard + 1), ...rest };
    }
    return Array.isArray(schema.allOf) ? mergeAllOf(schema, guard + 1) : schema;
  }

  function mergeAllOf(schema: Schema, guard = 0): Schema {
    const { allOf, ...rest } = schema;
    let merged: Schema = flatten(rest, guard + 1);
    for (const part of allOf as unknown[]) {
      const next = flatten(part, guard + 1);
      const properties = { ...(isObject(merged.properties) ? merged.properties : {}) };
      for (const [key, value] of Object.entries(isObject(next.properties) ? next.properties : {})) {
        setOwn(properties, key, Object.hasOwn(properties, key) ? { allOf: [properties[key], value] } : value);
      }
      const required = [
        ...new Set([
          ...(Array.isArray(merged.required) ? merged.required : []),
          ...(Array.isArray(next.required) ? next.required : []),
        ]),
      ];
      merged = {
        ...next,
        ...merged,
        ...(Object.keys(properties).length && { properties }),
        ...(required.length && { required }),
      };
    }
    return merged;
  }

  /** Atlanamayan bir konumda üretim kesildiğinde (derinlik, özyineleme) tipe göre en küçük değer. */
  function minimal(schema: unknown): unknown {
    const flat = flatten(schema, 0);
    const type = Array.isArray(flat.type)
      ? flat.type.find((t) => t !== 'null')
      : (flat.type ?? inferType(flat));
    return type === 'object'
      ? {}
      : type === 'array'
        ? []
        : type === 'string'
          ? ''
          : type === 'boolean'
            ? false
            : type === 'number' || type === 'integer'
              ? 0
              : null;
  }

  function gen(input: unknown, at: At): unknown {
    if (input === false) return OMIT;
    if (!isObject(input)) return null;
    if (++nodes > MAX_NODES || nesting >= MAX_NESTING) return at.optional ? OMIT : minimal(input);
    nesting++;
    try {
      return genSchema(input, at);
    } finally {
      nesting--;
    }
  }

  function genSchema(input: Schema, at: At): unknown {
    let schema = input;
    if (at.depth > maxDepth) return at.optional ? OMIT : minimal(schema);

    if (typeof schema.$ref === 'string') {
      const ref = schema.$ref;
      const target = resolveRef(doc, ref);
      // Özyinelemeli başvuru bir kez açılır; ikinci kez görülünce kesilir.
      if (refStack.includes(ref)) return at.optional ? OMIT : minimal(target);
      const rest = omit(schema, '$ref');
      refStack.push(ref);
      try {
        return gen(typeof target === 'boolean' ? target : { ...target, ...rest }, at);
      } finally {
        refStack.pop();
      }
    }

    if (Array.isArray(schema.allOf)) return gen(mergeAllOf(schema), at);
    if (schema.const !== undefined) return structuredClone(schema.const);
    if (Array.isArray(schema.examples) && schema.examples.length) {
      return structuredClone(pick(schema.examples, at.variant));
    }
    if (schema.example !== undefined) return structuredClone(schema.example);
    if (schema.default !== undefined) return structuredClone(schema.default);
    if (Array.isArray(schema.enum) && schema.enum.length)
      return structuredClone(pick(schema.enum, at.variant));

    const choices = Array.isArray(schema.oneOf)
      ? schema.oneOf
      : Array.isArray(schema.anyOf)
        ? schema.anyOf
        : null;
    if (choices?.length) {
      const nonNull = choices.filter((c) => !(isObject(c) && c.type === 'null'));
      const choice = rng ? pick(nonNull.length ? nonNull : choices, 0) : (nonNull[0] ?? choices[0]);
      const rest = omit(schema, 'oneOf', 'anyOf');
      schema = Object.keys(rest).length ? { allOf: [rest, choice] } : (choice as Schema);
      return gen(schema, at);
    }

    let type = schema.type;
    if (Array.isArray(type)) type = type.find((t) => t !== 'null') ?? (type.length ? 'null' : undefined);
    switch (type ?? inferType(schema)) {
      case 'null':
        return null;
      case 'boolean':
        return rng ? rng() < 0.5 : true;
      case 'integer':
        return genNumber(schema, at, true);
      case 'number':
        return genNumber(schema, at, false);
      case 'string':
        return genString(schema, at);
      case 'array':
        return genArray(schema, at);
      case 'object':
        return genObject(schema, at);
      default:
        return null;
    }
  }

  function genObject(schema: Schema, at: At): Record<string, unknown> {
    const properties = isObject(schema.properties) ? schema.properties : {};
    const required = new Set((Array.isArray(schema.required) ? schema.required : []).map(String));
    const extra = schema.additionalProperties;
    const out: Record<string, unknown> = {};
    const child = (name: string): At => ({
      depth: at.depth + 1,
      name,
      variant: 0,
      optional: !required.has(name),
    });
    for (const [key, sub] of Object.entries(properties)) {
      if (options.requiredOnly && !required.has(key)) continue;
      const value = gen(sub, child(key));
      if (value !== OMIT) setOwn(out, key, value);
    }
    for (const key of required) {
      if (Object.hasOwn(out, key)) continue;
      const value = gen(isObject(extra) ? extra : {}, child(key));
      if (value !== OMIT) setOwn(out, key, value);
    }
    // Yalnızca serbest anahtarlı nesne (sözlük): bir örnek anahtar.
    if (!Object.keys(properties).length && !required.size && isObject(extra) && !options.requiredOnly) {
      const value = gen(extra, { depth: at.depth + 1, name: 'anahtar', variant: 0, optional: true });
      if (value !== OMIT) out.anahtar = value;
    }
    return out;
  }

  function genArray(schema: Schema, at: At): unknown[] {
    const tuple = Array.isArray(schema.prefixItems)
      ? (schema.prefixItems as unknown[])
      : Array.isArray(schema.items)
        ? (schema.items as unknown[])
        : [];
    const rest = Array.isArray(schema.prefixItems)
      ? schema.items
      : Array.isArray(schema.items)
        ? schema.additionalItems
        : schema.items;
    const min = Math.min(Math.max(0, num(schema.minItems) ?? 0), MAX_ITEMS);
    const max = Math.max(0, num(schema.maxItems) ?? Infinity);
    let count = Math.max(min, tuple.length, rest === undefined || rest === false ? 0 : 1);
    if (rng && rest !== undefined && rest !== false) count += Math.floor(rng() * 3);
    count = Math.min(count, max, MAX_ITEMS);
    const out: unknown[] = [];
    for (let i = 0; i < count; i++) {
      const sub = i < tuple.length ? tuple[i] : (rest ?? {});
      const value = gen(sub, { depth: at.depth + 1, name: at.name, variant: i, optional: true });
      if (value === OMIT) break;
      out.push(value);
    }
    return out;
  }

  function genNumber(schema: Schema, at: At, integer: boolean): number {
    const step = (num(schema.multipleOf) ?? 0) > 0 ? (schema.multipleOf as number) : integer ? 1 : 0;
    let lo = num(schema.minimum) ?? -Infinity;
    let hi = num(schema.maximum) ?? Infinity;
    // draft-04 / OpenAPI 3.0'da exclusiveMinimum mantıksal, sonrasında sayıdır.
    let loEx = schema.exclusiveMinimum === true;
    let hiEx = schema.exclusiveMaximum === true;
    const exMin = num(schema.exclusiveMinimum);
    const exMax = num(schema.exclusiveMaximum);
    if (exMin !== undefined && exMin >= lo) [lo, loEx] = [exMin, true];
    if (exMax !== undefined && exMax <= hi) [hi, hiEx] = [exMax, true];

    let value: number;
    if (rng) {
      const a = Number.isFinite(lo) ? lo : Number.isFinite(hi) ? hi - 100 : 0;
      const b = Number.isFinite(hi) ? hi : a + 100;
      value = a + rng() * (b - a);
      if (!step) value = Math.round(value * 100) / 100;
    } else {
      const hint = NUMBER_HINTS.find(([re]) => re.test((at.name ?? '').toLowerCase()))?.[1];
      // Alt sınır varsa ondan başlanır; yoksa ada göre (yaş, yıl, fiyat…) ya da 1.
      const start = Number.isFinite(lo) ? lo : (hint ?? (integer ? 1 : 1.5));
      value = Math.min(start + at.variant * (step || 1), hi);
    }
    const gap = (other: number) => step || (Number.isFinite(other) ? Math.abs(hi - lo) / 2 : 1);
    if (loEx && value <= lo) value = lo + gap(hi);
    if (hiEx && value >= hi) value = hi - gap(lo);
    if (step) {
      value = Math.ceil(value / step - 1e-9) * step;
      if (value > hi || (hiEx && value >= hi)) value -= step;
    }
    if (integer) value = Math.ceil(value) > hi ? Math.floor(value) : Math.ceil(value);
    return integer ? value : Number(value.toPrecision(12));
  }

  function formatSample(format: string, variant: number): string | null {
    const dayMs = 86_400_000;
    const offset = rng
      ? Math.floor(rng() * 365) * dayMs + Math.floor(rng() * 86_400) * 1000
      : variant * dayMs;
    const time = Date.UTC(2024, 0, 15, 9, 30) + offset;
    const iso = new Date(time).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const hex = (n: number) => Array.from({ length: n }, () => Math.floor(rng!() * 16).toString(16)).join('');
    switch (format) {
      case 'date-time':
        return iso;
      case 'date':
        return iso.slice(0, 10);
      case 'time':
        return iso.slice(11, 19) + 'Z';
      case 'email':
      case 'idn-email':
        return pick(EMAILS, variant);
      case 'uri':
      case 'url':
      case 'iri':
        return `https://ornek.com/kaynak/${rng ? Math.floor(rng() * 1000) : variant + 1}`;
      case 'uri-reference':
      case 'iri-reference':
        return `/kaynak/${variant + 1}`;
      case 'uri-template':
        return 'https://ornek.com/kaynak/{id}';
      case 'uuid':
        return rng
          ? `${hex(8)}-${hex(4)}-4${hex(3)}-${'89ab'[Math.floor(rng() * 4)]}${hex(3)}-${hex(12)}`
          : `3fa85f64-5717-4562-b3fc-${(0x2c963f66afa6 + variant).toString(16)}`;
      case 'hostname':
      case 'idn-hostname':
        return 'api.ornek.com';
      case 'ipv4':
        return rng
          ? Array.from({ length: 4 }, () => Math.floor(rng() * 256)).join('.')
          : `192.168.1.${10 + (variant % 240)}`;
      case 'ipv6':
        return `2001:db8::${(variant + 1).toString(16)}`;
      case 'byte':
        return 'w7ZybmVrIHZlcmk='; // "örnek veri" (base64)
      case 'binary':
        return 'örnek veri';
      case 'password':
        return 'Gizli*1234';
      case 'duration':
        return 'P1DT2H';
      case 'regex':
        return '^[a-z]+$';
      case 'json-pointer':
        return '/ornek/0';
      case 'int32':
      case 'int64':
        return String(variant + 1);
      default:
        return null;
    }
  }

  function genString(schema: Schema, at: At): string {
    if (typeof schema.format === 'string') {
      const formatted = formatSample(schema.format, at.variant);
      if (formatted !== null) return formatted;
    }
    if (typeof schema.pattern === 'string') {
      const matched = sampleFromPattern(schema.pattern, rng);
      if (matched !== null) return matched;
    }
    const name = (at.name ?? '').toLowerCase();
    const pool = NAME_HINTS.find(([re]) => re.test(name))?.[1] ?? WORDS;
    const base = [...pick(pool, at.variant)];
    const minLength = Math.min(num(schema.minLength) ?? 0, MAX_STRING_LENGTH, Math.max(textLeft, 0));
    textLeft -= minLength;
    const maxLength = num(schema.maxLength) ?? Infinity;
    // Uzunluk sınırları kod noktası sayısıyla: kısa metin tekrar edilerek uzatılır, uzunu kesilir.
    let chars = base;
    if (chars.length < minLength) {
      const unit = [...base, ' '];
      chars = Array.from({ length: minLength }, (_, i) => unit[i % unit.length]!);
    }
    if (chars.length > maxLength) chars = chars.slice(0, maxLength);
    if (chars.length > 1 && chars[chars.length - 1] === ' ') chars[chars.length - 1] = '.';
    return chars.join('');
  }

  const result = gen(rootSchema, { depth: 0, variant: 0, optional: false });
  if (result === OMIT)
    throw new ToolError(msg('toolsData.sample.cannotGenerate', 'Şemaya uyan bir değer üretilemedi.'));
  return result;
}
