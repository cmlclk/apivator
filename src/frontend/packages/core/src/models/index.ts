import type { ModelSet } from './ir';
import type { GeneratedFile, ModelOptions } from './common';
import { generateCSharp } from './csharp';
import { generateJava } from './java';
import { generateKotlin, generateSwift } from './kotlinSwift';
import { generatePython, generateTypeScript } from './typescriptPython';
import { generateDart, generateGo } from './goDart';
import { toJsonSchema } from './schema';

export * from './ir';
export * from './common';
export { inferModel, type InferOptions } from './infer';
export {
  isOpenApiDocument,
  modelFromSchema,
  openApiSchemaNames,
  SchemaError,
  toJsonSchema,
  type SchemaOptions,
} from './schema';
export { camelCase, pascalCase, singular, snakeCase, words } from './naming';

/** Modeli seçilen dilde koda çevirir. Java'da her tip ayrı dosyadır; diğerlerinde tek dosya. */
export function generateModel(set: ModelSet, options: ModelOptions): GeneratedFile[] {
  switch (options.language) {
    case 'csharp':
      return generateCSharp(set, options);
    case 'java':
      return generateJava(set, options);
    case 'kotlin':
      return generateKotlin(set, options);
    case 'typescript':
      return generateTypeScript(set, options);
    case 'python':
      return generatePython(set, options);
    case 'go':
      return generateGo(set, options);
    case 'swift':
      return generateSwift(set, options);
    case 'dart':
      return generateDart(set, options);
    case 'jsonschema': {
      const title = set.root.kind === 'class' ? set.root.name : undefined;
      return [
        {
          name: `${title ?? 'schema'}.schema.json`,
          content: `${JSON.stringify(toJsonSchema(set, title), null, 2)}\n`,
        },
      ];
    }
  }
}
