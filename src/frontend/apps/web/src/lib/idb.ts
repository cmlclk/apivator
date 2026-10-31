/**
 * IndexedDB üzerinde küçük anahtar–değer deposu (çevrimdışı önbellek için). IndexedDB yoksa (eski tarayıcı, gizli
 * pencere kısıtları, testler) bellek içi yedeğe düşer; uygulama yine çalışır, yalnızca önbellek kalıcı olmaz.
 */
const DB_NAME = 'apivator';
const STORE = 'kv';

let opening: Promise<IDBDatabase | null> | null = null;
const memory = new Map<string, string>();

function open(): Promise<IDBDatabase | null> {
  opening ??= new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opening;
}

function run<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | undefined> {
  return open().then(
    (db) =>
      new Promise<T | undefined>((resolve) => {
        if (!db) {
          resolve(undefined);
          return;
        }
        try {
          const request = action(db.transaction(STORE, mode).objectStore(STORE));
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => resolve(undefined);
        } catch {
          resolve(undefined);
        }
      }),
  );
}

export const kv = {
  async get(key: string): Promise<string | null> {
    const db = await open();
    if (!db) return memory.get(key) ?? null;
    const value = await run<string>('readonly', (s) => s.get(key) as IDBRequest<string>);
    return value ?? null;
  },
  async set(key: string, value: string): Promise<void> {
    const db = await open();
    if (!db) {
      memory.set(key, value);
      return;
    }
    await run('readwrite', (s) => s.put(value, key));
  },
  async remove(key: string): Promise<void> {
    memory.delete(key);
    if (await open()) await run('readwrite', (s) => s.delete(key));
  },
  /** Önekle başlayan tüm anahtarları siler (ör. başka kullanıcının önbelleği). */
  async removePrefix(prefix: string): Promise<void> {
    for (const key of [...memory.keys()]) if (key.startsWith(prefix)) memory.delete(key);
    if (!(await open())) return;
    const keys = (await run<IDBValidKey[]>('readonly', (s) => s.getAllKeys())) ?? [];
    for (const key of keys) if (typeof key === 'string' && key.startsWith(prefix)) await kv.remove(key);
  },
};
