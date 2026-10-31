import type { LocalAgent, RefreshTokenStore } from '@apivator/core';
import { translate } from '../i18n';

const DESKTOP_ERRORS = [
  'agentStartFailed',
  'agentExited',
  'agentTimeout',
  'fileBodyInvalid',
  'fileWriteFailed',
  'invalidUrl',
  'urlScheme',
  'secretKeyNotAllowed',
  'noUpdate',
  'updatesDisabled',
  'localApiStartFailed',
  'localApiExited',
  'localApiTimeout',
  'localModeOff',
  'invalidMode',
  'dataDirFailed',
  'backupFailed',
] as const;

/**
 * Rust komutları hatayı `{"code","params"}` JSON'u olarak döner (metin etkin dilde burada üretilir);
 * kütüphanelerden gelen diğer hatalar düz metindir.
 */
export function desktopError(error: unknown): Error {
  const text = typeof error === 'string' ? error : String(error);
  try {
    const parsed = JSON.parse(text) as { code?: unknown; params?: Record<string, string> };
    const code = DESKTOP_ERRORS.find((c) => c === parsed.code);
    if (code) return new Error(translate('common', `desktop.${code}`, parsed.params ?? {}).trim());
  } catch {
    // Düz metin.
  }
  return new Error(text);
}

/** Uygulama Tauri masaüstü penceresinde mi çalışıyor? */
export function isDesktop(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** Tauri köprüsü yalnızca masaüstünde yüklenir; web paketine eklenmez. */
async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  try {
    return await tauriInvoke<T>(command, args);
  } catch (error) {
    throw desktopError(error);
  }
}

/** Kurulu masaüstü uygulamasının sürümü (tauri.conf.json). */
export async function appVersion(): Promise<string> {
  const { getVersion } = await import('@tauri-apps/api/app');
  return getVersion();
}

/** Yerel ajanın adresi ve oturum token'ı; ajan hazır değilse Rust tarafı bekler. */
export function agentInfo(): Promise<LocalAgent> {
  return invoke<LocalAgent>('agent_info');
}

/** Çalışma modu: kişisel kullanım (API bu bilgisayarda) ya da bir Apivator sunucusuna bağlanma. */
export type AppMode = 'local' | 'server';

export interface AppModeInfo {
  /** İlk açılışta seçilene kadar null. */
  mode: AppMode | null;
  /** Yerel verilerin klasörü (apivator.db ve yedekler). */
  dataDir: string;
}

export function appMode(): Promise<AppModeInfo> {
  return invoke<AppModeInfo>('app_mode');
}

/** Modu kaydeder; yerel moda geçilince uygulamanın içindeki API başlar, sunucu moduna geçilince durur. */
export function setAppMode(mode: AppMode): Promise<void> {
  return invoke<void>('set_app_mode', { mode });
}

/** Yerel API'nin adresi ve oturum token'ı (yalnızca yerel modda); API hazır değilse Rust tarafı bekler. */
export function localApiInfo(): Promise<LocalAgent> {
  return invoke<LocalAgent>('local_api_info');
}

/** İşletim sisteminin anahtar zinciri (yalnızca izin verilen anahtar önekleri: refresh_token:, network:). */
export const secrets = {
  get: (key: string) => invoke<string | null>('secret_get', { key }),
  set: (key: string, value: string) => invoke<void>('secret_set', { key, value }),
  remove: (key: string) => invoke<void>('secret_delete', { key }),
};

/**
 * "Farklı kaydet" diyaloğu ve yazma (masaüstü). Dosya ham gövde olarak gider (JSON'a çevrilmez); ad başlıkta.
 * Kullanıcı iptal ederse false.
 */
export async function saveWithDialog(fileName: string, data: Uint8Array): Promise<boolean> {
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  try {
    return await tauriInvoke<boolean>('save_file', data, {
      headers: { 'x-file-name': encodeURIComponent(fileName) },
    });
  } catch (error) {
    throw desktopError(error);
  }
}

/** Bağlantıyı sistem tarayıcısında açar (OAuth girişi). */
export function openExternal(url: string): Promise<void> {
  return invoke<void>('open_external', { url });
}

/**
 * Refresh token işletim sisteminin anahtar zincirinde, sunucu adresine göre saklanır. Anahtar zinciri
 * kullanılamıyorsa (ör. Linux'ta Secret Service yoksa) token yalnızca bu oturumun belleğinde tutulur.
 */
export function keychainRefreshTokens(server: () => string): RefreshTokenStore {
  const memory = new Map<string, string>();
  const key = () => `refresh_token:${server()}`;
  return {
    async get() {
      try {
        return (await secrets.get(key())) ?? memory.get(key()) ?? null;
      } catch {
        return memory.get(key()) ?? null;
      }
    },
    async set(token) {
      const k = key();
      if (token) memory.set(k, token);
      else memory.delete(k);
      try {
        await invoke<void>(
          token ? 'secret_set' : 'secret_delete',
          token ? { key: k, value: token } : { key: k },
        );
      } catch {
        // Bellekte tutulan değer bu oturum için yeterli.
      }
    },
  };
}

export interface UpdateInfo {
  version: string;
  notes: string | null;
}

/** Otomatik güncelleme: yalnızca yayın derlemelerinde etkin; yerel derlemede her zaman null döner. */
export const updates = {
  check: () => invoke<UpdateInfo | null>('update_check'),
  install: () => invoke<void>('update_install'),
};
