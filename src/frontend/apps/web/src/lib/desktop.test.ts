import { afterEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

const { isDesktop, keychainRefreshTokens, agentInfo } = await import('./desktop');
const { setLanguage } = await import('../i18n');

afterEach(() => {
  invoke.mockReset();
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});

describe('desktop', () => {
  it('Tauri penceresini tanır', () => {
    expect(isDesktop()).toBe(false);
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    expect(isDesktop()).toBe(true);
  });

  it('düz metin Rust hatasını Error olarak iletir', async () => {
    invoke.mockRejectedValueOnce('Secret Service bulunamadı');
    await expect(agentInfo()).rejects.toThrow('Secret Service bulunamadı');
  });

  it('kodlu Rust hatasını etkin dilde gösterir', async () => {
    const error = JSON.stringify({ code: 'agentTimeout', params: { seconds: '20' } });
    invoke.mockRejectedValueOnce(error);
    await expect(agentInfo()).rejects.toThrow('Yerel ajan 20 saniye içinde hazır olmadı.');

    await setLanguage('en', { explicit: false });
    try {
      invoke.mockRejectedValueOnce(error);
      await expect(agentInfo()).rejects.toThrow("The local agent wasn't ready within 20 seconds.");
      invoke.mockRejectedValueOnce(
        JSON.stringify({ code: 'agentExited', params: { code: '1', detail: '' } }),
      );
      await expect(agentInfo()).rejects.toThrow(/^The local agent stopped \(exit code 1\)\.$/);
    } finally {
      await setLanguage('tr', { explicit: false });
    }
  });

  it('refresh token anahtar zincirinde sunucuya göre saklanır', async () => {
    let server = 'https://a.example.com';
    const store = keychainRefreshTokens(() => server);
    invoke.mockResolvedValue(undefined);

    await store.set('rt-a');
    expect(invoke).toHaveBeenLastCalledWith('secret_set', {
      key: 'refresh_token:https://a.example.com',
      value: 'rt-a',
    });

    server = 'https://b.example.com';
    await store.set(null);
    expect(invoke).toHaveBeenLastCalledWith('secret_delete', { key: 'refresh_token:https://b.example.com' });

    invoke.mockResolvedValueOnce('rt-kalici');
    expect(await store.get()).toBe('rt-kalici');
  });

  it('anahtar zinciri yoksa oturum boyunca bellekte tutar', async () => {
    invoke.mockRejectedValue('Secret Service bulunamadı');
    const store = keychainRefreshTokens(() => 'https://a.example.com');

    await store.set('rt-bellek');
    expect(await store.get()).toBe('rt-bellek');
    await store.set(null);
    expect(await store.get()).toBeNull();
  });
});
