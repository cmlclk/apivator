import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { translate } from '../../i18n';
import { useFiles } from './fileStore';
import {
  definitionsEqual,
  emptyDefinition,
  normalizeDefinition,
  type ApiRequestDto,
  type ExecuteResponse,
  type RequestDefinition,
} from '@apivator/core';

export type EditorSection =
  'params' | 'auth' | 'headers' | 'body' | 'scripts' | 'messages' | 'settings' | 'grpc' | 'docs';

/** Sekme açılırken gösterilecek bölüm. */
export function initialSection(definition: RequestDefinition): EditorSection {
  if (definition.kind === 'WebSocket') return 'messages';
  if (definition.kind === 'Grpc') return 'grpc';
  return definition.body.mode !== 'None' ? 'body' : 'params';
}

export interface RequestTab {
  id: string;
  workspaceId: string;
  /** Kaydedilmiş bir isteğe bağlıysa Id'si; yeni (henüz kaydedilmemiş) sekmede null. */
  requestId: string | null;
  collectionId: string | null;
  name: string;
  draft: RequestDefinition;
  saved: { name: string; definition: RequestDefinition; version: number } | null;
  section: EditorSection;
  response: ExecuteResponse | null;
  sending: boolean;
  /** Kaydetme sırasında oluşan hata (ör. başkası değiştirmiş). */
  saveError: string | null;
  /** Geçici bilgi (ör. cURL yapıştırıldı, şu seçenekler atlandı); saklanmaz. */
  notice: TabNotice | null;
  /** Bu sekme kirliyken başkasının kaydettiği (ya da sildiği) sürüm; çözülene kadar gösterilir. Saklanmaz. */
  remote?: RemoteChange | null;
  /** Çevrimdışıyken kaydedildi; bağlantı gelince sunucuya gönderilecek. Saklanır. */
  pendingSave?: boolean;
  /** Taslak ortak düzenleniyor (Yjs): kaydetme ve uzaktan gelen sürümler taslağı ezmez. Saklanmaz. */
  collab?: boolean;
}

export interface RemoteChange {
  deleted: boolean;
  /** Değişikliği yapan; bilinmiyorsa (ör. kaydederken 409) null. */
  byName: string | null;
  /** Sunucudaki güncel hâli (silindiyse null). */
  request: ApiRequestDto | null;
}

export interface TabNotice {
  tone: 'info' | 'warning' | 'error';
  text: string;
  details?: string[];
}

interface TabsState {
  tabs: RequestTab[];
  activeTabId: string | null;
  newTab: (
    workspaceId: string,
    init?: { name?: string; draft?: RequestDefinition; notice?: TabNotice },
  ) => string;
  openSaved: (workspaceId: string, request: ApiRequestDto) => void;
  activate: (id: string) => void;
  close: (id: string) => void;
  closeByRequestIds: (ids: string[]) => void;
  updateDraft: (id: string, change: Partial<RequestDefinition>) => void;
  /** Ortak düzenlemeden gelen taslak: tümüyle değiştirilir. */
  setDraft: (id: string, draft: RequestDefinition) => void;
  setCollab: (id: string, collab: boolean) => void;
  rename: (id: string, name: string) => void;
  setSection: (id: string, section: EditorSection) => void;
  setSending: (id: string, sending: boolean) => void;
  setResponse: (id: string, response: ExecuteResponse | null) => void;
  setSaveError: (id: string, message: string | null) => void;
  setNotice: (id: string, notice: TabNotice | null) => void;
  setPendingSave: (id: string, pending: boolean) => void;
  markSaved: (id: string, request: ApiRequestDto) => void;
  /** Ağaçta yeniden adlandırılan isteğin sekme adını günceller (taslak değişmeden). */
  syncName: (requestId: string, name: string, version: number) => void;
  /** Ağaçta taşınan isteğin collection'ını ve sürümünü günceller; taslak korunur. */
  syncMoved: (requestId: string, collectionId: string, version: number) => void;
  setRemote: (id: string, remote: RemoteChange | null) => void;
  /** Çakışmada "benimkini koru": taban güncel sürüm olur, taslak aynen kalır (kaydedince üzerine yazar). */
  keepMine: (id: string) => void;
  /** Silinmiş isteğin sekmesini kaydedilmemiş yeni bir sekmeye çevirir. */
  detach: (id: string) => void;
}

