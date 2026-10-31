import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from './client';
import { ApiError, NetworkError } from './errors';
import { emptyAuth, emptyBody } from './http';
import type { AuthResult, RunEvent } from './types';

const session: AuthResult = {
  accessToken: 'new-token',
  accessTokenExpiresAt: '2026-10-20T10:00:00Z',
  refreshToken: 'rt',
  refreshTokenExpiresAt: '2026-11-03T10:00:00Z',
  user: { id: '1', email: 'a@example.com', displayName: 'Ayşe', emailConfirmed: false },
};

function json(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function setup(responses: Response[]) {
  let token: string | null = 'old-token';
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => responses.shift() ?? json(500));
  const onSession = vi.fn((s: AuthResult | null) => {
    token = s?.accessToken ?? null;
  });
  const client = createApiClient({
    getAccessToken: () => token,
    onSession,
    fetch: fetchMock as unknown as typeof fetch,
  });
  return { client, fetchMock, onSession };
}

describe('createApiClient', () => {
  it('attaches the bearer token', async () => {
    const { client, fetchMock } = setup([json(200, [])]);
    await client.workspaces.list();

    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer old-token');
    expect(init.credentials).toBe('include');
  });

  it('refreshes once on 401 and retries with the new token', async () => {
    const { client, fetchMock, onSession } = setup([
      json(401),
      json(200, session),
      json(200, [{ id: 'w1' }]),
    ]);

    const result = await client.workspaces.list();

    expect(result).toEqual([{ id: 'w1' }]);
    expect(onSession).toHaveBeenCalledWith(session);
    expect(fetchMock.mock.calls[1]![0]).toBe('/api/auth/refresh');
    const retry = fetchMock.mock.calls[2]![1] as RequestInit;
    expect((retry.headers as Record<string, string>).Authorization).toBe('Bearer new-token');
  });

  it('clears the session when refresh fails', async () => {
    const { client, onSession } = setup([json(401), json(401)]);

    await expect(client.workspaces.list()).rejects.toBeInstanceOf(ApiError);
    expect(onSession).toHaveBeenCalledWith(null);
  });

  it('shares a single refresh between concurrent 401s', async () => {
    const { client, fetchMock } = setup([
      json(401),
      json(401),
      json(200, session),
      json(200, []),
      json(200, []),
    ]);

    await Promise.all([client.workspaces.list(), client.workspaces.list()]);

    const refreshCalls = fetchMock.mock.calls.filter(([url]) => url === '/api/auth/refresh');
    expect(refreshCalls).toHaveLength(1);
  });

  it('does not refresh for auth endpoints', async () => {
    const { client, fetchMock } = setup([
      json(401, { detail: 'E-posta veya şifre hatalı.', code: 'auth.invalid_credentials' }),
    ]);

    const error = await client.auth.login({ email: 'a@example.com', password: 'x' }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toBe('E-posta veya şifre hatalı.');
    expect((error as ApiError).code).toBe('auth.invalid_credentials');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maps validation problems to field errors', async () => {
    const { client } = setup([
      json(400, {
        detail: 'Gönderilen bilgiler geçersiz.',
        errors: { Password: ['Şifre en az 8 karakter olmalı.'] },
      }),
    ]);

    const error = (await client.auth
      .register({ email: 'a@example.com', password: 'x', displayName: 'A' })
      .catch((e: unknown) => e)) as ApiError;

    expect(error.fieldError('password')).toBe('Şifre en az 8 karakter olmalı.');
  });

  it('wraps network failures', async () => {
    const client = createApiClient({
      getAccessToken: () => null,
      onSession: () => {},
      fetch: (() => Promise.reject(new TypeError('Failed to fetch'))) as typeof fetch,
    });

    await expect(client.me()).rejects.toBeInstanceOf(NetworkError);
  });
});

describe('ApiError', () => {
  it('kodsuz 404 için API güncel değil mesajı verir', async () => {
    const error = await ApiError.fromResponse(json(404, { title: 'Not Found', status: 404 }));
    expect(error.message).toContain('API güncel değilse');
  });

  it('uygulamanın kendi 404 mesajını korur', async () => {
    const error = await ApiError.fromResponse(
      json(404, { detail: 'İstek bulunamadı.', code: 'request.not_found' }),
    );
    expect(error.message).toBe('İstek bulunamadı.');
  });
});

describe('fileNameFrom', () => {
  it('prefers the UTF-8 file name', async () => {
    const { fileNameFrom } = await import('./client');
    expect(
      fileNameFrom(
        `attachment; filename="_deme API.json"; filename*=UTF-8''%C3%96deme%20API.postman_collection.json`,
      ),
    ).toBe('Ödeme API.postman_collection.json');
    expect(fileNameFrom('attachment; filename=a.json')).toBe('a.json');
    expect(fileNameFrom(null)).toBeNull();
  });
});

describe('runs.start', () => {
  it('parses NDJSON events split across chunks', async () => {
    const encoder = new TextEncoder();
    const chunks = [
      '{"type":"start","iterations":1}\n{"type":"res',
      'ult","result":{"name":"A"}}\n',
      '{"type":"done"}',
    ];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });
    const { client } = setup([new Response(body, { status: 200 })]);
    const events: string[] = [];

    await client.runs.start({ collectionId: 'c' }, (e) =>
      events.push(e.type + (e.result ? `:${e.result.name}` : '')),
    );

    expect(events).toEqual(['start', 'result:A', 'done']);
  });
});

