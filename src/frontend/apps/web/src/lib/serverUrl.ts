import { translate } from '../i18n';
import { isDesktop } from './desktop';
import { localApiUrl } from './localMode';

const STORAGE_KEY = 'apivator-server-url';
const DESKTOP_DEFAULT = import.meta.env.VITE_API_URL || 'http://localhost:5080';

/**
 * API sunucusunun adresi. Web'de boş (aynı origin); masaüstünde kullanıcı giriş ekranından değiştirebilir,
 * yerel modda uygulamanın içindeki API.
 */
export function serverUrl(): string {
  if (!isDesktop()) return import.meta.env.VITE_API_URL ?? '';
  // Kişisel kullanım: uygulamanın içindeki API.
  const local = localApiUrl();
  if (local) return local;
  try {
    return localStorage.getItem(STORAGE_KEY) || DESKTOP_DEFAULT;
  } catch {
    return DESKTOP_DEFAULT;
  }
}

/**
 * Bu cihazda saklanan verilerin (çevrimdışı önbellek, son kullanıcı) sunucu anahtarı. Yerel API'nin portu her
 * açılışta değiştiği için yerel modda sabittir.
 */
export function serverKey(): string {
  return localApiUrl() ? 'local' : serverUrl() || location.origin;
}

/** Adresi doğrular ve normalleştirir (sondaki / atılır); geçersizse hata mesajı döner. */
export function normalizeServerUrl(input: string): { url: string } | { error: string } {
  let parsed: URL;
  try {
    parsed = new URL(input.trim());
  } catch {
    return { error: translate('common', 'errors.serverUrlInvalid') };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
    return { error: translate('common', 'errors.serverUrlScheme') };
  return { url: `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}` };
}

export function setServerUrl(url: string) {
  try {
    localStorage.setItem(STORAGE_KEY, url);
  } catch {
    // Kaydedilemezse bu oturum için varsayılan kullanılır.
  }
}
