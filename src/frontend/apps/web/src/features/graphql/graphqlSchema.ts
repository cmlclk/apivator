import { create } from 'zustand';
import {
  buildClientSchema,
  getIntrospectionQuery,
  type GraphQLSchema,
  type IntrospectionQuery,
} from 'graphql';
import type { ExecuteRequest, ExecuteResponse } from '@apivator/core';
import { api } from '../../lib/api';
import { translate } from '../../i18n';
import { errorMessage, UserError } from '../../lib/errors';
import { kv } from '../../lib/idb';

/**
 * GraphQL şeması: isteğin kendi adresine, header'larına ve yetkilendirmesiyle introspection sorgusu gönderilir
 * (sunucu ya da masaüstünde yerel ajan üzerinden, normal isteklerle aynı yol). Sonuç adres başına bellekte ve
 * IndexedDB'de saklanır; editör otomatik tamamlama ve doğrulama için, şema gezgini görüntülemek için kullanır.
 */

export interface SchemaEntry {
  status: 'loading' | 'ready' | 'error';
  schema: GraphQLSchema | null;
  fetchedAt: string | null;
  error: string | null;
}

interface SchemaState {
  /** Çözülmüş istek adresi → şema. */
  entries: Record<string, SchemaEntry>;
}

export const useGraphqlSchemas = create<SchemaState>(() => ({ entries: {} }));

const storageKey = (url: string) => `graphql-schema:${url}`;

/** Şemanın saklandığı biçim (IndexedDB). */
interface StoredSchema {
  fetchedAt: string;
  data: IntrospectionQuery;
}

function set(url: string, entry: Partial<SchemaEntry>) {
  useGraphqlSchemas.setState((s) => ({
    entries: {
      ...s.entries,
      [url]: { status: 'ready', schema: null, fetchedAt: null, error: null, ...s.entries[url], ...entry },
    },
  }));
}

/** introspection yanıtını şemaya çevirir; GraphQL hataları ya da geçersiz yanıt anlaşılır mesajla atılır. */
export function schemaFromResponse(response: ExecuteResponse): {
  schema: GraphQLSchema;
  data: IntrospectionQuery;
} {
  if (response.error) throw new UserError(response.error.message);
  if (response.truncated) throw new UserError(translate('graphql', 'schema.truncated'));
  let parsed: { data?: IntrospectionQuery; errors?: { message?: string }[] };
  try {
    parsed = JSON.parse(
      response.bodyEncoding === 'base64' ? atob(response.body) : response.body,
    ) as typeof parsed;
  } catch {
    throw new UserError(translate('graphql', 'schema.notJson', { status: response.status ?? '?' }));
  }
  if (parsed.errors?.length && !parsed.data?.__schema) {
    const first = parsed.errors[0]?.message ?? translate('graphql', 'schema.unknownError');
    throw new UserError(
      /introspection/i.test(first)
        ? translate('graphql', 'schema.introspectionOff', { message: first })
        : translate('graphql', 'schema.noSchemaGiven', { message: first }),
    );
  }
  if (!parsed.data?.__schema) {
    throw new UserError(translate('graphql', 'schema.missing', { status: response.status ?? '?' }));
  }
  return { schema: buildClientSchema(parsed.data), data: parsed.data };
}

/** Önce bellek, sonra IndexedDB; yoksa null. */
export async function loadCachedSchema(url: string): Promise<SchemaEntry | null> {
  const current = useGraphqlSchemas.getState().entries[url];
  if (current) return current;
  const raw = await kv.get(storageKey(url));
  if (!raw) return null;
  try {
    const stored = JSON.parse(raw) as StoredSchema;
    const entry: SchemaEntry = {
      status: 'ready',
      schema: buildClientSchema(stored.data),
      fetchedAt: stored.fetchedAt,
      error: null,
    };
    // Bu arada istenmiş olabilir; daha yenisini ezme.
    if (!useGraphqlSchemas.getState().entries[url]) set(url, entry);
    return useGraphqlSchemas.getState().entries[url] ?? entry;
  } catch {
    await kv.remove(storageKey(url));
    return null;
  }
}

/**
 * Introspection'ı çalıştırır. `request` isteğin kendisidir (değişkenli adres, header'lar, yetkilendirme, değişken
 * değerleri); gövdesi introspection sorgusuyla değiştirilir, script'ler çalıştırılmaz. `key` çözülmüş adrestir.
 */
export async function fetchSchema(
  key: string,
  request: Omit<ExecuteRequest, 'body' | 'method'>,
): Promise<SchemaEntry> {
  set(key, { status: 'loading', error: null });
  try {
    const response = await api.execute({
      ...request,
      method: 'POST',
      headers: [
        ...request.headers.filter((h) => h.key.trim().toLowerCase() !== 'content-type'),
        { key: 'Content-Type', value: 'application/json', enabled: true },
      ],
      body: {
        mode: 'GraphQL',
        rawLanguage: 'Json',
        raw: getIntrospectionQuery({ descriptions: true, inputValueDeprecation: true }),
        form: [],
        fileName: null,
        graphqlVariables: '',
      },
      preRequestScripts: [],
      postResponseScripts: [],
    });
    const { schema, data } = schemaFromResponse(response);
    const fetchedAt = new Date().toISOString();
    set(key, { status: 'ready', schema, fetchedAt, error: null });
    void kv.set(storageKey(key), JSON.stringify({ fetchedAt, data } satisfies StoredSchema));
  } catch (error) {
    set(key, { status: 'error', error: errorMessage(error) });
  }
  return useGraphqlSchemas.getState().entries[key]!;
}
