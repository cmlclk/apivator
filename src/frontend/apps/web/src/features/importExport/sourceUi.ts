import { create } from 'zustand';

/** Kaynak penceresini her yerden (ağaçtaki rozet, menü, bildirim) açmak için. */
export const useSourceUi = create<{
  collectionId: string | null;
  open: (collectionId: string) => void;
  close: () => void;
}>((set) => ({
  collectionId: null,
  open: (collectionId) => set({ collectionId }),
  close: () => set({ collectionId: null }),
}));

export const sourceQueryKey = (collectionId: string) => ['collection-source', collectionId] as const;
