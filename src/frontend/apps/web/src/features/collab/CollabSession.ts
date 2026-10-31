import * as Y from 'yjs';
import * as decoding from 'lib0/decoding';
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from 'y-protocols/awareness';
import { definitionsEqual, type RequestDefinition } from '@apivator/core';
import {
  DEFINITION_KEY,
  applyDraft,
  base64,
  fromBase64,
  isEmpty,
  readDraft,
  textAt,
  toJson,
} from './draftDoc';

/** Sunucunun JoinDocument yanıtı. */
export interface DocumentJoin {
  canEdit: boolean;
  /** true: belgeyi bu istemci kaydedilmiş sürümden tohumlar. */
  first: boolean;
  /** Base64 Yjs güncellemeleri (sırayla). */
  updates: string[];
  generation: number;
}

/** Canlı kanalın belge uçları (SignalR hub'ı ya da testlerde sahte). */
export interface CollabTransport {
  isConnected(): boolean;
  join(requestId: string): Promise<DocumentJoin>;
  leave(requestId: string): Promise<void>;
  sendUpdate(requestId: string, update: string): Promise<void>;
  sendAwareness(requestId: string, payload: string): Promise<void>;
  compact(requestId: string, count: number, generation: number, merged: string): Promise<boolean>;
}

/** Sekmenin taslağına erişim (store'dan bağımsız tutulur ki oturum tek başına sınanabilsin). */
export interface DraftPort {
  getDraft(): RequestDefinition;
  /** Kaydedilmiş tanım; yoksa null. */
  getSaved(): RequestDefinition | null;
  setDraft(definition: RequestDefinition): void;
  /** Taslak değişince çağrılır; abonelikten çıkış işlevi döner. */
  subscribe(listener: (draft: RequestDefinition) => void): () => void;
}

export interface CollabUser {
  id: string;
  name: string;
}

export type CollabStatus =
  | 'joining'
  /** Başka biri belgeyi tohumluyor; gelmesi bekleniyor. */
  | 'waiting'
  | 'live'
  /** Görüntüleyici: ortak taslağı görür, yazamaz. */
  | 'readonly'
  /** Kaydedilmemiş yerel değişiklikler ortak taslaktan farklı; kullanıcı karar verir. */
  | 'conflict'
  /** Kullanıcı tek başına düzenliyor ya da ortak düzenleme kurulamadı. */
  | 'solo';

export interface CollabPeer {
  clientId: number;
  userId: string;
  name: string;
  color: string;
  /** Odaklandığı alanın yolu ("url", "body.raw" …). */
  field: string | null;
}

export interface RemoteCursor {
  name: string;
  color: string;
  anchor: number;
  head: number;
}

export interface SessionEvents {
  onStatus(status: CollabStatus): void;
  onPeers(peers: CollabPeer[]): void;
}

const LOCAL = 'local';
const REMOTE = 'remote';
const FLUSH_MS = 30;
const SEED_WAIT_MS = 5000;
const COMPACT_AFTER = 40;
const COLORS = ['#0284c7', '#7c3aed', '#d97706', '#e11d48', '#059669', '#c026d3'];

const SAFE_COLOR = /^#[0-9a-f]{6}$/i;

/**
 * Awareness başka bir istemciden gelir ve güvenilmez: renk CSS'e girdiği için yalnızca #rrggbb kabul edilir
 * (aksi hâlde stil enjeksiyonu olurdu); ad kısaltılır ve denetim karakterlerinden arındırılır.
 */
export function safeColor(color: unknown, fallbackId: string): string {
  return typeof color === 'string' && SAFE_COLOR.test(color) ? color : colorFor(fallbackId);
}

export function safeName(name: unknown): string {
  const text =
    typeof name === 'string'
      ? [...name]
          .filter((c) => c.charCodeAt(0) > 31 && c.charCodeAt(0) !== 127)
          .join('')
          .trim()
      : '';
  return text.slice(0, 64) || '?';
}

