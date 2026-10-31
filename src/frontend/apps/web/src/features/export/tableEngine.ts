// Excel yazıcı ve çözümleyici ayrı parçada: yalnızca pencere açılınca yüklenir.
import {
  createTableSession,
  type AnalyzeRequest,
  type AnalyzeResult,
  type ExportedFile,
  type ExportRequest,
  type ExportSource,
} from '@apivator/core/tableExport';
import { translate } from '../../i18n';
import { UserError } from '../../lib/errors';

export type WorkerRequest =
  | { id: number; type: 'open'; source: ExportSource }
  | { id: number; type: 'analyze'; request: AnalyzeRequest }
  | { id: number; type: 'export'; request: ExportRequest };

export type WorkerResponse =
  | { id: number; ok: true; result: AnalyzeResult | ExportedFile | null }
  | { id: number; ok: false; message: string };

type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;

export interface TableEngine {
  analyze(request: AnalyzeRequest): Promise<AnalyzeResult>;
  export(request: ExportRequest): Promise<ExportedFile>;
  dispose(): void;
}

/**
 * Tablo motoru: Web Worker'da çalışır (büyük yanıtta arayüz donmaz). Worker olmayan ortamda (testler) aynı
 * kod bu iş parçacığında çalışır.
 */
export function openTableEngine(source: ExportSource): TableEngine {
  if (typeof Worker === 'undefined') {
    let session: ReturnType<typeof createTableSession> | null = null;
    const get = () => (session ??= createTableSession(source));
    // Worker'daki gibi: çözümleme hataları kullanıcıya olduğu gibi gösterilir.
    const guard = async <T>(action: () => T | Promise<T>): Promise<T> => {
      try {
        return await action();
      } catch (error) {
        throw new UserError(error instanceof Error ? error.message : String(error));
      }
    };
    return {
      analyze: (request) => guard(() => get().analyze(request)),
      export: (request) => guard(() => get().export(request)),
      dispose: () => undefined,
    };
  }

  const worker = new Worker(new URL('./tableWorker.ts', import.meta.url), { type: 'module' });
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  let next = 0;
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const entry = pending.get(event.data.id);
    if (!entry) return;
    pending.delete(event.data.id);
    if (event.data.ok) entry.resolve(event.data.result);
    else entry.reject(new UserError(event.data.message));
  };
  worker.onerror = (event) => {
    for (const entry of pending.values())
      entry.reject(new UserError(event.message || translate('exchange', 'export.tableFailed')));
    pending.clear();
  };
  const call = <T>(message: WithoutId<WorkerRequest>) =>
    new Promise<T>((resolve, reject) => {
      const id = ++next;
      pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      worker.postMessage({ ...message, id });
    });

  const opened = call<null>({ type: 'open', source });
  // Hata ilk analyze/export çağrısında gösterilir; burada yakalanmamış sayılmasın.
  opened.catch(() => undefined);
  return {
    analyze: async (request) => {
      await opened;
      return call<AnalyzeResult>({ type: 'analyze', request });
    },
    export: async (request) => {
      await opened;
      return call<ExportedFile>({ type: 'export', request });
    },
    dispose: () => worker.terminate(),
  };
}
