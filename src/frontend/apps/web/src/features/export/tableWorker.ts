/// <reference lib="webworker" />
import { createTableSession, type TableSession } from '@apivator/core/tableExport';
import type { WorkerRequest, WorkerResponse } from './tableEngine';

/** Büyük yanıtlarda arayüz donmasın diye çözümleme ve dosya üretimi burada yapılır. */
let session: TableSession | null = null;

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  const reply = (response: WorkerResponse, transfer: Transferable[] = []) =>
    (self as unknown as DedicatedWorkerGlobalScope).postMessage(response, transfer);
  try {
    if (message.type === 'open') {
      session = createTableSession(message.source);
      reply({ id: message.id, ok: true, result: null });
    } else if (message.type === 'analyze') {
      reply({ id: message.id, ok: true, result: session!.analyze(message.request) });
    } else {
      const file = await session!.export(message.request);
      reply({ id: message.id, ok: true, result: file }, [file.data.buffer]);
    }
  } catch (error) {
    reply({ id: message.id, ok: false, message: error instanceof Error ? error.message : String(error) });
  }
};
