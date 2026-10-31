import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { ModelLanguage, ModelOptions } from '@apivator/core/models';

interface ModelPrefs {
  language: ModelLanguage;
  /** Dile göre namespace / paket (C#, Java, Kotlin, Go). */
  namespaces: Partial<Record<ModelLanguage, string>>;
  decimal: boolean;
  csharp: NonNullable<ModelOptions['csharp']>;
  java: NonNullable<ModelOptions['java']>;
  typescript: NonNullable<ModelOptions['typescript']>;
  python: NonNullable<ModelOptions['python']>;
  set: (change: Partial<Omit<ModelPrefs, 'set'>>) => void;
}

/** Model üretimi tercihleri bu cihazda hatırlanır (dil, namespace, stil). */
export const useModelPrefs = create<ModelPrefs>()(
  persist(
    (set) => ({
      language: 'csharp',
      namespaces: {},
      decimal: false,
      csharp: { style: 'class', serializer: 'system-text-json' },
      java: { style: 'class', lombok: false },
      typescript: { zod: false },
      python: { style: 'pydantic' },
      set: (change) => set(change),
    }),
    {
      name: 'apivator-model-prefs',
      storage: createJSONStorage(() => {
        try {
          return localStorage;
        } catch {
          return sessionStorage;
        }
      }),
    },
  ),
);

export function modelOptions(prefs: ModelPrefs): ModelOptions {
  return {
    language: prefs.language,
    namespace: prefs.namespaces[prefs.language],
    decimal: prefs.decimal,
    csharp: prefs.csharp,
    java: prefs.java,
    typescript: prefs.typescript,
    python: prefs.python,
  };
}
