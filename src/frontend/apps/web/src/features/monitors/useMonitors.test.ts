import { describe, expect, it } from 'vitest';
import type { MonitorRunPointDto } from '@apivator/core';
import { describeSchedule } from './monitorSchedule';
import { monitorStats, perRequestMs } from './useMonitors';

const point = (healthy: boolean, totalRequests: number, totalTimeMs: number): MonitorRunPointDto => ({
  id: crypto.randomUUID(),
  startedAt: '2026-10-21T10:00:00Z',
  finishedAt: '2026-10-21T10:00:01Z',
  origin: 'Monitor',
  status: 'Completed',
  healthy,
  totalRequests,
  requestErrors: 0,
  testsPassed: 1,
  testsFailed: healthy ? 0 : 1,
  totalTimeMs,
});

describe('monitör yardımcıları', () => {
  it('zamanlamayı okunur yazar', () => {
    expect(describeSchedule('*/15 * * * *')).toBe('Her 15 dakikada bir');
    expect(describeSchedule('30 8 * * *')).toBe("Her gün 08:30'da");
    expect(describeSchedule('0 18 * * 1-5')).toBe("Hafta içi her gün 18:00'de");
    expect(describeSchedule('*/10  * * * *')).toBe('Her 10 dakikada bir');
    expect(describeSchedule('0 0 1 * *')).toBe("Her ayın 1. günü 00:00'da");
    expect(describeSchedule(' 61  * * * *')).toBe('cron: 61 * * * *');
  });

  it('başarı oranını ve istek başına ortalama süreyi hesaplar', () => {
    const stats = monitorStats([
      point(true, 2, 200),
      point(false, 2, 600),
      point(true, 1, 100),
      point(true, 1, 100),
    ]);
    expect(stats).toEqual({ runs: 4, healthy: 3, successRate: 75, avgResponseMs: 1000 / 6 });
    expect(monitorStats([])).toEqual({ runs: 0, healthy: 0, successRate: null, avgResponseMs: null });
    expect(perRequestMs(point(true, 4, 400))).toBe(100);
    expect(perRequestMs(point(true, 0, 0))).toBe(0);
  });
});
