import {
  emptyAuth,
  parseQueryParams,
  resolveRequest,
  type CodeRequest,
  type DocFolderDto,
  type DocRequestDto,
  type DocumentationDto,
  type KeyValueItem,
  type VariableMap,
} from '@apivator/core';
import { toLower, translate } from '../../i18n';

export type DocNode =
  | { kind: 'folder'; folder: DocFolderDto; depth: number; children: DocNode[] }
  | { kind: 'request'; request: DocRequestDto; depth: number };

/** Klasör ağacı: aynı düzeyde sıra numarasına göre (eşitlikte önce klasörler). */
export function buildTree(doc: DocumentationDto): DocNode[] {
  const build = (parentId: string | null, depth: number): DocNode[] => {
    const folders = doc.folders
      .filter((f) => f.parentFolderId === parentId)
      .map((f) => ({
        order: f.sortOrder,
        rank: 0,
        node: { kind: 'folder' as const, folder: f, depth, children: build(f.id, depth + 1) },
      }));
    const requests = doc.requests
      .filter((r) => r.folderId === parentId)
      .map((r) => ({ order: r.sortOrder, rank: 1, node: { kind: 'request' as const, request: r, depth } }));
    return [...folders, ...requests].sort((a, b) => a.order - b.order || a.rank - b.rank).map((x) => x.node);
  };
  return build(null, 0);
}

/** Ağaçtaki tüm düğümler sırayla (sayfa da bu sırayla çizilir). */
export function flatten(nodes: DocNode[]): DocNode[] {
  return nodes.flatMap((n) => (n.kind === 'folder' ? [n, ...flatten(n.children)] : [n]));
}

function matches(text: string | null | undefined, query: string) {
  return !!text && toLower(text).includes(query);
}

/**
 * Aramaya uyan düğümler: istek adı, adresi, method'u ya da açıklaması; klasör adı ya da açıklaması. Klasör uyarsa
 * içi tamamen, istek uyarsa üst klasörleri (bağlam için) gösterilir.
 */
export function filterTree(nodes: DocNode[], query: string): DocNode[] {
  const q = toLower(query.trim());
  if (!q) return nodes;
  return nodes.flatMap((n): DocNode[] => {
    if (n.kind === 'request') {
      const r = n.request;
      return matches(r.name, q) || matches(r.url, q) || matches(r.method, q) || matches(r.description, q)
        ? [n]
        : [];
    }
    if (matches(n.folder.name, q) || matches(n.folder.description, q)) return [n];
    const children = filterTree(n.children, q);
    return children.length ? [{ ...n, children }] : [];
  });
}

/** Dokümandaki değişkenler (gizliler hariç) çözüm tablosu olarak. */
export function variableMap(doc: DocumentationDto): VariableMap {
  const map: VariableMap = new Map();
  for (const v of doc.variables) {
    if (v.isSecret) continue;
    map.set(v.key, {
      value: v.value,
      scope: v.source,
      scopeName: v.source === 'environment' ? (doc.environmentName ?? '') : doc.name,
      isSecret: false,
    });
  }
  return map;
}

/** Etiketler erişim anında çevrilir (dil değişince güncel kalır). */
export const AUTH_LABELS: Record<string, string> = {
  get None() {
    return translate('docs', 'auth.None');
  },
  get Inherit() {
    return translate('docs', 'auth.Inherit');
  },
  get Bearer() {
    return translate('docs', 'auth.Bearer');
  },
  get Basic() {
    return translate('docs', 'auth.Basic');
  },
  get ApiKey() {
    return translate('docs', 'auth.ApiKey');
  },
  get Digest() {
    return translate('docs', 'auth.Digest');
  },
  get OAuth2() {
    return translate('docs', 'auth.OAuth2');
  },
  get AwsSigV4() {
    return translate('docs', 'auth.AwsSigV4');
  },
};

/**
 * Kod örneği için istek: bilinen (gizli olmayan) değişkenler çözülür, gizliler {{ad}} kalır. Yetkilendirme
 * değerleri dokümanda yoktur; yerlerine yer tutucu konur.
 */
export function codeRequest(request: DocRequestDto, variables: VariableMap): CodeRequest {
  const headers: KeyValueItem[] = request.headers.map((h) => ({ ...h, enabled: true }));
  let url = request.url;
  const { type, detail } = request.auth;
  const has = (key: string) => headers.some((h) => h.key.toLowerCase() === key.toLowerCase());
  if ((type === 'Bearer' || type === 'OAuth2') && !has('Authorization')) {
    headers.push({ key: 'Authorization', value: 'Bearer <token>', enabled: true });
  } else if (type === 'Basic' && !has('Authorization')) {
    headers.push({ key: 'Authorization', value: 'Basic <base64(kullanıcı:parola)>', enabled: true });
  } else if (type === 'ApiKey' && detail) {
    const query = /^\?([^=]+)=/.exec(detail);
    const header = /^([^:]+):/.exec(detail);
    if (query) url += `${url.includes('?') ? '&' : '?'}${query[1]}=<anahtar>`;
    else if (header && !has(header[1]!)) headers.push({ key: header[1]!, value: '<anahtar>', enabled: true });
  }
  // Gizli değişkenler haritada yok: çözülmeden {{ad}} olarak kalır.
  const resolved = resolveRequest({ url, headers, body: request.body, auth: emptyAuth('None') }, variables);
  return {
    method: request.method,
    url: resolved.url,
    headers: resolved.headers,
    body: resolved.body,
    auth: resolved.auth,
  };
}

export function queryParams(url: string) {
  return parseQueryParams(url);
}

export const anchor = {
  request: (id: string) => `istek-${id}`,
  folder: (id: string) => `klasor-${id}`,
};
