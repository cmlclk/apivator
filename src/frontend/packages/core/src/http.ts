import type {
  AuthType,
  CollectionTreeDto,
  KeyValueItem,
  RequestAuth,
  RequestBody,
  RequestDefinition,
  GrpcSettings,
  RequestKind,
  ScriptSet,
} from './types';

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;

export function emptyBody(): RequestBody {
  return { mode: 'None', rawLanguage: 'Json', raw: '', form: [], fileName: null, graphqlVariables: '' };
}

export function emptyAuth(type: AuthType = 'Inherit'): RequestAuth {
  return {
    type,
    apiKeyName: '',
    apiKeyValue: '',
    apiKeyIn: 'Header',
    bearerToken: '',
    basicUsername: '',
    basicPassword: '',
    oAuth2GrantType: 'AuthorizationCode',
    oAuth2AuthUrl: '',
    oAuth2TokenUrl: '',
    oAuth2ClientId: '',
    oAuth2ClientSecret: '',
    oAuth2Scope: '',
    oAuth2Audience: '',
    oAuth2Username: '',
    oAuth2Password: '',
    oAuth2RedirectUri: '',
    oAuth2ClientAuthentication: 'Header',
    oAuth2HeaderPrefix: 'Bearer',
    oAuth2AccessToken: '',
    awsAccessKey: '',
    awsSecretKey: '',
    awsRegion: 'us-east-1',
    awsService: '',
    awsSessionToken: '',
  };
}

/** Sunucudaki RequestAuth.OAuth2Fingerprint ile aynı: token'ı ayarlara bağlayan anahtar (değişkenler çözülmeden). */
export function oauth2Fingerprint(auth: RequestAuth): string {
  return `${auth.oAuth2GrantType}|${auth.oAuth2TokenUrl}|${auth.oAuth2ClientId}|${auth.oAuth2Scope}`;
}

export function normalizeAuth(
  auth: Partial<RequestAuth> | null | undefined,
  fallback: AuthType = 'Inherit',
): RequestAuth {
  return { ...emptyAuth(fallback), ...(auth ?? {}) };
}

export function emptyScripts(): ScriptSet {
  return { preRequest: '', postResponse: '' };
}

export function emptyDefinition(): RequestDefinition {
  return {
    method: 'GET',
    url: '',
    headers: [],
    body: emptyBody(),
    auth: emptyAuth(),
    scripts: emptyScripts(),
    kind: 'Http',
    description: '',
    messages: [],
    protocols: '',
    grpc: emptyGrpc(),
  };
}

export const REQUEST_KIND_LABELS: Record<RequestKind, string> = {
  Http: 'HTTP',
  Sse: 'SSE',
  WebSocket: 'WebSocket',
  Grpc: 'gRPC',
};

export function emptyGrpc(): GrpcSettings {
  return { method: '', useReflection: true, protoFiles: [], message: '', deadlineSeconds: null };
}

/** Ağaçta ve sekmelerde method yerine gösterilen kısa rozet. */
export function requestBadge(kind: RequestKind | null | undefined, method: string): string {
  return kind === 'WebSocket' ? 'WS' : kind === 'Sse' ? 'SSE' : kind === 'Grpc' ? 'gRPC' : method;
}

/** Sunucu varsayılan değerleri (Text türü, boş açıklama) yazmaz; karşılaştırma için aynı biçime getirir. */
function normalizeItem(item: KeyValueItem): KeyValueItem {
  const result: KeyValueItem = {
    key: item.key ?? '',
    value: item.value ?? '',
    enabled: item.enabled ?? true,
  };
  if (item.description) result.description = item.description;
  if (item.type === 'File') result.type = 'File';
  return result;
}

