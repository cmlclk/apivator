import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, renderHook, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { useToolsStore } from './toolsStore';
import JsonSchemaTool from './tools/JsonSchemaTool';
import {
  runSchemaValidate,
  type SchemaValidateJob,
  type SchemaValidateRequest,
} from './tools/schemaValidateWorker';
import {
  SCHEMA_VALIDATE_DEBOUNCE_MS,
  schemaValidateTimeoutMessage,
  SCHEMA_VALIDATE_TIMEOUT_MS,
  useSchemaValidator,
} from './tools/useSchemaValidator';

vi.mock('../../lib/useWorkspaces', () => ({
  useWorkspaces: () => ({ current: { id: 'w1', role: 'Admin' }, workspaces: [] }),
}));

vi.mock('../requests/CodeEditor', () => ({
  CodeEditor: ({ value, label }: { value: string; label: string }) => (
    <textarea aria-label={label} value={value} readOnly />
  ),
}));

/** Yanıtı testin elle verdiği sahte Worker. */
class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Partial<ErrorEvent>) => void) | null = null;
  posted: SchemaValidateRequest[] = [];
  terminate = vi.fn();
  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage(message: SchemaValidateRequest) {
    this.posted.push(message);
  }
  /** Gönderilen işi gerçekten çalıştırıp (istenirse başka bir sıra numarasıyla) yanıtlar. */
  reply(index = this.posted.length - 1, id = this.posted[index]!.id) {
    const response = runSchemaValidate({ ...this.posted[index]!, id });
    act(() => this.onmessage?.({ data: response } as MessageEvent));
  }
}

const job = (data: unknown): SchemaValidateJob => ({
  doc: { type: 'object', required: ['ad'] },
  data,
  options: {},
});

const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

describe('useSchemaValidator: Worker yok (aynı iş parçacığı)', () => {
  it('sonucu hemen verir; hata ve boş iş', () => {
    const { result, rerender } = renderHook(({ j }) => useSchemaValidator(j), {
      initialProps: { j: job({}) as SchemaValidateJob | null },
    });
    expect(result.current.busy).toBe(false);
    expect(result.current.result?.valid).toBe(false);
    expect(result.current.result?.errors[0]?.message).toContain('"ad"');
    rerender({ j: { doc: { $ref: 'https://ornek.com/s.json' }, data: {}, options: {} } });
    expect(result.current.result).toBeNull();
    expect(result.current.error).toContain('Harici $ref');
    rerender({ j: null });
    expect(result.current).toEqual({ result: null, error: null, busy: false });
  });
});

describe('useSchemaValidator: Worker', () => {
  beforeEach(() => {
    FakeWorker.instances = [];
    vi.useFakeTimers();
    vi.stubGlobal('Worker', FakeWorker);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('girdi beklenir, Worker yanıtı uygulanır', async () => {
    const valid = job({ ad: 'Ada' });
    const { result } = renderHook(() => useSchemaValidator(valid));
    expect(FakeWorker.instances).toHaveLength(0);
    await advance(SCHEMA_VALIDATE_DEBOUNCE_MS);
    const worker = FakeWorker.instances[0]!;
    expect(worker.posted).toHaveLength(1);
    expect(result.current.busy).toBe(true);
    worker.reply();
    expect(result.current).toMatchObject({ busy: false, error: null, result: { valid: true } });
  });

  it('süre aşılırsa Worker sonlandırılır ve hata gösterilir; sonraki iş yeni Worker açar', async () => {
    const { result, rerender } = renderHook(({ j }) => useSchemaValidator(j), {
      initialProps: { j: job({}) },
    });
    await advance(SCHEMA_VALIDATE_DEBOUNCE_MS);
    const stuck = FakeWorker.instances[0]!;
    await advance(SCHEMA_VALIDATE_TIMEOUT_MS - 1);
    expect(stuck.terminate).not.toHaveBeenCalled();
    await advance(1);
    expect(stuck.terminate).toHaveBeenCalled();
    expect(result.current).toEqual({ result: null, error: schemaValidateTimeoutMessage(), busy: false });

    rerender({ j: job({ ad: 'Ada' }) });
    await advance(SCHEMA_VALIDATE_DEBOUNCE_MS);
    expect(FakeWorker.instances).toHaveLength(2);
    FakeWorker.instances[1]!.reply();
    expect(result.current.result?.valid).toBe(true);
  });

  it('eski yanıtlar yok sayılır; bitmemiş iş varken yeni iş Worker’ı yeniler', async () => {
    const { result, rerender } = renderHook(({ j }) => useSchemaValidator(j), {
      initialProps: { j: job({}) },
    });
    await advance(SCHEMA_VALIDATE_DEBOUNCE_MS);
    const first = FakeWorker.instances[0]!;
    rerender({ j: job({ ad: 'Ada' }) });
    await advance(SCHEMA_VALIDATE_DEBOUNCE_MS);
    expect(first.terminate).toHaveBeenCalled();
    const second = FakeWorker.instances[1]!;
    // Eski işin sıra numarasıyla gelen yanıt uygulanmaz.
    second.reply(0, first.posted[0]!.id);
    expect(result.current.busy).toBe(true);
    expect(result.current.result).toBeNull();
    second.reply();
    expect(result.current.result?.valid).toBe(true);
    // Yanıtı gelmiş işin süresi işlemez.
    await advance(SCHEMA_VALIDATE_TIMEOUT_MS);
    expect(second.terminate).not.toHaveBeenCalled();
  });

  it('Worker yüklenemezse aynı iş parçacığına düşer', async () => {
    const { result, rerender } = renderHook(({ j }) => useSchemaValidator(j), {
      initialProps: { j: job({}) },
    });
    await advance(SCHEMA_VALIDATE_DEBOUNCE_MS);
    act(() => FakeWorker.instances[0]!.onerror?.({ preventDefault: () => {}, message: '' }));
    expect(result.current.result?.valid).toBe(false);
    rerender({ j: job({ ad: 'Ada' }) });
    expect(result.current.result?.valid).toBe(true);
    expect(FakeWorker.instances).toHaveLength(1);
  });
});

describe('Doğrula kipi: süre aşımı', () => {
  beforeEach(() => {
    localStorage.clear();
    useToolsStore.setState({ favorites: [], recent: [], inputs: {}, volatile: {}, rememberInputs: true });
    FakeWorker.instances = [];
    vi.useFakeTimers();
    vi.stubGlobal('Worker', FakeWorker);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('yanıt gelmezse Worker sonlandırılır, Türkçe hata ve meşgul durumu', async () => {
    const set = (name: string, value: string) =>
      useToolsStore.getState().setInput('json-schema', name, value);
    set('mode', 'validate');
    set('input', JSON.stringify({ type: 'string', pattern: '^(a+)+$' }));
    set('data', JSON.stringify(`${'a'.repeat(30)}b`));
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <JsonSchemaTool />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    // Şema ayrıştırması (eşzamansız) bitsin, sonra girdi beklemesi.
    await advance(0);
    await advance(SCHEMA_VALIDATE_DEBOUNCE_MS);
    expect(screen.getByRole('status')).toHaveTextContent('Doğrulanıyor…');
    await advance(SCHEMA_VALIDATE_TIMEOUT_MS);
    expect(FakeWorker.instances[0]!.terminate).toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Doğrulama 3 saniyede bitmedi');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
