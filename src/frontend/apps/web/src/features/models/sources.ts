/**
 * Model kaynakları: JSON örnekleri (yanıt, kayıtlı örnekler, istek gövdesi) ya da şema (gRPC mesajı, yapıştırılan
 * JSON Schema / OpenAPI).
 */
export type ModelSource =
  | { id: string; label: string; kind: 'samples'; rootName: string; samples: () => Promise<unknown[]> }
  | { id: string; label: string; kind: 'schema'; rootName: string; schema: unknown };

/**
 * İstek gövdesindeki JSON'u okur. Tırnaksız `{{değişken}}` yer tutucuları null sayılır (tırnak içindekiler metin
 * olarak kalır). Okunamazsa undefined.
 */
export function parseJsonSample(text: string | null | undefined): unknown {
  if (!text?.trim()) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    try {
      return JSON.parse(
        text.replace(
          /("(?:[^"\\]|\\.)*")|\{\{[^{}]+\}\}/g,
          (_match, quoted: string | undefined) => quoted ?? 'null',
        ),
      );
    } catch {
      return undefined;
    }
  }
}

/** Örneklerden okunabilenler (boş ve JSON olmayanlar atlanır). */
export function jsonSamples(texts: (string | null | undefined)[]): unknown[] {
  return texts.map(parseJsonSample).filter((v) => v !== undefined);
}

/** "Kullanıcıları listele" → "KullanicilariListele" + ek (Response / Request). */
export function rootNameFor(name: string | undefined, suffix: string): string {
  const base = (name ?? '')
    .replace(
      /[çÇğĞıİöÖşŞüÜ]/g,
      (c) =>
        ({ ç: 'c', Ç: 'C', ğ: 'g', Ğ: 'G', ı: 'i', İ: 'I', ö: 'o', Ö: 'O', ş: 's', Ş: 'S', ü: 'u', Ü: 'U' })[
          c
        ]!,
    )
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
  const safe = /^[0-9]/.test(base) ? `N${base}` : base;
  return `${safe || 'Root'}${safe.endsWith(suffix) ? '' : suffix}`;
}
