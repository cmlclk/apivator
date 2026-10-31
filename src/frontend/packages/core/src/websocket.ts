import { msg } from './i18n';
/**
 * WebSocket köprüsü istemcisi. Tarayıcı WebSocket'te özel header gönderemez ve hedefe kendi ağından çıkar;
 * bu yüzden bağlantı sunucudaki (masaüstünde yerel ajandaki) köprü üzerinden kurulur. Protokol JSON zarflarıdır:
 *
 * - istemci → köprü: `connect {url, headers, protocols}`, `send {data, binary}`, `close {code, reason}`
 * - köprü → istemci: `open {protocol}`, `message {data, binary, size, at}`, `closed {code, reason}`, `error {message}`
 */

export interface RelayConnectOptions {
  url: string;
  headers: { key: string; value: string }[];
  protocols: string[];
}

export interface RelayMessage {
  data: string;
  /** true ise data base64 kodlu ikili veridir. */
  binary: boolean;
  size: number;
  at: string;
}

export interface RelayHandlers {
  onOpen?: (protocol: string | null) => void;
  onMessage?: (message: RelayMessage) => void;
  onClosed?: (code: number | null, reason: string | null) => void;
  onError?: (message: string) => void;
}

/** Testlerde sahte soket verilebilsin diye yalnızca kullanılan kısım. */
export interface SocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export type SocketFactory = (url: string) => SocketLike;

const OPEN = 1;

/** "chat.v1, graphql-ws" → ["chat.v1", "graphql-ws"] */
export function parseProtocols(text: string | null | undefined): string[] {
  return (text ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
}

/** Bayt sayısı (UTF-8); ikili mesajda base64'ten çözülmüş boyut. */
export function messageSize(data: string, binary: boolean): number {
  if (!binary) return new TextEncoder().encode(data).length;
  const clean = data.replace(/\s/g, '');
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
}

export function isValidBase64(data: string): boolean {
  const clean = data.replace(/\s/g, '');
  return clean.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(clean);
}

export class RelayConnection {
  private socket: SocketLike | null = null;
  private finished = false;

  constructor(
    private readonly handlers: RelayHandlers,
    private readonly factory: SocketFactory = (url) => new WebSocket(url) as unknown as SocketLike,
  ) {}

  get isOpen(): boolean {
    return this.socket?.readyState === OPEN && !this.finished;
  }

  /** Köprüye bağlanır ve hedef bağlantıyı ister. relayUrl: ApiClient.webSocketRelayUrl(). */
  connect(relayUrl: string, options: RelayConnectOptions) {
    const socket = this.factory(relayUrl);
    this.socket = socket;
    socket.onopen = () => {
      socket.send(
        JSON.stringify({
          type: 'connect',
          url: options.url,
          headers: options.headers.filter((h) => h.key.trim()),
          protocols: options.protocols,
        }),
      );
    };
    socket.onmessage = (event) => {
      if (typeof event.data !== 'string') return;
      let message: {
        type?: string;
        data?: string;
        binary?: boolean;
        size?: number;
        at?: string;
        protocol?: string | null;
        code?: number | null;
        reason?: string | null;
        message?: string;
      };
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      switch (message.type) {
        case 'open':
          this.handlers.onOpen?.(message.protocol || null);
          break;
        case 'message': {
          const data = message.data ?? '';
          const binary = message.binary ?? false;
          this.handlers.onMessage?.({
            data,
            binary,
            size: message.size ?? messageSize(data, binary),
            at: message.at ?? new Date().toISOString(),
          });
          break;
        }
        case 'closed':
          this.finish(message.code ?? null, message.reason ?? null);
          break;
        case 'error':
          this.handlers.onError?.(message.message ?? 'Bilinmeyen hata.');
          break;
      }
    };
    socket.onerror = () => {
      // Ayrıntı onclose'da; tarayıcı WebSocket hatası nedeni vermez.
    };
    socket.onclose = (event) => {
      if (this.finished) return;
      if (event.code === 1006 || event.code === 1008) {
        this.handlers.onError?.(
          event.code === 1008
            ? msg('core.bridge.rejected', 'Köprü bağlantıyı reddetti.')
            : msg(
                'core.bridge.unreachable',
                'Köprüye bağlanılamadı ya da bağlantı koptu. Oturumunuzun açık olduğundan emin olun.',
              ),
        );
      }
      this.finish(event.code === 1005 ? null : event.code, event.reason || null);
    };
  }

  /** Mesaj gönderir; ikili mesajda data base64'tür. */
  send(data: string, binary = false): boolean {
    if (!this.isOpen) return false;
    this.socket!.send(JSON.stringify({ type: 'send', data, binary }));
    return true;
  }

  close(code = 1000, reason = '') {
    if (!this.socket || this.finished) return;
    if (this.socket.readyState === OPEN) {
      this.socket.send(JSON.stringify({ type: 'close', code, reason }));
      // Köprü "closed" ile yanıtlar; yanıt gelmezse soket kendimiz kapatılır.
      const socket = this.socket;
      setTimeout(() => {
        if (!this.finished) {
          socket.close();
          this.finish(code, reason || null);
        }
      }, 3000);
    } else {
      this.socket.close();
      this.finish(code, reason || null);
    }
  }

  private finish(code: number | null, reason: string | null) {
    if (this.finished) return;
    this.finished = true;
    try {
      if (this.socket && this.socket.readyState <= OPEN) this.socket.close();
    } catch {
      // Zaten kapanıyor.
    }
    this.handlers.onClosed?.(code, reason);
  }
}
