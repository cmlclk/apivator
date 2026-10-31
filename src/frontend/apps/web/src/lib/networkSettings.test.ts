import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const keychain = new Map<string, string>();
const invoke = vi.fn(async (command: string, args: Record<string, string> = {}) => {
  if (command === 'agent_info') return { url: 'http://127.0.0.1:4000', token: 'ajan' };
  if (command === 'secret_get') return keychain.get(args.key!) ?? null;
  if (command === 'secret_set') return void keychain.set(args.key!, args.value!);
  if (command === 'secret_delete') return void keychain.delete(args.key!);
  throw new Error(command);
});
vi.mock('@tauri-apps/api/core', () => ({ invoke: (c: string, a?: Record<string, string>) => invoke(c, a) }));

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();

const {
  DEFAULT_NETWORK_SETTINGS,
  loadNetworkSettings,
  saveNetworkSettings,
  localAgentWithSettings,
  networkStartupError,
} = await import('./networkSettings');

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
});
afterEach(() => {
  keychain.clear();
  localStorage.clear();
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe('networkSettings', () => {
  it('parolaları anahtar zincirinde, geri kalanını yerel depoda saklar', async () => {
    await saveNetworkSettings(
      {
        ...DEFAULT_NETWORK_SETTINGS,
        proxyMode: 'Custom',
        proxyUrl: ' http://proxy:8080 ',
        proxyPassword: 'p-gizli',
        clientCertificates: [{ host: 'api.ornek.com', path: 'C:\\c.pfx', password: 'c-gizli' }],
      },
      0,
    );

    const stored = localStorage.getItem('apivator-network-settings')!;
    expect(stored).not.toContain('gizli');
    expect(keychain.get('network:proxy_password')).toBe('p-gizli');
    expect(keychain.get('network:cert_password:0')).toBe('c-gizli');

    const sent = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(sent).toMatchObject({ proxyUrl: 'http://proxy:8080', proxyPassword: 'p-gizli' });
    expect((fetchMock.mock.calls[0]![1]!.headers as Record<string, string>)['X-Apivator-Agent-Token']).toBe(
      'ajan',
    );

    const loaded = await loadNetworkSettings();
    expect(loaded.proxyPassword).toBe('p-gizli');
    expect(loaded.clientCertificates[0]!.password).toBe('c-gizli');
  });

  it('ajan reddederse kaydetmez ve hatayı iletir', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: 'Proxy adresi http://sunucu:port biçiminde olmalı.' }), {
        status: 400,
      }),
    );
    await expect(
      saveNetworkSettings({ ...DEFAULT_NETWORK_SETTINGS, proxyMode: 'Custom' }, 0),
    ).rejects.toThrow('Proxy adresi');
    expect(localStorage.getItem('apivator-network-settings')).toBeNull();
  });

  it('kayıtlı ayarları her ajan için ilk istekten önce bir kez uygular', async () => {
    localStorage.setItem('apivator-network-settings', JSON.stringify({ verifySsl: false }));

    await localAgentWithSettings();
    await localAgentWithSettings();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string).verifySsl).toBe(false);
    expect(networkStartupError()).toBeNull();
  });
});
