import type { CollectionTreeDto, ExecutionVariables, ScriptSet } from './types';

/**
 * İstek gönderilirken çalışacak script'ler: collection → üst klasörden alt klasöre → istek. Postman'deki gibi
 * pre-request ve post-response için aynı sıra kullanılır.
 */
export function scriptChain(
  collection: CollectionTreeDto | undefined,
  folderId: string | null,
  request: ScriptSet,
): { preRequest: string[]; postResponse: string[] } {
  const chain: ScriptSet[] = [];
  if (collection) {
    if (collection.scripts) chain.push(collection.scripts);
    const folders: ScriptSet[] = [];
    let current = folderId;
    let guard = 0;
    while (current && guard++ < 50) {
      const folder = collection.folders.find((f) => f.id === current);
      if (!folder) break;
      if (folder.scripts) folders.unshift(folder.scripts);
      current = folder.parentFolderId;
    }
    chain.push(...folders);
  }
  chain.push(request);
  const pick = (key: keyof ScriptSet) =>
    chain.map((s) => s[key] ?? '').filter((code) => code.trim().length > 0);
  return { preRequest: pick('preRequest'), postResponse: pick('postResponse') };
}

export interface VariableChanges {
  /** Yeni ya da değişen değerler (güncel değer olarak yazılır). */
  set: Record<string, string>;
  /** Script'in sildiği (unset) değişkenler. */
  unset: string[];
}

/** Gönderilen ve script'lerden sonra dönen değişken haritaları arasındaki fark. */
export function variableChanges(
  before: Record<string, string> | null | undefined,
  after: Record<string, string> | null | undefined,
): VariableChanges | null {
  if (!after) return null;
  const prior = before ?? {};
  const set: Record<string, string> = {};
  for (const [key, value] of Object.entries(after)) {
    if (prior[key] !== value) set[key] = value;
  }
  const unset = Object.keys(prior).filter((key) => !(key in after));
  return Object.keys(set).length || unset.length ? { set, unset } : null;
}

export type ScopeName = 'environment' | 'collection' | 'globals';

/** Her kapsam için değişiklikler (yalnızca gönderilmiş kapsamlar karşılaştırılır). */
export function scopeChanges(
  sent: ExecutionVariables,
  received: ExecutionVariables | null | undefined,
): Partial<Record<ScopeName, VariableChanges>> {
  const result: Partial<Record<ScopeName, VariableChanges>> = {};
  if (!received) return result;
  for (const scope of ['environment', 'collection', 'globals'] as const) {
    if (!sent[scope]) continue;
    const changes = variableChanges(sent[scope], received[scope]);
    if (changes) result[scope] = changes;
  }
  return result;
}
