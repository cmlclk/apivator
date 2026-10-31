import type { ModelClass, ModelEnum, ModelSet, TypeRef } from './ir';
import {
  classes,
  commentLines,
  dependencyOrder,
  fieldIdentifiers,
  header,
  rootTypeNote,
  typeDeps,
  type GeneratedFile,
  type ModelOptions,
} from './common';
import { snakeCase, uniqueName } from './naming';

const rootFileName = (set: ModelSet) =>
  set.root.kind === 'class' ? set.root.name : (set.types[0]?.name ?? 'models');
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** TypeScript arayüzleri; istenirse zod şemaları (tip `z.infer` ile). Tarihler ISO metni olarak `string`. */
export function generateTypeScript(set: ModelSet, options: ModelOptions): GeneratedFile[] {
  return options.typescript?.zod ? zodFile(set) : interfacesFile(set);
}

function interfacesFile(set: ModelSet): GeneratedFile[] {
  const { typeName, renderType } = interfaceRenderer();
  const body: string[] = [];
  for (const type of set.types) {
    if (body.length) body.push('');
    body.push(...renderType(type));
  }
  const root =
    set.root.kind !== 'class' ? ['', `export type ${rootAlias(set)} = ${typeName(set.root)};`] : [];
  return [
    { name: `${rootFileName(set)}.ts`, content: [`// ${header()}`, '', ...body, ...root, ''].join('\n') },
  ];
}

function interfaceRenderer() {
  const typeName = (type: TypeRef): string => {
    switch (type.kind) {
      case 'primitive':
        return {
          string: 'string',
          integer: 'number',
          long: 'number',
          number: 'number',
          boolean: 'boolean',
          date: 'string',
          datetime: 'string',
          uuid: 'string',
          any: 'unknown',
        }[type.type];
      case 'array': {
        const inner = typeName(type.items);
        return /[|&]/.test(inner) ? `Array<${inner}>` : `${inner}[]`;
      }
      case 'map':
        return `Record<string, ${typeName(type.values)}>`;
      default:
        return type.name;
    }
  };
  const formatNote = (type: TypeRef) =>
    type.kind === 'primitive' && ['date', 'datetime', 'uuid'].includes(type.type)
      ? ` // ${{ date: 'tarih (YYYY-MM-DD)', datetime: 'ISO 8601 tarih-saat', uuid: 'UUID' }[type.type as 'date']}`
      : '';
  const doc = (text: string | undefined, pad: string) => {
    const lines = commentLines(text);
    return lines.length ? [`${pad}/** ${lines.join(' ')} */`] : [];
  };

  /** `optionalUndefined`: zod'un çıkardığı tiple (`a?: T | undefined`) exactOptionalPropertyTypes'ta da uyumlu. */
  const renderType = (type: ModelClass | ModelEnum, optionalUndefined = false): string[] => {
    if (type.kind === 'enum') {
      return [
        ...doc(type.description, ''),
        `export type ${type.name} = ${type.values.map((v) => JSON.stringify(v)).join(' | ')};`,
      ];
    }
    const lines = [...doc(type.description, ''), `export interface ${type.name} {`];
    for (const f of type.fields) {
      lines.push(...doc(f.description, '  '));
      const key = IDENTIFIER.test(f.name) ? f.name : JSON.stringify(f.name);
      const extra = `${f.nullable ? ' | null' : ''}${f.optional && optionalUndefined ? ' | undefined' : ''}`;
      lines.push(`  ${key}${f.optional ? '?' : ''}: ${typeName(f.type)}${extra};${formatNote(f.type)}`);
    }
    lines.push('}');
    return lines;
  };
  return { typeName, renderType };
}

function rootAlias(set: ModelSet) {
  const used = new Set(set.types.map((t) => t.name));
  return uniqueName('Root', used);
}