/** Sunucudan gelen tanımda eksik alan varsa varsayılanlarla tamamlar. */
export function normalizeDefinition(
  definition: Partial<RequestDefinition> | null | undefined,
): RequestDefinition {
  const body = definition?.body;
  return {
    method: (definition?.method || 'GET').toUpperCase(),
    url: definition?.url ?? '',
    headers: (definition?.headers ?? []).map(normalizeItem),
    body: {
      mode: body?.mode ?? 'None',
      rawLanguage: body?.rawLanguage ?? 'Json',
      raw: body?.raw ?? '',
      form: (body?.form ?? []).map(normalizeItem),
      fileName: body?.fileName ?? null,
      graphqlVariables: body?.graphqlVariables ?? '',
    },
    auth: normalizeAuth(definition?.auth),
    scripts: {
      preRequest: definition?.scripts?.preRequest ?? '',
      postResponse: definition?.scripts?.postResponse ?? '',
    },
    kind: definition?.kind ?? 'Http',
    description: definition?.description ?? '',
    messages: (definition?.messages ?? []).map((m) => ({
      name: m.name ?? '',
      body: m.body ?? '',
      binary: m.binary ?? false,
    })),
    protocols: definition?.protocols ?? '',
    grpc: normalizeGrpc(definition?.grpc),
  };
}

function normalizeGrpc(grpc: Partial<GrpcSettings> | null | undefined): GrpcSettings {
  return {
    method: grpc?.method ?? '',
    useReflection: grpc?.useReflection ?? true,
    protoFiles: (grpc?.protoFiles ?? []).map((f) => ({ name: f.name ?? '', content: f.content ?? '' })),
    message: grpc?.message ?? '',
    deadlineSeconds: grpc?.deadlineSeconds && grpc.deadlineSeconds > 0 ? grpc.deadlineSeconds : null,
  };
}

/**
 * Yetkilendirmeyi header'lara ya da URL'ye uygular (Bearer, Basic, API key, OAuth 2.0 token'ı). WebSocket
 * bağlantısında ve kod üretiminde kullanılır; Digest ve AWS imzası istek gövdesine bağlı olduğundan burada yoktur.
 */
export function applyAuth(
  url: string,
  headers: { key: string; value: string }[],
  auth: RequestAuth,
  oauthPlaceholder = '',
): { url: string; headers: { key: string; value: string }[] } {
  const result = [...headers];
  const has = (name: string) => result.some((h) => h.key.toLowerCase() === name.toLowerCase());
  if (auth.type === 'Bearer' && auth.bearerToken && !has('Authorization')) {
    result.push({ key: 'Authorization', value: `Bearer ${auth.bearerToken}` });
  } else if (auth.type === 'Basic' && !has('Authorization')) {
    result.push({
      key: 'Authorization',
      value: `Basic ${utf8Base64(`${auth.basicUsername}:${auth.basicPassword}`)}`,
    });
  } else if (auth.type === 'OAuth2' && !has('Authorization')) {
    const token = auth.oAuth2AccessToken || oauthPlaceholder;
    if (token) {
      const prefix = auth.oAuth2HeaderPrefix.trim();
      result.push({ key: 'Authorization', value: prefix ? `${prefix} ${token}` : token });
    }
  } else if (auth.type === 'ApiKey' && auth.apiKeyName) {
    if (auth.apiKeyIn === 'Query') {
      url += `${url.includes('?') ? '&' : '?'}${encodeURIComponent(auth.apiKeyName)}=${encodeURIComponent(auth.apiKeyValue)}`;
    } else if (!has(auth.apiKeyName)) {
      result.push({ key: auth.apiKeyName, value: auth.apiKeyValue });
    }
  }
  return { url, headers: result };
}

export function utf8Base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export interface ResolvedAuth {
  auth: RequestAuth;
  /** Yetkilendirmenin geldiği yer; istek kendi yetkilendirmesini kullanıyorsa null. */
  source: { kind: 'folder' | 'collection'; name: string } | null;
}

