import type { ModelClass, ModelEnum, ModelSet, TypeRef } from './ir';
import {
  classes,
  commentLines,
  enums,
  fieldIdentifiers,
  header,
  rootTypeNote,
  quote,
  type GeneratedFile,
  type ModelOptions,
} from './common';
import { pascalCase, uniqueName } from './naming';

/** C#: sınıf ya da positional record; System.Text.Json ya da Newtonsoft.Json öznitelikleri; nullable açık. */
export function generateCSharp(set: ModelSet, options: ModelOptions): GeneratedFile[] {
  const style = options.csharp?.style ?? 'class';
  const newtonsoft = options.csharp?.serializer === 'newtonsoft';
  const attr = (name: string) =>
    newtonsoft ? `JsonProperty(${quote(name)})` : `JsonPropertyName(${quote(name)})`;
  let usesJsonValue = false;
  let usesCollections = false;

  const typeName = (type: TypeRef): string => {
    switch (type.kind) {
      case 'primitive':
        switch (type.type) {
          case 'string':
            return 'string';
          case 'integer':
            return 'int';
          case 'long':
            return 'long';
          case 'number':
            return options.decimal ? 'decimal' : 'double';
          case 'boolean':
            return 'bool';
          case 'date':
            return 'DateOnly';
          case 'datetime':
            return 'DateTimeOffset';
          case 'uuid':
            return 'Guid';
          case 'any':
            usesJsonValue = true;
            return newtonsoft ? 'JToken' : 'JsonElement';
        }
        break;
      case 'array':
        usesCollections = true;
        return `List<${typeName(type.items)}>`;
      case 'map':
        usesCollections = true;
        return `Dictionary<string, ${typeName(type.values)}>`;
      default:
        return type.name;
    }
  };

  /** Boş bırakılamayan başvuru tipleri için başlangıç değeri (nullable uyarısı olmasın). */
  const initializer = (type: TypeRef, nullable: boolean): string => {
    if (nullable) return '';
    if (type.kind === 'primitive')
      return type.type === 'string'
        ? ' = string.Empty;'
        : type.type === 'any' && newtonsoft
          ? ' = JValue.CreateNull();'
          : '';
    if (type.kind === 'array' || type.kind === 'map' || type.kind === 'class') return ' = new();';
    return '';
  };

  const summary = (text: string | undefined, pad: string) => {
    const lines = commentLines(text);
    return lines.length
      ? [
          `${pad}/// <summary>`,
          ...lines.map((l) => `${pad}/// ${l.replace(/&/g, '&amp;').replace(/</g, '&lt;')}`),
          `${pad}/// </summary>`,
        ]
      : [];
  };

  const renderClass = (model: ModelClass): string[] => {
    const names = fieldIdentifiers(
      model.fields,
      (n) => pascalCase(n),
      'csharp',
      (n) => `@${n}`,
      [model.name],
    );
    const lines = [...summary(model.description, '')];
    if (style === 'record') {
      lines.push(`public sealed record ${model.name}(`);
      model.fields.forEach((field, i) => {
        const nullable = field.nullable || field.optional;
        const doc = commentLines(field.description);
        if (doc.length) lines.push(`    // ${doc.join(' ')}`);
        lines.push(
          `    [property: ${attr(field.name)}] ${typeName(field.type)}${nullable ? '?' : ''} ${names[i]}${i < model.fields.length - 1 ? ',' : ');'}`,
        );
      });
      return lines;
    }
    lines.push(`public sealed class ${model.name}`, '{');
    model.fields.forEach((field, i) => {
      const nullable = field.nullable || field.optional;
      if (i > 0) lines.push('');
      lines.push(...summary(field.description, '    '));
      lines.push(`    [${attr(field.name)}]`);
      lines.push(
        `    public ${typeName(field.type)}${nullable ? '?' : ''} ${names[i]} { get; set; }${initializer(field.type, nullable)}`,
      );
    });
    lines.push('}');
    return lines;
  };

  const renderEnum = (model: ModelEnum): string[] => {
    const used = new Set<string>();
    const members = model.values.map((v) => uniqueName(pascalCase(v, 'Value'), used));
    const lines = [...summary(model.description, '')];
    lines.push(
      newtonsoft
        ? '[JsonConverter(typeof(StringEnumConverter))]'
        : `[JsonConverter(typeof(JsonStringEnumConverter<${model.name}>))]`,
    );
    lines.push(`public enum ${model.name}`, '{');
    model.values.forEach((value, i) => {
      // JSON değeri üye adından farklıysa açıkça yazılır (System.Text.Json: .NET 9+).
      if (members[i] !== value)
        lines.push(
          newtonsoft
            ? `    [EnumMember(Value = ${quote(value)})]`
            : `    [JsonStringEnumMemberName(${quote(value)})]`,
        );
      lines.push(`    ${members[i]},`);
    });
    lines.push('}');
    return lines;
  };

  const body: string[] = [];
  for (const type of set.types) {
    if (body.length) body.push('');
    body.push(...(type.kind === 'class' ? renderClass(type) : renderEnum(type)));
  }
  const rootNote = set.root.kind !== 'class' ? [`// ${rootTypeNote(typeName(set.root))}`, ''] : [];

  const usings = [
    ...(usesCollections ? ['using System.Collections.Generic;'] : []),
    ...(newtonsoft && enums(set).length ? ['using System.Runtime.Serialization;'] : []),
    ...(newtonsoft
      ? [
          'using Newtonsoft.Json;',
          ...(usesJsonValue ? ['using Newtonsoft.Json.Linq;'] : []),
          ...(enums(set).length ? ['using Newtonsoft.Json.Converters;'] : []),
        ]
      : [...(usesJsonValue ? ['using System.Text.Json;'] : []), 'using System.Text.Json.Serialization;']),
  ];
  const namespace = options.namespace?.trim();
  const content = [
    `// <auto-generated> ${header()} </auto-generated>`,
    '#nullable enable',
    '',
    'using System;',
    ...usings,
    '',
    ...(namespace ? [`namespace ${namespace};`, ''] : []),
    ...rootNote,
    ...body,
    '',
  ].join('\n');
  return [
    {
      name: `${(set.root.kind === 'class' ? set.root.name : classes(set)[0]?.name) ?? 'Models'}.cs`,
      content,
    },
  ];
}
