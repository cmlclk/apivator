import { useQuery } from '@tanstack/react-query';
import { create } from 'zustand';
import type { MonitorRunPointDto } from '@apivator/core';
import { api } from '../../lib/api';

export const monitorsQueryKey = (workspaceId: string | undefined) => ['monitors', workspaceId] as const;
export const monitorRunsQueryKey = (monitorId: string, days: number) =>
  ['monitor-runs', monitorId, days] as const;

export function useMonitors(workspaceId: string | undefined) {
  return useQuery({
    queryKey: monitorsQueryKey(workspaceId),
    queryFn: () => api.monitors.list(workspaceId!),
    enabled: Boolean(workspaceId),
  });
}

/** E-postadaki bağlantıdan ya da listeden açılan monitör. */
export const useMonitorUi = create<{ openMonitorId: string | null; open: (id: string | null) => void }>(
  (set) => ({
    openMonitorId: null,
    open: (openMonitorId) => set({ openMonitorId }),
  }),
);

/** Tarayıcının saat dilimi (yoksa UTC). */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export interface MonitorStats {
  runs: number;
  healthy: number;
  /** Başarılı çalıştırma oranı (yüzde); çalıştırma yoksa null. */
  successRate: number | null;
  /** İstek başına ortalama yanıt süresi (ms); istek yoksa null. */
  avgResponseMs: number | null;
}

export function monitorStats(points: MonitorRunPointDto[]): MonitorStats {
  const healthy = points.filter((p) => p.healthy).length;
  const requests = points.reduce((n, p) => n + p.totalRequests, 0);
  const time = points.reduce((n, p) => n + p.totalTimeMs, 0);
  return {
    runs: points.length,
    healthy,
    successRate: points.length ? (healthy / points.length) * 100 : null,
    avgResponseMs: requests ? time / requests : null,
  };
}

/** Bir çalıştırmada istek başına ortalama süre. */
export function perRequestMs(point: MonitorRunPointDto): number {
  return point.totalRequests ? point.totalTimeMs / point.totalRequests : 0;
}
