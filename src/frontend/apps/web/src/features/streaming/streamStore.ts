import { create } from 'zustand';
import {
  GrpcCallConnection,
  messageSize,
  RelayConnection,
  type GrpcStartOptions,
  type GrpcStatusEvent,
  type ExecuteRequest,
  type HttpHeader,
  type RelayConnectOptions,
  type StreamEvent,
} from '@apivator/core';
import { api } from '../../lib/api';
import { translate } from '../../i18n';
import { errorMessage } from '../../lib/errors';
import { useTabs } from '../requests/tabsStore';

/** Bir sekmede tutulan en fazla mesaj/olay; eskiler atılır. */
export const MAX_ITEMS = 2000;

export type StreamStatus = 'connecting' | 'open' | 'closed' | 'error';

export interface StreamItem {
  id: number;
  /** in: gelen, out: giden, info: bağlantı bilgisi, error: hata. */
  direction: 'in' | 'out' | 'info' | 'error';
  at: string;
  data: string;
  /** SSE olay adı. */
  event?: string | null;
  /** SSE olay kimliği. */
  eventId?: string | null;
  binary?: boolean;
  size?: number;
}

export interface StreamSession {
  kind: 'Sse' | 'WebSocket' | 'Grpc';
  url: string;
  status: StreamStatus;
  startedAt: string;
  endedAt: string | null;
  httpStatus: number | null;
  statusText: string | null;
  headers: HttpHeader[];
  protocol: string | null;
  items: StreamItem[];
  /** Sınır yüzünden atılan eski öğe sayısı. */
  dropped: number;
  /** gRPC: çağrının sonucu ve trailer'lar. */
  grpcStatus?: GrpcStatusEvent | null;
  /** gRPC: istemci mesaj akışı açık mı (istemci/çift yönlü akışta "Gönder" ve "Akışı bitir" için). */
  clientStreaming?: boolean;
  requestEnded?: boolean;
}

export interface Composer {
  text: string;
  binary: boolean;
}

interface StreamState {
  sessions: Record<string, StreamSession>;
  composers: Record<string, Composer>;
  setComposer: (tabId: string, composer: Partial<Composer>) => void;
  clear: (tabId: string) => void;
}

export const useStreams = create<StreamState>()((set) => ({
  sessions: {},
  composers: {},
  setComposer: (tabId, composer) =>
    set((s) => ({
      composers: {
        ...s.composers,
        [tabId]: { ...(s.composers[tabId] ?? { text: '', binary: false }), ...composer },
      },
    })),
  clear: (tabId) =>
    set((s) =>
      s.sessions[tabId]
        ? { sessions: { ...s.sessions, [tabId]: { ...s.sessions[tabId]!, items: [], dropped: 0 } } }
        : s,
    ),
}));

/** Canlı bağlantılar (durumda saklanmaz; serileştirilemez). */
const controllers = new Map<
  string,
  { abort?: AbortController; relay?: RelayConnection; grpc?: GrpcCallConnection }
>();
let nextId = 1;
/** İptali kullanıcının istediği gRPC çağrıları. */
const cancelled = new Set<string>();

function patch(tabId: string, change: (session: StreamSession) => Partial<StreamSession>) {
  useStreams.setState((s) => {
    const session = s.sessions[tabId];
    if (!session) return s;
    return { sessions: { ...s.sessions, [tabId]: { ...session, ...change(session) } } };
  });
}

function push(tabId: string, item: Omit<StreamItem, 'id' | 'at'> & { at?: string }) {
  patch(tabId, (session) => {
    const items = [...session.items, { id: nextId++, at: new Date().toISOString(), ...item }];
    const overflow = Math.max(0, items.length - MAX_ITEMS);
    return { items: overflow ? items.slice(overflow) : items, dropped: session.dropped + overflow };
  });
}

function finish(tabId: string, status: 'closed' | 'error') {
  controllers.delete(tabId);
  patch(tabId, (session) =>
    session.status === 'closed' || session.status === 'error'
      ? {}
      : { status, endedAt: new Date().toISOString() },
  );
}

function begin(tabId: string, kind: StreamSession['kind'], url: string) {
  stop(tabId);
  useStreams.setState((s) => ({
    sessions: {
      ...s.sessions,
      [tabId]: {
        kind,
        url,
        status: 'connecting',
        startedAt: new Date().toISOString(),
        endedAt: null,
        httpStatus: null,
        statusText: null,
        headers: [],
        protocol: null,
        // Önceki bağlantının mesajları korunur; araya bir ayraç girer.
        items: s.sessions[tabId]?.items ?? [],
        dropped: s.sessions[tabId]?.dropped ?? 0,
      },
    },
  }));
  push(tabId, { direction: 'info', data: translate('streaming', 'log.connecting', { url }) });
}

