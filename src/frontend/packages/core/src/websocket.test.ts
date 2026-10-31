import { describe, expect, it, vi } from 'vitest';
import { applyAuth, emptyAuth, normalizeDefinition, requestBadge } from './http';
import { isValidBase64, messageSize, parseProtocols, RelayConnection, type SocketLike } from './websocket';

class FakeSocket implements SocketLike {
  readyState = 0;
  sent: unknown[] = [];
  closed = false;
  onopen: SocketLike['onopen'] = null;
  onmessage: SocketLike['onmessage'] = null;
  onclose: SocketLike['onclose'] = null;
  onerror: SocketLike['onerror'] = null;

  constructor(public url: string) {}

  send(data: string) {
    this.sent.push(JSON.parse(data));
  }

  close() {
    this.closed = true;
    this.readyState = 3;
  }

  open() {
    this.readyState = 1;
    this.onopen?.({});
  }

  receive(message: object) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

function setup() {
  let socket!: FakeSocket;
  const handlers = { onOpen: vi.fn(), onMessage: vi.fn(), onClosed: vi.fn(), onError: vi.fn() };
  const connection = new RelayConnection(handlers, (url) => (socket = new FakeSocket(url)));
  connection.connect('ws://relay/ws-proxy?token=t', {
    url: 'wss://hedef.test/soket',
    headers: [
      { key: 'X-Test', value: '1' },
      { key: ' ', value: 'boş' },
    ],
    protocols: ['chat.v1'],
  });
  return { socket, handlers, connection };
}

describe('RelayConnection', () => {
  it('sends connect envelope on open and relays events', () => {
    const { socket, handlers, connection } = setup();
    expect(socket.url).toBe('ws://relay/ws-proxy?token=t');
    expect(connection.send('erken')).toBe(false);

    socket.open();
    expect(socket.sent[0]).toEqual({
      type: 'connect',
      url: 'wss://hedef.test/soket',
      headers: [{ key: 'X-Test', value: '1' }],
      protocols: ['chat.v1'],
    });

    socket.receive({ type: 'open', protocol: 'chat.v1' });
    expect(handlers.onOpen).toHaveBeenCalledWith('chat.v1');

    socket.receive({ type: 'message', data: 'merhaba', binary: false, size: 7, at: '2026-01-01T00:00:00Z' });
    expect(handlers.onMessage).toHaveBeenCalledWith({
      data: 'merhaba',
      binary: false,
      size: 7,
      at: '2026-01-01T00:00:00Z',
    });

    expect(connection.send('AQID', true)).toBe(true);
    expect(socket.sent[1]).toEqual({ type: 'send', data: 'AQID', binary: true });

    socket.receive({ type: 'error', message: 'olmadı' });
    expect(handlers.onError).toHaveBeenCalledWith('olmadı');

    connection.close(1000, 'bitti');
    expect(socket.sent[2]).toEqual({ type: 'close', code: 1000, reason: 'bitti' });
    socket.receive({ type: 'closed', code: 1000, reason: 'bitti' });
    expect(handlers.onClosed).toHaveBeenCalledWith(1000, 'bitti');
    expect(socket.closed).toBe(true);
    expect(connection.isOpen).toBe(false);
  });

  it('reports a failed relay connection once', () => {
    const { socket, handlers } = setup();
    socket.onclose?.({ code: 1006, reason: '' });
    socket.onclose?.({ code: 1006, reason: '' });
    expect(handlers.onError).toHaveBeenCalledTimes(1);
    expect(handlers.onClosed).toHaveBeenCalledTimes(1);
    expect(handlers.onClosed).toHaveBeenCalledWith(1006, null);
  });
});

describe('websocket helpers', () => {
  it('parses protocols and measures messages', () => {
    expect(parseProtocols(' chat.v1, ,graphql-ws ')).toEqual(['chat.v1', 'graphql-ws']);
    expect(messageSize('ş', false)).toBe(2);
    expect(messageSize('AQID', true)).toBe(3);
    expect(messageSize('AQ==', true)).toBe(1);
    expect(isValidBase64('AQID')).toBe(true);
    expect(isValidBase64('AQI')).toBe(false);
  });

  it('applies auth to headers or URL', () => {
    const bearer = { ...emptyAuth('Bearer'), bearerToken: 'abc' };
    expect(applyAuth('wss://x', [], bearer).headers).toEqual([{ key: 'Authorization', value: 'Bearer abc' }]);
    const basic = { ...emptyAuth('Basic'), basicUsername: 'ali', basicPassword: 'ş' };
    expect(applyAuth('wss://x', [], basic).headers[0]!.value).toBe(`Basic ${btoa('ali:Å\u009f')}`);
    const query = {
      ...emptyAuth('ApiKey'),
      apiKeyName: 'key',
      apiKeyValue: 'a b',
      apiKeyIn: 'Query' as const,
    };
    expect(applyAuth('wss://x/s?a=1', [], query).url).toBe('wss://x/s?a=1&key=a%20b');
    const oauth = { ...emptyAuth('OAuth2'), oAuth2HeaderPrefix: 'Bearer' };
    expect(applyAuth('wss://x', [], oauth).headers).toEqual([]);
    expect(applyAuth('wss://x', [{ key: 'authorization', value: 'kendi' }], bearer).headers).toHaveLength(1);
  });

  it('normalizes kind and badges', () => {
    const d = normalizeDefinition({
      url: 'wss://x',
      kind: 'WebSocket',
      messages: [{ name: 'a', body: '1' }],
    });
    expect(d.kind).toBe('WebSocket');
    expect(d.messages).toEqual([{ name: 'a', body: '1', binary: false }]);
    expect(normalizeDefinition({}).kind).toBe('Http');
    expect(requestBadge('WebSocket', 'GET')).toBe('WS');
    expect(requestBadge('Sse', 'POST')).toBe('SSE');
    expect(requestBadge(undefined, 'POST')).toBe('POST');
  });
});
