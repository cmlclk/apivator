import { describe, expect, it, vi } from 'vitest';
import { GrpcCallConnection } from './grpc';
import { emptyDefinition, normalizeDefinition, requestBadge } from './http';
import type { SocketLike } from './websocket';

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
  const handlers = {
    onHeaders: vi.fn(),
    onSent: vi.fn(),
    onMessage: vi.fn(),
    onError: vi.fn(),
    onStatus: vi.fn(),
  };
  const call = new GrpcCallConnection(handlers, (url) => (socket = new FakeSocket(url)));
  call.start('ws://relay/grpc-proxy?token=t', {
    url: 'localhost:5001',
    metadata: [
      { key: 'authorization', value: 'Bearer x' },
      { key: ' ', value: 'boş' },
    ],
    method: '/magaza.v1.Katalog/UrunGetir',
    descriptorSet: 'AAEC',
    deadlineSeconds: 5,
  });
  return { socket, handlers, call };
}

describe('GrpcCallConnection', () => {
  it('queues messages until the relay is open and relays events', () => {
    const { socket, handlers, call } = setup();
    expect(call.send('{"id":"u1"}')).toBe(true);
    expect(call.end()).toBe(true);
    expect(socket.sent).toEqual([]);

    socket.open();
    expect(socket.sent).toEqual([
      {
        type: 'start',
        url: 'localhost:5001',
        metadata: [{ key: 'authorization', value: 'Bearer x' }],
        method: '/magaza.v1.Katalog/UrunGetir',
        descriptorSet: 'AAEC',
        deadlineSeconds: 5,
      },
      { type: 'send', message: '{"id":"u1"}' },
      { type: 'end' },
    ]);

    socket.receive({ type: 'sent', data: '{"id":"u1"}', size: 4, at: 't0' });
    socket.receive({ type: 'headers', metadata: [{ key: 'x-sunucu', value: 'k' }] });
    socket.receive({ type: 'message', data: '{"id":"u1"}', size: 4, at: 't1' });
    socket.receive({ type: 'error', message: 'uyarı' });
    socket.receive({
      type: 'status',
      code: 0,
      name: 'OK',
      message: '',
      metadata: [{ key: 'x-iz', value: '1' }],
      timeMs: 12,
    });

    expect(handlers.onSent).toHaveBeenCalledWith('{"id":"u1"}', 4, 't0');
    expect(handlers.onHeaders).toHaveBeenCalledWith([{ key: 'x-sunucu', value: 'k' }]);
    expect(handlers.onMessage).toHaveBeenCalledWith('{"id":"u1"}', 4, 't1');
    expect(handlers.onError).toHaveBeenCalledWith('uyarı');
    expect(handlers.onStatus).toHaveBeenCalledWith({
      code: 0,
      name: 'OK',
      message: '',
      trailers: [{ key: 'x-iz', value: '1' }],
      timeMs: 12,
    });
    expect(socket.closed).toBe(true);
    expect(call.send('{}')).toBe(false);
  });

  it('reports a dropped relay once and cancels before connecting', () => {
    const { socket, handlers } = setup();
    socket.open();
    socket.onclose?.({ code: 1006, reason: '' });
    socket.onclose?.({ code: 1006, reason: '' });
    expect(handlers.onStatus).toHaveBeenCalledTimes(1);
    expect(handlers.onStatus.mock.calls[0]![0]).toMatchObject({ name: 'UNAVAILABLE' });

    const second = setup();
    second.call.cancel();
    expect(second.socket.closed).toBe(true);
    expect(second.handlers.onStatus).toHaveBeenCalledWith(expect.objectContaining({ name: 'CANCELLED' }));
  });

  it('normalizes gRPC settings and shows a badge', () => {
    expect(requestBadge('Grpc', 'POST')).toBe('gRPC');
    const normalized = normalizeDefinition({ kind: 'Grpc', grpc: { method: '/a.B/C' } as never });
    expect(normalized.grpc).toEqual({
      method: '/a.B/C',
      useReflection: true,
      protoFiles: [],
      message: '',
      deadlineSeconds: null,
    });
    expect(normalizeDefinition(emptyDefinition())).toEqual(emptyDefinition());
  });
});