/** Awareness güncellemesindeki istemci numaraları; bozuk veri null. */
function awarenessClientIds(update: Uint8Array): number[] | null {
  try {
    const decoder = decoding.createDecoder(update);
    const count = decoding.readVarUint(decoder);
    if (count > 64) return null;
    const ids: number[] = [];
    for (let i = 0; i < count; i++) {
      ids.push(decoding.readVarUint(decoder));
      decoding.readVarUint(decoder);
      decoding.readVarString(decoder);
    }
    return ids;
  } catch {
    return null;
  }
}

/**
 * Sunucuya gönderilen kayıtların birleştirilmiş hâli, kayıtların kendisiyle aynı belgeyi veriyorsa döner.
 * Sunucu sıkıştırmayı doğrulayamaz (düzenleyiciye güvenir); bu yüzden hatalı bir birleşim hiç gönderilmez.
 */
function verifiedMerge(log: string[]): Uint8Array | null {
  const parts = log.map(fromBase64);
  const merged = Y.mergeUpdates(parts);
  const original = new Y.Doc();
  const compact = new Y.Doc();
  try {
    for (const part of parts) Y.applyUpdate(original, part);
    Y.applyUpdate(compact, merged);
    const sameVector = base64(Y.encodeStateVector(original)) === base64(Y.encodeStateVector(compact));
    const sameContent =
      JSON.stringify(toJson(original.getMap(DEFINITION_KEY))) ===
      JSON.stringify(toJson(compact.getMap(DEFINITION_KEY)));
    return sameVector && sameContent ? merged : null;
  } finally {
    original.destroy();
    compact.destroy();
  }
}

export function colorFor(userId: string): string {
  let hash = 0;
  for (const ch of userId) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return COLORS[Math.abs(hash) % COLORS.length]!;
}

/**
 * Bir isteğin ortak taslağı: Y.Doc ile sekmenin taslağı iki yönlü eşlenir. Yerel değişiklik belgeye farkıyla
 * yazılır ve hub'a gider; gelen güncelleme belgeye uygulanıp taslağa okunur. Kaydetme eskisi gibi yürür.
 */
