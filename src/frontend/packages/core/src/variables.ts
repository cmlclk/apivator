import { FAKE_DYNAMIC_VARIABLES, fakeDynamicValue } from './tools/fakeData';
import type { KeyValueItem, RequestAuth, RequestBody, Variable } from './types';

export type VariableScopeKind = 'environment' | 'collection' | 'global';

/** Bir değişken kümesi ve bu kullanıcının o kümedeki güncel (yalnızca yerelde tutulan) değerleri. */
export interface VariableScope {
  kind: VariableScopeKind;
  name: string;
  variables: Variable[];
  /** Anahtar → güncel değer. Tanımlı değilse başlangıç değeri kullanılır. */
  current: Record<string, string>;
}

export interface ResolvedVariable {
  value: string;
  scope: VariableScopeKind;
  scopeName: string;
  isSecret: boolean;
}

export type VariableMap = Map<string, ResolvedVariable>;

const VARIABLE = /\{\{\s*([^{}]+?)\s*\}\}/g;
const MAX_DEPTH = 10;

/**
 * Kapsamları öncelik sırasıyla birleştirir: environment > collection > global. Kapalı (enabled=false)
 * değişkenler yok sayılır.
 */
export function buildVariableMap(scopes: VariableScope[]): VariableMap {
  const order: Record<VariableScopeKind, number> = { environment: 0, collection: 1, global: 2 };
  const map: VariableMap = new Map();
  for (const scope of [...scopes].sort((a, b) => order[a.kind] - order[b.kind])) {
    for (const variable of scope.variables) {
      if (!variable.enabled || !variable.key || map.has(variable.key)) continue;
      const value = Object.prototype.hasOwnProperty.call(scope.current, variable.key)
        ? scope.current[variable.key]!
        : variable.value;
      map.set(variable.key, { value, scope: scope.kind, scopeName: scope.name, isSecret: variable.isSecret });
    }
    // Script'lerin oluşturduğu (tanımda olmayan) değişkenler yalnızca güncel değer olarak yaşar.
    const defined = new Set(scope.variables.map((v) => v.key));
    for (const [key, value] of Object.entries(scope.current)) {
      if (!key || defined.has(key) || map.has(key)) continue;
      map.set(key, { value, scope: scope.kind, scopeName: scope.name, isSecret: false });
    }
  }
  return map;
}

/**
 * Postman'deki hazır dinamik değişkenler; her kullanımda yeniden üretilir. `$random…` değerleri araçlardaki
 * sahte veri üretecinden (tools/fakeData) gelir.
 */
function dynamicValue(name: string): string | undefined {
  switch (name) {
    case '$timestamp':
      return Math.floor(Date.now() / 1000).toString();
    case '$isoTimestamp':
      return new Date().toISOString();
    default:
      return name.startsWith('$') ? fakeDynamicValue(name) : undefined;
  }
}

export function isDynamicVariable(name: string): boolean {
  return (
    name === '$timestamp' ||
    name === '$isoTimestamp' ||
    Object.prototype.hasOwnProperty.call(FAKE_DYNAMIC_VARIABLES, name)
  );
}

export interface ResolveResult {
  text: string;
  /** Tanımlı olmayan değişken adları (metinde {{ad}} olarak bırakılır). */
  unresolved: Set<string>;
}

/** Metindeki {{değişken}} ifadelerini çözer; değişken değeri başka değişken içerebilir (en fazla 10 kat). */
export function resolveText(
  text: string,
  map: VariableMap,
  unresolved: Set<string> = new Set(),
): ResolveResult {
  if (!text || !text.includes('{{')) return { text, unresolved };
  let current = text;
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    let changed = false;
    current = current.replace(VARIABLE, (match, rawName: string) => {
      const name = rawName.trim();
      const found = map.get(name)?.value ?? dynamicValue(name);
      if (found === undefined) {
        unresolved.add(name);
        return match;
      }
      changed = true;
      return found;
    });
    if (!changed) break;
  }
  return { text: current, unresolved };
}

