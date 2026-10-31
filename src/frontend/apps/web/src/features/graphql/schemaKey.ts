import { resolveText, type VariableMap } from '@apivator/core';

/** Şema önbelleğinin anahtarı: değişkenleri çözülmüş adres (query hariç). Tanımsız değişken varsa null. */
export function graphqlSchemaKey(url: string, variables: VariableMap): string | null {
  if (!url.trim()) return null;
  const { text, unresolved } = resolveText(url.trim(), variables);
  if (unresolved.size > 0) return null;
  return text.split('#')[0]!.split('?')[0]!;
}
