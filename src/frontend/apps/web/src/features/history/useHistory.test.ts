import { describe, expect, it } from 'vitest';
import { emptyDefinition, type ExecuteResponse, type HistoryEntryDto } from '@apivator/core';
import { displayUrl, groupByDay, HISTORY_RESPONSE_MAX, historyResponsePayload } from './useHistory';

describe('historyResponsePayload', () => {
  const response = (body: string, bodyEncoding: 'text' | 'base64' = 'text'): ExecuteResponse => ({
    status: 200,
    statusText: 'OK',
    headers: [{ key: 'Content-Type', value: 'application/json' }],
    body,
    bodyEncoding,
    size: body.length,
    truncated: false,
    timeMs: 1,
    finalUrl: null,
    error: null,
  });

  it('metin gövdeyi içerik türüyle verir; ikili ya da boş gövdede null', () => {
    expect(historyResponsePayload(response('{}'))).toEqual({
      body: '{}',
      contentType: 'application/json',
      truncated: false,
    });
    expect(historyResponsePayload(response('AAAA', 'base64'))).toBeNull();
    expect(historyResponsePayload(response(''))).toBeNull();
  });

  it('sınırda kısaltır ve vekil çiftini bölmez', () => {
    const long = historyResponsePayload(response('a'.repeat(HISTORY_RESPONSE_MAX - 1) + '😀b'))!;
    expect(long.truncated).toBe(true);
    expect(long.body).toBe('a'.repeat(HISTORY_RESPONSE_MAX - 1));
  });
});

const entry = (id: string, executedAt: Date): HistoryEntryDto => ({
  id,
  requestId: null,
  method: 'GET',
  url: 'https://x.test',
  definition: emptyDefinition(),
  status: 200,
  timeMs: 10,
  size: 1,
  executedAt: executedAt.toISOString(),
});

describe('groupByDay', () => {
  it('groups into today, yesterday and dated days', () => {
    const now = new Date(2026, 9, 20, 15, 0);
    const groups = groupByDay(
      [
        entry('a', new Date(2026, 9, 20, 9, 0)),
        entry('b', new Date(2026, 9, 20, 0, 5)),
        entry('c', new Date(2026, 9, 19, 23, 0)),
        entry('d', new Date(2026, 9, 2, 12, 0)),
      ],
      now,
    );
    expect(groups.map((g) => [g.label, g.entries.map((e) => e.id)])).toEqual([
      ['Bugün', ['a', 'b']],
      ['Dün', ['c']],
      ['2 Ekim 2026', ['d']],
    ]);
  });

  it('strips the scheme for display', () => {
    expect(displayUrl('https://api.test/a')).toBe('api.test/a');
    expect(displayUrl('{{baseUrl}}/a')).toBe('{{baseUrl}}/a');
  });
});