export interface RequestParts {
  url: string;
  headers: KeyValueItem[];
  body: RequestBody;
  auth: RequestAuth;
}

/** İsteğin gönderilecek tüm parçalarında değişkenleri çözer. Kaydedilen tanım değişmez. */
export function resolveRequest(
  parts: RequestParts,
  map: VariableMap,
): RequestParts & { unresolved: string[] } {
  const unresolved = new Set<string>();
  const r = (value: string) => resolveText(value, map, unresolved).text;
  // Dosya alanlarının değeri dosya adıdır, çözülmez. Sıra korunur: gönderilen dosyalar indeksle eşleşir.
  const pairs = (items: KeyValueItem[]) =>
    items.map((item) =>
      item.enabled
        ? { ...item, key: r(item.key), value: item.type === 'File' ? item.value : r(item.value) }
        : item,
    );
  const textBody = parts.body.mode === 'Raw' || parts.body.mode === 'GraphQL';

  return {
    url: r(parts.url),
    headers: pairs(parts.headers),
    body: {
      ...parts.body,
      raw: textBody ? r(parts.body.raw) : parts.body.raw,
      graphqlVariables:
        parts.body.mode === 'GraphQL'
          ? r(parts.body.graphqlVariables ?? '')
          : (parts.body.graphqlVariables ?? ''),
      form: pairs(parts.body.form),
    },
    auth: {
      ...parts.auth,
      apiKeyName: r(parts.auth.apiKeyName),
      apiKeyValue: r(parts.auth.apiKeyValue),
      bearerToken: r(parts.auth.bearerToken),
      basicUsername: r(parts.auth.basicUsername),
      basicPassword: r(parts.auth.basicPassword),
      oAuth2AuthUrl: r(parts.auth.oAuth2AuthUrl),
      oAuth2TokenUrl: r(parts.auth.oAuth2TokenUrl),
      oAuth2ClientId: r(parts.auth.oAuth2ClientId),
      oAuth2ClientSecret: r(parts.auth.oAuth2ClientSecret),
      oAuth2Scope: r(parts.auth.oAuth2Scope),
      oAuth2Audience: r(parts.auth.oAuth2Audience),
      oAuth2Username: r(parts.auth.oAuth2Username),
      oAuth2Password: r(parts.auth.oAuth2Password),
      oAuth2RedirectUri: r(parts.auth.oAuth2RedirectUri),
      oAuth2HeaderPrefix: r(parts.auth.oAuth2HeaderPrefix),
      oAuth2AccessToken: r(parts.auth.oAuth2AccessToken),
      awsAccessKey: r(parts.auth.awsAccessKey),
      awsSecretKey: r(parts.auth.awsSecretKey),
      awsRegion: r(parts.auth.awsRegion),
      awsService: r(parts.auth.awsService),
      awsSessionToken: r(parts.auth.awsSessionToken),
    },
    unresolved: [...unresolved],
  };
}

export interface TextSegment {
  text: string;
  /** Bu parça bir {{değişken}} ise adı. */
  variable?: string;
}

/** Vurgulama için metni düz metin ve değişken parçalarına böler. */
export function splitVariables(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(VARIABLE)) {
    const index = match.index ?? 0;
    if (index > last) segments.push({ text: text.slice(last, index) });
    segments.push({ text: match[0], variable: match[1]!.trim() });
    last = index + match[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last) });
  return segments;
}

/** Bir kapsamın etkin değerleri (sunucuya script'ler için gönderilir): açık değişkenler + yalnızca yerel olanlar. */
export function scopeValues(scope: VariableScope): Record<string, string> {
  const values: Record<string, string> = {};
  for (const variable of scope.variables) {
    if (!variable.enabled || !variable.key) continue;
    values[variable.key] = Object.prototype.hasOwnProperty.call(scope.current, variable.key)
      ? scope.current[variable.key]!
      : variable.value;
  }
  for (const [key, value] of Object.entries(scope.current)) {
    if (key && !(key in values) && !scope.variables.some((v) => v.key === key)) values[key] = value;
  }
  return values;
}
