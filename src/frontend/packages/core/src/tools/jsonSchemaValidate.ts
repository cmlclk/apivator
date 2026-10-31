/**
 * JSON Schema doğrulayıcı (draft 2020-12 ve draft-07; OpenAPI belgesindeki şemalar da). Kod üretmez (`new Function`
 * yok), bağımlılığı yoktur. Yalnızca belge içi `$ref` / `$anchor` / gömülü `$id` çözülür; harici başvurular hata
 * verir (ağ isteği yapılmaz). `format` varsayılan olarak açıklamadır; istenirse denetlenir. Hata sayısı ve işlem
 * bütçesi sınırlıdır: çok büyük ya da döngüsel girdiler arayüzü dondurmaz.
 */
import { ToolError } from './errors';
import { msg } from '../i18n';
import { checkArraySize, checkNumber, checkObjectSize, checkString } from './jsonSchemaValidateKeywords';
import type {
  SchemaValidationError,
  SchemaValidationResult,
  ValidateOptions,
} from './jsonSchemaValidateTypes';
import { decodePointer, indexSchema, MAX_DEPTH, prepareSchema, type Located } from './jsonSchemaIndex';
import {
  canonicalJson,
  deepEqual,
  escapePointer,
  isObject,
  jsonType,
  matchesType,
  short,
} from './jsonSchemaValidateHelpers';

type Schema = Record<string, unknown>;

export type {
  SchemaValidationError,
  SchemaValidationResult,
  ValidateDraft,
  ValidateOptions,
} from './jsonSchemaValidateTypes';

export const DEFAULT_MAX_ERRORS = 100;
/** Toplam işlem sınırı: aşılırsa doğrulama yarıda kesilir. */
const MAX_OPS = 2_000_000;

interface Sink {
  errors: SchemaValidationError[];
  limit: number;
}

/** Aynı veri konumunda değerlendirilen alanlar/öğeler (`unevaluated*` için). */
interface Ann {
  props: Set<string>;
  items: Set<number>;
}

const newAnn = (): Ann => ({ props: new Set(), items: new Set() });
function merge(into: Ann, from: Ann) {
  for (const p of from.props) into.props.add(p);
  for (const i of from.items) into.items.add(i);
}

