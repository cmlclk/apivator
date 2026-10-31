import { msg } from './i18n';
/**
 * gRPC köprüsü istemcisi. Tarayıcı HTTP/2 çerçevelerine ve trailer'lara erişemediği için çağrı sunucudaki
 * (masaüstünde yerel ajandaki) köprüden yapılır; mesajlar JSON olarak taşınır:
 *
 * - istemci → köprü: `start {url, metadata, method, descriptorSet, deadlineSeconds}`, `send {message}`, `end`, `cancel`
 * - köprü → istemci: `headers {metadata}`, `sent {data, size}`, `message {data, size, at}`,
 *   `status {code, name, message, metadata, timeMs}`, `error {message}`
 */
import type { SocketFactory, SocketLike } from './websocket';

export interface GrpcStartOptions {
  url: string;
  metadata: { key: string; value: string }[];
  /** "/paket.Servis/Metot" */
  method: string;
  /** base64 FileDescriptorSet (GrpcSchemaDto.descriptorSet). */
  descriptorSet: string;
  deadlineSeconds?: number | null;
}

export interface GrpcStatusEvent {
  code: number;
  name: string;
  message: string;
  trailers: { key: string; value: string }[];
  timeMs: number;
}

export interface GrpcHandlers {
  onHeaders?: (metadata: { key: string; value: string }[]) => void;
  onSent?: (data: string, size: number, at: string) => void;
  onMessage?: (data: string, size: number, at: string) => void;
  onError?: (message: string) => void;
  /** Çağrı bitti (her durumda bir kez). */
  onStatus?: (status: GrpcStatusEvent) => void;
}

const OPEN = 1;

export class GrpcCallConnection {
  private socket: SocketLike | null = null;
  private finished = false;
  private queue: string[] = [];

  constructor(
    private readonly handlers: GrpcHandlers,
    private readonly factory: SocketFactory = (url) => new WebSocket(url) as unknown as SocketLike,
  ) {}

  get isOpen(): boolean {
    return !this.finished;
  }

  /** Köprüye bağlanır ve çağrıyı başlatır; bağlantı kurulmadan gönderilen mesajlar sıraya alınır. */
  start(relayUrl: string, options: GrpcStartOptions) {
    if (this.finished) return;
    const socket = this.factory(relayUrl);
    this.socket = socket;
    socket.onopen = () => {
      socket.send(
        JSON.stringify({
          type: 'start',
          url: options.url,
          metadata: options.metadata.filter((h) => h.key.trim()),
          method: options.method,
          descriptorSet: options.descriptorSet,
          deadlineSeconds: options.deadlineSeconds ?? null,
        }),
      );
      for (const item of this.queue) socket.send(item);
      this.queue = [];
    };
    socket.onmessage = (event) => {
      if (typeof event.data !== 'string') return;
      let message: {
        type?: string;
        data?: string;
        size?: number;
        at?: string;
        metadata?: { key: string; value: string }[] | null;
        code?: number;
        name?: string;
        message?: string;
        timeMs?: number;
      };
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      const at = message.at ?? new Date().toISOString();
      switch (message.type) {
        case 'headers':
          this.handlers.onHeaders?.(message.metadata ?? []);
          break;
        case 'sent':
          this.handlers.onSent?.(message.data ?? '', message.size ?? 0, at);
          break;
        case 'message':
          this.handlers.onMessage?.(message.data ?? '', message.size ?? 0, at);
          break;
        case 'error':
          this.handlers.onError?.(message.message ?? 'Bilinmeyen hata.');
          break;
        case 'status':
          this.finish({
            code: message.code ?? 2,
            name: message.name ?? 'UNKNOWN',
            message: message.message ?? '',
            trailers: message.metadata ?? [],
            timeMs: message.timeMs ?? 0,
          });
          break;
      }
    };
    socket.onerror = () => {};
    socket.onclose = (event) => {
      if (this.finished) return;
      this.finish({
        code: 14,
        name: 'UNAVAILABLE',
        message:
          event.code === 1008
            ? msg('core.bridge.rejected', 'Köprü bağlantıyı reddetti.')
            : msg(
                'core.bridge.unreachable',
                'Köprüye bağlanılamadı ya da bağlantı koptu. Oturumunuzun açık olduğundan emin olun.',
              ),
        trailers: [],
        timeMs: 0,
      });
    };
  }

  /** Bir istek mesajı (JSON metni) gönderir. */
  send(message: string): boolean {
    return this.post({ type: 'send', message });
  }

  /** İstemci akışını bitirir (istemci/çift yönlü akışta). */
  end(): boolean {
    return this.post({ type: 'end' });
  }

  /** Çağrıyı iptal eder. Köprüye henüz bağlanılmadıysa çağrı hiç başlatılmadan biter. */
  cancel() {
    if (this.finished) return;
    if (this.socket?.readyState === OPEN) {
      this.post({ type: 'cancel' });
      return;
    }
    this.queue = [];
    this.socket?.close();
    this.finish({
      code: 1,
      name: 'CANCELLED',
      message: msg('core.grpc.cancelled', 'Çağrı iptal edildi.'),
      trailers: [],
      timeMs: 0,
    });
  }

  /** Köprü henüz açılmadıysa (start çağrılmadıysa da) mesaj sıraya alınır ve start'tan sonra gider. */
  private post(envelope: object): boolean {
    if (this.finished) return false;
    const text = JSON.stringify(envelope);
    if (this.socket?.readyState === OPEN) this.socket.send(text);
    else this.queue.push(text);
    return true;
  }

  private finish(status: GrpcStatusEvent) {
    if (this.finished) return;
    this.finished = true;
    this.handlers.onStatus?.(status);
    try {
      this.socket?.close();
    } catch {
      /* zaten kapalı */
    }
  }
}
