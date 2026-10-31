import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { emptyDefinition, normalizeDefinition, type RequestDefinition } from '@apivator/core';
import { applyDraft, base64, readDraft, setText } from './draftDoc';
import {
  CollabSession,
  type CollabStatus,
  type CollabTransport,
  type DocumentJoin,
  type DraftPort,
} from './CollabSession';

/** Sunucunun belge mantığı (tohumlama hakkı, günlük, iletim) bellekte. */
class FakeHub {
  log: string[] = [];
  seedClaimed = false;
  private readonly members = new Map<
    string,
    { session: () => CollabSession | undefined; canEdit: boolean }
  >();

  transport = (name: string, canEdit = true): CollabTransport & { session?: CollabSession } => {
    const holder: { session?: CollabSession } = {};
    return Object.assign(holder, {
      isConnected: () => true,
      join: async (): Promise<DocumentJoin> => {
        this.members.set(name, { session: () => holder.session, canEdit });
        const first = !this.seedClaimed;
        this.seedClaimed = true;
        return { canEdit, first, updates: [...this.log], generation: 0 };
      },
      leave: async () => {
        this.members.delete(name);
      },
      sendUpdate: async (_id: string, update: string) => {
        if (!canEdit) throw new Error('yetki yok');
        this.log.push(update);
        for (const [other, m] of this.members)
          if (other !== name) queueMicrotask(() => m.session()?.receive(update));
      },
      sendAwareness: async (_id: string, payload: string) => {
        for (const [other, m] of this.members) {
          if (other !== name)
            queueMicrotask(() => m.session()?.receiveAwareness(payload, { userId: name, name }));
        }
      },
      compact: async () => {
        return true;
      },
    });
  };
}

