import { create } from 'zustand';

/** Arayüz dilleri. Yeni dil: buraya ekle, `locales/<dil>/` klasörünü oluştur, sunucudaki listeye yaz. */
export const LANGUAGES = ['tr', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];
export const DEFAULT_LANGUAGE: Language = 'tr';

/** Dil seçicide her dil kendi adıyla gösterilir (çevrilmez). */
export const LANGUAGE_NAMES: Record<Language, string> = { tr: 'Türkçe', en: 'English' };

const LOCALE_TAGS: Record<Language, string> = { tr: 'tr-TR', en: 'en-US' };

/** Bu cihazda son kullanılan dil; ilk boyamada sunucudaki tercih gelmeden doğru dille açılmak için. */
const STORAGE_KEY = 'apivator-language';

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}

interface LocaleState {
  language: Language;
  /** Kullanıcı bu cihazda dili kendisi seçti mi (tarayıcı dilinden gelmedi)? */
  explicit: boolean;
  /** Geliştirme modunda sözde dil açık mı (`i18n/pseudo.ts`)? Açıkken `language` 'en'dir; sunucuya hiç gitmez. */
  pseudo: boolean;
}

export const useLocale = create<LocaleState>()(() => ({
  language: DEFAULT_LANGUAGE,
  explicit: false,
  pseudo: false,
}));

export function currentLanguage(): Language {
  return useLocale.getState().language;
}

/** `Intl` için dil etiketi (ör. "tr-TR"). */
export function currentLocale(): string {
  return LOCALE_TAGS[currentLanguage()];
}

export function readStoredLanguage(): Language | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return isLanguage(value) ? value : null;
  } catch {
    return null;
  }
}

export function storeLanguage(language: Language) {
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // Gizli pencere vb.: yalnızca bu oturum için geçerli olur.
  }
}

/** Tarayıcının tercih ettiği dillerden ilk desteklenen (ör. "en-GB" → "en"). */
export function browserLanguage(): Language | null {
  const candidates = typeof navigator === 'undefined' ? [] : (navigator.languages ?? [navigator.language]);
  for (const tag of candidates) {
    const base = tag?.toLowerCase().split('-')[0];
    if (isLanguage(base)) return base;
  }
  return null;
}
