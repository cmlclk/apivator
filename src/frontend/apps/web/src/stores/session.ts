import { create } from 'zustand';
import type { AuthResult, UserDto } from '@apivator/core';
import { serverKey } from '../lib/serverUrl';

/**
 * offline: sunucuya ulaşılamıyor ama bu cihazda daha önce oturum açılmış; uygulama son eşitlenen verilerle açılır,
 * bağlantı gelince oturum yenilenir.
 */
type Status = 'loading' | 'authenticated' | 'offline' | 'anonymous';

interface SessionState {
  status: Status;
  /** Access token yalnızca bellekte tutulur; sayfa yenilenince refresh cookie ile geri alınır. */
  accessToken: string | null;
  user: UserDto | null;
  /** Açılışta sunucuya ulaşılamadı ve bu cihazda önceki oturum yok (giriş ekranında gösterilir). */
  unreachable: boolean;
  setSession: (session: AuthResult | null) => void;
  setUser: (user: UserDto) => void;
  /** Sunucuya ulaşılamadı: önceki oturum varsa çevrimdışı moda geçer. */
  setUnreachable: () => void;
}

/** Son oturum açan kullanıcı (sunucu adresi başına); yalnızca kimlik ve görünen ad, token yok. */
const lastUserKey = () => `apivator-last-user:${serverKey()}`;

export function rememberedUser(): UserDto | null {
  try {
    const raw = localStorage.getItem(lastUserKey());
    return raw ? (JSON.parse(raw) as UserDto) : null;
  } catch {
    return null;
  }
}

function remember(user: UserDto | null) {
  try {
    if (user) localStorage.setItem(lastUserKey(), JSON.stringify(user));
    else localStorage.removeItem(lastUserKey());
  } catch {
    // Depolama kapalıysa çevrimdışı açılış olmaz; başka bir etkisi yok.
  }
}

export const useSession = create<SessionState>((set, get) => ({
  status: 'loading',
  accessToken: null,
  user: null,
  unreachable: false,
  setSession: (session) => {
    remember(session?.user ?? null);
    set(
      session
        ? {
            status: 'authenticated',
            accessToken: session.accessToken,
            user: session.user,
            unreachable: false,
          }
        : { status: 'anonymous', accessToken: null, user: null, unreachable: false },
    );
  },
  setUser: (user) => {
    remember(user);
    set({ user });
  },
  setUnreachable: () => {
    const { status } = get();
    if (status === 'anonymous') {
      set({ unreachable: true });
      return;
    }
    // Açık oturumdaki kopmalar oturumu değiştirmez (bağlantı durumu ayrıca izlenir); yalnızca açılışta karar verilir.
    if (status !== 'loading') return;
    const user = rememberedUser();
    if (user) set({ status: 'offline', user });
    else set({ status: 'anonymous', unreachable: true });
  },
}));
