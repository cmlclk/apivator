import { msg } from '../i18n';
/**
 * JSON Schema (draft 2020-12 / 7) ve OpenAPI 3 / Swagger 2 şemalarından model; modelden JSON Schema.
 * gRPC mesajları da sunucuda JSON Schema'ya çevrilip buradan geçer.
 */
import {
  primitive,
  type ModelField,
  type ModelSet,
  type ModelType,
  type PrimitiveType,
  type TypeRef,
} from './ir';
import { orderTypes } from './infer';
import { pascalCase, singular, typeName, uniqueName } from './naming';

type Schema = Record<string, unknown>;

const isObject = (value: unknown): value is Schema =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export class SchemaError extends Error {}

/** Belge OpenAPI/Swagger mı, düz JSON Schema mı? */
export function isOpenApiDocument(doc: unknown): boolean {
  return isObject(doc) && (typeof doc.openapi === 'string' || typeof doc.swagger === 'string');
}

/** OpenAPI belgesindeki adlandırılmış şemalar. */
export function openApiSchemaNames(doc: unknown): string[] {
  if (!isObject(doc)) return [];
  const components = isObject(doc.components) ? doc.components : {};
  const schemas = isObject(components.schemas)
    ? components.schemas
    : isObject(doc.definitions)
      ? doc.definitions
      : {};
  return Object.keys(schemas);
}

export interface SchemaOptions {
  /** Düz JSON Schema'da kök sınıfın adı (şemada `title` yoksa). */
  rootName?: string;
  /** OpenAPI'de yalnızca bu şemalar (ve kullandıkları) üretilir; boşsa hepsi. */
  only?: string[];
}

/**
 * Şemadan model. OpenAPI belgesinde `components.schemas` (Swagger 2'de `definitions`) altındaki tüm şemalar
 * üretilir; düz JSON Schema'da kök ve `$defs`/`definitions`.
 */
