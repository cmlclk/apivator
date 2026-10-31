import { beforeEach, describe, expect, it } from 'vitest';
import { encryptedStorage, type KeyStore } from './secureStorage';

function memoryKeys(): KeyStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: async (key) => data.get(key) ?? null,
    set: async (key, value) => {
      data.set(key, value);
    },
  };
}

const failingKeys: KeyStore = {
  get: async () => {
    throw new Error('Secret Service yok');
  },
  set: async () => {
    throw new Error('Secret Service yok');
  },
};

beforeEach(() => localStorage.clear());

describe('encryptedStorage', () => {
  it('stores values encrypted with a key kept in the keychain', async () => {
    const keys = memoryKeys();
    const storage = encryptedStorage(keys);
    const value = JSON.stringify({
      state: { currentValues: { 'env:1': { token: 'gizli-jwt' } } },
      version: 1,
    });

    await storage.setItem('apivator-env', value);

    const raw = localStorage.getItem('apivator-env')!;
    expect(raw).not.toContain('gizli-jwt');
    expect(JSON.parse(raw)).toMatchObject({ v: 1 });
    expect(keys.data.get('local_key:variables')).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    expect(await storage.getItem('apivator-env')).toBe(value);

    // Aynı anahtarla yeni bir örnek (uygulama yeniden açıldı) okuyabilir.
    expect(await encryptedStorage(keys).getItem('apivator-env')).toBe(value);
  });

  it('reads an old plain-text record and encrypts it on the next write', async () => {
    const plain = JSON.stringify({ state: { currentValues: {} }, version: 1 });
    localStorage.setItem('apivator-env', plain);
    const storage = encryptedStorage(memoryKeys());

    expect(await storage.getItem('apivator-env')).toBe(plain);
    await storage.setItem('apivator-env', plain);
    expect(JSON.parse(localStorage.getItem('apivator-env')!)).toHaveProperty('iv');
  });

  it('forgets values when the key is gone instead of failing', async () => {
    const keys = memoryKeys();
    await encryptedStorage(keys).setItem('apivator-env', '{"a":1}');
    keys.data.clear();
    expect(await encryptedStorage(keys).getItem('apivator-env')).toBeNull();
  });

  it('falls back to plain text when the keychain is unavailable', async () => {
    const storage = encryptedStorage(failingKeys);
    await storage.setItem('apivator-env', '{"a":1}');
    expect(localStorage.getItem('apivator-env')).toBe('{"a":1}');
    expect(await storage.getItem('apivator-env')).toBe('{"a":1}');
  });
});
