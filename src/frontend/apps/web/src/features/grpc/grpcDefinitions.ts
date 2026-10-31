import { create } from 'zustand';
import type { GrpcDescribeRequest, GrpcMethodDto, GrpcSchemaDto, GrpcSettings } from '@apivator/core';
import { translate } from '../../i18n';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';

export interface GrpcSchemaEntry {
  status: 'loading' | 'ready' | 'error';
  schema: GrpcSchemaDto | null;
  error: string | null;
}

interface GrpcSchemaState {
  entries: Record<string, GrpcSchemaEntry>;
}

/** Servis tanımları (oturum boyunca bellekte): reflection için adres, .proto için dosya içerikleri anahtardır. */
export const useGrpcSchemas = create<GrpcSchemaState>()(() => ({ entries: {} }));

function hash(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/**
 * Tanımların anahtarı. Reflection'da çözülmüş adres (çözülemediyse null); .proto'da dosyaların özeti (dosya
 * yoksa null).
 */
export function grpcSchemaKey(settings: GrpcSettings, resolvedUrl: string | null): string | null {
  if (settings.useReflection) {
    const url = resolvedUrl?.trim();
    return url ? `reflection:${url}` : null;
  }
  if (settings.protoFiles.length === 0) return null;
  return `proto:${hash(settings.protoFiles.map((f) => `${f.name}\u0000${f.content}`).join('\u0001'))}`;
}

const inFlight = new Map<string, Promise<GrpcSchemaDto>>();

/** Tanımları getirir (aynı anahtar için tek istek); sonuç ve hata mağazaya yazılır. */
export function describeGrpc(key: string, request: GrpcDescribeRequest): Promise<GrpcSchemaDto> {
  const running = inFlight.get(key);
  if (running) return running;
  const set = (entry: Partial<GrpcSchemaEntry>) =>
    useGrpcSchemas.setState((s) => ({
      entries: {
        ...s.entries,
        [key]: { ...(s.entries[key] ?? { status: 'loading', schema: null, error: null }), ...entry },
      },
    }));
  set({ status: 'loading', error: null });
  const promise = api.grpc
    .describe(request)
    .then((schema) => {
      set({ status: 'ready', schema, error: null });
      return schema;
    })
    .catch((error: unknown) => {
      set({ status: 'error', schema: null, error: errorMessage(error) });
      throw error;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

export function findMethod(schema: GrpcSchemaDto | null | undefined, path: string): GrpcMethodDto | null {
  if (!schema || !path) return null;
  for (const service of schema.services) {
    const method = service.methods.find((m) => m.path === path);
    if (method) return method;
  }
  return null;
}

export function streamingLabel(method: GrpcMethodDto): string {
  if (method.clientStreaming && method.serverStreaming) return translate('grpc', 'streaming.bidi');
  if (method.clientStreaming) return translate('grpc', 'streaming.client');
  if (method.serverStreaming) return translate('grpc', 'streaming.server');
  return 'Unary';
}