export function modelFromSchema(doc: unknown, options: SchemaOptions = {}): ModelSet {
  if (!isObject(doc))
    throw new SchemaError(msg('core.models.schemaNotObject', 'Şema bir JSON nesnesi olmalı.'));

  const openApi = isOpenApiDocument(doc);
  const definitions: Schema = openApi
    ? ((isObject(doc.components) && isObject(doc.components.schemas) ? doc.components.schemas : undefined) ??
      (isObject(doc.definitions) ? doc.definitions : {}))
    : { ...(isObject(doc.definitions) ? doc.definitions : {}), ...(isObject(doc.$defs) ? doc.$defs : {}) };

  const used = new Set<string>();
  const types = new Map<string, ModelType>();
  const named = new Map<string, string>(); // tanım adı → üretilen tip adı
  const converting = new Set<string>();

  const refName = (ref: string): string | null => {
    const match = /^#\/(?:components\/schemas|definitions|\$defs)\/(.+)$/.exec(ref);
    return match ? decodeURIComponent(match[1]!.replace(/~1/g, '/').replace(/~0/g, '~')) : null;
  };

  const definitionType = (key: string): TypeRef => {
    const schema = definitions[key];
    if (!isObject(schema)) return primitive('any');
    if (named.has(key)) {
      const name = named.get(key)!;
      return { kind: types.get(name)?.kind === 'enum' ? 'enum' : 'class', name };
    }
    if (converting.has(key)) {
      // Kendine başvuran şema: ad önceden ayrılır.
      return { kind: 'class', name: named.get(key) ?? pascalCase(key) };
    }
    converting.add(key);
    const name = uniqueName(typeName(key, 'Model'), used, true);
    named.set(key, name);
    const result = convert(schema, name, true);
    converting.delete(key);
    // Adlandırılmış ama nesne olmayan şema (ör. `type: string`) doğrudan tip olarak kullanılır.
    if (result.type.kind !== 'class' && result.type.kind !== 'enum') {
      named.delete(key);
      used.delete(name.toLowerCase());
    }
    return result.type;
  };

  /** `nameHint`: sınıf gerekirse adı; `fixedName`: adı önceden ayrıldı (tanımlar). */
  function convert(
    schema: Schema,
    nameHint: string,
    fixedName = false,
  ): { type: TypeRef; nullable: boolean } {
    if (typeof schema.$ref === 'string') {
      const key = refName(schema.$ref);
      if (key === null || !(key in definitions))
        throw new SchemaError(
          msg('core.models.unresolvedRef', 'Çözülemeyen başvuru: {ref}', { ref: schema.$ref }),
        );
      return { type: definitionType(key), nullable: false };
    }

    let nullable = schema.nullable === true || schema['x-nullable'] === true;
    let type = schema.type;
    if (Array.isArray(type)) {
      nullable ||= type.includes('null');
      const rest = type.filter((t) => t !== 'null');
      type = rest.length === 1 ? rest[0] : undefined;
    }
    if (type === 'null') return { type: primitive('any'), nullable: true };

    const options = (
      Array.isArray(schema.oneOf) ? schema.oneOf : Array.isArray(schema.anyOf) ? schema.anyOf : null
    ) as Schema[] | null;
    if (options) {
      const nonNull = options.filter((o) => !(isObject(o) && o.type === 'null'));
      nullable ||= nonNull.length < options.length;
      if (nonNull.length === 1 && isObject(nonNull[0])) {
        const inner = convert(nonNull[0], nameHint, fixedName);
        return { type: inner.type, nullable: nullable || inner.nullable };
      }
      return { type: primitive('any'), nullable };
    }

    if (Array.isArray(schema.allOf)) {
      const parts = (schema.allOf as unknown[]).filter(isObject).map((part) => resolveObject(part));
      const merged: Schema = {
        type: 'object',
        properties: Object.assign({}, ...parts.map((p) => p.properties ?? {}), schema.properties ?? {}),
        required: [
          ...parts.flatMap((p) => (Array.isArray(p.required) ? p.required : [])),
          ...(Array.isArray(schema.required) ? schema.required : []),
        ],
        description: schema.description,
      };
      if (parts.length === 1 && !schema.properties && Object.keys(merged.properties as Schema).length === 0) {
        return convert(schema.allOf[0] as Schema, nameHint, fixedName);
      }
      return { type: objectType(merged, nameHint, fixedName), nullable };
    }

    if (Array.isArray(schema.enum)) {
      const values = (schema.enum as unknown[]).filter((v) => v !== null);
      nullable ||= values.length < (schema.enum as unknown[]).length;
      if (values.length && values.every((v) => typeof v === 'string')) {
        const name = fixedName ? nameHint : uniqueName(typeName(nameHint, 'Kind'), used, true);
        types.set(name, {
          kind: 'enum',
          name,
          values: values as string[],
          description: str(schema.description),
        });
        return { type: { kind: 'enum', name }, nullable };
      }
      if (values.every((v) => typeof v === 'number')) {
        return { type: primitive(values.every(Number.isInteger) ? 'integer' : 'number'), nullable };
      }
    }

    switch (type) {
      case 'string':
        return {
          type: primitive(
            schema.format === 'date'
              ? 'date'
              : schema.format === 'date-time'
                ? 'datetime'
                : schema.format === 'uuid'
                  ? 'uuid'
                  : 'string',
          ),
          nullable,
        };
      case 'integer':
        return { type: primitive(schema.format === 'int64' ? 'long' : 'integer'), nullable };
      case 'number':
        return { type: primitive('number'), nullable };
      case 'boolean':
        return { type: primitive('boolean'), nullable };
      case 'array':
        return {
          type: {
            kind: 'array',
            items: isObject(schema.items)
              ? convert(schema.items, singular(nameHint) || nameHint).type
              : primitive('any'),
          },
          nullable,
        };
      default:
        if (type === 'object' || isObject(schema.properties) || schema.additionalProperties !== undefined) {
          return { type: objectType(schema, nameHint, fixedName), nullable };
        }
        return { type: primitive('any'), nullable };
    }
  }

  function resolveObject(schema: Schema): Schema {
    if (typeof schema.$ref === 'string') {
      const key = refName(schema.$ref);
      const target = key ? definitions[key] : undefined;
      return isObject(target) ? resolveObject(target) : {};
    }
    if (Array.isArray(schema.allOf)) {
      const parts = (schema.allOf as unknown[]).filter(isObject).map(resolveObject);
      return {
        properties: Object.assign({}, ...parts.map((p) => p.properties ?? {}), schema.properties ?? {}),
        required: [
          ...parts.flatMap((p) => (Array.isArray(p.required) ? p.required : [])),
          ...(Array.isArray(schema.required) ? schema.required : []),
        ],
      };
    }
    return schema;
  }

  function objectType(schema: Schema, nameHint: string, fixedName: boolean): TypeRef {
    const properties = isObject(schema.properties) ? schema.properties : {};
    if (Object.keys(properties).length === 0) {
      const extra = schema.additionalProperties;
      return {
        kind: 'map',
        values: isObject(extra) ? convert(extra, singular(nameHint)).type : primitive('any'),
      };
    }
    const name = fixedName ? nameHint : uniqueName(typeName(nameHint, 'Item'), used, true);
    // Kendine başvuru için ad önce kaydedilir, alanlar sonra doldurulur.
    const model: ModelType = { kind: 'class', name, fields: [], description: str(schema.description) };
    types.set(name, model);
    const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);
    model.fields = Object.entries(properties)
      .filter((entry): entry is [string, Schema] => isObject(entry[1]))
      .map(([key, property]): ModelField => {
        const converted = convert(property, pascalCase(key, 'Item'));
        return {
          name: key,
          type: converted.type,
          nullable: converted.nullable,
          optional: !required.has(key),
          description: str(property.description),
        };
      });
    return { kind: 'class', name };
  }

  let root: TypeRef;
  if (openApi) {
    const keys = options.only?.length
      ? options.only.filter((k) => k in definitions)
      : Object.keys(definitions);
    if (keys.length === 0)
      throw new SchemaError(
        msg('core.models.noOpenApiSchemas', 'OpenAPI belgesinde şema (components.schemas) yok.'),
      );
    const refs = keys.map(definitionType);
    root = refs[0]!;
    const ordered = orderTypes(root, types);
    // Seçilen şemaların hepsi listede, seçilme sırasıyla önde olsun.
    const first = refs.flatMap((r) => (r.kind === 'class' || r.kind === 'enum' ? [types.get(r.name)!] : []));
    return { root, types: [...new Set([...first, ...ordered])] };
  }
  const rootName = typeName(str(doc.title) ?? options.rootName ?? 'Root', 'Root');
  const converted = convert(doc, rootName);
  root = converted.type;
  return { root, rootNullable: converted.nullable, types: orderTypes(root, types) };
}

