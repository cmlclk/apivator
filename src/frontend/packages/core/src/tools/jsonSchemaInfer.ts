/**
 * JSON örneklerinden JSON Schema (draft 2020-12 ya da draft-07) çıkarımı. Dizi elemanları (ve istenirse kökteki
 * nesne dizisi) birleştirilir: özellikler birleşimi alınır, `required` tüm örneklerde bulunanlardır, farklı tipler
 * (null dahil) tip dizisiyle (`["string", "null"]`) yazılır. Çıktı sırası girdiye göre sabittir.
 */

export type SchemaDraft = '2020-12' | '07';

type JsonType = 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'null';

/** Tip dizisindeki sabit sıra (çıktı belirlenimci olsun). */
const TYPE_ORDER: JsonType[] = ['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'];

export const SCHEMA_DRAFT_URI: Record<SchemaDraft, string> = {
  '2020-12': 'https://json-schema.org/draft/2020-12/schema',
  '07': 'http://json-schema.org/draft-07/schema#',
};

export interface InferSchemaOptions {
  /** Varsayılan 2020-12. */
  draft?: SchemaDraft;
  /** Metinlerde `format` tanınsın mı (date-time, date, email, uri, uuid, ipv4); varsayılan açık. */
  detectFormats?: boolean;
  /** Basit değerlere görülen örnekler (`examples`, en fazla 3) eklensin mi. */
  examples?: boolean;
  /** Nesnelere `additionalProperties: false` eklensin mi. */
  noAdditionalProperties?: boolean;
  /** Kök şemanın başlığı. */
  title?: string;
  /** Kökteki dizi bir örnek listesi sayılır: şema tek elemanı tanımlar. */
  rootArrayAsSamples?: boolean;
}

type Format = 'date-time' | 'date' | 'email' | 'uri' | 'uuid' | 'ipv4';

/** Bir konumda görülen tüm değerlerin özeti. */
interface Node {
  types: Set<JsonType>;
  /** Metinlerin ortak biçimi: undefined = henüz metin yok, null = biçim yok ya da karışık. */
  format: Format | null | undefined;
  /** Görülen nesne sayısı (zorunlu alanlar için). */
  objects: number;
  /** Özellik → (düğüm, kaç nesnede bulundu); ilk görülme sırasıyla. */
  props: Map<string, { node: Node; seen: number }>;
  items: Node | null;
  examples: unknown[];
}

const MAX_EXAMPLES = 3;

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME =
  /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):[0-5]\d:([0-5]\d|60)(\.\d+)?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)$/i;
const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const URI = /^[a-z][a-z0-9+.-]*:\/\/[^\s/?#]+[^\s]*$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

const validDate = (match: RegExpExecArray | null) => {
  if (!match) return false;
  const month = Number(match[2]);
  const day = Number(match[3]);
  return month >= 1 && month <= 12 && day >= 1 && day <= 31;
};

/** Metnin biçimi; tanınmazsa null. */
export function detectStringFormat(value: string): Format | null {
  if (validDate(DATE.exec(value))) return 'date';
  if (DATETIME.test(value) && validDate(DATE.exec(value.slice(0, 10)))) return 'date-time';
  if (UUID.test(value)) return 'uuid';
  if (IPV4.test(value)) return 'ipv4';
  if (EMAIL.test(value)) return 'email';
  if (URI.test(value)) return 'uri';
  return null;
}

const newNode = (): Node => ({
  types: new Set(),
  format: undefined,
  objects: 0,
  props: new Map(),
  items: null,
  examples: [],
});

function add(node: Node, value: unknown, options: InferSchemaOptions) {
  if (value === null || value === undefined) {
    node.types.add('null');
    return;
  }
  if (Array.isArray(value)) {
    node.types.add('array');
    node.items ??= newNode();
    for (const item of value) add(node.items, item, options);
    return;
  }
  if (typeof value === 'object') {
    node.types.add('object');
    node.objects++;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      let prop = node.props.get(key);
      if (!prop) node.props.set(key, (prop = { node: newNode(), seen: 0 }));
      prop.seen++;
      add(prop.node, child, options);
    }
    return;
  }
  if (typeof value === 'string') {
    node.types.add('string');
    const format = options.detectFormats === false ? null : detectStringFormat(value);
    node.format = node.format === undefined || node.format === format ? format : null;
  } else if (typeof value === 'number') {
    node.types.add(Number.isInteger(value) ? 'integer' : 'number');
  } else if (typeof value === 'boolean') {
    node.types.add('boolean');
  } else {
    return;
  }
  if (options.examples && node.examples.length < MAX_EXAMPLES && !node.examples.includes(value)) {
    node.examples.push(value);
  }
}

type Schema = Record<string, unknown>;

function toSchema(node: Node, options: InferSchemaOptions): Schema {
  const types = new Set(node.types);
  // Tam sayı ondalığın alt kümesi: ikisi de görüldüyse yalnızca "number".
  if (types.has('number')) types.delete('integer');
  const list = TYPE_ORDER.filter((t) => types.has(t));
  const schema: Schema = {};
  if (list.length === 1) schema.type = list[0];
  else if (list.length > 1) schema.type = list;

  if (types.has('string') && node.format) schema.format = node.format;

  if (types.has('object')) {
    const properties: Schema = {};
    const required: string[] = [];
    for (const [key, prop] of node.props) {
      // `__proto__` adlı alan da kendi özelliği olarak yazılır (atama prototipi değiştirirdi).
      Object.defineProperty(properties, key, {
        value: toSchema(prop.node, options),
        enumerable: true,
        writable: true,
        configurable: true,
      });
      if (prop.seen === node.objects) required.push(key);
    }
    schema.properties = properties;
    if (required.length) schema.required = required;
    if (options.noAdditionalProperties) schema.additionalProperties = false;
  }

  if (types.has('array')) {
    schema.items = node.items && node.items.types.size ? toSchema(node.items, options) : {};
  }

  if (options.examples && node.examples.length) schema.examples = [...node.examples];
  return schema;
}

/**
 * JSON değerinden şema çıkarır. `rootArrayAsSamples` açıksa ve kök bir dizi ise her eleman ayrı örnek sayılır.
 */
export function inferJsonSchema(value: unknown, options: InferSchemaOptions = {}): Schema {
  const root = newNode();
  const samples = options.rootArrayAsSamples && Array.isArray(value) ? value : [value];
  for (const sample of samples) add(root, sample, options);
  const title = options.title?.trim();
  return {
    $schema: SCHEMA_DRAFT_URI[options.draft ?? '2020-12'],
    ...(title && { title }),
    ...toSchema(root, options),
  };
}