/** Şemayı (ya da OpenAPI belgesindeki bir şemayı) veriye uygular ve hataları Türkçe mesajlarla döndürür. */
export function validateJsonSchema(
  doc: unknown,
  data: unknown,
  options: ValidateOptions = {},
): SchemaValidationResult {
  const { draft, start, openApi } = prepareSchema(doc, options.draft, options.schemaName);
  const { ids, anchors, track, notes } = indexSchema(doc);
  const maxErrors = Math.max(1, options.maxErrors ?? DEFAULT_MAX_ERRORS);
  const assertFormats = Boolean(options.assertFormats);
  // Draft-07 ve OpenAPI 3.0'da `$ref`'in yanındaki anahtarlar yok sayılır.
  const refOnly = draft === '07';
  const rootLocated: Located = { schema: doc as Schema | boolean, path: '' };
  const active = new Map<object, Set<string>>();
  const regexCache = new Map<string, RegExp>();
  let ops = 0;

  function regex(pattern: string, at: string): RegExp {
    let re = regexCache.get(pattern);
    if (!re) {
      try {
        re = new RegExp(pattern, 'u');
      } catch {
        try {
          re = new RegExp(pattern);
        } catch {
          throw new ToolError(
            msg('toolsData.validate.badRegex', 'Şemada geçersiz düzenli ifade ({at}): {pattern}', {
              at,
              pattern,
            }),
          );
        }
      }
      regexCache.set(pattern, re);
    }
    return re;
  }

  function pointerIn(base: Located, frag: string, ref: string): Located {
    let current: unknown = base.schema;
    let path = base.path;
    for (const raw of frag.slice(1).split('/')) {
      const key = decodePointer(raw, ref);
      if (typeof current !== 'object' || current === null || !Object.hasOwn(current, key))
        throw new ToolError(msg('toolsData.schema.unresolvedRef', 'Çözülemeyen başvuru: {ref}', { ref }));
      current = (current as Record<string, unknown>)[key];
      path += `/${escapePointer(key)}`;
    }
    if (!isObject(current) && typeof current !== 'boolean')
      throw new ToolError(msg('toolsData.schema.unresolvedRef', 'Çözülemeyen başvuru: {ref}', { ref }));
    return { schema: current, path };
  }

  function resolve(ref: string, base: Located): Located {
    const hash = ref.indexOf('#');
    const uri = hash < 0 ? ref : ref.slice(0, hash);
    const frag = hash < 0 ? '' : ref.slice(hash + 1);
    let target = base;
    if (uri) {
      const found =
        ids.get(uri) ??
        [...ids.entries()].find(([id]) => id.endsWith(`/${uri}`) || uri.endsWith(`/${id}`))?.[1];
      if (!found)
        throw new ToolError(
          msg('toolsData.schema.externalRef', 'Harici $ref desteklenmiyor (ağ isteği yapılmaz): {ref}', {
            ref,
          }),
        );
      target = found;
    }
    if (!frag) return target;
    if (frag.startsWith('/')) return pointerIn(target, frag, ref);
    const anchor = anchors.get(decodePointer(frag, ref));
    if (!anchor)
      throw new ToolError(msg('toolsData.schema.unresolvedRef', 'Çözülemeyen başvuru: {ref}', { ref }));
    return anchor;
  }

  function push(sink: Sink, error: SchemaValidationError) {
    if (sink.errors.length < sink.limit) sink.errors.push(error);
  }

  /** Şemayı veri konumuna uygular; geçerliyse ve `parent` verildiyse değerlendirilen alanları ona ekler. */
  function validate(
    located: Located,
    inst: unknown,
    ip: string,
    sink: Sink,
    parent: Ann | null,
    base: Located,
    depth: number,
  ): boolean {
    if (++ops > MAX_OPS)
      throw new ToolError(
        msg(
          'toolsData.validate.tooSlow',
          'Doğrulama çok uzun sürdü: şema ya da veri çok büyük veya karmaşık.',
        ),
      );
    if (depth > MAX_DEPTH)
      throw new ToolError(msg('toolsData.validate.tooDeep', 'Şema ya da veri çok derin iç içe.'));
    const { schema, path: sp } = located;
    if (schema === true) return true;
    if (schema === false) {
      push(sink, {
        instancePath: ip,
        schemaPath: `#${sp}`,
        keyword: 'false',
        message: msg('toolsData.validate.falseSchema', 'Şema hiçbir değere izin vermiyor (false).'),
      });
      return false;
    }
    if (!isObject(schema))
      throw new ToolError(
        msg('toolsData.validate.invalidSchema', 'Geçersiz şema (#{sp}): nesne ya da boolean olmalı.', { sp }),
      );
    if (typeof schema.$id === 'string' && !schema.$id.startsWith('#') && sp !== '') base = located;

    let ok = true;
    const ann = newAnn();
    const err = (keyword: string, message: () => string, at = ip) => {
      ok = false;
      if (sink.errors.length < sink.limit)
        push(sink, { instancePath: at, schemaPath: `#${sp}/${keyword}`, keyword, message: message() });
    };
    const child = (key: string): Located => ({
      schema: schema[key] as Schema,
      path: `${sp}/${escapePointer(key)}`,
    });
    const childAt = (key: string, sub: string | number): Located => ({
      schema: (schema[key] as Record<string, Schema>)[sub as string]!,
      path: `${sp}/${escapePointer(key)}/${escapePointer(sub)}`,
    });
    const run = (loc: Located, value: unknown, at: string, s: Sink, a: Ann | null) =>
      validate(loc, value, at, s, a, base, depth + 1);
    const quick = (loc: Located, value: unknown, at: string, a: Ann | null = null) =>
      run(loc, value, at, { errors: [], limit: 1 }, a);
    const full = () => !ok && sink.errors.length >= sink.limit;
    const finish = () => {
      if (ok && parent) merge(parent, ann);
      return ok;
    };

    // $ref (ve statik çözülen $dynamicRef / $recursiveRef)
    for (const key of ['$ref', '$dynamicRef', '$recursiveRef']) {
      const ref = schema[key];
      if (typeof ref !== 'string') continue;
      const target = resolve(ref, key === '$recursiveRef' ? rootLocated : base);
      const seen = active.get(target.schema as object) ?? new Set<string>();
      if (seen.has(ip))
        throw new ToolError(
          msg('toolsData.validate.refLoop', 'Sonsuz $ref döngüsü: {ref} (#{sp})', { ref, sp }),
        );
      seen.add(ip);
      active.set(target.schema as object, seen);
      try {
        if (!run(target, inst, ip, sink, ann)) ok = false;
      } finally {
        seen.delete(ip);
      }
      if (refOnly && key === '$ref') return finish();
    }

    const nullable = openApi && schema.nullable === true && inst === null;
    if (schema.type !== undefined && !nullable) {
      const types = Array.isArray(schema.type) ? (schema.type as string[]) : [schema.type as string];
      if (!types.some((t) => matchesType(inst, t)))
        err('type', () =>
          msg('toolsData.validate.type', 'Tür uyuşmuyor: {expected} bekleniyordu, {actual} geldi.', {
            expected: types.join(' | '),
            actual: jsonType(inst),
          }),
        );
    }
    if (Array.isArray(schema.enum) && !nullable && !schema.enum.some((v) => deepEqual(v, inst)))
      err('enum', () =>
        msg('toolsData.validate.enum', 'İzin verilen değerlerden biri olmalı: {values}', {
          values: (schema.enum as unknown[]).map((v) => short(v, 30)).join(', '),
        }),
      );
    if ('const' in schema && !deepEqual(schema.const, inst))
      err('const', () =>
        msg('toolsData.validate.const', 'Değer {value} olmalı.', { value: short(schema.const) }),
      );
    if (full()) return false;

    if (typeof inst === 'number') checkNumber(schema, inst, err);
    if (typeof inst === 'string') {
      if (typeof inst === 'string')
        checkString(schema, inst, err, (pattern) => regex(pattern, `#${sp}/pattern`), assertFormats);
    }

    if (Array.isArray(inst)) {
      const prefix = Array.isArray(schema.prefixItems)
        ? 'prefixItems'
        : Array.isArray(schema.items)
          ? 'items'
          : null;
      const restKey = prefix === 'items' ? 'additionalItems' : 'items';
      const tuple = prefix ? (schema[prefix] as unknown[]) : [];
      const rest = schema[restKey];
      for (let i = 0; i < inst.length && !full(); i++) {
        const key = i < tuple.length ? prefix! : rest !== undefined ? restKey : null;
        if (!key) break;
        if (key === restKey && rest === false) {
          err(restKey, () =>
            msg('toolsData.validate.maxTuple', 'En fazla {max} öğe olabilir ({count} var).', {
              max: String(tuple.length),
              count: String(inst.length),
            }),
          );
          break;
        }
        const loc = key === restKey ? child(restKey) : childAt(prefix!, i);
        if (!run(loc, inst[i], `${ip}/${i}`, sink, null)) ok = false;
        if (track) ann.items.add(i);
      }
      if (schema.contains !== undefined) {
        const min = typeof schema.minContains === 'number' ? schema.minContains : 1;
        let count = 0;
        for (let i = 0; i < inst.length; i++) {
          if (quick(child('contains'), inst[i], `${ip}/${i}`)) {
            count++;
            if (track) ann.items.add(i);
          }
        }
        if (count < min)
          err('contains', () =>
            min === 1
              ? msg('toolsData.validate.containsNone', '"contains" şemasına uyan öğe yok.')
              : msg(
                  'toolsData.validate.containsMin',
                  '"contains" şemasına uyan en az {min} öğe olmalı ({count} var).',
                  { min: String(min), count: String(count) },
                ),
          );
        if (typeof schema.maxContains === 'number' && count > schema.maxContains)
          err('maxContains', () =>
            msg(
              'toolsData.validate.containsMax',
              '"contains" şemasına uyan en fazla {max} öğe olmalı ({count} var).',
              { max: String(schema.maxContains), count: String(count) },
            ),
          );
      }
      checkArraySize(schema, inst, err);
      if (schema.uniqueItems === true) {
        const seen = new Map<string, number>();
        for (let i = 0; i < inst.length; i++) {
          ops++;
          const key = canonicalJson(inst[i]);
          const first = seen.get(key);
          if (first !== undefined) {
            err(
              'uniqueItems',
              () =>
                msg(
                  'toolsData.validate.uniqueItems',
                  'Öğeler benzersiz olmalı: {i}. öğe {first}. öğe ile aynı.',
                  { i: String(i), first: String(first) },
                ),
              `${ip}/${i}`,
            );
            break;
          }
          seen.set(key, i);
        }
      }
    }

    if (isObject(inst)) {
      const keys = Object.keys(inst);
      const props = isObject(schema.properties) ? schema.properties : null;
      const patterns = isObject(schema.patternProperties) ? Object.keys(schema.patternProperties) : [];
      if (Array.isArray(schema.required)) {
        for (const name of schema.required as string[])
          if (!Object.hasOwn(inst, name))
            err('required', () =>
              msg('toolsData.validate.required', 'Zorunlu alan eksik: "{name}"', { name }),
            );
      }
      for (const key of keys) {
        if (full()) break;
        const at = `${ip}/${escapePointer(key)}`;
        let matched = false;
        if (props && Object.hasOwn(props, key)) {
          matched = true;
          if (!run(childAt('properties', key), inst[key], at, sink, null)) ok = false;
        }
        for (const pattern of patterns) {
          if (!regex(pattern, `#${sp}/patternProperties`).test(key)) continue;
          matched = true;
          if (!run(childAt('patternProperties', pattern), inst[key], at, sink, null)) ok = false;
        }
        if (!matched && schema.additionalProperties !== undefined) {
          matched = true;
          if (schema.additionalProperties === false)
            err(
              'additionalProperties',
              () =>
                msg('toolsData.validate.additionalProperty', 'Ek alana izin verilmiyor: "{key}"', { key }),
              at,
            );
          else if (!run(child('additionalProperties'), inst[key], at, sink, null)) ok = false;
        }
        if (matched && track) ann.props.add(key);
        if (schema.propertyNames !== undefined && !quick(child('propertyNames'), key, at))
          err(
            'propertyNames',
            () => msg('toolsData.validate.propertyName', 'Alan adı uygun değil: "{key}"', { key }),
            at,
          );
      }
      checkObjectSize(schema, keys, err);
      for (const keyword of ['dependentRequired', 'dependentSchemas', 'dependencies']) {
        const deps = schema[keyword];
        if (!isObject(deps)) continue;
        for (const [name, dep] of Object.entries(deps)) {
          if (!Object.hasOwn(inst, name)) continue;
          if (Array.isArray(dep)) {
            for (const needed of dep as string[])
              if (!Object.hasOwn(inst, needed))
                err(keyword, () =>
                  msg('toolsData.validate.dependency', '"{name}" varsa "{needed}" de olmalı.', {
                    name,
                    needed,
                  }),
                );
          } else if (!run(childAt(keyword, name), inst, ip, sink, ann)) ok = false;
        }
      }
    }
    if (full()) return false;

    // Aynı veri konumuna uygulanan alt şemalar
    if (Array.isArray(schema.allOf)) {
      for (let i = 0; i < schema.allOf.length; i++)
        if (!run(childAt('allOf', i), inst, ip, sink, ann)) ok = false;
    }
    for (const keyword of ['anyOf', 'oneOf'] as const) {
      const options = schema[keyword];
      if (!Array.isArray(options)) continue;
      const valid: number[] = [];
      const failures: SchemaValidationError[][] = [];
      for (let i = 0; i < options.length; i++) {
        const branch: Sink = { errors: [], limit: sink.limit };
        const a = newAnn();
        if (run(childAt(keyword, i), inst, ip, branch, a)) {
          valid.push(i);
          if (keyword === 'anyOf' || valid.length === 1) merge(ann, a);
          if (keyword === 'anyOf' && !track) break;
        } else failures.push(branch.errors);
      }
      if (valid.length === 0) {
        err(keyword, () =>
          keyword === 'anyOf'
            ? msg('toolsData.validate.anyOf', 'Seçeneklerin (anyOf) hiçbirine uymuyor.')
            : msg('toolsData.validate.oneOfNone', 'Seçeneklerin (oneOf) hiçbirine uymuyor.'),
        );
        const closest = failures.reduce((best, e) => (e.length < best.length ? e : best), failures[0] ?? []);
        for (const e of closest) push(sink, e);
      } else if (keyword === 'oneOf' && valid.length > 1) {
        err('oneOf', () =>
          msg(
            'toolsData.validate.oneOfMany',
            'Yalnızca bir seçeneğe (oneOf) uymalı; {options}. seçeneklere uyuyor.',
            { options: valid.join(', ') },
          ),
        );
      }
    }
    if (schema.not !== undefined && quick(child('not'), inst, ip))
      err('not', () => msg('toolsData.validate.not', '"not" şemasına uymamalı.'));
    if (schema.if !== undefined) {
      const a = newAnn();
      if (quick(child('if'), inst, ip, a)) {
        merge(ann, a);
        if (schema.then !== undefined && !run(child('then'), inst, ip, sink, ann)) ok = false;
      } else if (schema.else !== undefined && !run(child('else'), inst, ip, sink, ann)) ok = false;
    }
    if (full()) return false;

    // Değerlendirilmeyen alan/öğeler en sonda: önceki tüm kuralların değerlendirdikleri bilinir.
    if (isObject(inst) && schema.unevaluatedProperties !== undefined) {
      for (const key of Object.keys(inst)) {
        if (ann.props.has(key)) continue;
        const at = `${ip}/${escapePointer(key)}`;
        if (schema.unevaluatedProperties === false)
          err(
            'unevaluatedProperties',
            () =>
              msg('toolsData.validate.unevaluatedProperty', 'Tanımlanmamış alana izin verilmiyor: "{key}"', {
                key,
              }),
            at,
          );
        else if (!run(child('unevaluatedProperties'), inst[key], at, sink, null)) ok = false;
        ann.props.add(key);
      }
    }
    if (Array.isArray(inst) && schema.unevaluatedItems !== undefined) {
      for (let i = 0; i < inst.length; i++) {
        if (ann.items.has(i)) continue;
        if (schema.unevaluatedItems === false) {
          err(
            'unevaluatedItems',
            () =>
              msg('toolsData.validate.unevaluatedItem', 'Tanımlanmamış öğeye izin verilmiyor ({i}. öğe).', {
                i: String(i),
              }),
            `${ip}/${i}`,
          );
          break;
        }
        if (!run(child('unevaluatedItems'), inst[i], `${ip}/${i}`, sink, null)) ok = false;
        ann.items.add(i);
      }
    }
    return finish();
  }

  const sink: Sink = { errors: [], limit: maxErrors + 1 };
  const startAt = start ? pointerIn(rootLocated, start, `#${start}`) : rootLocated;
  let valid: boolean;
  try {
    valid = validate(startAt, data, '', sink, null, rootLocated, 0);
  } catch (error) {
    // `uniqueItems` / `const` karşılaştırmaları veriye derinlik sınırı olmadan iner.
    if (error instanceof RangeError)
      throw new ToolError(msg('toolsData.validate.tooDeep', 'Şema ya da veri çok derin iç içe.'));
    throw error;
  }
  const truncated = sink.errors.length > maxErrors;
  return {
    valid,
    errors: sink.errors.slice(0, maxErrors),
    truncated,
    draft,
    notes: [...notes],
  };
}