/** Bağlantı kurulmadan önceki hata (ör. tanımsız değişken): oturum hata durumunda açılır. */
export function failBeforeStart(tabId: string, kind: StreamSession['kind'], url: string, message: string) {
  begin(tabId, kind, url);
  push(tabId, { direction: 'error', data: message });
  finish(tabId, 'error');
}

export function isActive(session: StreamSession | undefined): boolean {
  return session?.status === 'connecting' || session?.status === 'open';
}

/** Server-Sent Events akışını başlatır; olaylar geldikçe listeye eklenir. */
export function startSse(tabId: string, request: ExecuteRequest) {
  begin(tabId, 'Sse', request.url);
  const abort = new AbortController();
  controllers.set(tabId, { abort });

  const onEvent = (event: StreamEvent) => {
    switch (event.type) {
      case 'open':
        patch(tabId, () => ({
          status: 'open',
          httpStatus: event.status ?? null,
          statusText: event.statusText ?? null,
          headers: event.headers ?? [],
        }));
        push(tabId, {
          direction: 'info',
          data: translate('streaming', 'log.httpConnected', {
            status: `${event.status ?? ''} ${event.statusText ?? ''}`.trim(),
          }),
        });
        break;
      case 'event':
        push(tabId, {
          direction: 'in',
          data: event.data ?? '',
          event: event.event ?? 'message',
          eventId: event.id ?? null,
          size: messageSize(event.data ?? '', false),
        });
        break;
      case 'body':
        push(tabId, { direction: 'in', data: event.data ?? '', size: messageSize(event.data ?? '', false) });
        break;
      case 'done':
        push(tabId, { direction: 'info', data: event.message || translate('streaming', 'log.streamEnded') });
        finish(tabId, 'closed');
        break;
      case 'error':
        push(tabId, {
          direction: 'error',
          data: event.message ?? translate('streaming', 'log.unknownError'),
        });
        finish(tabId, 'error');
        break;
    }
  };

  void api
    .executeStream(request, onEvent, abort.signal)
    .then(() => finish(tabId, 'closed'))
    .catch((error: unknown) => {
      if (abort.signal.aborted) {
        push(tabId, { direction: 'info', data: translate('streaming', 'log.disconnected') });
        finish(tabId, 'closed');
      } else {
        push(tabId, { direction: 'error', data: errorMessage(error) });
        finish(tabId, 'error');
      }
    });
}

/** WebSocket bağlantısını köprü üzerinden kurar. */
export function connectWebSocket(tabId: string, options: RelayConnectOptions) {
  begin(tabId, 'WebSocket', options.url);
  const relay = new RelayConnection({
    onOpen: (protocol) => {
      patch(tabId, () => ({ status: 'open', protocol }));
      push(tabId, {
        direction: 'info',
        data: protocol
          ? translate('streaming', 'log.connectedProtocol', { protocol })
          : translate('streaming', 'log.connected'),
      });
    },
    onMessage: (message) =>
      push(tabId, {
        direction: 'in',
        data: message.data,
        binary: message.binary,
        size: message.size,
        at: message.at,
      }),
    onError: (message) => push(tabId, { direction: 'error', data: message }),
    onClosed: (code, reason) => {
      const failed = useStreams.getState().sessions[tabId]?.items.at(-1)?.direction === 'error';
      push(tabId, {
        direction: 'info',
        data: code
          ? translate('streaming', 'log.closedWith', { detail: `${code}${reason ? `: ${reason}` : ''}` })
          : translate('streaming', 'log.closed'),
      });
      finish(
        tabId,
        failed && useStreams.getState().sessions[tabId]?.status === 'connecting' ? 'error' : 'closed',
      );
    },
  });
  controllers.set(tabId, { relay });
  void api
    .webSocketRelayUrl()
    .then((url) => {
      // Bu arada iptal edildiyse bağlanılmaz.
      if (controllers.get(tabId)?.relay === relay) relay.connect(url, options);
    })
    .catch((error: unknown) => {
      push(tabId, { direction: 'error', data: errorMessage(error) });
      finish(tabId, 'error');
    });
}

/** Açık WebSocket'e mesaj gönderir; gönderilemezse false. */
export function sendWebSocket(tabId: string, data: string, binary: boolean): boolean {
  const relay = controllers.get(tabId)?.relay;
  if (!relay?.send(data, binary)) return false;
  push(tabId, { direction: 'out', data, binary, size: messageSize(data, binary) });
  return true;
}

function headerText(metadata: { key: string; value: string }[]) {
  return metadata.map((h) => `${h.key}: ${h.value}`).join(' · ');
}

