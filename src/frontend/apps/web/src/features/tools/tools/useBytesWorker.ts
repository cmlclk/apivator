import { useCallback, useEffect, useRef, useState } from 'react';
import { translate } from '../../../i18n';
import { parseBytesErrorCode, runBytesJob, type BytesJob, type BytesResponse } from './bytesWorker';

type JobResult = Exclude<BytesResponse, { type: 'progress' }>;

export interface BytesJobState {
  status: 'idle' | 'busy' | 'done' | 'cancelled';
  progress: { done: number; total: number } | null;
  result: JobResult | null;
}

/** Worker'dan kodlu gelen hata metinlerini etkin dile çevirir. */
function localizeError(text: string): string {
  const coded = parseBytesErrorCode(text);
  if (!coded) return text;
  return coded.code === 'memory'
    ? translate('tools', 'worker.outOfMemory', { detail: coded.detail })
    : translate('tools', 'worker.unreadable');
}

function localize(response: BytesResponse): BytesResponse {
  if (response.type === 'error') return { ...response, error: localizeError(response.error) };
  if (response.type === 'hash')
    return {
      ...response,
      rows: response.rows.map((r) => (r.error ? { ...r, error: localizeError(r.error) } : r)),
    };
  return response;
}

const IDLE: BytesJobState = { status: 'idle', progress: null, result: null };
const DEBOUNCE_MS = 150;

/**
 * Dosya işini Worker'da çalıştırır. İş değişince süren iş bırakılır (Worker sonlandırılıp yenisi açılır),
 * eski yanıtlar sıra numarasıyla elenir. Worker yoksa (test ortamı) ya da yüklenemezse aynı iş parçacığında
 * çalışır. `job` her çizimde aynı nesne kalmalı (useMemo).
 */
export function useBytesWorker(job: BytesJob | null) {
  const [state, setState] = useState<BytesJobState>(IDLE);
  const [attempt, setAttempt] = useState(0);
  const worker = useRef<Worker | null>(null);
  const seq = useRef(0);
  const workerBroken = useRef(false);
  /** Worker en az bir kez yanıt verdiyse yüklenmiştir; sonraki hatalar yükleme hatası sayılmaz. */
  const workerReady = useRef(false);
  const inFlight = useRef(false);

  const stopWorker = useCallback(() => {
    worker.current?.terminate();
    worker.current = null;
    inFlight.current = false;
  }, []);

  useEffect(() => stopWorker, [stopWorker]);

  useEffect(() => {
    const id = ++seq.current;
    // Önceki işin sonucu artık gereksiz; bitmesini beklemek yerine Worker sonlandırılır.
    if (inFlight.current) stopWorker();
    if (!job) {
      setState(IDLE);
      return;
    }
    setState({ status: 'busy', progress: null, result: null });

    const deliver = (response: BytesResponse) => {
      if (response.id !== seq.current) return;
      if (response.type === 'progress') {
        const { done, total } = response;
        setState((s) => ({ ...s, progress: { done, total } }));
        return;
      }
      inFlight.current = false;
      setState({ status: 'done', progress: null, result: localize(response) as JobResult });
    };
    const runHere = () => {
      void runBytesJob({ ...job, id }, deliver).then(({ response }) => deliver(response));
    };

    const debounce = setTimeout(() => {
      if (id !== seq.current) return; // bu arada iptal edildi
      if (typeof Worker === 'undefined' || workerBroken.current) {
        runHere();
        return;
      }
      // Worker açılamazsa (CSP, modül worker desteği yok) bundan sonra aynı iş parçacığında çalışılır.
      const fallBack = () => {
        workerBroken.current = true;
        stopWorker();
        if (id === seq.current) runHere();
      };
      if (!worker.current) {
        try {
          worker.current = new Worker(new URL('./bytesWorker.ts', import.meta.url), { type: 'module' });
        } catch {
          fallBack();
          return;
        }
      }
      const current = worker.current;
      current.onerror = (event) => {
        event.preventDefault();
        if (!workerReady.current) {
          fallBack();
          return;
        }
        stopWorker();
        deliver({ id, type: 'error', error: event.message || translate('tools', 'worker.failed') });
      };
      current.onmessage = (event: MessageEvent<BytesResponse>) => {
        workerReady.current = true;
        deliver(event.data);
      };
      inFlight.current = true;
      current.postMessage({ ...job, id });
    }, DEBOUNCE_MS);
    return () => clearTimeout(debounce);
  }, [job, attempt, stopWorker]);

  /** Süren işi durdurur; aynı iş parçacığında çalışıyorsa yalnızca sonucu yok sayılır. */
  const cancel = useCallback(() => {
    seq.current++;
    stopWorker();
    setState({ status: 'cancelled', progress: null, result: null });
  }, [stopWorker]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { ...state, cancel, retry };
}
