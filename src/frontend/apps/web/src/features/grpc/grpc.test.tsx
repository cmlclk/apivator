import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { emptyGrpc, type GrpcSchemaDto, type GrpcSettings } from '@apivator/core';
import { GrpcEditor } from './GrpcEditor';
import { describeGrpc, grpcSchemaKey, useGrpcSchemas } from './grpcDefinitions';
import { StreamPanel } from '../streaming/StreamPanel';
import { endGrpc, sendGrpc, startGrpc, stop, useStreams } from '../streaming/streamStore';

const api = vi.hoisted(() => ({ grpc: { describe: vi.fn(), relayUrl: vi.fn() } }));
vi.mock('../../lib/api', () => ({ api }));

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

  open() {
    this.readyState = 1;
    this.onopen?.({});
  }

  emit(message: object) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

const schema: GrpcSchemaDto = {
  services: [
    {
      name: 'magaza.v1.Katalog',
      methods: [
        {
          name: 'UrunGetir',
          path: '/magaza.v1.Katalog/UrunGetir',
          clientStreaming: false,
          serverStreaming: false,
          inputType: 'magaza.v1.UrunIstegi',
          outputType: 'magaza.v1.Urun',
          sample: '{\n  "id": ""\n}',
        },
        {
          name: 'Sohbet',
          path: '/magaza.v1.Katalog/Sohbet',
          clientStreaming: true,
          serverStreaming: true,
          inputType: 'magaza.v1.Mesaj',
          outputType: 'magaza.v1.Mesaj',
          sample: '{\n  "metin": ""\n}',
        },
      ],
    },
  ],
  descriptorSet: 'AAEC',
  warnings: ['google/api/annotations.proto bağımlılığı alınamadı.'],
};

beforeEach(() => {
  vi.clearAllMocks();
  FakeSocket.last = null;
  useStreams.setState({ sessions: {}, composers: {} });
  useGrpcSchemas.setState({ entries: {} });
  api.grpc.relayUrl.mockResolvedValue('ws://relay/grpc-proxy');
  vi.stubGlobal('WebSocket', FakeSocket);
});

afterEach(() => vi.unstubAllGlobals());

function Harness({ initial, onLoad }: { initial: GrpcSettings; onLoad: () => void }) {
  return <Stateful initial={initial} onLoad={onLoad} />;
}

function Stateful({ initial, onLoad }: { initial: GrpcSettings; onLoad: () => void }) {
  const [settings, setSettings] = useStateCompat(initial);
  return (
    <GrpcEditor
      tabId="t1"
      settings={settings}
      onChange={(change) => setSettings({ ...settings, ...change })}
      schemaKey={grpcSchemaKey(settings, 'localhost:5001')}
      onLoad={onLoad}
      variables={new Map()}
    />
  );
}

// React'ın useState'i; ayrı ad, Harness'i okunur tutmak için.
import { useState as useStateCompat } from 'react';

describe('gRPC definitions', () => {
  it('keys schemas by address or proto contents', () => {
    expect(grpcSchemaKey(emptyGrpc(), 'localhost:5001')).toBe('reflection:localhost:5001');
    expect(grpcSchemaKey(emptyGrpc(), null)).toBeNull();
    const proto = { ...emptyGrpc(), useReflection: false };
    expect(grpcSchemaKey(proto, 'x')).toBeNull();
    const a = grpcSchemaKey({ ...proto, protoFiles: [{ name: 'a.proto', content: 'x' }] }, null);
    const b = grpcSchemaKey({ ...proto, protoFiles: [{ name: 'a.proto', content: 'y' }] }, null);
    expect(a).toMatch(/^proto:/);
    expect(a).not.toBe(b);
  });

  it('describes once per key and stores errors', async () => {
    api.grpc.describe.mockResolvedValueOnce(schema);
    const request = { url: 'localhost:5001', metadata: [], protoFiles: null, useReflection: true };
    const [first, second] = await Promise.all([describeGrpc('k', request), describeGrpc('k', request)]);
    expect(first).toBe(second);
    expect(api.grpc.describe).toHaveBeenCalledTimes(1);
    expect(useGrpcSchemas.getState().entries.k?.status).toBe('ready');

    api.grpc.describe.mockRejectedValueOnce(new Error('x'));
    await expect(describeGrpc('k2', request)).rejects.toThrow();
    expect(useGrpcSchemas.getState().entries.k2).toMatchObject({ status: 'error', schema: null });
  });
});