/**
 * gRPC çağrısını köprü üzerinden başlatır. Unary ve sunucu akışında mesaj hemen gönderilip istek akışı kapanır;
 * istemci/çift yönlü akışta ilk mesaj (varsa) gönderilir, sonrakiler sendGrpc ile eklenir, endGrpc ile biter.
 */
export function startGrpc(
  tabId: string,
  options: GrpcStartOptions & { clientStreaming: boolean; firstMessage: string | null },
) {
  begin(tabId, 'Grpc', `${options.url}${options.method}`);
  cancelled.delete(tabId);
  patch(tabId, () => ({ grpcStatus: null, clientStreaming: options.clientStreaming, requestEnded: false }));
  const call = new GrpcCallConnection({
    onHeaders: (metadata) => {
      patch(tabId, () => ({ status: 'open', headers: metadata }));
      push(tabId, {
        direction: 'info',
        data: metadata.length
          ? translate('streaming', 'log.grpcMetadata', { metadata: headerText(metadata) })
          : translate('streaming', 'log.grpcStarted'),
      });
    },
    onSent: (data, size, at) => push(tabId, { direction: 'out', data, size, at }),
    onMessage: (data, size, at) => push(tabId, { direction: 'in', data, size, at }),
    onError: (message) => push(tabId, { direction: 'error', data: message }),
    onStatus: (status) => {
      patch(tabId, () => ({ grpcStatus: status }));
      // Kullanıcının iptali hata sayılmaz.
      const ok = status.code === 0 || (status.code === 1 && cancelled.delete(tabId));
      push(tabId, {
        direction: ok ? 'info' : 'error',
        data: `${status.name} (${status.code})${status.message ? `: ${status.message}` : ''}${
          status.trailers.length
            ? ` · ${translate('streaming', 'log.grpcTrailers', { trailers: headerText(status.trailers) })}`
            : ''
        }`,
      });
      finish(tabId, ok ? 'closed' : 'error');
    },
  });
  controllers.set(tabId, { grpc: call });
  // Köprü açılınca start'tan sonra gönderilmek üzere sıraya girer.
  if (options.firstMessage !== null) call.send(options.firstMessage);
  if (!options.clientStreaming) {
    call.end();
    patch(tabId, () => ({ requestEnded: true }));
  } else {
    patch(tabId, () => ({ status: 'open' }));
  }
  void api.grpc
    .relayUrl()
    .then((url) => {
      if (controllers.get(tabId)?.grpc === call) call.start(url, options);
    })
    .catch((error: unknown) => {
      push(tabId, { direction: 'error', data: errorMessage(error) });
      finish(tabId, 'error');
    });
}

/** Açık istemci akışına mesaj ekler; gönderilemezse false. */
export function sendGrpc(tabId: string, message: string): boolean {
  const session = useStreams.getState().sessions[tabId];
  if (!session?.clientStreaming || session.requestEnded) return false;
  return controllers.get(tabId)?.grpc?.send(message) ?? false;
}

/** İstemci akışını bitirir; sunucu yanıtını/akışını bitirince durum gelir. */
export function endGrpc(tabId: string) {
  if (controllers.get(tabId)?.grpc?.end()) {
    patch(tabId, () => ({ requestEnded: true }));
    push(tabId, { direction: 'info', data: translate('streaming', 'log.requestEnded') });
  }
}

/** Akışı durdurur ya da WebSocket'i kapatır. */
export function stop(tabId: string) {
  const controller = controllers.get(tabId);
  if (!controller) return;
  if (controller.grpc) {
    cancelled.add(tabId);
    controller.grpc.cancel();
  } else if (controller.abort) {
    controller.abort.abort();
  } else if (controller.relay) {
    if (useStreams.getState().sessions[tabId]?.status === 'connecting') {
      controllers.delete(tabId);
      controller.relay.close();
      push(tabId, { direction: 'info', data: translate('streaming', 'log.cancelled') });
      finish(tabId, 'closed');
    } else {
      controller.relay.close(1000, '');
    }
  }
}

// Kapatılan sekmelerin bağlantıları kesilir, kayıtları silinir.
useTabs.subscribe((state) => {
  const open = new Set(state.tabs.map((t) => t.id));
  for (const id of [...controllers.keys()]) if (!open.has(id)) stop(id);
  const { sessions, composers } = useStreams.getState();
  const stale = Object.keys(sessions).filter((id) => !open.has(id));
  const staleComposers = Object.keys(composers).filter((id) => !open.has(id));
  if (stale.length || staleComposers.length) {
    useStreams.setState((s) => ({
      sessions: Object.fromEntries(Object.entries(s.sessions).filter(([id]) => open.has(id))),
      composers: Object.fromEntries(Object.entries(s.composers).filter(([id]) => open.has(id))),
    }));
  }
});
