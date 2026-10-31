import type { ModelClass, ModelEnum, ModelSet, TypeRef } from './ir';
import {
  commentLines,
  fieldIdentifiers,
  header,
  quote,
  type GeneratedFile,
  type ModelOptions,
} from './common';
import { camelCase, snakeCase, uniqueName } from './naming';

/**
 * Java (Jackson): her tip ayrı dosya. POJO (getter/setter ya da Lombok) veya record (Java 16+).
 * java.time tipleri için ObjectMapper'a `JavaTimeModule` (jackson-datatype-jsr310) kaydedilmelidir.
 */
export function generateJava(set: ModelSet, options: ModelOptions): GeneratedFile[] {
  const style = options.java?.style ?? 'class';
  const lombok = style === 'class' && (options.java?.lombok ?? false);
  const pkg = options.namespace?.trim();

  const files: GeneratedFile[] = [];
  for (const type of set.types) {
    const imports = new Set<string>();
    const typeName = (t: TypeRef, boxed: boolean): string => {
      switch (t.kind) {
        case 'primitive':
          switch (t.type) {
            case 'string':
              return 'String';
            case 'integer':
              return boxed ? 'Integer' : 'int';
            case 'long':
              return boxed ? 'Long' : 'long';
            case 'number':
              if (options.decimal) {
                imports.add('java.math.BigDecimal');
                return 'BigDecimal';
              }
              return boxed ? 'Double' : 'double';
            case 'boolean':
              return boxed ? 'Boolean' : 'boolean';
            case 'date':
              imports.add('java.time.LocalDate');
              return 'LocalDate';
            case 'datetime':
              imports.add('java.time.OffsetDateTime');
              return 'OffsetDateTime';
            case 'uuid':
              imports.add('java.util.UUID');
              return 'UUID';
            case 'any':
              imports.add('com.fasterxml.jackson.databind.JsonNode');
              return 'JsonNode';
          }
          break;
        case 'array':
          imports.add('java.util.List');
          return `List<${typeName(t.items, true)}>`;
        case 'map':
          imports.add('java.util.Map');
          return `Map<String, ${typeName(t.values, true)}>`;
        default:
          return t.name;
      }
    };

    const javadoc = (text: string | undefined, pad: string) => {
      const lines = commentLines(text);
      return lines.length ? [`${pad}/**`, ...lines.map((l) => `${pad} * ${l}`), `${pad} */`] : [];
    };

    let body: string[];
    if (type.kind === 'enum') {
      body = renderEnum(type, javadoc);
      imports.add('com.fasterxml.jackson.annotation.JsonProperty');
    } else {
      imports.add('com.fasterxml.jackson.annotation.JsonIgnoreProperties');
      imports.add('com.fasterxml.jackson.annotation.JsonProperty');
      body = renderClass(type, typeName, javadoc);
      if (lombok) {
        imports.add('lombok.AllArgsConstructor');
        imports.add('lombok.Data');
        imports.add('lombok.NoArgsConstructor');
      }
    }

    const sortedImports = [...imports].sort();
    const content = [
      `// ${header()}`,
      ...(pkg ? [`package ${pkg};`, ''] : []),
      ...sortedImports.map((i) => `import ${i};`),
      ...(sortedImports.length ? [''] : []),
      ...body,
      '',
    ].join('\n');
    files.push({ name: `${type.name}.java`, content });
  }
  return files;

  function renderEnum(model: ModelEnum, javadoc: (t: string | undefined, p: string) => string[]): string[] {
    const used = new Set<string>();
    const members = model.values.map((v) => uniqueName(snakeCase(v, 'value').toUpperCase(), used));
    return [
      ...javadoc(model.description, ''),
      `public enum ${model.name} {`,
      ...model.values.map(
        (v, i) => `    @JsonProperty(${quote(v)}) ${members[i]}${i < model.values.length - 1 ? ',' : ';'}`,
      ),
      '}',
    ];
  }

  function renderClass(
    model: ModelClass,
    typeName: (t: TypeRef, boxed: boolean) => string,
    javadoc: (t: string | undefined, p: string) => string[],
  ): string[] {
    const names = fieldIdentifiers(
      model.fields,
      (n) => camelCase(n),
      'java',
      (n) => `${n}_`,
    );
    const types = model.fields.map((f) => typeName(f.type, f.nullable || f.optional));
    const lines = [...javadoc(model.description, ''), '@JsonIgnoreProperties(ignoreUnknown = true)'];

    if (style === 'record') {
      lines.push(`public record ${model.name}(`);
      model.fields.forEach((f, i) =>
        lines.push(
          `        @JsonProperty(${quote(f.name)}) ${types[i]} ${names[i]}${i < model.fields.length - 1 ? ',' : ') {'}`,
        ),
      );
      lines.push('}');
      return lines;
    }

    if (lombok) lines.push('@Data', '@NoArgsConstructor', '@AllArgsConstructor');
    lines.push(`public class ${model.name} {`);
    model.fields.forEach((f, i) => {
      if (i > 0) lines.push('');
      lines.push(...javadoc(f.description, '    '));
      lines.push(`    @JsonProperty(${quote(f.name)})`, `    private ${types[i]} ${names[i]};`);
    });
    if (!lombok) {
      model.fields.forEach((_, i) => {
        // Jackson getter'ı alanla adından eşleştirir (orderNo ↔ getOrderNo, class_ ↔ getClass_); farklı ad
        // serileştirmede ikinci bir özellik doğururdu.
        const accessor = names[i]!.charAt(0).toUpperCase() + names[i]!.slice(1);
        const getter = types[i] === 'boolean' ? `is${accessor}` : `get${accessor}`;
        lines.push(
          '',
          `    public ${types[i]} ${getter}() {`,
          `        return ${names[i]};`,
          '    }',
          '',
          `    public void set${accessor}(${types[i]} ${names[i]}) {`,
          `        this.${names[i]} = ${names[i]};`,
          '    }',
        );
      });
    }
    lines.push('}');
    return lines;
  }
}
