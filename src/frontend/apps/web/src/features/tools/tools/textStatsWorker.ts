/**
 * Metin sayacı işi. 5 MB metinde hesap ~0,75 sn sürer; sekme donmasın diye büyük metinler Worker'da sayılır,
 * Worker yoksa (test ortamı) aynı fonksiyon ana iş parçacığında çağrılır.
 */
import { textStats, type TextStats } from '@apivator/core/tools';

export interface TextStatsRequest {
  id: number;
  text: string;
}

export type TextStatsResponse =
  { id: number; type: 'result'; stats: TextStats } | { id: number; type: 'error'; error: string };

/** Sayar; hiçbir zaman fırlatmaz. */
export function runTextStats({ id, text }: TextStatsRequest): TextStatsResponse {
  try {
    return { id, type: 'result', stats: textStats(text) };
  } catch (e) {
    return { id, type: 'error', error: e instanceof Error ? e.message : String(e) };
  }
}

// Worker içinde çalışırken mesajları dinle (ana iş parçacığında içe aktarılınca bir şey yapmaz).
if (typeof window === 'undefined' && typeof self !== 'undefined' && 'postMessage' in self) {
  self.onmessage = (event: MessageEvent<TextStatsRequest>) => {
    self.postMessage(runTextStats(event.data));
  };
}
