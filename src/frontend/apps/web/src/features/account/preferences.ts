import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import type { PreferencesDto } from '@apivator/core';
import { isLanguage, setLanguage, useLocale } from '../../i18n';
import { api } from '../../lib/api';
import { useSession } from '../../stores/session';
import { useUi } from '../../stores/ui';

export const preferencesQueryKey = ['account', 'preferences'] as const;
export const profileQueryKey = ['account', 'profile'] as const;
export const sessionsQueryKey = ['account', 'sessions'] as const;

export function useProfile() {
  return useQuery({ queryKey: profileQueryKey, queryFn: api.account.profile });
}

export function usePreferences() {
  const status = useSession((s) => s.status);
  return useQuery({
    queryKey: preferencesQueryKey,
    queryFn: api.account.preferences,
    enabled: status === 'authenticated',
    staleTime: 60_000,
  });
}

/** Tercihi kaydeder; önbelleği hemen günceller (iyimser), hata olursa geri alır. */
export function useSavePreferences() {
  const queryClient = useQueryClient();
  return async (change: Partial<PreferencesDto>) => {
    const previous = queryClient.getQueryData<PreferencesDto>(preferencesQueryKey);
    if (!previous) return;
    const next = { ...previous, ...change };
    queryClient.setQueryData(preferencesQueryKey, next);
    try {
      queryClient.setQueryData(preferencesQueryKey, await api.account.updatePreferences(next));
    } catch (error) {
      queryClient.setQueryData(preferencesQueryKey, previous);
      throw error;
    }
  };
}

/** Uygulama açılışında varsayılan workspace bir kez uygulanır (sonra kullanıcı istediğini seçer). */
let defaultWorkspaceApplied = false;

/** Test yardımcısı. */
export function resetPreferenceSync() {
  defaultWorkspaceApplied = false;
}

/**
 * Sunucudaki tercihleri bu cihaza uygular (tema, dil, açılıştaki workspace) ve tema bu cihazda değişince sunucuya
 * yazar; böylece tercihler cihazlar arasında ortak olur. Sunucuda dil yoksa ve kullanıcı bu cihazda (ör. giriş
 * sayfasında) dil seçtiyse o seçim sunucuya yazılır.
 */
export function PreferencesSync() {
  const { data } = usePreferences();
  const save = useSavePreferences();
  const theme = useUi((s) => s.theme);
  const setTheme = useUi((s) => s.setTheme);
  const setWorkspace = useUi((s) => s.setCurrentWorkspaceId);
  const [params] = useSearchParams();
  const applied = useRef(false);

  // İlk yüklemede sunucudaki tema ve varsayılan workspace uygulanır.
  useEffect(() => {
    if (!data || applied.current) return;
    applied.current = true;
    if (data.theme !== useUi.getState().theme) setTheme(data.theme);
    const locale = useLocale.getState();
    if (isLanguage(data.language)) {
      if (data.language !== locale.language) void setLanguage(data.language);
    } else if (locale.explicit) {
      save({ language: locale.language }).catch(() => undefined);
    }
    // E-postadaki bağlantı gibi adreste workspace belirtilmişse o kazanır.
    if (!defaultWorkspaceApplied && data.defaultWorkspaceId && !params.get('workspace')) {
      setWorkspace(data.defaultWorkspaceId);
    }
    defaultWorkspaceApplied = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- save her çizimde yeni; yalnızca ilk veri için çalışır
  }, [data, params, setTheme, setWorkspace]);

  // Sonraki tema değişiklikleri (üst çubuktaki düğme) sunucuya yazılır.
  useEffect(() => {
    if (!applied.current || !data || data.theme === theme) return;
    save({ theme }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- yalnızca tema değişince
  }, [theme]);

  return null;
}

export const twoFactorQueryKey = ['two-factor'] as const;
export const securityEventsQueryKey = ['security-events'] as const;
