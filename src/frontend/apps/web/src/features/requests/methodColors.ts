import type { RequestKind } from '@apivator/core';

const colors: Record<string, string> = {
  GET: 'text-success',
  POST: 'text-warning',
  PUT: 'text-accent',
  PATCH: 'text-[#8b5cf6] dark:text-[#a78bfa]',
  DELETE: 'text-danger',
};

export function methodColor(method: string, kind?: RequestKind | null): string {
  if (kind === 'WebSocket') return 'text-[#0891b2] dark:text-[#22d3ee]';
  if (kind === 'Sse') return 'text-[#0d9488] dark:text-[#2dd4bf]';
  if (kind === 'Grpc') return 'text-[#4f46e5] dark:text-[#818cf8]';
  return colors[method.toUpperCase()] ?? 'text-fg-muted';
}

/** Ağaçta ve sekmede kısa gösterim (DELETE → DEL, OPTIONS → OPT). */
export function methodLabel(method: string, kind?: RequestKind | null): string {
  if (kind === 'WebSocket') return 'WS';
  if (kind === 'Sse') return 'SSE';
  if (kind === 'Grpc') return 'gRPC';
  const upper = method.toUpperCase();
  if (upper === 'DELETE') return 'DEL';
  if (upper === 'OPTIONS') return 'OPT';
  return upper.length > 5 ? upper.slice(0, 4) : upper;
}
