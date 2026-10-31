import { msg } from '../i18n';
import type { ModelClass, ModelEnum, ModelField, ModelSet, TypeRef } from './ir';
import { RESERVED, uniqueName } from './naming';

export type ModelLanguage =
  'csharp' | 'java' | 'kotlin' | 'typescript' | 'python' | 'go' | 'swift' | 'dart' | 'jsonschema';

export interface ModelOptions {
  language: ModelLanguage;
  /** C# namespace, Java/Kotlin paketi, Go paketi. Boşsa dilin varsayılanı (Go: `models`) ya da hiçbiri. */
  namespace?: string;
  /** Ondalık sayılar: decimal (C#), BigDecimal (Java), Decimal (Swift); yoksa double. */
  decimal?: boolean;
  csharp?: { style?: 'class' | 'record'; serializer?: 'system-text-json' | 'newtonsoft' };
  java?: { style?: 'class' | 'record'; lombok?: boolean };
  typescript?: { zod?: boolean };
  python?: { style?: 'pydantic' | 'dataclass' };
}

export interface GeneratedFile {
  name: string;
  content: string;
}

export const MODEL_LANGUAGES: { id: ModelLanguage; label: string }[] = [
  { id: 'csharp', label: 'C#' },
  { id: 'java', label: 'Java' },
  { id: 'kotlin', label: 'Kotlin' },
  { id: 'typescript', label: 'TypeScript' },
  { id: 'python', label: 'Python' },
  { id: 'go', label: 'Go' },
  { id: 'swift', label: 'Swift' },
  { id: 'dart', label: 'Dart' },
  { id: 'jsonschema', label: 'JSON Schema' },
];

/** Üretilen dosyaların başındaki not. */
export const header = () => msg('core.models.header', 'Apivator ile üretildi.');
/** Kök tip sınıf değilse dosyaya eklenen not (yorum işareti olmadan). */
export const rootTypeNote = (type: string) => msg('core.models.rootType', 'Kök tip: {type}', { type });

export const classes = (set: ModelSet) => set.types.filter((t): t is ModelClass => t.kind === 'class');
export const enums = (set: ModelSet) => set.types.filter((t): t is ModelEnum => t.kind === 'enum');

/**
 * Bir sınıfın alanları için dilin kurallarına uygun, benzersiz tanımlayıcılar. Ayrılmış kelimeler
 * `escape` ile kaçışlanır; `avoid` (ör. C#'ta sınıfın kendi adı) kullanılmaz.
 */
export function fieldIdentifiers(
  fields: ModelField[],
  convert: (name: string) => string,
  language: keyof typeof RESERVED,
  escape: (name: string) => string,
  avoid: string[] = [],
): string[] {
  const used = new Set<string>(avoid);
  const reserved = RESERVED[language]!;
  return fields.map((field) => {
    let name = convert(field.name);
    if (avoid.includes(name)) name = `${name}Value`;
    name = uniqueName(name, used);
    return reserved.has(name) ? escape(name) : name;
  });
}

/** Sınıflar bağımlılık sırasıyla (kullanılan önce); döngüde olanlar bulundukları yerde kalır. */
export function dependencyOrder<T extends { name: string }>(items: T[], deps: (item: T) => string[]): T[] {
  const byName = new Map(items.map((i) => [i.name, i]));
  const done = new Set<string>();
  const visiting = new Set<string>();
  const out: T[] = [];
  const visit = (item: T) => {
    if (done.has(item.name) || visiting.has(item.name)) return;
    visiting.add(item.name);
    for (const dep of deps(item)) {
      const next = byName.get(dep);
      if (next) visit(next);
    }
    visiting.delete(item.name);
    done.add(item.name);
    out.push(item);
  };
  for (const item of items) visit(item);
  return out;
}

export const typeDeps = (type: TypeRef): string[] =>
  type.kind === 'array'
    ? typeDeps(type.items)
    : type.kind === 'map'
      ? typeDeps(type.values)
      : type.kind === 'class' || type.kind === 'enum'
        ? [type.name]
        : [];

/** Açıklamayı yorum satırlarına böler (yorum kapanışlarını bozmadan). */
export function commentLines(text: string | undefined): string[] {
  return (text ?? '')
    .replace(/\*\//g, '* /')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

/** Dize sabiti (çift tırnak, JSON kaçışlarıyla; çoğu dilde geçerli). */
export const quote = (text: string) => JSON.stringify(text);

export const indent = (lines: string[], prefix: string) => lines.map((l) => (l ? prefix + l : l));
