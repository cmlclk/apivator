import { create } from 'zustand';
import { translate } from '../../i18n';
import type { ConsoleEntry, ExecuteResponse, HttpHeader, SentRequest, TestResult } from '@apivator/core';

/** Konsoldaki bir gönderim: hedefe giden istek, yanıtın özeti ve script çıktıları. Yalnızca bu oturumda tutulur. */
export interface ConsoleRecord {
  id: string;
  time: number;
  requestName: string;
  method: string;
  url: string;
  status: number | null;
  statusText: string | null;
  timeMs: number;
  size: number;
  error: { code: string; message: string } | null;
  request: SentRequest | null;
  responseHeaders: HttpHeader[];
  responseBody: string;
  logs: ConsoleEntry[];
  tests: TestResult[];
}

const MAX_RECORDS = 100;
const MAX_BODY = 20_000;

interface ConsoleState {
  records: ConsoleRecord[];
  open: boolean;
  add: (requestName: string, method: string, url: string, response: ExecuteResponse) => void;
  clear: () => void;
  setOpen: (open: boolean) => void;
}

export const useConsole = create<ConsoleState>()((set) => ({
  records: [],
  open: false,
  add: (requestName, method, url, response) =>
    set((s) => {
      const record: ConsoleRecord = {
        id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
        time: Date.now(),
        requestName,
        method: response.request?.method ?? method,
        url: response.request?.url ?? url,
        status: response.status,
        statusText: response.statusText,
        timeMs: response.timeMs,
        size: response.size,
        error: response.error,
        request: response.request ?? null,
        responseHeaders: response.headers,
        responseBody:
          response.bodyEncoding === 'base64'
            ? translate('console', 'binaryBody', { size: response.size })
            : response.body.length > MAX_BODY
              ? `${response.body.slice(0, MAX_BODY)}…`
              : response.body,
        logs: response.console ?? [],
        tests: response.tests ?? [],
      };
      return { records: [...s.records, record].slice(-MAX_RECORDS) };
    }),
  clear: () => set({ records: [] }),
  setOpen: (open) => set({ open }),
}));