const newId = () =>
  globalThis.crypto?.randomUUID?.() ?? `tab-${Date.now()}-${Math.random().toString(16).slice(2)}`;

function patchTab(tabs: RequestTab[], id: string, patch: (tab: RequestTab) => Partial<RequestTab>) {
  return tabs.map((t) => (t.id === id ? { ...t, ...patch(t) } : t));
}

export const useTabs = create<TabsState>()(
  persist(
    (set) => ({
      tabs: [],
      activeTabId: null,

      newTab: (workspaceId, init) => {
        const id = newId();
        const draft = init?.draft ? normalizeDefinition(init.draft) : emptyDefinition();
        set((s) => ({
          tabs: [
            ...s.tabs,
            {
              id,
              workspaceId,
              requestId: null,
              collectionId: null,
              name: init?.name ?? translate('requests', 'tabs.newRequest'),
              draft,
              saved: null,
              section: initialSection(draft),
              response: null,
              sending: false,
              saveError: null,
              notice: init?.notice ?? null,
            },
          ],
          activeTabId: id,
        }));
        return id;
      },

      openSaved: (workspaceId, request) =>
        set((s) => {
          const existing = s.tabs.find((t) => t.requestId === request.id);
          if (existing) return { activeTabId: existing.id };
          const definition = normalizeDefinition(request.definition);
          const id = newId();
          return {
            tabs: [
              ...s.tabs,
              {
                id,
                workspaceId,
                requestId: request.id,
                collectionId: request.collectionId,
                name: request.name,
                draft: definition,
                saved: { name: request.name, definition, version: request.version },
                section: initialSection(definition),
                response: null,
                sending: false,
                saveError: null,
                notice: null,
              },
            ],
            activeTabId: id,
          };
        }),

      activate: (id) => set({ activeTabId: id }),

      close: (id) =>
        set((s) => {
          useFiles.getState().forgetTab(id);
          const index = s.tabs.findIndex((t) => t.id === id);
          const tabs = s.tabs.filter((t) => t.id !== id);
          const activeTabId =
            s.activeTabId === id ? (tabs[Math.min(index, tabs.length - 1)]?.id ?? null) : s.activeTabId;
          return { tabs, activeTabId };
        }),

      closeByRequestIds: (ids) =>
        set((s) => {
          const tabs = s.tabs.filter((t) => !t.requestId || !ids.includes(t.requestId));
          const activeTabId = tabs.some((t) => t.id === s.activeTabId)
            ? s.activeTabId
            : (tabs.at(-1)?.id ?? null);
          return { tabs, activeTabId };
        }),

      updateDraft: (id, change) =>
        set((s) => ({
          tabs: patchTab(s.tabs, id, (t) => ({ draft: { ...t.draft, ...change }, saveError: null })),
        })),

      setDraft: (id, draft) =>
        set((s) => ({ tabs: patchTab(s.tabs, id, () => ({ draft, saveError: null })) })),

      setCollab: (id, collab) =>
        set((s) => ({ tabs: patchTab(s.tabs, id, (t) => (!!t.collab === collab ? {} : { collab })) })),

      rename: (id, name) => set((s) => ({ tabs: patchTab(s.tabs, id, () => ({ name })) })),

      setSection: (id, section) => set((s) => ({ tabs: patchTab(s.tabs, id, () => ({ section })) })),

      setSending: (id, sending) => set((s) => ({ tabs: patchTab(s.tabs, id, () => ({ sending })) })),

      setResponse: (id, response) => set((s) => ({ tabs: patchTab(s.tabs, id, () => ({ response })) })),

      setSaveError: (id, saveError) => set((s) => ({ tabs: patchTab(s.tabs, id, () => ({ saveError })) })),

      setNotice: (id, notice) => set((s) => ({ tabs: patchTab(s.tabs, id, () => ({ notice })) })),

      setPendingSave: (id, pending) =>
        set((s) => ({ tabs: patchTab(s.tabs, id, () => ({ pendingSave: pending })) })),

      markSaved: (id, request) =>
        set((s) => ({
          tabs: patchTab(s.tabs, id, (t) => {
            const definition = normalizeDefinition(request.definition);
            return {
              requestId: request.id,
              collectionId: request.collectionId,
              name: request.name,
              // Ortak düzenlemede taslak başkalarının son yazdıklarını içerir; kaydedilen sürüm yalnızca tabandır.
              draft: t.collab ? t.draft : definition,
              saved: { name: request.name, definition, version: request.version },
              saveError: null,
              remote: null,
              pendingSave: false,
            };
          }),
        })),

      setRemote: (id, remote) =>
        set((s) => ({ tabs: patchTab(s.tabs, id, () => ({ remote, saveError: null })) })),

      keepMine: (id) =>
        set((s) => ({
          tabs: patchTab(s.tabs, id, (t) => {
            const latest = t.remote?.request;
            if (!latest) return { remote: null };
            return {
              collectionId: latest.collectionId,
              saved: {
                name: latest.name,
                definition: normalizeDefinition(latest.definition),
                version: latest.version,
              },
              remote: null,
            };
          }),
        })),

      detach: (id) =>
        set((s) => ({
          tabs: patchTab(s.tabs, id, () => ({
            requestId: null,
            collectionId: null,
            saved: null,
            remote: null,
            saveError: null,
          })),
        })),

      syncMoved: (requestId, collectionId, version) =>
        set((s) => ({
          tabs: s.tabs.map((t) =>
            t.requestId === requestId && t.saved ? { ...t, collectionId, saved: { ...t.saved, version } } : t,
          ),
        })),

      syncName: (requestId, name, version) =>
        set((s) => ({
          tabs: s.tabs.map((t) =>
            t.requestId === requestId && t.saved ? { ...t, name, saved: { ...t.saved, name, version } } : t,
          ),
        })),
    }),
    {
      name: 'apivator-tabs',
      storage: createJSONStorage(() => localStorage),
      // Yanıtlar ve geçici durumlar saklanmaz; sayfa yenilenince sekmeler ve taslaklar geri gelir.
      version: 1,
      // Tarayıcıda eski bir sürümün kaydettiği sekmeler olabilir; yeni eklenen alanlar (ör. auth)
      // eksikse varsayılanlarla tamamlanır.
      merge: (persisted, current) => mergePersistedTabs(persisted, current),
      migrate: (persisted) => persisted as TabsState,
      partialize: (s) => ({
        activeTabId: s.activeTabId,
        tabs: s.tabs.map((t) => ({
          ...t,
          response: null,
          sending: false,
          saveError: null,
          notice: null,
          remote: null,
          collab: false,
        })),
      }),
    },
  ),
);

export function mergePersistedTabs<T extends Pick<TabsState, 'tabs' | 'activeTabId'>>(
  persisted: unknown,
  current: T,
): T {
  const stored = (persisted ?? {}) as Partial<Pick<TabsState, 'tabs' | 'activeTabId'>>;
  const tabs = Array.isArray(stored.tabs) ? stored.tabs : [];
  return {
    ...current,
    activeTabId: stored.activeTabId ?? null,
    tabs: tabs
      .filter((t) => t && typeof t.id === 'string')
      .map((t) => ({
        ...t,
        section: t.section ?? 'params',
        draft: normalizeDefinition(t.draft),
        saved: t.saved ? { ...t.saved, definition: normalizeDefinition(t.saved.definition) } : null,
        response: null,
        sending: false,
        saveError: null,
        notice: null,
      })),
  };
}

export function isDirty(tab: RequestTab): boolean {
  if (!tab.saved) return !definitionsEqual(tab.draft, emptyDefinition());
  return tab.name !== tab.saved.name || !definitionsEqual(tab.draft, tab.saved.definition);
}