describe('masaüstü modu', () => {
  function desktop(responses: Response[], stored: string | null = 'rt-stored') {
    let refresh: string | null = stored;
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => responses.shift() ?? json(500));
    const onSession = vi.fn();
    const store = {
      get: vi.fn(async () => refresh),
      set: vi.fn(async (t: string | null) => {
        refresh = t;
      }),
    };
    let server = 'https://api.example.com';
    const client = createApiClient({
      baseUrl: () => server,
      getAccessToken: () => 'at',
      onSession,
      refreshTokens: store,
      localAgent: async () => ({ url: 'http://127.0.0.1:4000', token: 'ajan-tokeni' }),
      fetch: fetchMock as unknown as typeof fetch,
    });
    return { client, fetchMock, onSession, store, setServer: (s: string) => (server = s) };
  }

  it('iki adımlı girişte refresh token ancak ikinci adımdan sonra saklanır', async () => {
    const { client, fetchMock, store } = desktop([
      json(200, { twoFactorRequired: true, challengeToken: 'ch', expiresAt: '2026-10-20T10:05:00Z' }),
      json(200, { accessToken: 'at2', refreshToken: 'rt-yeni', user: { id: 'u' } }),
    ]);
    const first = await client.auth.login({ email: 'a@b.c', password: 'x' });
    expect('twoFactorRequired' in first).toBe(true);
    expect(store.set).not.toHaveBeenCalled();

    await client.auth.loginTwoFactor('ch', '123456');
    expect(fetchMock.mock.calls[1]![0]).toBe('https://api.example.com/api/auth/login/2fa');
    expect(JSON.parse(fetchMock.mock.calls[1]![1]!.body as string)).toEqual({
      challengeToken: 'ch',
      code: '123456',
    });
    expect(store.set).toHaveBeenCalledWith('rt-yeni');
  });

  it('Swagger adresini ajan çeker, belgeyi sunucuya gönderir; sürüm listesi sunucuya gitmez', async () => {
    const { client, fetchMock } = desktop([
      json(200, {
        url: null,
        content: null,
        choices: [{ name: 'v1', url: 'http://localhost:5000/v1.json' }],
        tried: [],
      }),
      json(200, {
        url: 'http://localhost:5000/v1.json',
        content: 'openapi: 3.0.0',
        choices: null,
        tried: [],
      }),
      json(201, { result: { kind: 'collection', name: 'Yerel' }, choices: null }),
    ]);

    const first = await client.importExport.importFromUrl('w1', 'localhost:5000', [
      { key: 'Authorization', value: 'Bearer t', enabled: true },
    ]);
    expect(first.choices).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe('http://127.0.0.1:4000/openapi/fetch');
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual({
      url: 'localhost:5000',
      headers: [{ key: 'Authorization', value: 'Bearer t', enabled: true }],
    });

    const second = await client.importExport.importFromUrl('w1', 'http://localhost:5000/v1.json');
    expect(second.result?.name).toBe('Yerel');
    const [serverUrl, init] = fetchMock.mock.calls[2]!;
    expect(serverUrl).toBe('https://api.example.com/api/workspaces/w1/import/url');
    // Header'lar sunucuya gitmez; belge metni gider.
    expect(JSON.parse(init!.body as string)).toEqual({
      url: 'http://localhost:5000/v1.json',
      document: 'openapi: 3.0.0',
    });
  });

  it('istekleri yerel ajana token ile, çerezsiz gönderir', async () => {
    const { client, fetchMock } = desktop([json(200, { status: 200 }), json(200, { accessToken: 'x' })]);

    await client.execute({ method: 'GET', url: 'http://localhost:3000', headers: [], body: null } as never);
    await client.oauth2.token({ auth: {} as never });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:4000/execute');
    expect((init!.headers as Record<string, string>)['X-Apivator-Agent-Token']).toBe('ajan-tokeni');
    expect((init!.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(init!.credentials).toBeUndefined();
    expect(fetchMock.mock.calls[1]![0]).toBe('http://127.0.0.1:4000/oauth2/token');
    expect(client.local).toBe(true);
  });

  it('ajana ulaşılamazsa anlaşılır bir AgentError fırlatır', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const client = createApiClient({
      getAccessToken: () => null,
      onSession: () => {},
      localAgent: async () => {
        throw new Error('Yerel ajan kapandı (çıkış kodu 1).');
      },
      fetch: fetchMock as unknown as typeof fetch,
    });
    await expect(client.execute({} as never)).rejects.toMatchObject({
      name: 'AgentError',
      message: expect.stringContaining('Yerel ajan kapandı'),
    });

    const unreachable = createApiClient({
      getAccessToken: () => null,
      onSession: () => {},
      localAgent: async () => ({ url: 'http://127.0.0.1:1', token: 't' }),
      fetch: fetchMock as unknown as typeof fetch,
    });
    await expect(unreachable.execute({} as never)).rejects.toMatchObject({ name: 'AgentError' });
  });

  it('sunucu adresini her istekte yeniden okur', async () => {
    const { client, fetchMock, setServer } = desktop([json(200, []), json(200, [])]);
    await client.workspaces.list();
    setServer('https://diger.example.com');
    await client.workspaces.list();
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      'https://api.example.com/api/workspaces',
      'https://diger.example.com/api/workspaces',
    ]);
  });

  it('refresh token gövdede gönderilir, yenisi saklanır; reddedilirse silinir', async () => {
    const { client, fetchMock, store } = desktop([json(200, session), json(401)]);

    expect(await client.refreshSession()).toEqual(session);
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual({ refreshToken: 'rt-stored' });
    expect(store.set).toHaveBeenLastCalledWith('rt');

    expect(await client.refreshSession()).toBeNull();
    expect(store.set).toHaveBeenLastCalledWith(null);
  });

  it('saklı token yoksa sunucuya gitmeden oturumsuz açılır; ağ hatasında token korunur', async () => {
    const empty = desktop([], null);
    expect(await empty.client.refreshSession()).toBeNull();
    expect(empty.fetchMock).not.toHaveBeenCalled();
    expect(empty.onSession).toHaveBeenCalledWith(null);

    const offline = desktop([]);
    offline.fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await offline.client.refreshSession()).toBeNull();
    expect(offline.store.set).not.toHaveBeenCalled();
  });

  it('girişte token saklanır, çıkışta silinir', async () => {
    const { client, fetchMock, store } = desktop([json(200, session), new Response(null, { status: 204 })]);
    await client.auth.login({ email: 'a@example.com', password: 'x' });
    expect(store.set).toHaveBeenLastCalledWith('rt');

    await client.auth.logout();
    expect(JSON.parse(fetchMock.mock.calls[1]![1]!.body as string)).toEqual({ refreshToken: 'rt' });
    expect(store.set).toHaveBeenLastCalledWith(null);
  });
});