function port(saved: RequestDefinition, draft: RequestDefinition = saved) {
  let current = draft;
  const listeners = new Set<(d: RequestDefinition) => void>();
  return {
    getDraft: () => current,
    getSaved: () => saved,
    setDraft(next: RequestDefinition) {
      current = next;
      listeners.forEach((l) => l(next));
    },
    subscribe(listener: (d: RequestDefinition) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** Kullanıcının yazması. */
    edit(change: Partial<RequestDefinition>) {
      current = { ...current, ...change };
      listeners.forEach((l) => l(current));
    },
  } satisfies DraftPort & { edit: (c: Partial<RequestDefinition>) => void };
}

const saved = (): RequestDefinition =>
  normalizeDefinition({
    method: 'GET',
    url: 'https://api.test/users',
    headers: [
      { key: 'Accept', value: 'application/json', enabled: true },
      { key: 'X-Trace', value: '1', enabled: true },
    ],
  });

const sessions: CollabSession[] = [];

function join(hub: FakeHub, name: string, p: ReturnType<typeof port>, canEdit = true) {
  const transport = hub.transport(name, canEdit);
  const statuses: CollabStatus[] = [];
  const session = new CollabSession(
    'req-1',
    transport,
    p,
    { id: name, name },
    {
      onStatus: (s) => statuses.push(s),
      onPeers: () => undefined,
    },
  );
  transport.session = session;
  sessions.push(session);
  return { session, statuses, ready: session.start() };
}

afterEach(() => {
  sessions.splice(0).forEach((s) => s.dispose());
});

describe('draftDoc', () => {
  it('round-trips a definition through the shared document', () => {
    const doc = new Y.Doc();
    applyDraft(doc, saved());
    expect(readDraft(doc)).toEqual(saved());
  });

  it('writes only the changed range of a text field and keeps emoji intact', () => {
    const doc = new Y.Doc();
    const text = doc.getText('t');
    text.insert(0, 'a😀b');
    setText(text, 'a😀cb');
    expect(text.toString()).toBe('a😀cb');
    setText(text, 'a😁cb');
    expect(text.toString()).toBe('a😁cb');
  });

  it('inserts and deletes a table row without touching the others', () => {
    const doc = new Y.Doc();
    const base = saved();
    applyDraft(doc, base);
    const before = Y.encodeStateVector(doc);
    applyDraft(doc, {
      ...base,
      headers: [base.headers[0]!, { key: 'X-New', value: 'v', enabled: true }, base.headers[1]!],
    });
    expect(readDraft(doc).headers.map((h) => h.key)).toEqual(['Accept', 'X-New', 'X-Trace']);
    const delta = Y.encodeStateAsUpdate(doc, before);
    expect(delta.length).toBeLessThan(150);
    applyDraft(doc, { ...base, headers: [base.headers[1]!] });
    expect(readDraft(doc).headers.map((h) => h.key)).toEqual(['X-Trace']);
  });
});

describe('CollabSession', () => {
  it('seeds from the saved version, then a second client adopts the shared draft', async () => {
    const hub = new FakeHub();
    const a = join(hub, 'a', port(saved()));
    await a.ready;
    expect(a.session.currentStatus).toBe('live');
    const pb = port(saved());
    const b = join(hub, 'b', pb);
    await b.ready;
    expect(b.session.currentStatus).toBe('live');
    expect(pb.getDraft()).toEqual(saved());
  });

  it('merges simultaneous edits in the same text field and in different table rows', async () => {
    const hub = new FakeHub();
    const pa = port(saved());
    const pb = port(saved());
    await join(hub, 'a', pa).ready;
    await join(hub, 'b', pb).ready;

    pa.edit({ url: 'https://api.test/v2/users' });
    pb.edit({
      url: 'https://api.test/users?limit=5',
      headers: [saved().headers[0]!, { key: 'X-Trace', value: '2', enabled: true }],
    });
    await vi.waitFor(() => expect(pa.getDraft()).toEqual(pb.getDraft()), { timeout: 1000 });
    expect(pa.getDraft().url).toBe('https://api.test/v2/users?limit=5');
    expect(pa.getDraft().headers[1]!.value).toBe('2');
  });

  it('keeps a late joiner in sync with edits made before it arrived', async () => {
    const hub = new FakeHub();
    const pa = port(saved());
    await join(hub, 'a', pa).ready;
    pa.edit({ url: 'https://api.test/changed' });
    await vi.waitFor(() => expect(hub.log.length).toBeGreaterThan(1));

    const pb = port(saved());
    await join(hub, 'b', pb).ready;
    expect(pb.getDraft().url).toBe('https://api.test/changed');
  });

  it('asks before replacing unsaved local changes, then adopts the shared draft on request', async () => {
    const hub = new FakeHub();
    await join(hub, 'a', port(saved())).ready;
    const dirty = { ...saved(), url: 'https://elle.test/yazilmis' };
    const pb = port(saved(), dirty);
    const b = join(hub, 'b', pb);
    await b.ready;
    expect(b.session.currentStatus).toBe('conflict');
    expect(pb.getDraft().url).toBe('https://elle.test/yazilmis');

    b.session.adopt();
    expect(b.session.currentStatus).toBe('live');
    expect(pb.getDraft()).toEqual(saved());
  });

  it('lets a viewer receive but never sends its own changes', async () => {
    const hub = new FakeHub();
    const pa = port(saved());
    await join(hub, 'a', pa).ready;
    const pv = port(saved());
    const viewer = join(hub, 'v', pv, false);
    await viewer.ready;
    expect(viewer.session.currentStatus).toBe('readonly');

    pa.edit({ url: 'https://api.test/live' });
    await vi.waitFor(() => expect(pv.getDraft().url).toBe('https://api.test/live'));

    const logged = hub.log.length;
    pv.edit({ url: 'https://api.test/local-only' });
    await new Promise((r) => setTimeout(r, 80));
    expect(hub.log.length).toBe(logged);
    expect(pa.getDraft().url).toBe('https://api.test/live');
  });

  it('applies a received update only once and ignores echoes of its own state', async () => {
    const hub = new FakeHub();
    const pa = port(saved());
    const a = await join(hub, 'a', pa).ready.then(() => sessions[0]!);
    const update = base64(Y.encodeStateAsUpdate(a.doc));
    a.receive(update);
    a.receive(update);
    expect(pa.getDraft()).toEqual(saved());
  });
});

describe('definition defaults', () => {
  it('survives an empty definition', () => {
    const doc = new Y.Doc();
    applyDraft(doc, emptyDefinition());
    expect(readDraft(doc)).toEqual(normalizeDefinition(emptyDefinition()));
  });
});

describe('editor integration', () => {
  it('applies an external whole-document replacement as a minimal change, keeping the cursor', async () => {
    const { EditorState } = await import('@codemirror/state');
    const { ExternalChange } = await import('@uiw/react-codemirror');
    const { minimalExternalChange } = await import('./cmCollab');
    const state = EditorState.create({
      doc: 'hello world',
      selection: { anchor: 11 },
      extensions: [minimalExternalChange],
    });
    const next = state.update({
      changes: { from: 0, to: 11, insert: 'oh hello world' },
      annotations: [ExternalChange.of(true)],
    }).state;
    expect(next.doc.toString()).toBe('oh hello world');
    expect(next.selection.main.head).toBe(14);
  });

  it('keeps the shared draft when the saved version is refreshed on a collaborating tab', async () => {
    const { useTabs } = await import('../requests/tabsStore');
    const request = {
      id: 'r1',
      collectionId: 'c1',
      folderId: null,
      name: 'Liste',
      sortOrder: 0,
      method: 'GET',
      version: 1,
      definition: saved(),
    };
    useTabs.getState().openSaved('w1', request as never);
    const tab = useTabs.getState().tabs.at(-1)!;
    useTabs.getState().setCollab(tab.id, true);
    useTabs.getState().setDraft(tab.id, { ...saved(), url: 'https://api.test/shared-edit' });
    useTabs.getState().markSaved(tab.id, { ...request, version: 2 } as never);
    const after = useTabs.getState().tabs.find((t) => t.id === tab.id)!;
    expect(after.saved?.version).toBe(2);
    expect(after.draft.url).toBe('https://api.test/shared-edit');
  });
});

describe('untrusted awareness', () => {
  it('rejects colours that are not plain hex and trims names', async () => {
    const { safeColor, safeName } = await import('./CollabSession');
    expect(safeColor('#12abEF', 'u')).toBe('#12abEF');
    expect(safeColor('red;position:fixed;inset:0', 'u')).toMatch(/^#[0-9a-f]{6}$/i);
    expect(safeColor({}, 'u')).toMatch(/^#[0-9a-f]{6}$/i);
    expect(safeName(`Mert${String.fromCharCode(7)}${'x'.repeat(100)}`)).toHaveLength(64);
    expect(safeName(42)).toBe('?');
  });
});

describe('awareness identity', () => {
  async function awarenessFrom(state: Record<string, unknown>, doc = new Y.Doc()) {
    const { Awareness, encodeAwarenessUpdate } = await import('y-protocols/awareness');
    const awareness = new Awareness(doc);
    awareness.setLocalState(state);
    return { payload: base64(encodeAwarenessUpdate(awareness, [doc.clientID])), doc, awareness };
  }

  it('takes the identity from the server stamp and ignores a spoofed name, id and colour', async () => {
    const hub = new FakeHub();
    const mine = join(hub, 'a', port(saved()));
    await mine.ready;
    const spoof = await awarenessFrom({
      user: { id: 'victim-id', name: 'Yönetici', color: 'red;position:fixed;inset:0' },
      focus: 'url',
    });
    mine.session.receiveAwareness(spoof.payload, { userId: 'attacker-id', name: 'Mert' });

    const [peer] = mine.session.peers();
    expect(peer).toMatchObject({ userId: 'attacker-id', name: 'Mert', field: 'url' });
    expect(peer!.color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('refuses another sender taking over a client id that is already bound', async () => {
    const hub = new FakeHub();
    const mine = join(hub, 'a', port(saved()));
    await mine.ready;
    const first = await awarenessFrom({ user: { color: '#112233' }, focus: 'url' });
    mine.session.receiveAwareness(first.payload, { userId: 'real', name: 'Gerçek' });

    first.awareness.setLocalState({ user: { color: '#445566' }, focus: 'body.raw' });
    const { encodeAwarenessUpdate } = await import('y-protocols/awareness');
    const forged = base64(encodeAwarenessUpdate(first.awareness, [first.doc.clientID]));
    mine.session.receiveAwareness(forged, { userId: 'attacker', name: 'Saldırgan' });

    expect(mine.session.peers()).toMatchObject([{ userId: 'real', name: 'Gerçek', field: 'url' }]);
  });
});
