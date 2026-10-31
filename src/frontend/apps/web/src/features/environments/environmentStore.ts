import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { isDesktop, secrets } from '../../lib/desktop';
import { encryptedStorage } from '../../lib/secureStorage';

/**
 * Yalnızca bu tarayıcıda tutulan değişken durumu: hangi environment'ın aktif olduğu ve değişkenlerin
 * "güncel değerleri". Güncel değerler sunucuya hiç gönderilmez; ekip arkadaşlarınız göremez. Masaüstünde
 * anahtarı işletim sisteminin anahtar zincirinde duran AES-GCM ile şifreli saklanır (bkz. secureStorage).
 */
interface EnvironmentState {
  /** workspaceId → aktif environment Id'si (yoksa null). */
  active: Record<string, string | null>;
  /** Kapsam anahtarı (scopeKey) → değişken adı → güncel değer. */
  currentValues: Record<string, Record<string, string>>;
  setActive: (workspaceId: string, environmentId: string | null) => void;
  setCurrentValues: (scopeKey: string, values: Record<string, string>) => void;
  forgetScope: (scopeKey: string) => void;
}

export const scopeKeys = {
  environment: (id: string) => `env:${id}`,
  collection: (id: string) => `collection:${id}`,
  globals: (workspaceId: string) => `globals:${workspaceId}`,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const useEnvironmentStore = create<EnvironmentState>()(
  persist(
    (set) => ({
      active: {},
      currentValues: {},
      setActive: (workspaceId, environmentId) =>
        set((s) => ({ active: { ...s.active, [workspaceId]: environmentId } })),
      setCurrentValues: (scopeKey, values) =>
        set((s) => ({ currentValues: { ...s.currentValues, [scopeKey]: values } })),
      forgetScope: (scopeKey) =>
        set((s) => {
          const rest = { ...s.currentValues };
          delete rest[scopeKey];
          return { currentValues: rest };
        }),
    }),
    {
      name: 'apivator-env',
      version: 1,
      storage: createJSONStorage(() => (isDesktop() ? encryptedStorage(secrets) : localStorage)),
      // Bozuk ya da eski kayıt uygulamayı çökertmesin.
      merge: (persisted, current) => {
        const stored = isRecord(persisted) ? persisted : {};
        return {
          ...current,
          active: isRecord(stored.active) ? (stored.active as Record<string, string | null>) : {},
          currentValues: isRecord(stored.currentValues)
            ? (stored.currentValues as Record<string, Record<string, string>>)
            : {},
        };
      },
      partialize: (s) => ({ active: s.active, currentValues: s.currentValues }),
    },
  ),
);