describe('GrpcEditor', () => {
  it('loads definitions, picks a method and fills its sample', async () => {
    const onLoad = vi.fn(() => {
      useGrpcSchemas.setState({
        entries: { 'reflection:localhost:5001': { status: 'ready', schema, error: null } },
      });
    });
    render(<Harness initial={emptyGrpc()} onLoad={onLoad} />);
    // Reflection'da adres yazılmayı bitirince otomatik yüklenir.
    await waitFor(() => expect(onLoad).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(await screen.findByText('1 servis · 2 metot')).toBeInTheDocument();
    expect(screen.getByText(/annotations.proto/)).toBeInTheDocument();

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('gRPC metodu'), '/magaza.v1.Katalog/Sohbet');
    expect(screen.getByText('Çift yönlü akış')).toBeInTheDocument();
    expect(screen.getByLabelText('gRPC mesajı')).toHaveValue('{\n  "metin": ""\n}');

    // Örnek değiştirilmediyse metot değişince yeni metodun örneği gelir; düzenlendiyse korunur.
    await user.selectOptions(screen.getByLabelText('gRPC metodu'), '/magaza.v1.Katalog/UrunGetir');
    expect(screen.getByLabelText('gRPC mesajı')).toHaveValue('{\n  "id": ""\n}');
    await user.clear(screen.getByLabelText('gRPC mesajı'));
    await user.type(screen.getByLabelText('gRPC mesajı'), 'x');
    await user.selectOptions(screen.getByLabelText('gRPC metodu'), '/magaza.v1.Katalog/Sohbet');
    expect(screen.getByLabelText('gRPC mesajı')).toHaveValue('x');
    await user.click(screen.getByRole('button', { name: /Örnek mesaj/ }));
    expect(screen.getByLabelText('gRPC mesajı')).toHaveValue('{\n  "metin": ""\n}');
  });

  it('adds and removes .proto files', async () => {
    const onLoad = vi.fn();
    render(<Harness initial={{ ...emptyGrpc(), useReflection: false }} onLoad={onLoad} />);
    const user = userEvent.setup();
    const file = new File(['syntax = "proto3";'], 'katalog.proto', { type: 'text/plain' });
    // jsdom'daki File'da text() yok.
    Object.defineProperty(file, 'text', { value: () => Promise.resolve('syntax = "proto3";') });
    await user.upload(screen.getByLabelText('.proto dosyası seç'), file);
    const list = await screen.findByRole('list', { name: 'Yüklenen .proto dosyaları' });
    expect(within(list).getByText('katalog.proto')).toBeInTheDocument();
    await waitFor(() => expect(onLoad).toHaveBeenCalled());
    await user.click(screen.getByRole('button', { name: 'katalog.proto dosyasını kaldır' }));
    expect(screen.queryByRole('list', { name: 'Yüklenen .proto dosyaları' })).not.toBeInTheDocument();
  });
});

describe('gRPC calls', () => {
  it('runs a unary call and shows messages, status and trailers', async () => {
    startGrpc('t1', {
      url: 'localhost:5001',
      metadata: [{ key: 'authorization', value: 'Bearer x' }],
      method: '/magaza.v1.Katalog/UrunGetir',
      descriptorSet: 'AAEC',
      clientStreaming: false,
      firstMessage: '{"id":"u1"}',
    });
    render(<StreamPanel tabId="t1" kind="Grpc" />);
    await waitFor(() => expect(FakeSocket.last).not.toBeNull());
    const socket = FakeSocket.last!;
    act(() => socket.open());
    expect(socket.url).toBe('ws://relay/grpc-proxy');
    expect(socket.sent.map((m) => m.type)).toEqual(['start', 'send', 'end']);
    expect(sendGrpc('t1', '{}')).toBe(false); // unary: tek mesaj

    act(() => {
      socket.emit({ type: 'sent', data: '{"id":"u1"}', size: 4 });
      socket.emit({ type: 'headers', metadata: [{ key: 'x-sunucu', value: 'katalog' }] });
      socket.emit({ type: 'message', data: '{\n  "ad": "Kalem"\n}', size: 7 });
      socket.emit({
        type: 'status',
        code: 0,
        name: 'OK',
        message: '',
        metadata: [{ key: 'x-iz', value: 'abc' }],
        timeMs: 12,
      });
    });
    expect(screen.getAllByText('OK').length).toBeGreaterThan(0);
    expect(screen.getByText(/x-sunucu: katalog/)).toBeInTheDocument();
    expect(screen.getByText(/Trailer'lar: x-iz: abc/)).toBeInTheDocument();
    expect(screen.getByText('12 ms')).toBeInTheDocument();
    expect(screen.getByText('1 gelen · 1 giden')).toBeInTheDocument();
    expect(useStreams.getState().sessions.t1?.status).toBe('closed');
  });

  it('streams client messages until ended and cancels', async () => {
    startGrpc('t1', {
      url: 'localhost:5001',
      metadata: [],
      method: '/magaza.v1.Katalog/Sohbet',
      descriptorSet: 'AAEC',
      clientStreaming: true,
      firstMessage: '{"metin":"a"}',
    });
    await waitFor(() => expect(FakeSocket.last).not.toBeNull());
    const socket = FakeSocket.last!;
    act(() => socket.open());
    expect(sendGrpc('t1', '{"metin":"b"}')).toBe(true);
    act(() => endGrpc('t1'));
    expect(sendGrpc('t1', '{"metin":"c"}')).toBe(false);
    expect(socket.sent.map((m) => m.type)).toEqual(['start', 'send', 'send', 'end']);

    act(() => stop('t1'));
    expect(socket.sent.at(-1)).toEqual({ type: 'cancel' });
    act(() =>
      socket.emit({ type: 'status', code: 1, name: 'CANCELLED', message: 'Çağrı iptal edildi.', timeMs: 3 }),
    );
    // Kullanıcının iptali hata sayılmaz.
    expect(useStreams.getState().sessions.t1?.status).toBe('closed');
    expect(useStreams.getState().sessions.t1?.grpcStatus?.name).toBe('CANCELLED');
  });
});