function zodFile(set: ModelSet): GeneratedFile[] {
  // Kullanılan şema önce tanımlanmalı; döngüdekiler z.lazy ile.
  const ordered = dependencyOrder(set.types, (t) =>
    t.kind === 'class' ? t.fields.flatMap((f) => typeDeps(f.type)) : [],
  );
  const defined = new Set<string>();
  const interfaces = interfaceRenderer();
  const schema = (type: TypeRef): string => {
    switch (type.kind) {
      case 'primitive':
        return {
          string: 'z.string()',
          integer: 'z.number().int()',
          long: 'z.number().int()',
          number: 'z.number()',
          boolean: 'z.boolean()',
          date: 'z.string().date()',
          datetime: 'z.string().datetime({ offset: true })',
          uuid: 'z.string().uuid()',
          any: 'z.unknown()',
        }[type.type];
      case 'array':
        return `z.array(${schema(type.items)})`;
      case 'map':
        return `z.record(z.string(), ${schema(type.values)})`;
      default:
        return defined.has(type.name) ? `${type.name}Schema` : `z.lazy(() => ${type.name}Schema)`;
    }
  };

  const body: string[] = [];
  for (const type of ordered) {
    if (body.length) body.push('');
    if (type.kind === 'enum') {
      body.push(
        `export const ${type.name}Schema = z.enum([${type.values.map((v) => JSON.stringify(v)).join(', ')}]);`,
      );
    } else {
      // Döngüdeki şemanın tipi çıkarılamaz: arayüz ayrıca yazılır ve şema onunla işaretlenir.
      const cyclic = type.fields.some((f) => typeDeps(f.type).some((d) => !defined.has(d)));
      if (cyclic) body.push(...interfaces.renderType(type, true), '');
      body.push(`export const ${type.name}Schema${cyclic ? `: z.ZodType<${type.name}>` : ''} = z.object({`);
      for (const f of type.fields) {
        const key = IDENTIFIER.test(f.name) ? f.name : JSON.stringify(f.name);
        body.push(
          `  ${key}: ${schema(f.type)}${f.nullable ? '.nullable()' : ''}${f.optional ? '.optional()' : ''},`,
        );
      }
      body.push('});');
      if (cyclic) {
        defined.add(type.name);
        continue;
      }
    }
    body.push(`export type ${type.name} = z.infer<typeof ${type.name}Schema>;`);
    defined.add(type.name);
  }
  const root =
    set.root.kind !== 'class'
      ? [
          '',
          `export const ${rootAlias(set)}Schema = ${schema(set.root)};`,
          `export type ${rootAlias(set)} = z.infer<typeof ${rootAlias(set)}Schema>;`,
        ]
      : [];
  return [
    {
      name: `${rootFileName(set)}.ts`,
      content: [`// ${header()}`, "import { z } from 'zod';", '', ...body, ...root, ''].join('\n'),
    },
  ];
}

/**
 * Python: Pydantic v2 modelleri (alias ile JSON adı) ya da `dataclass` + `from_dict`. Pydantic'te tarih, saat
 * ve UUID kendi tipinde; dataclass'ta metin olarak kalır.
 */
