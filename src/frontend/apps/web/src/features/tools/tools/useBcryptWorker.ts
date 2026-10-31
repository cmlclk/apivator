import { useCallback, useEffect, useRef, useState } from 'react';
import { translate } from '../../../i18n';
import { runBcryptJob, type BcryptJob, type BcryptResponse } from './bcryptWorker';

type JobResult = Exclude<BcryptResponse, { type: 'progress' }>;

export interface BcryptJobState {
  status: 'idle' | 'busy' | 'done' | 'cancelled';
  progress: { done: number; total: number } | null;
  result: JobResult | null;
}

const IDLE: BcryptJobState = { status: 'idle', progress: null, result: null };

/**
 * bcrypt işini istek üzerine Worker'da çalıştırır. Yeni iş ya da iptal süren işin Worker'ını sonlandırır;
 * eski yanıtlar sıra numarasıyla elenir. Worker yoksa (test ortamı) ya da yüklenemezse aynı iş parçacığında
 * çalışır (o durumda iptal yalnızca sonucu yok sayar).
 */
export function useBcryptWorker() {
  const [state, setState] = useState<BcryptJobState>(IDLE);
  const worker = useRef<Worker | null>(null);
  const seq = useRef(0);
  const workerBroken = useRef(false);
  /** Worker en az bir kez yanıt verdiyse yüklenmiştir; sonraki hatalar yükleme hatası sayılmaz. */
  const workerReady = useRef(false);

  const stopWorker = useCallback(() => {
    worker.current?.terminate();
    worker.current = null;
  }, []);

  useEffect(
    () => () => {
      seq.current++;
      stopWorker();
    },
    [stopWorker],
  );

  const run = useCallback(
    (job: BcryptJob) => {
      const id = ++seq.current;
      // Önceki iş bitmemiş olabilir: beklemek yerine Worker sonlandırılır.
      stopWorker();
      setState({ status: 'busy', progress: null, result: null });

      const deliver = (response: BcryptResponse) => {
        if (response.id !== seq.current) return;
        if (response.type === 'progress') {
          const { done, total } = response;
          setState((s) => ({ ...s, progress: { done, total } }));
          return;
        }
        stopWorker();
        setState({ status: 'done', progress: null, result: response });
      };
      // Yoğun eşzamanlı iş: "Hesaplanıyor" durumu önce çizilsin.
      const runHere = () =>
        setTimeout(() => {
          if (id === seq.current) deliver(runBcryptJob({ ...job, id }));
        }, 0);

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
      let current: Worker;
      try {
        current = new Worker(new URL('./bcryptWorker.ts', import.meta.url), { type: 'module' });
      } catch {
        fallBack();
        return;
      }
      worker.current = current;
      current.onerror = (event) => {
        event.preventDefault();
        if (!workerReady.current) {
          fallBack();
          return;
        }
        stopWorker();
        deliver({ id, type: 'error', error: event.message || translate('toolsSecurity', 'bcrypt.failed') });
      };
      current.onmessage = (event: MessageEvent<BcryptResponse>) => {
        workerReady.current = true;
        deliver(event.data);
      };
      current.postMessage({ ...job, id });
    },
    [stopWorker],
  );

  /** Süren işi durdurur. */
  const cancel = useCallback(() => {
    seq.current++;
    stopWorker();
    setState({ status: 'cancelled', progress: null, result: null });
  }, [stopWorker]);

  return { ...state, run, cancel };
}
