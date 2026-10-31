import { create } from 'zustand';
import type { CollabPeer, CollabStatus } from './CollabSession';

export interface TabCollab {
  status: CollabStatus;
  peers: CollabPeer[];
}

interface CollabState {
  tabs: Record<string, TabCollab>;
}

/** Sekme başına ortak düzenleme durumu ve aynı belgedeki diğer kişiler (saklanmaz). */
export const useCollab = create<CollabState>(() => ({ tabs: {} }));

const EMPTY: TabCollab = { status: 'solo', peers: [] };

export function useTabCollab(tabId: string): TabCollab {
  return useCollab((s) => s.tabs[tabId]) ?? EMPTY;
}

export function patchCollab(tabId: string, patch: Partial<TabCollab>) {
  useCollab.setState((s) => ({
    tabs: { ...s.tabs, [tabId]: { ...(s.tabs[tabId] ?? { status: 'joining', peers: [] }), ...patch } },
  }));
}

export function clearCollab(tabId: string) {
  useCollab.setState((s) => {
    const rest = { ...s.tabs };
    delete rest[tabId];
    return { tabs: rest };
  });
}
