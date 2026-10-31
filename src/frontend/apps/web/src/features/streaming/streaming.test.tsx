import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { emptyAuth, emptyBody, type StreamEvent } from '@apivator/core';
import { MessagesEditor } from './MessagesEditor';
import { StreamPanel } from './StreamPanel';
import { connectWebSocket, startSse, stop, useStreams } from './streamStore';

const api = vi.hoisted(() => ({
  executeStream: vi.fn(),
  webSocketRelayUrl: vi.fn(),
}));

vi.mock('../../lib/api', () => ({ api }));

// CodeMirror jsdom'da ölçüm yapamıyor; düz bir metin alanı yeterli.
vi.mock('../requests/CodeEditor', () => ({
  CodeEditor: ({
    value,
    onChange,
    label,
  }: {
    value: string;
    onChange?: (v: string) => void;
    label: string;
  }) => <textarea aria-label={label} value={value} onChange={(e) => onChange?.(e.target.value)} />,
}));

class FakeSocket {
  static last: FakeSocket | null = null;
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  onopen: ((e: unknown) => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: ((e: { code: number; reason: string }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;

  constructor(public url: string) {
    FakeSocket.last = this;
  }

  send(data: string) {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }

  close() {
    this.readyState = 3;
  }

  emit(message: object) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

const request = {
  method: 'GET',
  url: 'https://olay.test/akis',
  headers: [],
  body: emptyBody(),
  auth: emptyAuth('None'),
};

beforeEach(() => {
  vi.clearAllMocks();
  useStreams.setState({ sessions: {}, composers: {} });
  vi.stubGlobal('WebSocket', FakeSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Server-Sent Events', () => {
  it('shows events live and filters them', async () => {
    let emit!: (e: StreamEvent) => void;
    let finish!: () => void;
    api.executeStream.mockImplementation(
      (_body: unknown, onEvent: (e: StreamEvent) => void) =>
        new Promise<void>((resolve) => {
          emit = onEvent;
          finish = resolve;
        }),
    );
    render(<StreamPanel tabId="t1" kind="Sse" />);
    expect(screen.getByText(/olaylar burada canlı akar/)).toBeInTheDocument();

    act(() => startSse('t1', request));
    expect(screen.getByText('Bağlanıyor')).toBeInTheDocument();
    act(() => {
      emit({ type: 'open', status: 200, statusText: 'OK', headers: [] });
      emit({ type: 'event', event: 'fiyat', data: '{"tl":42}', id: '7' });
      emit({ type: 'event', event: 'message', data: 'merhaba' });
    });
    expect(screen.getByText('Dinleniyor')).toBeInTheDocument();
    expect(screen.getByText('2 olay')).toBeInTheDocument();
    expect(screen.getByText('fiyat')).toBeInTheDocument();
    expect(screen.getByText('#7')).toBeInTheDocument();

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Mesajlarda ara'), 'merh');
    const list = screen.getByRole('list', { name: 'Olaylar' });
    expect(within(list).queryByText('{"tl":42}')).not.toBeInTheDocument();
    expect(within(list).getByText('merhaba')).toBeInTheDocument();

    await act(async () => {
      emit({ type: 'done', message: 'Akış sona erdi.' });
      finish();
    });
    expect(screen.getByText('Kapalı')).toBeInTheDocument();
  });

  it('stops the stream through the abort signal', async () => {
    let signal!: AbortSignal;
    api.executeStream.mockImplementation(
      (_b: unknown, _e: unknown, s: AbortSignal) =>
        new Promise<void>((_, reject) => {
          signal = s;
          s.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    startSse('t2', request);
    await act(async () => {
      stop('t2');
      await Promise.resolve();
    });
    expect(signal.aborted).toBe(true);
    const session = useStreams.getState().sessions.t2!;
    expect(session.status).toBe('closed');
    expect(session.items.at(-1)?.data).toBe('Bağlantı kesildi.');
  });
});

describe('WebSocket', () => {
  it('connects through the relay, sends composed and saved messages', async () => {
    api.webSocketRelayUrl.mockResolvedValue('ws://localhost/hubs/ws-proxy?access_token=t');
    const onChange = vi.fn();
    render(
      <>
        <MessagesEditor
          tabId="w1"
          messages={[{ name: 'Selam', body: '{"tip":"{{tip}}"}' }]}
          onChange={onChange}
          variables={
            new Map([['tip', { value: 'selam', scope: 'environment', scopeName: 'Test', isSecret: false }]])
          }
        />
        <StreamPanel tabId="w1" kind="WebSocket" />
      </>,
    );
    const user = userEvent.setup();
    expect(screen.getByRole('button', { name: 'Selam mesajını gönder' })).toBeDisabled();

    await act(async () => {
      connectWebSocket('w1', { url: 'wss://canli.test/soket', headers: [], protocols: ['chat.v1'] });
      await Promise.resolve();
    });
    const socket = FakeSocket.last!;
    expect(socket.url).toBe('ws://localhost/hubs/ws-proxy?access_token=t');
    act(() => {
      socket.readyState = 1;
      socket.onopen?.({});
    });
    expect(socket.sent[0]).toMatchObject({
      type: 'connect',
      url: 'wss://canli.test/soket',
      protocols: ['chat.v1'],
    });
    act(() => socket.emit({ type: 'open', protocol: 'chat.v1' }));
    expect(screen.getByText('Bağlı')).toBeInTheDocument();
    expect(screen.getByText('Protokol: chat.v1')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Selam mesajını gönder' }));
    expect(socket.sent[1]).toEqual({ type: 'send', data: '{"tip":"selam"}', binary: false });

    act(() => useStreams.getState().setComposer('w1', { text: 'AQI', binary: true }));
    await user.click(screen.getByRole('button', { name: 'Gönder' }));
    expect(screen.getByRole('alert')).toHaveTextContent('base64');

    act(() => useStreams.getState().setComposer('w1', { text: 'AQID' }));
    await user.click(screen.getByRole('button', { name: 'Gönder' }));
    expect(socket.sent[2]).toEqual({ type: 'send', data: 'AQID', binary: true });

    act(() =>
      socket.emit({ type: 'message', data: 'yankı', binary: false, size: 6, at: new Date().toISOString() }),
    );
    expect(screen.getByText('1 gelen · 2 giden')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Giden' }));
    expect(screen.queryByText('yankı')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Mesajı kaydet/ }));
    await user.type(screen.getByLabelText('Mesaj adı'), 'İkili');
    await user.click(screen.getByRole('button', { name: 'Ekle' }));
    expect(onChange).toHaveBeenCalledWith([
      { name: 'Selam', body: '{"tip":"{{tip}}"}' },
      { name: 'İkili', body: 'AQID', binary: true },
    ]);

    act(() => stop('w1'));
    expect(socket.sent.at(-1)).toEqual({ type: 'close', code: 1000, reason: '' });
    act(() => socket.emit({ type: 'closed', code: 1000, reason: '' }));
    expect(screen.getByText('Kapalı')).toBeInTheDocument();
  });

  it('reports a refused relay connection as an error', async () => {
    api.webSocketRelayUrl.mockResolvedValue('ws://localhost/hubs/ws-proxy');
    await act(async () => {
      connectWebSocket('w2', { url: 'ws://10.0.0.1/x', headers: [], protocols: [] });
      await Promise.resolve();
    });
    act(() => {
      FakeSocket.last!.readyState = 1;
      FakeSocket.last!.onopen?.({});
      FakeSocket.last!.emit({ type: 'error', message: 'Bu adrese bağlanmaya izin verilmiyor.' });
      FakeSocket.last!.emit({ type: 'closed', code: 1000, reason: null });
    });
    const session = useStreams.getState().sessions.w2!;
    expect(session.status).toBe('error');
    expect(session.items.some((i) => i.direction === 'error' && i.data.includes('izin verilmiyor'))).toBe(
      true,
    );
  });
});
