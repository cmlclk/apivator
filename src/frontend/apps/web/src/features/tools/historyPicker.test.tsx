import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { emptyDefinition, type HistoryEntryDto } from '@apivator/core';
import { HistoryResponsePicker } from './tools/historyResponsePicker';
import { useConsole } from '../console/consoleStore';

const prefs = vi.hoisted(() => ({ saveHistoryResponses: true }));
const api = vi.hoisted(() => ({ list: vi.fn(), response: vi.fn() }));

vi.mock('../../lib/api', () => ({ api: { history: { list: api.list, response: api.response } } }));
vi.mock('../../lib/useWorkspaces', () => ({
  useWorkspaces: () => ({ current: { id: 'w1', role: 'Admin' }, workspaces: [] }),
}));
vi.mock('../account/preferences', () => ({ usePreferences: () => ({ data: prefs }) }));

const entry = (id: string, url: string, executedAt: string, hasResponse: boolean): HistoryEntryDto => ({
  id,
  requestId: null,
  method: 'GET',
  url,
  definition: emptyDefinition(),
  status: 200,
  timeMs: 12,
  size: 2,
  executedAt,
  hasResponse,
});

function renderPicker(onPick = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <HistoryResponsePicker side="left" onPick={onPick} />
    </QueryClientProvider>,
  );
  return { onPick, user: userEvent.setup() };
}

beforeEach(() => {
  prefs.saveHistoryResponses = true;
  api.list.mockReset();
  api.response.mockReset();
  useConsole.getState().clear();
});

describe('Geçmişten seç: saklanan yanıtlar', () => {
  it('önceki oturumların saklanan yanıtlarını listeler, seçilince gövdeyi getirir', async () => {
    api.list.mockResolvedValue([
      entry('a', 'https://x.test/saved', '2026-10-30T10:00:00Z', true),
      entry('b', 'https://x.test/no-body', '2026-10-30T09:00:00Z', false),
    ]);
    api.response.mockResolvedValue({ body: '{"eski":1}', contentType: 'application/json', truncated: false });
    const { onPick, user } = renderPicker();

    await user.click(screen.getByRole('button', { name: /geçmişten seç/i }));
    const list = await screen.findByRole('list', { name: 'Yanıtlar' });
    const items = await within(list).findAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent('https://x.test/saved');

    await user.click(within(items[0]!).getByRole('button'));
    expect(api.response).toHaveBeenCalledWith('a');
    expect(onPick).toHaveBeenCalledWith('{"eski":1}');
  });

  it('bu oturumda konsolda olan yanıtı ikinci kez listelemez', async () => {
    useConsole.getState().add('İstek', 'GET', 'https://x.test/now', {
      status: 200,
      statusText: 'OK',
      headers: [],
      body: 'şimdi',
      bodyEncoding: 'text',
      size: 5,
      truncated: false,
      timeMs: 5,
      finalUrl: null,
      error: null,
    });
    const sessionStart = useConsole.getState().records[0]!.time;
    api.list.mockResolvedValue([
      entry('new', 'https://x.test/now', new Date(sessionStart + 1000).toISOString(), true),
      entry('old', 'https://x.test/old', new Date(sessionStart - 60_000).toISOString(), true),
    ]);
    const { user } = renderPicker();

    await user.click(screen.getByRole('button', { name: /geçmişten seç/i }));
    const list = await screen.findByRole('list', { name: 'Yanıtlar' });
    await within(list).findByText('https://x.test/old');
    expect(within(list).getAllByText('https://x.test/now')).toHaveLength(1);
  });

  it('tercih kapalıyken sunucuya sormaz ve nasıl açılacağını söyler', async () => {
    prefs.saveHistoryResponses = false;
    const { user } = renderPicker();

    await user.click(screen.getByRole('button', { name: /geçmişten seç/i }));
    expect(await screen.findByText(/Yanıt gövdelerini geçmişte sakla/)).toBeInTheDocument();
    expect(api.list).not.toHaveBeenCalled();
  });
});
