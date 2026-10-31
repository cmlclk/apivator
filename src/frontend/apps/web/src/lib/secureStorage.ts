import type { StateStorage } from 'zustand/middleware';

/**
 * Masaüstünde değişkenlerin güncel değerleri (token, parola…) diskte düz metin durmasın diye AES-GCM ile şifrelenir.
 * Anahtar (256 bit, rastgele) işletim sisteminin anahtar zincirindedir (Windows Credential Manager, macOS
 * Keychain, Linux Secret Service). Değerlerin kendisi anahtar zincirine konmaz: Windows'ta bir kayıt ~1280
 * karakterle sınırlı ve uzun JWT'ler sığmıyor.
 *
 * Anahtar zinciri kullanılamazsa (ör. Linux'ta Secret Service yok) eski davranışa düşülür: düz metin.
 * Anahtar kaybolursa (anahtar zinciri sıfırlandı) şifreli değerler okunamaz ve yok sayılır; yeniden girilir.
 */

export interface KeyStore {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string) => Promise<void>;
}

interface Envelope {
  v: 1;
  iv: string;
  data: string;
}

const KEY_NAME = 'local_key:variables';

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function isEnvelope(value: unknown): value is Envelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Envelope).v === 1 &&
    typeof (value as Envelope).iv === 'string' &&
    typeof (value as Envelope).data === 'string'
  );
}

export function encryptedStorage(keys: KeyStore, backing: Storage = localStorage): StateStorage {
  let keyPromise: Promise<CryptoKey | null> | null = null;

  /** Anahtar yoksa üretilip anahtar zincirine yazılır; anahtar zinciri yoksa null (düz metin). */
  const key = () => {
    keyPromise ??= (async () => {
      try {
        let raw = await keys.get(KEY_NAME);
        if (!raw) {
          raw = toBase64(crypto.getRandomValues(new Uint8Array(32)));
          await keys.set(KEY_NAME, raw);
          // Yazılabildiğini doğrula; bazı ortamlarda set sessizce başarısız olabiliyor.
          if ((await keys.get(KEY_NAME)) !== raw) return null;
        }
        return await crypto.subtle.importKey('raw', fromBase64(raw), 'AES-GCM', false, [
          'encrypt',
          'decrypt',
        ]);
      } catch {
        return null;
      }
    })();
    return keyPromise;
  };

  return {
    async getItem(name) {
      const stored = backing.getItem(name);
      if (stored === null) return null;
      let parsed: unknown;
      try {
        parsed = JSON.parse(stored);
      } catch {
        return null;
      }
      // Eski (şifresiz) kayıt: olduğu gibi okunur, ilk yazmada şifrelenir.
      if (!isEnvelope(parsed)) return stored;
      const cryptoKey = await key();
      if (!cryptoKey) return null;
      try {
        const plain = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: fromBase64(parsed.iv) },
          cryptoKey,
          fromBase64(parsed.data),
        );
        return new TextDecoder().decode(plain);
      } catch {
        // Anahtar değişmiş ya da veri bozulmuş: değerler okunamaz.
        return null;
      }
    },
    async setItem(name, value) {
      const cryptoKey = await key();
      if (!cryptoKey) {
        backing.setItem(name, value);
        return;
      }
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const data = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        cryptoKey,
        new TextEncoder().encode(value),
      );
      const envelope: Envelope = { v: 1, iv: toBase64(iv), data: toBase64(new Uint8Array(data)) };
      backing.setItem(name, JSON.stringify(envelope));
    },
    removeItem(name) {
      backing.removeItem(name);
    },
  };
}
