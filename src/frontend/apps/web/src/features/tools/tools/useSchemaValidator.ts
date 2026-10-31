import { useCallback, useEffect, useRef, useState } from 'react';
import type { SchemaValidationResult } from '@apivator/core/tools';
import { translate } from '../../../i18n';
import {
  runSchemaValidate,
  type SchemaValidateJob,
  type SchemaValidateResponse,
} from './schemaValidateWorker';

export const SCHEMA_VALIDATE_TIMEOUT_MS = 3000;
export const SCHEMA_VALIDATE_DEBOUNCE_MS = 300;
export const schemaValidateTimeoutMessage = (): string =>
  translate('toolsData', 'schemaValidate.timeout', { seconds: SCHEMA_VALIDATE_TIMEOUT_MS / 1000 });

export interface SchemaValidatorState {
  result: SchemaValidationResult | null;
  error: string | null;
  /** Worker'da doğrulama sürüyor (önceki sonuç bu sırada görünür kalır). */
  busy: boolean;
}

const IDLE: SchemaValidatorState = { result: null, error: null, busy: false };

const toState = (response: SchemaValidateResponse): SchemaValidatorState =>
  response.type === 'result'
    ? { result: response.result, error: null, busy: false }
    : { result: null, error: response.error, busy: false };

/**
 * Doğrulamayı Worker'da çalıştırır: girdi değişimi beklenir, süre aşılırsa Worker sonlandırılır (sonraki işte yenisi
 * açılır). Yanıtı beklenen iş varken yeni iş gelirse Worker sonlandırılıp yenisi açılır; eski yanıtlar sıra
 * numarasıyla elenir. Worker yoksa (test ortamı) ya da yüklenemezse aynı iş parçacığında çalışır. `job` kimliğiyle
 * karşılaştırılır: yalnızca girdi değişince yeni nesne verilmeli.
 */
export function useSchemaValidator(job: SchemaValidateJob | null): SchemaValidatorState {
  const [state, setState] = useState<SchemaValidatorState>(IDLE);
  const worker = useRef<Worker | null>(null);
  /** Worker'a gönderilip yanıtı gelmemiş iş var. */
  const pending = useRef(false);
  const seq = useRef(0);
  const workerBroken = useRef(false);
  /** Worker en az bir kez yanıt verdiyse yüklenmiştir; sonraki hatalar yükleme hatası sayılmaz. */
  const workerReady = useRef(false);

  const stopWorker = useCallback(() => {
    worker.current?.terminate();
    worker.current = null;
    pending.current = false;
  }, []);

  useEffect(
    () => () => {
      seq.current++;
      stopWorker();
    },
    [stopWorker],
  );

  useEffect(() => {
    const id = ++seq.current;
    if (!job) {
      // Süren (belki hiç bitmeyecek) iş arka planda çalışmaya devam etmesin.
      if (pending.current) stopWorker();
      setState(IDLE);
      return;
    }
    if (typeof Worker === 'undefined' || workerBroken.current) {
      setState(toState(runSchemaValidate({ ...job, id })));
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Worker açılamazsa (CSP, modül worker desteği yok) bundan sonra aynı iş parçacığında çalışılır.
    const fallBack = () => {
      clearTimeout(timer);
      workerBroken.current = true;
      stopWorker();
      if (id === seq.current) setState(toState(runSchemaValidate({ ...job, id })));
    };
    const debounce = setTimeout(() => {
      // Önceki iş bitmemiş olabilir: sırada beklemek yerine Worker sonlandırılır.
      if (pending.current) stopWorker();
      if (!worker.current) {
        try {
          worker.current = new Worker(new URL('./schemaValidateWorker.ts', import.meta.url), {
            type: 'module',
          });
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
        clearTimeout(timer);
        if (worker.current === current) stopWorker();
        else current.terminate();
        if (id === seq.current)
          setState({
            result: null,
            error: event.message || translate('toolsData', 'schemaValidate.failed'),
            busy: false,
          });
      };
      current.onmessage = (event: MessageEvent<SchemaValidateResponse>) => {
        workerReady.current = true;
        if (worker.current === current) pending.current = false;
        if (event.data.id !== seq.current) return;
        clearTimeout(timer);
        setState(toState(event.data));
      };
      try {
        current.postMessage({ ...job, id });
      } catch (e) {
        // Kopyalanamayan değer (DataCloneError).
        setState({ result: null, error: e instanceof Error ? e.message : String(e), busy: false });
        return;
      }
      pending.current = true;
      setState((s) => ({ ...s, busy: true }));
      timer = setTimeout(() => {
        if (worker.current === current) stopWorker();
        else current.terminate();
        if (id === seq.current)
          setState({ result: null, error: schemaValidateTimeoutMessage(), busy: false });
      }, SCHEMA_VALIDATE_TIMEOUT_MS);
    }, SCHEMA_VALIDATE_DEBOUNCE_MS);
    return () => {
      clearTimeout(debounce);
      clearTimeout(timer);
    };
  }, [job, stopWorker]);

  return state;
}
