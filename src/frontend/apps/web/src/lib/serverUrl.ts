import { translate } from '../i18n';
import { isDesktop } from './desktop';

const STORAGE_KEY = 'apivator-server-url';
const DESKTOP_DEFAULT = import.meta.env.VITE_API_URL || 'http://localhost:5080';

/**
 * API sunucusunun adresi. Web'de boş (aynı origin); masaüstünde kullanıcı giriş ekranından değiştirebilir.
 */
export function serverUrl(): string {
  if (!isDesktop()) return import.meta.env.VITE_API_URL ?? '';
  try {
    return localStorage.getItem(STORAGE_KEY) || DESKTOP_DEFAULT;
  } catch {
    return DESKTOP_DEFAULT;
  }
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
