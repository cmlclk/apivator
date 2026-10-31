import { beforeEach, describe, expect, it } from 'vitest';
import { emptyDefinition, type ApiRequestDto } from '@apivator/core';
import { isDirty, mergePersistedTabs, useTabs } from './tabsStore';

const saved: ApiRequestDto = {
  id: 'r1',
  collectionId: 'c1',
  folderId: null,
  name: 'Kullanıcılar',
  definition: { ...emptyDefinition(), url: 'https://x.test/users' },
  version: 3,
  updatedAt: '2026-10-20T10:00:00Z',
};

const tab = (id: string) => useTabs.getState().tabs.find((t) => t.id === id)!;

beforeEach(() => useTabs.setState({ tabs: [], activeTabId: null }));

describe('sekmeler', () => {
  it('kaydedilmiş isteği bir kez açar, tekrar tıklayınca aynı sekmeye geçer', () => {
    const { openSaved, newTab } = useTabs.getState();
    openSaved('w1', saved);
    const first = useTabs.getState().activeTabId;
    newTab('w1');
    openSaved('w1', saved);

    expect(useTabs.getState().tabs).toHaveLength(2);
    expect(useTabs.getState().activeTabId).toBe(first);
  });

  it('taslak değişince kaydedilmemiş sayılır, kaydedince temizlenir', () => {
    useTabs.getState().openSaved('w1', saved);
    const id = useTabs.getState().activeTabId!;
    expect(isDirty(tab(id))).toBe(false);

    useTabs.getState().updateDraft(id, { method: 'POST' });
    expect(isDirty(tab(id))).toBe(true);

    useTabs.getState().markSaved(id, { ...saved, definition: tab(id).draft, version: 4 });
    expect(isDirty(tab(id))).toBe(false);
    expect(tab(id).saved?.version).toBe(4);
  });

  it('boş yeni sekme kaydedilmemiş sayılmaz, URL yazılınca sayılır', () => {
    const id = useTabs.getState().newTab('w1');
    expect(isDirty(tab(id))).toBe(false);
    useTabs.getState().updateDraft(id, { url: 'https://x.test' });
    expect(isDirty(tab(id))).toBe(true);
  });

  it('aktif sekme kapanınca yanındaki sekme aktif olur', () => {
    const { newTab, close, activate } = useTabs.getState();
    const a = newTab('w1');
    const b = newTab('w1');
    const c = newTab('w1');
    activate(b);
    close(b);
    expect(useTabs.getState().activeTabId).toBe(c);
    close(c);
    expect(useTabs.getState().activeTabId).toBe(a);
  });

  it('silinen isteklerin sekmeleri kapanır', () => {
    useTabs.getState().openSaved('w1', saved);
    useTabs.getState().newTab('w1');
    useTabs.getState().closeByRequestIds(['r1']);
    expect(useTabs.getState().tabs.map((t) => t.requestId)).toEqual([null]);
  });

  it('ağaçta yeniden adlandırma taslağı korur, sürümü günceller', () => {
    useTabs.getState().openSaved('w1', saved);
    const id = useTabs.getState().activeTabId!;
    useTabs.getState().updateDraft(id, { url: 'https://x.test/degisti' });
    useTabs.getState().syncName('r1', 'Yeni ad', 4);

    expect(tab(id).name).toBe('Yeni ad');
    expect(tab(id).saved?.version).toBe(4);
    expect(tab(id).draft.url).toBe('https://x.test/degisti');
  });
});

describe('saklanan sekmeler', () => {
  it('eski sürümden kalan, auth alanı olmayan sekmeleri tamamlar', () => {
    const old = {
      activeTabId: 't1',
      tabs: [
        {
          id: 't1',
          workspaceId: 'w1',
          requestId: 'r1',
          collectionId: 'c1',
          name: 'Eski',
          draft: {
            method: 'GET',
            url: 'https://x.test',
            headers: [],
            body: { mode: 'None', rawLanguage: 'Json', raw: '', form: [] },
          },
          saved: {
            name: 'Eski',
            version: 1,
            definition: {
              method: 'GET',
              url: 'https://x.test',
              headers: [],
              body: { mode: 'None', rawLanguage: 'Json', raw: '', form: [] },
            },
          },
          section: 'params',
        },
      ],
    };

    const merged = mergePersistedTabs(old, useTabs.getState());

    expect(merged.tabs[0]!.draft.auth.type).toBe('Inherit');
    expect(merged.tabs[0]!.saved!.definition.auth.type).toBe('Inherit');
    expect(isDirty(merged.tabs[0]!)).toBe(false);
  });

  it('bozuk kaydı yok sayar', () => {
    expect(mergePersistedTabs('çöp', useTabs.getState()).tabs).toEqual([]);
    expect(mergePersistedTabs({ tabs: [null, { foo: 1 }] }, useTabs.getState()).tabs).toEqual([]);
  });
});
