import { useEffect, useMemo, useRef, useState } from 'react';
import { textStats, type TextStats } from '@apivator/core/tools';
import { runTextStats, type TextStatsResponse } from './textStatsWorker';

/** Bu boyuta kadar istatistikler her değişiklikte hemen, ana iş parçacığında hesaplanır. */
const IMMEDIATE_LIMIT = 100_000;
const DEBOUNCE_MS = 300;

/**
 * Metin istatistikleri. Küçük metin hemen sayılır; büyük metin (5 MB) yazmayı bekler ve Worker'da sayılır,
 * böylece sekme donmaz. Metin değişirken süren sayım Worker sonlandırılarak bırakılır, eski yanıtlar sıra
 * numarasıyla elenir. Worker yoksa (test ortamı) ya da yüklenemezse aynı iş parçacığında sayılır.
 */
export function useTextStats(text: string): { stats: TextStats | null; pending: boolean } {
  const immediate = text.length <= IMMEDIATE_LIMIT;
  const sync = useMemo(() => (immediate ? textStats(text) : null), [text, immediate]);
  const [deferred, setDeferred] = useState<{ text: string; stats: TextStats } | null>(null);
  const worker = useRef<Worker | null>(null);
  const seq = useRef(0);
  const inFlight = useRef(false);
  const workerBroken = useRef(false);

  useEffect(
    () => () => {
      worker.current?.terminate();
      worker.current = null;
    },
    [],
  );

  useEffect(() => {
    const id = ++seq.current;
    const stopWorker = () => {
      worker.current?.terminate();
      worker.current = null;
      inFlight.current = false;
    };
    // Önceki sayımın sonucu artık gereksiz; bitmesini beklemek yerine Worker sonlandırılır.
    if (inFlight.current) stopWorker();
    if (immediate) return;

    const runHere = () => {
      const response = runTextStats({ id, text });
      if (id === seq.current && response.type === 'result') setDeferred({ text, stats: response.stats });
    };
    const timer = setTimeout(() => {
      if (id !== seq.current) return;
      if (typeof Worker === 'undefined' || workerBroken.current) {
        runHere();
        return;
      }
      // Worker açılamazsa ya da çökerse (CSP, modül worker desteği yok) bundan sonra burada sayılır.
      const fallBack = () => {
        workerBroken.current = true;
        stopWorker();
        if (id === seq.current) runHere();
      };
      if (!worker.current) {
        try {
          worker.current = new Worker(new URL('./textStatsWorker.ts', import.meta.url), { type: 'module' });
        } catch {
          fallBack();
          return;
        }
      }
      const current = worker.current;
      current.onerror = (event) => {
        event.preventDefault();
        fallBack();
      };
      current.onmessage = (event: MessageEvent<TextStatsResponse>) => {
        const response = event.data;
        if (response.id !== seq.current) return;
        inFlight.current = false;
        if (response.type === 'result') setDeferred({ text, stats: response.stats });
        else runHere();
      };
      inFlight.current = true;
      current.postMessage({ id, text });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text, immediate]);

  if (sync) return { stats: sync, pending: false };
  return { stats: deferred?.stats ?? null, pending: deferred?.text !== text };
}
