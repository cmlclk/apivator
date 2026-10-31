import { lazy, Suspense, useState, type ClipboardEvent } from 'react';
import {
  Code2,
  History,
  Lock,
  MessageSquare,
  Plug,
  Radio,
  Save,
  Send,
  Square,
  Unplug,
  X,
  Zap,
} from 'lucide-react';
import { Alert, Button, Spinner, cn } from '@apivator/ui';
import {
  type CodeRequest,
  emptyGrpc,
  CurlParseError,
  HTTP_METHODS,
  looksLikeCurl,
  parseCurl,
  parseQueryParams,
  REQUEST_KIND_LABELS,
  resolveText,
  type RequestKind,
  withQueryParams,
  type ResolvedAuth,
  type VariableMap,
} from '@apivator/core';
import { SegmentedTabs } from '../../components/ui/SegmentedTabs';
import { useT } from '../../i18n';
import { AuthEditor } from './AuthEditor';
import { BodyEditor } from './BodyEditor';
import { graphqlSchemaKey } from '../graphql/schemaKey';
import { CodeDialog } from './CodeDialog';
import { ScriptsEditor } from '../scripts/ScriptsEditor';
import { KeyValueEditor } from './KeyValueEditor';
import { VariableInput } from './VariableInput';
import { methodColor } from './methodColors';
import { isDirty, useTabs, type EditorSection, type RequestTab } from './tabsStore';
import { RemoteChangeBanner } from './RemoteChangeBanner';
import { collabManager } from '../collab/collabManager';
import { useTabCollab } from '../collab/collabStore';
import { CollabSessionContext } from '../collab/CollabContext';
import { CollabAvatars, CollabNotice } from '../collab/CollabBar';
import { Avatar } from '../../components/PresenceAvatars';
import { useRequestViewers } from '../../lib/presence';
import { useWorkspaces } from '../../lib/useWorkspaces';
import { useCommentCounts, useCommentsPanel } from '../activity/activity';
import { RequestVersionsDialog } from '../activity/RequestVersionsDialog';
import { MessagesEditor } from '../streaming/MessagesEditor';
import { isActive, useStreams } from '../streaming/streamStore';
import { GrpcEditor } from '../grpc/GrpcEditor';
import { isLocalMode } from '../../lib/localMode';

const KINDS: RequestKind[] = ['Http', 'Sse', 'WebSocket', 'Grpc'];

// Markdown çizici büyük; yalnızca açıklama bölümü açılınca yüklenir.
const DescriptionEditor = lazy(() =>
  import('../docs/DescriptionEditor').then((m) => ({ default: m.DescriptionEditor })),
);

