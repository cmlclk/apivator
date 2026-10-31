import { NetworkError, type AuthResult, type LocalAgent, type UserDto } from '@apivator/core';
import { appMode, isDesktop, localApiInfo } from './desktop';

/**
 * Masaüstü yerel modu (kişisel kullanım): API uygulamanın içinde çalışır, giriş yoktur. Açılışta yerel API'nin
 * adresi ve oturum token'ı alınır; istemci sunucu yerine ona gider, token'ı access token olarak kullanır.
 */
let local: LocalAgent | null = null;

export function isLocalMode(): boolean {
  return local !== null;
}

/** Yerel API'nin adresi (yerel modda değilse null). */
export function localApiUrl(): string | null {
  return local?.url ?? null;
}

export type DesktopBoot = { kind: 'ready' } | { kind: 'choose' } | { kind: 'error'; message: string };

/**
 * Uygulama açılmadan önce: mod seçilmemişse seçim ekranı; yerel moddaysa API hazır olana kadar beklenir (ilk
 * açılışta veritabanı oluşturulur). Web'de ve eski kabukta her zaman "ready".
 */
export async function bootDesktopMode(): Promise<DesktopBoot> {
  if (!isDesktop()) return { kind: 'ready' };
  let mode: string | null;
  try {
    mode = (await appMode()).mode;
  } catch {
    // Eski kabuk ya da okunamayan ayar: eskisi gibi sunucuya bağlanılır.
    return { kind: 'ready' };
  }
  if (mode === null) return { kind: 'choose' };
  if (mode !== 'local') return { kind: 'ready' };
  try {
    local = await localApiInfo();
    return { kind: 'ready' };
  } catch (error) {
    return { kind: 'error', message: error instanceof Error ? error.message : String(error) };
  }
}

/** Yerel oturum: token uygulamadan gelir, kullanıcı bilgisi yerel API'den. */
export async function localSession(): Promise<AuthResult | null> {
  if (!local) return null;
  let response: Response;
  try {
    response = await fetch(`${local.url}/api/me`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${local.token}` },
    });
  } catch (error) {
    throw new NetworkError(error);
  }
  if (!response.ok) return null;
  const user = (await response.json()) as UserDto;
  return {
    accessToken: local.token,
    accessTokenExpiresAt: '',
    refreshToken: '',
    refreshTokenExpiresAt: '',
    user,
  };
}

/** Testler için. */
export function setLocalApiForTests(value: LocalAgent | null) {
  local = value;
}
