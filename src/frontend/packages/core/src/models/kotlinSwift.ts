import { msg } from '../i18n';
import { usesPrimitive, type ModelClass, type ModelEnum, type ModelSet, type TypeRef } from './ir';
import {
  commentLines,
  fieldIdentifiers,
  header,
  rootTypeNote,
  type GeneratedFile,
  type ModelOptions,
} from './common';
import { camelCase, snakeCase, uniqueName } from './naming';

/** Kotlin ve Swift dizelerinde `$` / `\(` kaçışlı sabit. */
const kotlinString = (text: string) => JSON.stringify(text).replace(/\$/g, '\\$');
const swiftString = (text: string) => JSON.stringify(text).replace(/\\u([0-9a-fA-F]{4})/g, '\\u{$1}');

const rootFileName = (set: ModelSet, extension: string) =>
  `${set.root.kind === 'class' ? set.root.name : (set.types[0]?.name ?? 'Models')}.${extension}`;

/**
 * Kotlin data class (kotlinx.serialization). Tarih ve GUID'ler `String` olarak gelir (kotlinx'te yerleşik
 * serileştirici yok); `any` için `JsonElement`.
 */
export function generateKotlin(set: ModelSet, options: ModelOptions): GeneratedFile[] {
  const pkg = options.namespace?.trim();
  const typeName = (type: TypeRef): string => {
    switch (type.kind) {
      case 'primitive':
        return {
          string: 'String',
          integer: 'Int',
          long: 'Long',
          number: 'Double',
          boolean: 'Boolean',
          date: 'String',
          datetime: 'String',
          uuid: 'String',
          any: 'JsonElement',
        }[type.type];
      case 'array':
        return `List<${typeName(type.items)}>`;
      case 'map':
        return `Map<String, ${typeName(type.values)}>`;
      default:
        return type.name;
    }
  };
  const kdoc = (text: string | undefined, pad: string) => {
    const lines = commentLines(text);
    return lines.length ? [`${pad}/**`, ...lines.map((l) => `${pad} * ${l}`), `${pad} */`] : [];
  };

  const renderClass = (model: ModelClass) => {
    const names = fieldIdentifiers(
      model.fields,
      (n) => camelCase(n),
      'kotlin',
      (n) => `\`${n}\``,
    );
    return [
      ...kdoc(model.description, ''),
      '@Serializable',
      `data class ${model.name}(`,
      ...model.fields.map((f, i) => {
        const nullable = f.nullable || f.optional;
        const comment = commentLines(f.description);
        return `${comment.length ? `    // ${comment.join(' ')}\n` : ''}    @SerialName(${kotlinString(f.name)}) val ${names[i]}: ${typeName(f.type)}${nullable ? '? = null' : ''},`;
      }),
      ')',
    ];
  };
  const renderEnum = (model: ModelEnum) => {
    const used = new Set<string>();
    return [
      ...kdoc(model.description, ''),
      '@Serializable',
      `enum class ${model.name} {`,
      ...model.values.map(
        (v) =>
          `    @SerialName(${kotlinString(v)}) ${uniqueName(snakeCase(v, 'value').toUpperCase(), used)},`,
      ),
      '}',
    ];
  };

  const body: string[] = [];
  for (const type of set.types) {
    if (body.length) body.push('');
    body.push(...(type.kind === 'class' ? renderClass(type) : renderEnum(type)));
  }
  const content = [
    `// ${header()}`,
    ...(pkg ? [`package ${pkg}`, ''] : []),
    'import kotlinx.serialization.SerialName',
    'import kotlinx.serialization.Serializable',
    ...(usesPrimitive(set, 'any') ? ['import kotlinx.serialization.json.JsonElement'] : []),
    '',
    ...(set.root.kind !== 'class' ? [`// ${rootTypeNote(typeName(set.root))}`, ''] : []),
    ...body,
    '',
  ].join('\n');
  return [{ name: rootFileName(set, 'kt'), content }];
}

