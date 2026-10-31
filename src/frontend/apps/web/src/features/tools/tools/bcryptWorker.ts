/**
 * bcrypt üretme ve doğrulama işi. Maliyet 12 ve üstü saniyeler sürer; arayüz donmasın diye Worker'da çalışır,
 * Worker yoksa (test ortamı) aynı fonksiyon ana iş parçacığında çağrılır.
 */
import { hashBcrypt, verifyBcrypt, type BcryptVersion } from '@apivator/core/tools';

export type BcryptJob =
  | { op: 'hash'; password: string; cost: number; version: BcryptVersion }
  | { op: 'verify'; password: string; hash: string };

export type BcryptRequest = BcryptJob & { id: number };

export type BcryptResponse =
  | { id: number; type: 'progress'; done: number; total: number }
  | { id: number; type: 'hash'; hash: string; ms: number }
  | { id: number; type: 'verify'; match: boolean; ms: number }
  | { id: number; type: 'error'; error: string };

/** İşi yapar; hiçbir zaman fırlatmaz. */
export function runBcryptJob(
  request: BcryptRequest,
  onProgress: (response: BcryptResponse) => void = () => {},
): BcryptResponse {
  const { id } = request;
  const progress = (done: number, total: number) => onProgress({ id, type: 'progress', done, total });
  const started = performance.now();
  try {
    if (request.op === 'hash') {
      const hash = hashBcrypt(request.password, request.cost, undefined, {
        version: request.version,
        onProgress: progress,
      });
      return { id, type: 'hash', hash, ms: performance.now() - started };
    }
    const match = verifyBcrypt(request.password, request.hash, { onProgress: progress });
    return { id, type: 'verify', match, ms: performance.now() - started };
  } catch (e) {
    return { id, type: 'error', error: e instanceof Error ? e.message : String(e) };
  }
}

// Worker içinde çalışırken mesajları dinle (ana iş parçacığında içe aktarılınca bir şey yapmaz).
if (typeof window === 'undefined' && typeof self !== 'undefined' && 'postMessage' in self) {
  self.onmessage = (event: MessageEvent<BcryptRequest>) => {
    self.postMessage(runBcryptJob(event.data, (progress) => self.postMessage(progress)));
  };
}