export class CollabSession {
  readonly doc = new Y.Doc();
  readonly awareness = new Awareness(this.doc);
  private status: CollabStatus = 'joining';
  private canEdit = true;
  private attached = false;
  private applyingRemote = false;
  private disposed = false;
  private pending: Uint8Array[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribe: (() => void) | null = null;
  private seedTimer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private cursorListeners = new Set<() => void>();
  /** Awareness istemci numarası → sunucunun damgaladığı kişi (istemcinin kendi beyanı kullanılmaz). */
  private readonly identities = new Map<number, { userId: string; name: string }>();

  constructor(
    readonly requestId: string,
    private readonly transport: CollabTransport,
    private readonly port: DraftPort,
    user: CollabUser,
    private readonly events: SessionEvents,
  ) {
    this.doc.on('update', this.onDocUpdate);
    this.awareness.setLocalState({ user: { id: user.id, name: user.name, color: colorFor(user.id) } });
    this.awareness.on('update', this.onAwarenessUpdate);
    this.awareness.on('change', this.onAwarenessChange);
  }

  get currentStatus() {
    return this.status;
  }

  get writable() {
    return this.canEdit && this.status !== 'readonly';
  }

  /** Katılır ve ortak taslağı kurar; ağ hatasında 'solo'ya düşer (yerel düzenleme sürer). */
  async start(): Promise<void> {
    this.setStatus('joining');
    try {
      await this.join();
    } catch {
      this.setStatus('solo');
    }
  }

  /** Bağlantı koptuktan sonra yeniden kurulduğunda: kaçan güncellemeler alınır, yerel durum sunucuya gönderilir. */
  async rejoin(): Promise<void> {
    if (this.disposed || this.status === 'solo' || this.status === 'conflict') return;
    try {
      const result = await this.transport.join(this.requestId);
      this.canEdit = result.canEdit;
      this.generation = result.generation;
      this.applyAll(result.updates);
      if (this.canEdit) this.send(Y.encodeStateAsUpdate(this.doc));
      this.broadcastAwareness();
      this.flush();
    } catch {
      // Sonraki bağlantıda yeniden denenir; yerel güncellemeler kuyrukta bekler.
    }
  }

  private async join(attempt = 0): Promise<void> {
    const result = await this.transport.join(this.requestId);
    if (this.disposed) return;
    this.canEdit = result.canEdit;
    this.generation = result.generation;
    this.applyAll(result.updates);
    if (result.first && isEmpty(this.doc)) {
      this.seed();
      return;
    }
    if (isEmpty(this.doc)) {
      await this.waitForSeed(attempt);
      return;
    }
    this.afterJoin(result.updates);
  }

  /** İlk gelen: belge kaydedilmiş sürümden kurulur, yerel taslak (varsa) üstüne yazılır. */
  private seed() {
    const base = this.port.getSaved() ?? this.port.getDraft();
    applyDraft(this.doc, base, LOCAL);
    applyDraft(this.doc, this.port.getDraft(), LOCAL);
    this.flush();
    this.attach();
    this.setStatus(this.canEdit ? 'live' : 'readonly');
  }

  /** Başkası tohumluyor: gelene kadar beklenir; gelmezse (tohumlayan düştüyse) yeniden katılınır. */
  private async waitForSeed(attempt: number) {
    this.setStatus('waiting');
    await new Promise<void>((resolve) => {
      this.seedTimer = setTimeout(resolve, SEED_WAIT_MS);
      const check = () => {
        if (!isEmpty(this.doc) || this.disposed) {
          if (this.seedTimer) clearTimeout(this.seedTimer);
          this.doc.off('update', check);
          resolve();
        }
      };
      this.doc.on('update', check);
      setTimeout(() => this.doc.off('update', check), SEED_WAIT_MS + 50);
    });
    if (this.disposed) return;
    if (!isEmpty(this.doc)) return this.afterJoin([]);
    if (attempt >= 2) return this.setStatus('solo');
    await this.transport.leave(this.requestId).catch(() => undefined);
    await this.join(attempt + 1);
  }

  private afterJoin(log: string[]) {
    this.compactIfLong(log);
    const shared = readDraft(this.doc);
    const draft = this.port.getDraft();
    const saved = this.port.getSaved();
    const same = definitionsEqual(shared, draft);
    const dirty = saved !== null && !definitionsEqual(draft, saved);
    if (same) {
      this.attach();
    } else if (!dirty) {
      this.applyingRemote = true;
      try {
        this.port.setDraft(shared);
      } finally {
        this.applyingRemote = false;
      }
      this.attach();
    } else {
      // Kaydedilmemiş yerel değişikliklerin sessizce ezilmesi yerine kullanıcıya sorulur.
      this.setStatus('conflict');
      return;
    }
    this.setStatus(this.canEdit ? 'live' : 'readonly');
    this.broadcastAwareness();
  }

  /** Çakışmada "ortak taslağa katıl": yerel değişiklikler atılır. */
  adopt() {
    if (this.status !== 'conflict') return;
    this.applyingRemote = true;
    try {
      this.port.setDraft(readDraft(this.doc));
    } finally {
      this.applyingRemote = false;
    }
    this.attach();
    this.setStatus(this.canEdit ? 'live' : 'readonly');
    this.broadcastAwareness();
  }

  /** "Tek başıma düzenle": belgeden ayrılır, taslak yerel kalır. */
  async goSolo() {
    this.detach();
    this.setStatus('solo');
    await this.transport.leave(this.requestId).catch(() => undefined);
  }

  /** Erişim değişti (sunucudan): yazma hakkı güncellenir. */
  setCanEdit(canEdit: boolean) {
    this.canEdit = canEdit;
    if (this.status === 'live' || this.status === 'readonly') this.setStatus(canEdit ? 'live' : 'readonly');
  }

  /** Erişim kalktı: ortak düzenleme sona erer, taslak yerelde kalır. */
  revoked() {
    this.detach();
    this.setStatus('solo');
  }

  private attach() {
    if (this.attached) return;
    this.attached = true;
    this.unsubscribe = this.port.subscribe((draft) => {
      if (this.applyingRemote || !this.writable) return;
      applyDraft(this.doc, draft, LOCAL);
    });
  }

  private detach() {
    this.attached = false;
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /** Sunucudan gelen güncelleme. */
  receive(update: string) {
    if (this.disposed || this.status === 'solo') return;
    this.applyAll([update]);
  }

  private applyAll(updates: string[]) {
    for (const update of updates) Y.applyUpdate(this.doc, fromBase64(update), REMOTE);
  }

  private readonly onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === REMOTE) {
      if (this.attached) this.pullRemote();
      return;
    }
    if (this.canEdit) this.send(update);
  };