describe('masaüstü runner', () => {
  const source = {
    collectionId: 'c1',
    name: 'Mağaza',
    auth: {},
    scripts: { preRequest: '', postResponse: '' },
    variables: [],
    folders: [{ id: 'f1', parentFolderId: null, name: 'Sipariş', sortOrder: 0 }],
    requests: [],
  };
  const result = (name: string) => ({
    iteration: 0,
    requestId: 'r',
    name,
    method: 'GET',
    url: 'http://localhost:3000',
    status: 200,
    timeMs: 5,
    size: 2,
    error: null,
    tests: [],
  });
  const ndjson = (events: unknown[]) =>
    new Response(events.map((e) => JSON.stringify(e)).join('\n') + '\n', { status: 200 });

  function client(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>) {
    const fetchMock = vi.fn(fetchImpl);
    return {
      fetchMock,
      api: createApiClient({
        baseUrl: 'https://api.example.com',
        getAccessToken: () => 'at',
        onSession: () => {},
        localAgent: async () => ({ url: 'http://127.0.0.1:4000', token: 't' }),
        fetch: fetchMock as unknown as typeof fetch,
      }),
    };
  }

  it('kaynağı sunucudan alır, ajanda çalıştırır, raporu kaydedip özetle bitirir', async () => {
    const summary = { id: 'run-1', origin: 'Desktop' };
    const { api, fetchMock } = client(async (url) => {
      if (url.endsWith('/run-source')) return json(200, source);
      if (url === 'http://127.0.0.1:4000/runs')
        return ndjson([
          { type: 'start', iterations: 1, requests: [] },
          { type: 'result', result: result('A') },
          {
            type: 'done',
            variables: { environment: { x: '1' } },
            report: { name: 'Mağaza', iterations: 1, status: 'Completed', results: [result('A')] },
          },
        ]);
      if (url.endsWith('/api/runs/report')) return json(200, summary);
      return json(500);
    });
    const events: RunEvent[] = [];

    await api.runs.start({ collectionId: 'c1', variables: { environmentName: 'Yerel' } } as never, (e) =>
      events.push(e),
    );

    expect(events.map((e) => e.type)).toEqual(['start', 'result', 'done']);
    expect(events[2]).toMatchObject({ runId: 'run-1', summary, variables: { environment: { x: '1' } } });
    const agentBody = JSON.parse(fetchMock.mock.calls[1]![1]!.body as string);
    expect(agentBody.source.name).toBe('Mağaza');
    const report = JSON.parse(fetchMock.mock.calls[2]![1]!.body as string);
    expect(report).toMatchObject({ collectionId: 'c1', environmentName: 'Yerel', status: 'Completed' });
  });

  it('durdurulunca o ana kadarki sonuçları "Stopped" olarak kaydeder', async () => {
    const controller = new AbortController();
    const saved: unknown[] = [];
    const { api } = client(async (url, init) => {
      if (url.endsWith('/run-source')) return json(200, source);
      if (url.endsWith('/api/runs/report')) {
        saved.push(JSON.parse(init!.body as string));
        return json(200, { id: 'x' });
      }
      // Bir sonuç gönderir, sonra durdurulana kadar bekler.
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new TextEncoder().encode(JSON.stringify({ type: 'result', result: result('A') }) + '\n'));
          init!.signal!.addEventListener('abort', () => c.error(new DOMException('durdu', 'AbortError')));
        },
      });
      return new Response(stream, { status: 200 });
    });

    const run = api.runs.start(
      { collectionId: 'c1', folderId: 'f1', iterations: 3 } as never,
      (e) => e.type === 'result' && controller.abort(),
      controller.signal,
    );

    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
    expect(saved).toEqual([
      expect.objectContaining({
        name: 'Mağaza / Sipariş',
        status: 'Stopped',
        iterations: 3,
        results: [result('A')],
      }),
    ]);
  });

  it('ajan raporsuz biterse AgentError fırlatır', async () => {
    const { api } = client(async (url) =>
      url.endsWith('/run-source') ? json(200, source) : ndjson([{ type: 'start', iterations: 1 }]),
    );
    await expect(api.runs.start({ collectionId: 'c1' } as never, () => {})).rejects.toMatchObject({
      name: 'AgentError',
    });
  });
});