/**
 * "Miras al" seçili istek için asıl yetkilendirmeyi bulur: önce bulunduğu klasör, sonra üst klasörler,
 * en son collection. Collection'a kaydedilmemiş istekte miras alınacak bir şey yoktur.
 */
export function resolveAuth(
  requestAuth: RequestAuth | null | undefined,
  folderId: string | null,
  collection: CollectionTreeDto | undefined,
): ResolvedAuth {
  // Eski sürümde kaydedilmiş veride auth alanı olmayabilir; miras alma kabul edilir.
  const auth = normalizeAuth(requestAuth);
  if (auth.type !== 'Inherit') return { auth, source: null };
  if (!collection) return { auth: emptyAuth('None'), source: null };

  const visited = new Set<string>();
  let current = folderId ? collection.folders.find((f) => f.id === folderId) : undefined;
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    const folderAuth = normalizeAuth(current.auth);
    if (folderAuth.type !== 'Inherit')
      return { auth: folderAuth, source: { kind: 'folder', name: current.name } };
    current = current.parentFolderId
      ? collection.folders.find((f) => f.id === current!.parentFolderId)
      : undefined;
  }

  const collectionAuth = normalizeAuth(collection.auth, 'None');
  return {
    auth: collectionAuth.type === 'Inherit' ? emptyAuth('None') : collectionAuth,
    source: { kind: 'collection', name: collection.name },
  };
}

function splitUrl(url: string) {
  const hashIndex = url.indexOf('#');
  const fragment = hashIndex >= 0 ? url.slice(hashIndex) : '';
  const withoutFragment = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
  const queryIndex = withoutFragment.indexOf('?');
  return {
    base: queryIndex >= 0 ? withoutFragment.slice(0, queryIndex) : withoutFragment,
    query: queryIndex >= 0 ? withoutFragment.slice(queryIndex + 1) : null,
    fragment,
  };
}

/**
 * URL'deki query parametrelerini tabloya çevirir. Değerler çözülmez (decode edilmez); kullanıcı ne yazdıysa
 * o görünür ve {{değişken}} ifadeleri bozulmaz.
 */
export function parseQueryParams(url: string): KeyValueItem[] {
  const { query } = splitUrl(url);
  if (!query) return [];
  return query
    .split('&')
    .filter((part) => part.length > 0)
    .map((part) => {
      const eq = part.indexOf('=');
      return {
        key: eq >= 0 ? part.slice(0, eq) : part,
        value: eq >= 0 ? part.slice(eq + 1) : '',
        enabled: true,
      };
    });
}

/** Tablodaki parametrelerle URL'nin query kısmını yeniden yazar; adres ve #fragment korunur. */
export function withQueryParams(url: string, params: KeyValueItem[]): string {
  const { base, fragment } = splitUrl(url);
  const query = params
    .filter((p) => p.enabled && (p.key !== '' || p.value !== ''))
    .map((p) => (p.value === '' ? p.key : `${p.key}=${p.value}`))
    .join('&');
  return `${base}${query ? `?${query}` : ''}${fragment}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
}

/** Geçerli JSON ise 2 boşlukla girintiler, değilse metni olduğu gibi döner. */
export function prettyJson(text: string): { text: string; isJson: boolean } {
  const trimmed = text.trim();
  if (!trimmed || (!'{["'.includes(trimmed[0]!) && !/^(-?\d|true|false|null)/.test(trimmed))) {
    return { text, isJson: false };
  }
  try {
    return { text: JSON.stringify(JSON.parse(trimmed), null, 2), isJson: true };
  } catch {
    return { text, isJson: false };
  }
}

/** İki istek tanımı aynı mı? (Sekmedeki "kaydedilmemiş değişiklik" noktası için.) */
export function definitionsEqual(a: RequestDefinition, b: RequestDefinition): boolean {
  return JSON.stringify(normalizeDefinition(a)) === JSON.stringify(normalizeDefinition(b));
}
