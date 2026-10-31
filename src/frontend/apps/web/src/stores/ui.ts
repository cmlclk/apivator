import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type Theme = 'light' | 'dark' | 'system';
export type SidebarSection =
  'collections' | 'environments' | 'mocks' | 'monitors' | 'merges' | 'history' | 'activity';

interface UiState {
  theme: Theme;
  sidebarSection: SidebarSection;
  currentWorkspaceId: string | null;
  /** Ağaçta açık olan collection ve klasörler. */
  expanded: Record<string, boolean>;
  setExpanded: (id: string, open: boolean) => void;
  setTheme: (theme: Theme) => void;
  setSidebarSection: (section: SidebarSection) => void;
  setCurrentWorkspaceId: (id: string) => void;
}

/** Tarayıcıda saklanan arayüz tercihleri (tema, açık panel, seçili workspace). */
export const useUi = create<UiState>()(
  persist(
    (set) => ({
      theme: 'system',
      sidebarSection: 'collections',
      currentWorkspaceId: null,
      expanded: {},
      setExpanded: (id, open) => set((s) => ({ expanded: { ...s.expanded, [id]: open } })),
      setTheme: (theme) => set({ theme }),
      setSidebarSection: (sidebarSection) => set({ sidebarSection }),
      setCurrentWorkspaceId: (currentWorkspaceId) => set({ currentWorkspaceId }),
    }),
    {
      name: 'apivator-ui',
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

export function applyTheme(theme: Theme) {
  const dark =
    theme === 'dark' || (theme === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', Boolean(dark));
}