const str = (value: unknown) => (typeof value === 'string' && value ? value : undefined);

const PRIMITIVE_SCHEMA: Record<PrimitiveType, Schema> = {
  string: { type: 'string' },
  integer: { type: 'integer', format: 'int32' },
  long: { type: 'integer', format: 'int64' },
  number: { type: 'number' },
  boolean: { type: 'boolean' },
  date: { type: 'string', format: 'date' },
  datetime: { type: 'string', format: 'date-time' },
  uuid: { type: 'string', format: 'uuid' },
  any: {},
};

/** Modelden JSON Schema (draft 2020-12): sınıflar ve enum'lar `$defs` altında. */
export function toJsonSchema(set: ModelSet, title?: string): Schema {
  const ref = (type: TypeRef): Schema => {
    switch (type.kind) {
      case 'primitive':
        return { ...PRIMITIVE_SCHEMA[type.type] };
      case 'array':
        return { type: 'array', items: ref(type.items) };
      case 'map':
        return { type: 'object', additionalProperties: ref(type.values) };
      default:
        return { $ref: `#/$defs/${type.name}` };
    }
  };
  const withNull = (schema: Schema, nullable: boolean): Schema =>
    !nullable
      ? schema
      : typeof schema.type === 'string'
        ? { ...schema, type: [schema.type, 'null'] }
        : { anyOf: [schema, { type: 'null' }] };

  const defs: Record<string, Schema> = {};
  for (const type of set.types) {
    if (type.kind === 'enum') {
      defs[type.name] = {
        type: 'string',
        enum: type.values,
        ...(type.description && { description: type.description }),
      };
      continue;
    }
    const properties: Record<string, Schema> = {};
    for (const field of type.fields) {
      properties[field.name] = withNull(
        { ...ref(field.type), ...(field.description && { description: field.description }) },
        field.nullable,
      );
    }
    const required = type.fields.filter((f) => !f.optional).map((f) => f.name);
    defs[type.name] = {
      type: 'object',
      ...(type.description && { description: type.description }),
      properties,
      ...(required.length && { required }),
    };
  }

  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    ...(title && { title }),
    ...withNull(ref(set.root), set.rootNullable ?? false),
    ...(Object.keys(defs).length && { $defs: defs }),
  };
}