  /** Uzaktan gelen değişiklik: ortak taslak sekmenin taslağına yazılır. */
  private pullRemote() {
    const shared = readDraft(this.doc);
    if (definitionsEqual(shared, this.port.getDraft())) return;
    this.applyingRemote = true;
    try {
      this.port.setDraft(shared);
    } finally {
      this.applyingRemote = false;
    }
  }

  private send(update: Uint8Array) {
    this.pending.push(update);
    this.flushTimer ??= setTimeout(() => this.flush(), FLUSH_MS);
  }

  private flush() {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    if (this.pending.length === 0 || !this.transport.isConnected()) return;
    const merged = this.pending.length === 1 ? this.pending[0]! : Y.mergeUpdates(this.pending);
    this.pending = [];
    this.transport.sendUpdate(this.requestId, base64(merged)).catch(() => {
      // Gönderilemeyen güncelleme kaybolmaz: yeniden bağlanınca tüm durum gönderilir (rejoin).
      this.pending.unshift(merged);
    });
  }

  /** Günlük uzadıysa katılımda alınan kayıtlar tek güncellemede birleştirilip sunucuya geri yazılır. */
  private compactIfLong(log: string[]) {
    if (log.length < COMPACT_AFTER || !this.canEdit) return;
    const merged = verifiedMerge(log);
    if (!merged) return;
    void this.transport
      .compact(this.requestId, log.length, this.generation, base64(merged))
      .catch(() => undefined);
  }

  // --- awareness (kimler burada, imleçler) ---

  private readonly onAwarenessUpdate = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => {
    if (origin === 'local') {
      const changed = [...added, ...updated, ...removed];
      if (changed.length) this.sendAwareness(encodeAwarenessUpdate(this.awareness, changed));
    } else if (added.length > 0) {
      // Yeni biri göründü: ona kendi durumumu da göstereyim.
      this.broadcastAwareness();
    }
  };

  private sendAwareness(update: Uint8Array) {
    if (!this.transport.isConnected() || this.status === 'solo' || this.status === 'joining') return;
    void this.transport.sendAwareness(this.requestId, base64(update)).catch(() => undefined);
  }

  private broadcastAwareness() {
    this.sendAwareness(encodeAwarenessUpdate(this.awareness, [this.doc.clientID]));
  }