export function generatePython(set: ModelSet, options: ModelOptions): GeneratedFile[] {
  const pydantic = (options.python?.style ?? 'pydantic') === 'pydantic';
  const imports = {
    datetime: new Set<string>(),
    typing: new Set<string>(['Any']),
    uuid: false,
    enum: false,
    decimal: false,
  };

  const typeName = (type: TypeRef): string => {
    switch (type.kind) {
      case 'primitive':
        switch (type.type) {
          case 'string':
            return 'str';
          case 'integer':
          case 'long':
            return 'int';
          case 'number':
            if (options.decimal && pydantic) {
              imports.decimal = true;
              return 'Decimal';
            }
            return 'float';
          case 'boolean':
            return 'bool';
          case 'date':
            if (!pydantic) return 'str';
            imports.datetime.add('date');
            return 'date';
          case 'datetime':
            if (!pydantic) return 'str';
            imports.datetime.add('datetime');
            return 'datetime';
          case 'uuid':
            if (!pydantic) return 'str';
            imports.uuid = true;
            return 'UUID';
          case 'any':
            return 'Any';
        }
        break;
      case 'array':
        return `list[${typeName(type.items)}]`;
      case 'map':
        return `dict[str, ${typeName(type.values)}]`;
      default:
        return type.name;
    }
  };

  const ordered = dependencyOrder(set.types, (t) =>
    t.kind === 'class' ? t.fields.flatMap((f) => typeDeps(f.type)) : [],
  );
  const body: string[] = [];
  const doc = (text: string | undefined, pad: string) => {
    const lines = commentLines(text);
    return lines.length ? [`${pad}"""${lines.join(' ').replace(/"""/g, "'''")}"""`, ''] : [];
  };

  const renderEnum = (model: ModelEnum) => {
    imports.enum = true;
    const used = new Set<string>();
    return [
      `class ${model.name}(str, Enum):`,
      ...doc(model.description, '    '),
      ...model.values.map((v) => {
        let name = uniqueName(snakeCase(v, 'value').toUpperCase(), used);
        if (/^[0-9]/.test(name)) name = `V_${name}`;
        return `    ${name} = ${JSON.stringify(v)}`;
      }),
    ];
  };

  const renderPydantic = (model: ModelClass) => {
    const names = fieldIdentifiers(
      model.fields,
      (n) => snakeCase(n),
      'python',
      (n) => `${n}_`,
      ['model_config'],
    );
    const lines = [
      `class ${model.name}(BaseModel):`,
      ...doc(model.description, '    '),
      '    model_config = ConfigDict(populate_by_name=True)',
      '',
    ];
    model.fields.forEach((f, i) => {
      let annotation = typeName(f.type);
      if (f.nullable || f.optional) {
        imports.typing.add('Optional');
        annotation = `Optional[${annotation}]`;
      }
      const args: string[] = [];
      if (f.optional) args.push('default=None');
      if (names[i] !== f.name) args.push(`alias=${JSON.stringify(f.name)}`);
      if (f.description) args.push(`description=${JSON.stringify(commentLines(f.description).join(' '))}`);
      const assigned =
        args.length === 1 && args[0] === 'default=None'
          ? ' = None'
          : args.length
            ? ` = Field(${args.join(', ')})`
            : '';
      lines.push(`    ${names[i]}: ${annotation}${assigned}`);
    });
    return lines;
  };

  const renderDataclass = (model: ModelClass) => {
    const names = fieldIdentifiers(
      model.fields,
      (n) => snakeCase(n),
      'python',
      (n) => `${n}_`,
      ['from_dict', 'to_dict'],
    );
    // Varsayılanı olmayan alanlar önce gelmeli.
    const order = model.fields
      .map((f, i) => ({ f, name: names[i]! }))
      .sort((a, b) => Number(a.f.optional) - Number(b.f.optional));
    const lines = ['@dataclass', `class ${model.name}:`, ...doc(model.description, '    ')];
    for (const { f, name } of order) {
      let annotation = typeName(f.type);
      if (f.nullable || f.optional) {
        imports.typing.add('Optional');
        annotation = `Optional[${annotation}]`;
      }
      lines.push(`    ${name}: ${annotation}${f.optional ? ' = None' : ''}`);
    }
    const convert = (type: TypeRef, expr: string): string => {
      switch (type.kind) {
        case 'class':
          return `${type.name}.from_dict(${expr})`;
        case 'enum':
          return `${type.name}(${expr})`;
        case 'array': {
          const inner = convert(type.items, 'x');
          return inner === 'x' ? expr : `[${inner} for x in ${expr}]`;
        }
        case 'map': {
          const inner = convert(type.values, 'v');
          return inner === 'v' ? expr : `{k: ${inner} for k, v in ${expr}.items()}`;
        }
        default:
          return expr;
      }
    };
    lines.push(
      '',
      '    @staticmethod',
      `    def from_dict(data: dict[str, Any]) -> ${model.name}:`,
      `        return ${model.name}(`,
    );
    for (const { f, name } of order) {
      const access = f.optional ? `data.get(${JSON.stringify(f.name)})` : `data[${JSON.stringify(f.name)}]`;
      const converted = convert(f.type, 'v');
      const value =
        converted === 'v'
          ? access
          : f.nullable || f.optional
            ? `_optional(${access}, lambda v: ${converted})`
            : convert(f.type, access);
      lines.push(`            ${name}=${value},`);
    }
    lines.push('        )');
    return lines;
  };

  for (const type of ordered) {
    if (body.length) body.push('', '');
    body.push(
      ...(type.kind === 'enum' ? renderEnum(type) : pydantic ? renderPydantic(type) : renderDataclass(type)),
    );
  }
  const needsOptionalHelper = !pydantic && body.some((l) => l.includes('_optional('));

  const fileHeader = [
    `# ${header()}`,
    'from __future__ import annotations',
    '',
    ...(!pydantic ? ['from dataclasses import dataclass'] : []),
    ...(imports.datetime.size ? [`from datetime import ${[...imports.datetime].sort().join(', ')}`] : []),
    ...(imports.decimal ? ['from decimal import Decimal'] : []),
    ...(imports.enum ? ['from enum import Enum'] : []),
    `from typing import ${[...imports.typing, ...(needsOptionalHelper ? ['Callable', 'TypeVar'] : [])].sort().join(', ')}`,
    ...(imports.uuid ? ['from uuid import UUID'] : []),
    ...(pydantic ? ['', 'from pydantic import BaseModel, ConfigDict, Field'] : []),
    '',
  ];
  const helper = needsOptionalHelper
    ? [
        '',
        "T = TypeVar('T')",
        '',
        '',
        'def _optional(value: Any, convert: Callable[[Any], T]) -> Optional[T]:',
        '    return None if value is None else convert(value)',
      ]
    : [];
  const rebuild =
    pydantic && classes(set).length
      ? ['', '', ...dependencyOrder(classes(set), () => []).map((c) => `${c.name}.model_rebuild()`)]
      : [];
  const root = set.root.kind !== 'class' ? ['', '', `# ${rootTypeNote(typeName(set.root))}`] : [];

  return [
    {
      name: `${snakeCase(rootFileName(set), 'models')}.py`,
      content: [
        ...fileHeader,
        ...helper,
        ...(helper.length ? ['', ''] : ['']),
        ...body,
        ...rebuild,
        ...root,
        '',
      ].join('\n'),
    },
  ];
}