describe('streaming and WebSocket relay', () => {
  const lines = (events: unknown[]) =>
    new Response(events.map((e) => JSON.stringify(e)).join('\n') + '\n', { status: 200 });
  const request = {
    method: 'GET',
    url: 'https://x/sse',
    headers: [],
    body: emptyBody(),
    auth: emptyAuth('None'),
  };

  it('streams SSE events from the server', async () => {
    const { client, fetchMock } = setup([
      lines([
        { type: 'open', status: 200 },
        { type: 'event', event: 'message', data: 'a' },
        { type: 'done' },
      ]),
    ]);
    const events: string[] = [];
    await client.executeStream(request, (e) => events.push(e.type));
    expect(events).toEqual(['open', 'event', 'done']);
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/execute/stream');
  });

  it('streams through the local agent when present', async () => {
    const fetchMock = vi.fn(async () => lines([{ type: 'done' }]));
    const client = createApiClient({
      getAccessToken: () => 't',
      onSession: () => undefined,
      fetch: fetchMock as unknown as typeof fetch,
      localAgent: async () => ({ url: 'http://127.0.0.1:7777', token: 'ajan' }),
    });
    const events: string[] = [];
    await client.executeStream(request, (e) => events.push(e.type));
    expect(events).toEqual(['done']);
    expect((fetchMock.mock.calls[0] as unknown[])[0]).toBe('http://127.0.0.1:7777/execute/stream');
    expect(await client.webSocketRelayUrl()).toBe('ws://127.0.0.1:7777/ws-proxy?token=ajan&lang=tr');
  });

  it('builds the server relay URL and refreshes an expired token first', async () => {
    const expired = `x.${btoa(JSON.stringify({ exp: 1 }))}.y`;
    let token: string | null = expired;
    const fetchMock = vi.fn(async () => json(200, { ...session, accessToken: 'taze' }));
    const client = createApiClient({
      baseUrl: 'https://apivator.test',
      getAccessToken: () => token,
      onSession: (s) => {
        token = s?.accessToken ?? null;
      },
      fetch: fetchMock as unknown as typeof fetch,
    });
    expect(await client.webSocketRelayUrl()).toBe(
      'wss://apivator.test/hubs/ws-proxy?access_token=taze&lang=tr',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('reachability', () => {
  it('reports unreachable server and keeps the session when refresh cannot reach it', async () => {
    const reach: boolean[] = [];
    const onSession = vi.fn();
    const store = { get: vi.fn(async () => 'saklı'), set: vi.fn(async () => undefined) };
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(json(200, []));
    const client = createApiClient({
      getAccessToken: () => null,
      onSession,
      refreshTokens: store,
      onReachability: (r) => reach.push(r),
      fetch: fetchMock as unknown as typeof fetch,
    });

    expect(await client.refreshSession()).toBeNull();
    expect(await client.refreshSession()).toBeNull();
    expect(onSession).not.toHaveBeenCalled();
    expect(store.set).not.toHaveBeenCalled();
    await client.workspaces.list();
    expect(reach).toEqual([false, false, true]);
  });

  it('still signs out when no reachability handler is given', async () => {
    const { client, onSession } = setup([]);
    const failing = createApiClient({
      getAccessToken: () => null,
      onSession,
      fetch: (async () => {
        throw new TypeError('offline');
      }) as unknown as typeof fetch,
    });
    void client;
    await failing.refreshSession();
    expect(onSession).toHaveBeenCalledWith(null);
  });

  it('lists all requests of a collection', async () => {
    const { client, fetchMock } = setup([json(200, [{ id: 'r1' }])]);
    expect(await client.requests.list('c1')).toEqual([{ id: 'r1' }]);
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/collections/c1/requests');
  });
});

describe('hesap', () => {
  it('görseli ham gövdeyle, kendi içerik türüyle yükler', async () => {
    const { client, fetchMock } = setup([json(200, { avatarVersion: 42 })]);
    const image = new Blob([new Uint8Array([0x89, 0x50])], { type: 'image/png' });

    expect(await client.account.setAvatar(image)).toEqual({ avatarVersion: 42 });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/me/avatar');
    expect(init!.method).toBe('PUT');
    expect(init!.body).toBe(image);
    expect((init!.headers as Record<string, string>)['Content-Type']).toBe('image/png');
  });

  it('istemci türünü (masaüstü) her istekte bildirir', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => json(200, []));
    const client = createApiClient({
      getAccessToken: () => 't',
      onSession: () => undefined,
      fetch: fetchMock as unknown as typeof fetch,
      app: 'desktop',
    });

    await client.account.sessions();

    expect(fetchMock.mock.calls[0]![0]).toBe('/api/me/sessions');
    expect((fetchMock.mock.calls[0]![1]!.headers as Record<string, string>)['X-Apivator-App']).toBe(
      'desktop',
    );
  });

  it('e-posta bağlantılarındaki onaylar oturum yenilemeye çalışmaz', async () => {
    const { client, fetchMock } = setup([json(401)]);

    await expect(client.account.confirmDeletion('u1', 'tok')).rejects.toBeInstanceOf(ApiError);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual({ userId: 'u1', token: 'tok' });
  });
});