  /**
   * Başka bir istemcinin imleç/odak bilgisi. Kim olduğu sunucunun damgasından (`sender`) alınır; bir istemci
   * numarası ilk kullanan kişiye bağlanır, başkası onun adına güncelleme gönderemez.
   */
  receiveAwareness(payload: string, sender: { userId: string; name: string }) {
    if (this.disposed) return;
    const update = fromBase64(payload);
    const ids = awarenessClientIds(update);
    if (!ids || ids.some((id) => id === this.doc.clientID)) return;
    if (ids.some((id) => (this.identities.get(id)?.userId ?? sender.userId) !== sender.userId)) return;
    for (const id of ids) this.identities.set(id, { userId: sender.userId, name: safeName(sender.name) });
    applyAwarenessUpdate(this.awareness, update, 'remote-awareness');
  }

  private readonly onAwarenessChange = () => {
    this.events.onPeers(this.peers());
    for (const listener of this.cursorListeners) listener();
  };

  peers(): CollabPeer[] {
    const result: CollabPeer[] = [];
    this.awareness.getStates().forEach((state, clientId) => {
      const who = this.identities.get(clientId);
      const user = (state as { user?: { color?: unknown } }).user;
      if (clientId === this.doc.clientID || !user || !who) return;
      result.push({
        clientId,
        userId: who.userId,
        name: who.name,
        color: safeColor(user.color, who.userId),
        field: (state as { focus?: string | null }).focus ?? null,
      });
    });
    return result;
  }

  /** İmleçler değişince çağrılır (CodeMirror dekorasyonlarını tazelemek için). */
  onCursors(listener: () => void): () => void {
    this.cursorListeners.add(listener);
    return () => this.cursorListeners.delete(listener);
  }

  /** Bu alandaki yerel imleç/seçim (indeksler Y.Text'e göre); alanı bırakınca null. */
  setCursor(field: string, selection: { anchor: number; head: number } | null) {
    const text = textAt(this.doc, field);
    const state = { ...this.awareness.getLocalState() } as Record<string, unknown>;
    if (selection && text) {
      const rel = (index: number) =>
        Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(text, Math.min(index, text.length)));
      state.focus = field;
      state.cursor = { field, anchor: rel(selection.anchor), head: rel(selection.head) };
    } else {
      if ((state.cursor as { field?: string } | undefined)?.field === field) delete state.cursor;
      if (state.focus === field) delete state.focus;
    }
    this.awareness.setLocalState(state);
  }

  /** Tek satırlık girişlerde imleç yerine "burada" göstergesi için odaklanılan alan. */
  setFocus(field: string | null) {
    const state = { ...this.awareness.getLocalState() } as Record<string, unknown>;
    if (field) state.focus = field;
    else delete state.focus;
    this.awareness.setLocalState(state);
  }

  remoteCursors(field: string): RemoteCursor[] {
    const result: RemoteCursor[] = [];
    const text = textAt(this.doc, field);
    if (!text) return result;
    this.awareness.getStates().forEach((state, clientId) => {
      const who = this.identities.get(clientId);
      const { user, cursor } = state as {
        user?: { color?: unknown };
        cursor?: { field: string; anchor: unknown; head: unknown };
      };
      if (clientId === this.doc.clientID || !user || !who || cursor?.field !== field) return;
      const resolve = (rel: unknown) =>
        Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(rel), this.doc);
      const anchor = resolve(cursor.anchor);
      const head = resolve(cursor.head);
      if (anchor && head && anchor.type === text && head.type === text) {
        result.push({
          name: who.name,
          color: safeColor(user.color, who.userId),
          anchor: anchor.index,
          head: head.index,
        });
      }
    });
    return result;
  }

  dispose() {
    if (this.disposed) return;
    this.flush();
    this.disposed = true;
    this.detach();
    if (this.seedTimer) clearTimeout(this.seedTimer);
    if (this.flushTimer) clearTimeout(this.flushTimer);
    removeAwarenessStates(this.awareness, [this.doc.clientID], 'local');
    this.awareness.destroy();
    void this.transport.leave(this.requestId).catch(() => undefined);
    this.doc.destroy();
  }

  private setStatus(status: CollabStatus) {
    if (this.status === status) return;
    this.status = status;
    this.events.onStatus(status);
  }
}
