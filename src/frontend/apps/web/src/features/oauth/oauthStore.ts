import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export interface StoredToken {
  accessToken: string;
  refreshToken: string | null;
  tokenType: string | null;
  scope: string | null;
  /** Unix ms; sunucu süre bildirmediyse null (süresiz kabul edilir). */
  expiresAt: number | null;
  obtainedAt: number;
}

/**
 * OAuth 2.0 token'ları yalnızca bu tarayıcıda tutulur; collection'a ya da sunucuya kaydedilmez.
 * Anahtar, ayarların parmak izidir (oauth2Fingerprint): ayar değişirse eski token kullanılmaz.
 */
interface OAuthState {
  tokens: Record<string, StoredToken>;
  save: (fingerprint: string, token: StoredToken) => void;
  remove: (fingerprint: string) => void;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

export const useOAuthTokens = create<OAuthState>()(
  persist(
    (set) => ({
      tokens: {},
      save: (fingerprint, token) => set((s) => ({ tokens: { ...s.tokens, [fingerprint]: token } })),
      remove: (fingerprint) =>
        set((s) => {
          const tokens = { ...s.tokens };
          delete tokens[fingerprint];
          return { tokens };
        }),
    }),
    {
      name: 'apivator-oauth',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ tokens: s.tokens }),
      merge: (persisted, current) => {
        const stored = isRecord(persisted) && isRecord(persisted.tokens) ? persisted.tokens : {};
        return { ...current, tokens: stored as Record<string, StoredToken> };
      },
    },
  ),
);

/** Süresi dolmak üzere olan token'ı (30 sn pay) geçersiz say. */
export function isTokenValid(token: StoredToken | undefined, now = Date.now()): boolean {
  return !!token && (token.expiresAt === null || token.expiresAt - 30_000 > now);
}