/** Tür değişince URL şeması da uyarlanır (https ↔ wss). */
function adaptUrl(url: string, kind: RequestKind): string {
  if (kind === 'WebSocket') return url.replace(/^http(s?):\/\//i, (_, s: string) => `ws${s}://`);
  return url.replace(/^ws(s?):\/\//i, (_, s: string) => `http${s}://`);
}

export function RequestEditor({
  tab,
  onSend,
  buildCode,
  onSave,
  onReload,
  breadcrumb,
  resolvedAuth,
  variables,
  canEdit = true,
  onIntrospect,
  grpcSchemaKey = null,
  onGrpcLoad,
}: {
  /** gRPC tanımlarının anahtarı (adres ya da .proto özeti). */
  grpcSchemaKey?: string | null;
  /** gRPC tanımlarını getir. */
  onGrpcLoad?: () => void;
  /** Kayıtlı isteğin collection'ını düzenleme yetkisi; yoksa kaydetme kapalıdır (göndermek serbest). */
  canEdit?: boolean;
  /** GraphQL gövdesinde şemayı introspection ile al. */
  onIntrospect?: () => void;
  tab: RequestTab;
  onSend: () => void;
  /** Değişkenleri ve yetkilendirme mirası çözülmüş istek (kod üretimi için). */
  buildCode: () => CodeRequest | null;
  onSave: () => void;
  onReload: () => void;
  breadcrumb: string | null;
  resolvedAuth: ResolvedAuth;
  variables: VariableMap;
}) {
  const t = useT('requests');
  const { updateDraft, setSection, rename, setNotice } = useTabs.getState();
  const { draft } = tab;
  const [codeRequest, setCodeRequest] = useState<CodeRequest | null>(null);
  const viewers = useRequestViewers(tab.requestId);
  const collab = useTabCollab(tab.id);
  const liveSession =
    collab.status === 'live' || collab.status === 'readonly' ? (collabManager.session(tab.id) ?? null) : null;
  const urlPeer = collab.peers.find((p) => p.field === 'url');
  const { current } = useWorkspaces();
  const [versionsOpen, setVersionsOpen] = useState(false);
  const { data: commentCounts } = useCommentCounts(tab.requestId ? tab.workspaceId : undefined);
  const commentCount = tab.requestId ? (commentCounts?.get(tab.requestId) ?? 0) : 0;
  const commentsTarget = useCommentsPanel((s) => s.target);
  const commentsOpen = commentsTarget?.type === 'Request' && commentsTarget.id === tab.requestId;

  /** URL alanına cURL komutu yapıştırılırsa isteğin tamamı ondan kurulur. */
  const onUrlPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text');
    if (!looksLikeCurl(text)) return;
    e.preventDefault();
    try {
      const { definition, hasAuth, warnings } = parseCurl(text);
      updateDraft(tab.id, {
        method: definition.method,
        url: definition.url,
        headers: definition.headers,
        body: definition.body,
        ...(hasAuth ? { auth: definition.auth } : {}),
      });
      setSection(tab.id, definition.body.mode !== 'None' ? 'body' : hasAuth ? 'auth' : 'params');
      setNotice(
        tab.id,
        warnings.length
          ? { tone: 'warning', text: t('editor.curlImportedWarnings'), details: warnings }
          : { tone: 'info', text: t('editor.curlImported') },
      );
    } catch (error) {
      setNotice(tab.id, {
        tone: 'error',
        text: t('editor.curlFailed', {
          message: error instanceof CurlParseError ? error.message : String(error),
        }),
      });
    }
  };
  const params = parseQueryParams(draft.url);
  const enabledHeaders = draft.headers.filter((h) => h.enabled && h.key).length;
  const kind = draft.kind ?? 'Http';
  const streamStatus = useStreams((s) => s.sessions[tab.id]?.status);
  const streaming = useStreams((s) => isActive(s.sessions[tab.id]));
  const messages = draft.messages ?? [];

  const changeKind = (next: RequestKind) => {
    updateDraft(tab.id, {
      kind: next,
      url: adaptUrl(draft.url, next),
      ...(next === 'Grpc' && !draft.grpc ? { grpc: emptyGrpc() } : {}),
    });
    if (next === 'WebSocket') setSection(tab.id, 'messages');
    else if (next === 'Grpc') setSection(tab.id, 'grpc');
    else if (tab.section === 'messages' || tab.section === 'settings' || tab.section === 'scripts')
      setSection(tab.id, 'params');
  };

  const grpc = draft.grpc ?? emptyGrpc();
  const allSections = [
    { id: 'grpc' as const, label: t('editor.sections.message'), badge: grpc.method ? null : '!' },
    {
      id: 'messages' as const,
      label: t('editor.sections.message'),
      badge: messages.length || null,
    },
    { id: 'params' as const, label: 'Params', badge: params.length || null },
    {
      id: 'auth' as const,
      label: 'Authorization',
      badge: draft.auth.type === 'Inherit' || draft.auth.type === 'None' ? null : '●',
    },
    {
      id: 'headers' as const,
      label: kind === 'Grpc' ? t('editor.metadataLabel') : 'Headers',
      badge: enabledHeaders || null,
    },
    { id: 'body' as const, label: 'Body', badge: draft.body.mode !== 'None' ? '●' : null },
    {
      id: 'scripts' as const,
      label: 'Scripts',
      badge: draft.scripts.preRequest.trim() || draft.scripts.postResponse.trim() ? '●' : null,
    },
    {
      id: 'settings' as const,
      label: t('editor.sections.settings'),
      badge: draft.protocols?.trim() ? '●' : null,
    },
    {
      id: 'docs' as const,
      label: t('editor.sections.description'),
      badge: draft.description?.trim() ? '●' : null,
    },
  ];
  // WebSocket'te gövde ve script yok; SSE'de script çalışmaz (akış yanıtı script'e verilemez). gRPC'de
  // mesaj, yetkilendirme ve metadata vardır.
  const sections = allSections.filter(
    (s) =>
      s.id === 'docs' ||
      (kind === 'Grpc'
        ? s.id === 'grpc' || s.id === 'auth' || s.id === 'headers'
        : kind === 'WebSocket'
          ? s.id !== 'body' && s.id !== 'scripts' && s.id !== 'grpc'
          : s.id !== 'messages' &&
            s.id !== 'settings' &&
            s.id !== 'grpc' &&
            (kind === 'Http' || s.id !== 'scripts')),
  );
  const section = sections.some((s) => s.id === tab.section) ? tab.section : sections[0]!.id;

  const sendLabel =
    kind === 'Http'
      ? t('editor.send')
      : kind === 'Grpc'
        ? streaming
          ? t('editor.cancel')
          : t('editor.call')
        : streaming
          ? streamStatus === 'connecting'
            ? t('editor.cancel')
            : kind === 'Sse'
              ? t('editor.stop')
              : t('editor.disconnect')
          : t('editor.connect');
  const SendIcon =
    kind === 'Http'
      ? Send
      : kind === 'Grpc'
        ? streaming
          ? Square
          : Zap
        : streaming
          ? kind === 'Sse'
            ? Square
            : Unplug
          : kind === 'Sse'
            ? Radio
            : Plug;

  return (
    <CollabSessionContext.Provider value={liveSession}>
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-center gap-2 px-4 pt-3">
          <div className="flex min-w-0 flex-1 items-center gap-1.5 text-sm">
            {breadcrumb && <span className="truncate text-fg-subtle">{breadcrumb} /</span>}
            <input
              value={tab.name}
              onChange={(e) => rename(tab.id, e.target.value)}
              aria-label={t('editor.requestName')}
              className="min-w-0 flex-1 truncate rounded px-1 py-0.5 font-medium text-fg hover:bg-muted focus:bg-surface focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
          <CollabAvatars tabId={tab.id} />
          {viewers.length > 0 && (
            <div
              className="flex items-center -space-x-1"
              title={t('editor.viewersTitle', { names: viewers.map((v) => v.displayName).join(', ') })}
              aria-label={t('editor.viewersLabel', { names: viewers.map((v) => v.displayName).join(', ') })}
              role="group"
            >
              {viewers.slice(0, 3).map((v) => (
                <Avatar key={v.userId} user={v} size="sm" />
              ))}
            </div>
          )}
          {tab.requestId && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setVersionsOpen(true)}
                title={t('editor.versionsTitle')}
              >
                <History className="h-3.5 w-3.5" /> {t('editor.versions')}
              </Button>
              {!isLocalMode() && (
                <Button
                  variant={commentsOpen ? 'secondary' : 'ghost'}
                  size="sm"
                  aria-pressed={commentsOpen}
                  onClick={() =>
                    commentsOpen
                      ? useCommentsPanel.getState().close()
                      : useCommentsPanel
                          .getState()
                          .open({ type: 'Request', id: tab.requestId!, name: tab.name })
                  }
                  title={t('editor.commentsTitle')}
                >
                  <MessageSquare className="h-3.5 w-3.5" /> {t('editor.comments')}
                  {commentCount > 0 && (
                    <span className="rounded bg-accent/15 px-1.5 text-[11px] font-semibold text-accent">
                      {commentCount}
                    </span>
                  )}
                </Button>
              )}
            </>
          )}
          {versionsOpen && tab.requestId && (
            <RequestVersionsDialog
              tab={tab}
              canEdit={canEdit && current?.role !== undefined}
              onClose={() => setVersionsOpen(false)}
            />
          )}
          {kind !== 'WebSocket' && kind !== 'Grpc' && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCodeRequest(buildCode())}
              disabled={!draft.url.trim()}
              title={t('editor.codeTitle')}
            >
              <Code2 className="h-3.5 w-3.5" /> {t('editor.code')}
            </Button>
          )}
          {codeRequest && <CodeDialog request={codeRequest} onClose={() => setCodeRequest(null)} />}
          <Button
            variant="secondary"
            size="sm"
            onClick={onSave}
            disabled={(!isDirty(tab) && tab.saved !== null) || (!canEdit && tab.requestId !== null)}
            title={!canEdit && tab.requestId ? t('editor.saveViewerTitle') : t('editor.saveTitle')}
          >
            <Save className="h-3.5 w-3.5" /> {t('editor.save')}
          </Button>
        </div>

        <RemoteChangeBanner tab={tab} onSave={onSave} />
        <CollabNotice tabId={tab.id} />

        {!canEdit && tab.requestId && (
          <Alert tone="info" className="mx-4 mt-2 flex items-center gap-2">
            <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {t('editor.viewerNotice')}
          </Alert>
        )}

        {tab.saveError && (
          <Alert tone="error" className="mx-4 mt-2 flex items-center justify-between gap-3">
            <span>{tab.saveError}</span>
            {tab.requestId && (
              <button type="button" onClick={onReload} className="shrink-0 font-medium underline">
                {t('editor.reload')}
              </button>
            )}
          </Alert>
        )}

        {tab.notice && (
          <Alert tone={tab.notice.tone} className="mx-4 mt-2 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p>{tab.notice.text}</p>
              {tab.notice.details && (
                <ul className="mt-1 list-disc ps-5 text-xs text-fg-muted">
                  {tab.notice.details.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              )}
            </div>
            <button
              type="button"
              onClick={() => setNotice(tab.id, null)}
              aria-label={t('editor.closeNotice')}
              className="shrink-0 rounded p-0.5 hover:bg-black/5 dark:hover:bg-white/10"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </Alert>
        )}

        <form
          className="flex gap-2 px-4 pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            onSend();
          }}
        >
          <div
            style={
              urlPeer ? { borderColor: urlPeer.color, boxShadow: `0 0 0 2px ${urlPeer.color}55` } : undefined
            }
            title={urlPeer ? t('editor.peerEditingUrl', { name: urlPeer.name }) : undefined}
            className="flex min-w-0 flex-1 overflow-hidden rounded-md border border-line bg-surface focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20"
          >
            <select
              value={kind}
              onChange={(e) => changeKind(e.target.value as RequestKind)}
              aria-label={t('editor.requestKind')}
              title={t('editor.requestKindTitle')}
              className="h-9 shrink-0 border-e border-line bg-muted/60 px-2 text-xs font-medium text-fg-muted focus:outline-none"
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {REQUEST_KIND_LABELS[k]}
                </option>
              ))}
            </select>
            {kind !== 'WebSocket' && kind !== 'Grpc' && (
              <select
                value={draft.method}
                onChange={(e) => updateDraft(tab.id, { method: e.target.value })}
                aria-label={t('editor.methodLabel')}
                className={cn(
                  'h-9 w-28 shrink-0 border-e border-line bg-muted/60 px-2.5 font-mono text-[13px] font-semibold focus:outline-none',
                  methodColor(draft.method),
                )}
              >
                {HTTP_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
                {!HTTP_METHODS.includes(draft.method as (typeof HTTP_METHODS)[number]) && (
                  <option value={draft.method}>{draft.method}</option>
                )}
              </select>
            )}
            <VariableInput
              value={draft.url}
              onChange={(url) => updateDraft(tab.id, { url })}
              onPaste={onUrlPaste}
              variables={variables}
              placeholder={
                kind === 'WebSocket'
                  ? t('editor.urlPlaceholder.ws')
                  : kind === 'Grpc'
                    ? t('editor.urlPlaceholder.grpc')
                    : kind === 'Sse'
                      ? t('editor.urlPlaceholder.sse')
                      : t('editor.urlPlaceholder.http')
              }
              aria-label="URL"
              collabField="url"
            />
          </div>
          <Button
            type="submit"
            variant={streaming ? 'secondary' : 'primary'}
            className="min-w-28 justify-center"
            disabled={tab.sending || (!streaming && !draft.url.trim())}
            title={t('editor.sendTitle', { label: sendLabel })}
          >
            {tab.sending ? <Spinner className="h-4 w-4" /> : <SendIcon className="h-4 w-4" />}
            {sendLabel}
          </Button>
        </form>

        <UrlPreview url={draft.url} variables={variables} />

        <div className="mt-2 border-b border-line px-4">
          <SegmentedTabs<EditorSection>
            tabs={sections}
            value={section}
            onChange={(next) => setSection(tab.id, next)}
            label={t('editor.sectionsLabel')}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
          {section === 'docs' && (
            <Suspense fallback={null}>
              <DescriptionEditor
                value={draft.description ?? ''}
                onChange={(description) => updateDraft(tab.id, { description })}
              />
            </Suspense>
          )}
          {section === 'grpc' && (
            <GrpcEditor
              tabId={tab.id}
              settings={grpc}
              onChange={(change) => updateDraft(tab.id, { grpc: { ...grpc, ...change } })}
              schemaKey={grpcSchemaKey}
              onLoad={() => onGrpcLoad?.()}
              variables={variables}
            />
          )}
          {section === 'messages' && (
            <MessagesEditor
              tabId={tab.id}
              messages={messages}
              onChange={(next) => updateDraft(tab.id, { messages: next })}
              variables={variables}
            />
          )}
          {section === 'params' && (
            <KeyValueEditor
              items={params}
              onChange={(items) => updateDraft(tab.id, { url: withQueryParams(draft.url, items) })}
              allowDisable={false}
              label={t('editor.queryParams')}
            />
          )}
          {section === 'auth' && (
            <AuthEditor
              auth={draft.auth}
              onChange={(auth) => updateDraft(tab.id, { auth })}
              allowInherit
              inheritedAuth={resolvedAuth.source ? resolvedAuth.auth : undefined}
              variables={variables}
              inheritedNote={
                resolvedAuth.source
                  ? t.rich(
                      resolvedAuth.source.kind === 'folder'
                        ? 'editor.inheritedFromFolder'
                        : 'editor.inheritedFromCollection',
                      { b: (c) => <strong className="font-medium text-fg">{c}</strong> },
                      { name: resolvedAuth.source.name, type: t(`auth.typeLabel.${resolvedAuth.auth.type}`) },
                    )
                  : t('editor.noInheritance')
              }
            />
          )}
          {section === 'headers' && (
            <KeyValueEditor
              items={draft.headers}
              onChange={(headers) => updateDraft(tab.id, { headers })}
              keyPlaceholder={kind === 'Grpc' ? t('editor.metadataKeyPlaceholder') : 'Header'}
              label={kind === 'Grpc' ? t('editor.metadataLabel') : t('editor.headersLabel')}
            />
          )}
          {section === 'body' && (
            <BodyEditor
              tabId={tab.id}
              body={draft.body}
              name={tab.name}
              onChange={(body) => updateDraft(tab.id, { body })}
              graphql={{ schemaKey: graphqlSchemaKey(draft.url, variables), onIntrospect }}
            />
          )}
          {section === 'scripts' && (
            <ScriptsEditor
              value={draft.scripts}
              onChange={(scripts) => updateDraft(tab.id, { scripts })}
              hint={t('editor.scriptsHint')}
            />
          )}
          {section === 'settings' && (
            <div className="flex max-w-xl flex-col gap-1.5 text-sm">
              <label htmlFor={`protocols-${tab.id}`} className="font-medium">
                {t('editor.subprotocols')}
              </label>
              <div className="flex rounded-md border border-line bg-surface focus-within:border-accent">
                <VariableInput
                  id={`protocols-${tab.id}`}
                  value={draft.protocols ?? ''}
                  onChange={(protocols) => updateDraft(tab.id, { protocols })}
                  variables={variables}
                  // eslint-disable-next-line apivator/no-literal-jsx-text -- WebSocket alt protokol adları örneği
                  placeholder="graphql-transport-ws, chat.v1"
                  aria-label={t('editor.subprotocols')}
                />
              </div>
              <p className="text-xs text-fg-subtle">{t('editor.subprotocolsHint')}</p>
            </div>
          )}
        </div>
      </div>
    </CollabSessionContext.Provider>
  );
}

/** URL'de değişken varsa çözülmüş hâlini ve tanımsız değişkenleri gösterir. */
function UrlPreview({ url, variables }: { url: string; variables: VariableMap }) {
  const t = useT('requests');
  if (!url.includes('{{')) return null;
  const { text, unresolved } = resolveText(url, variables);
  const secretUsed = [...url.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].some(
    (m) => variables.get(m[1]!.trim())?.isSecret,
  );
  return (
    <div className="flex min-w-0 items-center gap-3 px-4 pt-1.5 text-xs">
      <span className="min-w-0 truncate font-mono text-fg-subtle" title={secretUsed ? undefined : text}>
        → {secretUsed ? t('editor.urlHasSecret') : text}
      </span>
      {unresolved.size > 0 && (
        <span className="shrink-0 text-danger">
          {t('editor.undefinedVars', { names: [...unresolved].map((n) => `{{${n}}}`).join(', ') })}
        </span>
      )}
    </div>
  );
}
