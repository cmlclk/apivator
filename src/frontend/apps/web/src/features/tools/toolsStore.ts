import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

/** Bir aracın son girdisi bu sınırı aşarsa saklanmaz (yerel depolamayı doldurmasın). */
const MAX_SAVED_INPUT = 200_000;
/** Tüm araçların saklanan girdilerinin toplam sınırı; aşılırsa en büyük alanlar düşürülür. */
const MAX_SAVED_TOTAL = 1_000_000;
const MAX_RECENT = 8;
/**
 * Bu araçların girdileri hiç diske yazılmaz, yalnızca oturum boyunca bellekte kalır: HAR kayıtları çerez ve
 * Authorization başlıkları, sertifika ve kimlik araçları özel anahtar ya da şifre içerebilir. (`remember: false`ten farkı: akıllı yapıştırma `input` alanına yazabilir.)
 */
const UNSAVED_TOOLS = new Set(['har', 'certificate', 'basic-auth', 'pkce', 'password', 'cookie']);

interface ToolsState {
  favorites: string[];
  recent: string[];
  /** Araç kimliği → alan adı → değer. Bu cihazda kalır; sunucuya gönderilmez. */
  inputs: Record<string, Record<string, string>>;
  /** Aynı yapı, ama hiç diske yazılmaz (gizli anahtar, HMAC anahtarı gibi). */
  volatile: Record<string, Record<string, string>>;
  /** Kapalıysa girdiler hatırlanmaz (paylaşılan bilgisayarlar için). */
  rememberInputs: boolean;
  toggleFavorite: (toolId: string) => void;
  markUsed: (toolId: string) => void;
  setInput: (toolId: string, field: string, value: string, remember?: boolean) => void;
  clearInputs: (toolId?: string) => void;
  setRememberInputs: (remember: boolean) => void;
}

type Inputs = ToolsState['inputs'];

const withField = (inputs: Inputs, toolId: string, field: string, value: string): Inputs => ({
  ...inputs,
  [toolId]: { ...inputs[toolId], [field]: value },
});
const withoutTool = (inputs: Inputs, toolId?: string): Inputs =>
  toolId ? Object.fromEntries(Object.entries(inputs).filter(([id]) => id !== toolId)) : {};

/** Kota dolarsa yazma hatası düzenleyiciye taşmasın; girdiler olmadan yeniden denenir. */
function safeStorage(): StateStorage {
  let storage: Storage;
  try {
    storage = localStorage;
  } catch {
    storage = sessionStorage;
  }
  return {
    getItem: (name) => storage.getItem(name),
    removeItem: (name) => storage.removeItem(name),
    setItem: (name, value) => {
      try {
        storage.setItem(name, value);
      } catch {
        try {
          const parsed = JSON.parse(value) as { state?: { inputs?: unknown } };
          if (parsed.state) parsed.state.inputs = {};
          storage.setItem(name, JSON.stringify(parsed));
        } catch {
          // Depolama kullanılamıyor; tercihler yalnızca bu oturumda kalır.
        }
      }
    },
  };
}

export const useToolsStore = create<ToolsState>()(
  persist(
    (set) => ({
      favorites: [],
      recent: [],
      inputs: {},
      volatile: {},
      rememberInputs: true,
      toggleFavorite: (toolId) =>
        set((s) => ({
          favorites: s.favorites.includes(toolId)
            ? s.favorites.filter((id) => id !== toolId)
            : [...s.favorites, toolId],
        })),
      markUsed: (toolId) =>
        set((s) => ({ recent: [toolId, ...s.recent.filter((id) => id !== toolId)].slice(0, MAX_RECENT) })),
      setInput: (toolId, field, value, remember = true) =>
        set((s) =>
          remember
            ? { inputs: withField(s.inputs, toolId, field, value) }
            : { volatile: withField(s.volatile, toolId, field, value) },
        ),
      clearInputs: (toolId) =>
        set((s) => ({ inputs: withoutTool(s.inputs, toolId), volatile: withoutTool(s.volatile, toolId) })),
      setRememberInputs: (rememberInputs) =>
        set(rememberInputs ? { rememberInputs } : { rememberInputs, inputs: {} }),
    }),
    {
      name: 'apivator-tools',
      storage: createJSONStorage(safeStorage),
      // Girdiler yalnızca istenirse ve makul boyuttaysa diske yazılır; `volatile` hiç yazılmaz.
      partialize: (s) => ({
        favorites: s.favorites,
        recent: s.recent,
        rememberInputs: s.rememberInputs,
        inputs: s.rememberInputs ? trimInputs(s.inputs) : {},
      }),
    },
  ),
);

export function trimInputs(inputs: Inputs): Inputs {
  const fields = Object.entries(inputs)
    .flatMap(([toolId, values]) => Object.entries(values).map(([field, value]) => ({ toolId, field, value })))
    .filter((f) => f.value.length <= MAX_SAVED_INPUT && !UNSAVED_TOOLS.has(f.toolId))
    // Küçük alanlar önce: toplam sınır aşılırsa en büyükler düşer.
    .sort((a, b) => a.value.length - b.value.length);
  const result: Inputs = {};
  let total = 0;
  for (const { toolId, field, value } of fields) {
    total += value.length;
    if (total > MAX_SAVED_TOTAL) break;
    (result[toolId] ??= {})[field] = value;
  }
  return result;
}

/**
 * Aracın bir alanını useState gibi kullanır; değer bu cihazda hatırlanır.
 * Ana girdi alanının adı `input` olmalı: "Araçlarda aç" ve akıllı yapıştırma oraya yazar.
 * Gizli anahtar ve parola gibi alanlarda `{ remember: false }`: değer yalnızca oturum boyunca bellekte kalır.
 */
export function useToolInput(
  toolId: string,
  field: string,
  initial = '',
  { remember = true }: { remember?: boolean } = {},
): [string, (value: string) => void] {
  const value = useToolsStore((s) => (remember ? s.inputs : s.volatile)[toolId]?.[field]);
  const setInput = useToolsStore((s) => s.setInput);
  return [value ?? initial, (next: string) => setInput(toolId, field, next, remember)];
}