/** Swift `Codable` struct'lar. Tarihler `String` (decoder stratejisine bağlı kalmamak için), GUID `UUID`. */
export function generateSwift(set: ModelSet, options: ModelOptions): GeneratedFile[] {
  const typeName = (type: TypeRef): string => {
    switch (type.kind) {
      case 'primitive':
        return {
          string: 'String',
          integer: 'Int',
          long: 'Int64',
          number: options.decimal ? 'Decimal' : 'Double',
          boolean: 'Bool',
          date: 'String',
          datetime: 'String',
          uuid: 'UUID',
          any: 'JSONValue',
        }[type.type];
      case 'array':
        return `[${typeName(type.items)}]`;
      case 'map':
        return `[String: ${typeName(type.values)}]`;
      default:
        return type.name;
    }
  };
  const doc = (text: string | undefined, pad: string) => commentLines(text).map((l) => `${pad}/// ${l}`);

  // Kendini (doğrudan ya da başka bir struct üzerinden) içeren tipler struct olamaz: final class.
  const recursive = recursiveClasses(set);
  const renderClass = (model: ModelClass) => {
    const names = fieldIdentifiers(
      model.fields,
      (n) => camelCase(n),
      'swift',
      (n) => `\`${n}\``,
    );
    const lines = [
      ...doc(model.description, ''),
      `${recursive.has(model.name) ? 'final class' : 'struct'} ${model.name}: Codable {`,
    ];
    model.fields.forEach((f, i) => {
      lines.push(...doc(f.description, '    '));
      lines.push(`    let ${names[i]}: ${typeName(f.type)}${f.nullable || f.optional ? '?' : ''}`);
    });
    if (model.fields.some((f, i) => names[i]!.replace(/`/g, '') !== f.name)) {
      lines.push('', '    enum CodingKeys: String, CodingKey {');
      model.fields.forEach((f, i) => {
        const bare = names[i]!.replace(/`/g, '');
        lines.push(
          bare === f.name ? `        case ${names[i]}` : `        case ${names[i]} = ${swiftString(f.name)}`,
        );
      });
      lines.push('    }');
    }
    lines.push('}');
    return lines;
  };
  const renderEnum = (model: ModelEnum) => {
    const used = new Set<string>();
    return [
      ...doc(model.description, ''),
      `enum ${model.name}: String, Codable {`,
      ...model.values.map((v) => {
        const name = uniqueName(camelCase(v, 'value'), used);
        return `    case ${['default', 'case', 'class', 'struct', 'enum', 'let', 'var', 'func', 'in', 'is', 'self'].includes(name) ? `\`${name}\`` : name} = ${swiftString(v)}`;
      }),
      '}',
    ];
  };

  const body: string[] = [];
  for (const type of set.types) {
    if (body.length) body.push('');
    body.push(...(type.kind === 'class' ? renderClass(type) : renderEnum(type)));
  }
  const content = [
    `// ${header()}`,
    'import Foundation',
    '',
    ...(set.root.kind !== 'class' ? [`// ${rootTypeNote(typeName(set.root))}`, ''] : []),
    ...body,
    ...(usesPrimitive(set, 'any') ? ['', ...jsonValueSwift()] : []),
    '',
  ].join('\n');
  return [{ name: rootFileName(set, 'swift'), content }];
}

/** Tipi bilinmeyen değerler için küçük bir Codable yardımcı. */
const jsonValueSwift = () => [
  `/// ${msg('core.models.jsonValueDoc', 'Tipi önceden bilinmeyen JSON değeri.')}`,
  'enum JSONValue: Codable {',
  '    case string(String)',
  '    case number(Double)',
  '    case bool(Bool)',
  '    case object([String: JSONValue])',
  '    case array([JSONValue])',
  '    case null',
  '',
  '    init(from decoder: Decoder) throws {',
  '        let container = try decoder.singleValueContainer()',
  '        if container.decodeNil() { self = .null }',
  '        else if let value = try? container.decode(Bool.self) { self = .bool(value) }',
  '        else if let value = try? container.decode(Double.self) { self = .number(value) }',
  '        else if let value = try? container.decode(String.self) { self = .string(value) }',
  '        else if let value = try? container.decode([JSONValue].self) { self = .array(value) }',
  '        else { self = .object(try container.decode([String: JSONValue].self)) }',
  '    }',
  '',
  '    func encode(to encoder: Encoder) throws {',
  '        var container = encoder.singleValueContainer()',
  '        switch self {',
  '        case .string(let value): try container.encode(value)',
  '        case .number(let value): try container.encode(value)',
  '        case .bool(let value): try container.encode(value)',
  '        case .object(let value): try container.encode(value)',
  '        case .array(let value): try container.encode(value)',
  '        case .null: try container.encodeNil()',
  '        }',
  '    }',
  '}',
];

/** Dizi/sözlük dışından kendine ulaşan sınıflar (Swift'te değer tipi olamazlar). */
function recursiveClasses(set: ModelSet): Set<string> {
  const direct = new Map<string, string[]>();
  for (const type of set.types) {
    if (type.kind === 'class') {
      direct.set(
        type.name,
        type.fields.flatMap((f) => (f.type.kind === 'class' ? [f.type.name] : [])),
      );
    }
  }
  const result = new Set<string>();
  for (const start of direct.keys()) {
    const stack = [...(direct.get(start) ?? [])];
    const seen = new Set<string>();
    while (stack.length) {
      const next = stack.pop()!;
      if (next === start) {
        result.add(start);
        break;
      }
      if (seen.has(next)) continue;
      seen.add(next);
      stack.push(...(direct.get(next) ?? []));
    }
  }
  return result;
}
