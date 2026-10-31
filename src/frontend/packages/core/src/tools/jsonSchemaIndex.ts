/** JSON Schema doğrulayıcısının şema hazırlığı: sürüm tespiti, OpenAPI şeması seçimi, `$id` / `$anchor` dizini. */
import { isOpenApiDocument, openApiSchemaNames } from '../models/schema';
import { ToolError } from './errors';
import { msg } from '../i18n';
import { escapePointer, isObject } from './jsonSchemaValidateHelpers';

/** Şema ve veri iç içe derinliği (JS yığın taşmasına karşı). */
export const MAX_DEPTH = 500;
/** Şema dizinlenirken gezilecek en fazla düğüm. */
const MAX_INDEX_NODES = 200_000;
/** Veri sayılan anahtarlar: şema içermez, dizinlenmez. */
const DATA_KEYS = new Set(['const', 'enum', 'examples', 'example', 'default']);

export interface Located {
  schema: Record<string, unknown> | boolean;
  /** Kökten JSON pointer ('' kök). */
  path: string;
}

export function decodePointer(raw: string, ref: string): string {
  try {
    return decodeURIComponent(raw).replace(/~1/g, '/').replace(/~0/g, '~');
  } catch {
    throw new ToolError(msg('toolsData.schema.unresolvedRef', 'Çözülemeyen başvuru: {ref}', { ref }));
  }
}

/** Kök belge: sürüm tespiti ve OpenAPI belgesinde doğrulanacak şemanın yolu. */
export function prepareSchema(doc: unknown, draftOption: string | undefined, schemaName: string | undefined) {
  if (!isObject(doc) && typeof doc !== 'boolean')
    throw new ToolError(msg('toolsData.schema.mustBeObject', 'Şema bir JSON nesnesi olmalı.'));
  const forced = draftOption === '2020-12' || draftOption === '07' ? draftOption : null;
  if (isObject(doc) && isOpenApiDocument(doc)) {
    const names = openApiSchemaNames(doc);
    if (!names.length)
      throw new ToolError(
        msg('toolsData.schema.noOpenApiSchemas', 'OpenAPI belgesinde şema (components.schemas) yok.'),
      );
    const name = schemaName && names.includes(schemaName) ? schemaName : names[0]!;
    const base =
      isObject(doc.components) && isObject(doc.components.schemas) ? '/components/schemas' : '/definitions';
    const v31 = typeof doc.openapi === 'string' && doc.openapi.startsWith('3.1');
    const draft = forced ?? (v31 ? '2020-12' : '07');
    return { draft, start: `${base}/${escapePointer(name)}`, openApi: true } as const;
  }
  let draft: '2020-12' | '07' = forced ?? '2020-12';
  if (!forced && isObject(doc) && typeof doc.$schema === 'string' && /draft-0[3-7]/.test(doc.$schema))
    draft = '07';
  return { draft, start: '', openApi: false } as const;
}

/** Şema ağacını gezer: `$id`, `$anchor` ve `unevaluated*` kullanımını toplar. */
export function indexSchema(root: unknown) {
  const ids = new Map<string, Located>();
  const anchors = new Map<string, Located>();
  let track = false;
  let nodes = 0;
  const notes = new Set<string>();
  const visit = (node: unknown, path: string, depth: number) => {
    if (++nodes > MAX_INDEX_NODES || depth > MAX_DEPTH)
      throw new ToolError(msg('toolsData.schema.tooBig', 'Şema çok büyük ya da çok derin.'));
    if (Array.isArray(node)) {
      node.forEach((child, i) => visit(child, `${path}/${i}`, depth + 1));
      return;
    }
    if (!isObject(node)) return;
    const here: Located = { schema: node, path };
    if (typeof node.$id === 'string') {
      if (node.$id.startsWith('#')) anchors.set(node.$id.slice(1), here);
      else ids.set(node.$id.replace(/#$/, ''), here);
    }
    if (typeof node.$anchor === 'string') anchors.set(node.$anchor, here);
    if (typeof node.$dynamicAnchor === 'string' && !anchors.has(node.$dynamicAnchor))
      anchors.set(node.$dynamicAnchor, here);
    if ('unevaluatedProperties' in node || 'unevaluatedItems' in node) track = true;
    if ('$dynamicRef' in node || '$recursiveRef' in node)
      notes.add(
        msg(
          'toolsData.schema.dynamicRefNote',
          '$dynamicRef / $recursiveRef dinamik kapsam olmadan, $ref gibi çözülür.',
        ),
      );
    for (const [key, child] of Object.entries(node)) {
      if (!DATA_KEYS.has(key)) visit(child, `${path}/${escapePointer(key)}`, depth + 1);
    }
  };
  visit(root, '', 0);
  return { ids, anchors, track, notes };
}
