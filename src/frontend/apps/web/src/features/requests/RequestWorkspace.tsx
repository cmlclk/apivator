import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Send } from 'lucide-react';
import { Button, Kbd } from '@apivator/ui';
import { useShallow } from 'zustand/react/shallow';
import {
  applyAuth,
  buildVariableMap,
  emptyGrpc,
  parseProtocols,
  resolveAuth,
  resolveRequest,
  resolveText,
  scopeValues,
  scriptChain,
  type ExecutionVariables,
  type RequestAuth,
  type RequestDefinition,
  type VariableMap,
} from '@apivator/core';
import { useVariableScopes } from '../environments/useVariables';
import { useWorkspaces } from '../../lib/useWorkspaces';
import { useCollections } from '../collections/useCollections';
import { RequestEditor } from './RequestEditor';
import { ResponsePanel } from './ResponsePanel';
import { SaveExampleDialog } from './SaveExampleDialog';
import { SaveRequestDialog } from './SaveRequestDialog';
import { api } from '../../lib/api';
import { useUi } from '../../stores/ui';
import { collectionsQueryKey } from '../collections/useCollections';
import { TabBar } from './TabBar';
import { canEditCollection } from '../collections/collectionAccess';
import { graphqlSchemaKey } from '../graphql/schemaKey';
import { ConsolePanel } from '../console/ConsolePanel';
import { useTabs } from './tabsStore';
import { useSaveRequest, useSendRequest } from './useRequestActions';
import { tokenForSend } from '../oauth/oauthFlow';
import { StreamPanel } from '../streaming/StreamPanel';
import {
  connectWebSocket,
  failBeforeStart,
  isActive,
  startGrpc,
  startSse,
  stop,
  useStreams,
} from '../streaming/streamStore';
import { describeGrpc, findMethod, grpcSchemaKey, useGrpcSchemas } from '../grpc/grpcDefinitions';
import { errorMessage, UserError } from '../../lib/errors';
import { translate, useT } from '../../i18n';

/**
 * Köprüden kurulan bağlantılar (WebSocket, gRPC) için adres, header ve yetkilendirme burada çözülüp uygulanır;
 * köprü değişken çözmez.
 */
function resolveConnection(
  draft: RequestDefinition,
  auth: RequestAuth,
  variables: VariableMap,
  extra: string[] = [],
): { url: string; headers: { key: string; value: string }[]; error: string | null } {
  const parts = resolveRequest({ url: draft.url, headers: draft.headers, body: draft.body, auth }, variables);
  const unresolved = [
    ...new Set([...parts.unresolved, ...extra.flatMap((t) => [...resolveText(t, variables).unresolved])]),
  ];
  if (unresolved.length) {
    return {
      url: parts.url,
      headers: [],
      error: translate('requests', 'workspace.undefinedVars', {
        names: unresolved.map((n) => `{{${n}}}`).join(', '),
      }),
    };
  }
  if (auth.type === 'Digest' || auth.type === 'AwsSigV4') {
    return {
      url: parts.url,
      headers: [],
      error: translate('requests', 'workspace.unsupportedAuth'),
    };
  }
  const applied = applyAuth(
    parts.url,
    parts.headers.filter((h) => h.enabled && h.key.trim()).map((h) => ({ key: h.key, value: h.value })),
    parts.auth,
  );
  return { url: applied.url, headers: applied.headers, error: null };
}

/** Üst: istek editörü, alt: yanıt; aradaki çizgi sürüklenerek yükseklik ayarlanır. */
function useVerticalSplit(initial = 0.45) {
  const [ratio, setRatio] = useState(initial);
  const container = useRef<HTMLDivElement>(null);

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    event.preventDefault();
    const move = (e: PointerEvent) => {
      const rect = container.current?.getBoundingClientRect();
      if (!rect) return;
      setRatio(Math.min(0.8, Math.max(0.2, (e.clientY - rect.top) / rect.height)));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, []);

  return { ratio, container, onPointerDown };
}

export function RequestWorkspace() {
  const t = useT('requests');
  const { current } = useWorkspaces();
  const workspaceId = current?.id;
  const { data: collections = [] } = useCollections(workspaceId);
  const tabs = useTabs(useShallow((s) => s.tabs.filter((t) => t.workspaceId === workspaceId)));
  const activeTabId = useTabs((s) => s.activeTabId);
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs.at(-1);
  const send = useSendRequest();
  const { saveExisting, saveNew, reload } = useSaveRequest();
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [exampleDialogOpen, setExampleDialogOpen] = useState(false);
  const queryClient = useQueryClient();
  const split = useVerticalSplit();

  const newTab = useCallback(() => {
    if (workspaceId) useTabs.getState().newTab(workspaceId);
  }, [workspaceId]);

  const save = useCallback(async () => {
    if (!activeTab) return;
    // Mağazadan güncel hâli: çakışma çözümü (benimkini kaydet) tabanı az önce değiştirmiş olabilir.
    const tab = useTabs.getState().tabs.find((t) => t.id === activeTab.id) ?? activeTab;
    const handled = await saveExisting(tab);
    if (!handled) setSaveDialogOpen(true);
  }, [activeTab, saveExisting]);

  const collection = activeTab?.collectionId
    ? collections.find((c) => c.id === activeTab.collectionId)
    : undefined;
  const folderId = collection?.requests.find((r) => r.id === activeTab?.requestId)?.folderId ?? null;
  const resolvedAuth = activeTab ? resolveAuth(activeTab.draft.auth, folderId, collection) : null;
  // Collection rolü workspace rolünden farklı olabilir (daraltma ya da yalnızca bu collection'da düzenleme).
  const canEdit = collection ? canEditCollection(collection, current?.role) : current?.role !== 'Viewer';
  const variableScopes = useVariableScopes(workspaceId, collection);
  const variables = useMemo(() => buildVariableMap(variableScopes.scopes), [variableScopes]);

  const grpcKey = useMemo(() => {
    if (!activeTab || activeTab.draft.kind !== 'Grpc') return null;
    const settings = activeTab.draft.grpc ?? emptyGrpc();
    const { text, unresolved } = resolveText(activeTab.draft.url, variables);
    return grpcSchemaKey(settings, unresolved.size ? null : text);
  }, [activeTab, variables]);

  /** gRPC tanımlarını getirir (reflection'da isteğin adresi, metadata'sı ve yetkilendirmesiyle). */
  const loadGrpc = useCallback(
    async (draft: RequestDefinition, auth: RequestAuth) => {
      const settings = draft.grpc ?? emptyGrpc();
      const { text, unresolved } = resolveText(draft.url, variables);
      const key = grpcSchemaKey(settings, unresolved.size ? null : text);
      if (!key)
        throw new UserError(settings.useReflection ? t('workspace.serverMissing') : t('workspace.addProto'));
      if (!settings.useReflection) {
        return describeGrpc(key, {
          url: null,
          metadata: null,
          protoFiles: settings.protoFiles,
          useReflection: false,
        });
      }
      let sendAuth = auth;
      if (auth.type === 'OAuth2') {
        const token = await tokenForSend(auth, variables);
        if (token) sendAuth = { ...auth, oAuth2AccessToken: token };
      }
      const target = resolveConnection(draft, sendAuth, variables);
      if (target.error) throw new UserError(target.error);
      return describeGrpc(key, {
        url: target.url,
        metadata: target.headers,
        protoFiles: null,
        useReflection: true,
      });
    },
    [variables, t],
  );

  const onGrpcLoad = useCallback(() => {
    if (!activeTab || !resolvedAuth) return;
    // Hata tanım mağazasına yazılır ve editörde gösterilir.
    loadGrpc(activeTab.draft, resolvedAuth.auth).catch(() => undefined);
  }, [activeTab, resolvedAuth, loadGrpc]);

  /** gRPC çağrısı: tanımlar yoksa önce yüklenir, metot ve mesaj hazırlanır, çağrı köprüden başlar. */
  const callGrpc = useCallback(
    async (tabId: string, draft: RequestDefinition, auth: RequestAuth) => {
      const settings = draft.grpc ?? emptyGrpc();
      const target = resolveConnection(draft, auth, variables, [settings.message]);
      if (target.error) {
        failBeforeStart(tabId, 'Grpc', draft.url, target.error);
        return;
      }
      if (!settings.method) {
        failBeforeStart(tabId, 'Grpc', target.url, t('workspace.pickMethod'));
        return;
      }
      const { text } = resolveText(draft.url, variables);
      const key = grpcSchemaKey(settings, text);
      let schema = key ? useGrpcSchemas.getState().entries[key]?.schema : null;
      if (!schema) {
        try {
          schema = await loadGrpc(draft, auth);
        } catch (error) {
          failBeforeStart(
            tabId,
            'Grpc',
            target.url,
            t('workspace.schemaFailed', { message: errorMessage(error) }),
          );
          return;
        }
      }
      const method = findMethod(schema, settings.method);
      if (!method) {
        failBeforeStart(tabId, 'Grpc', target.url, t('workspace.methodMissing', { method: settings.method }));
        return;
      }
      const message = resolveText(settings.message.trim() || '{}', variables).text;
      startGrpc(tabId, {
        url: target.url,
        metadata: target.headers,
        method: method.path,
        descriptorSet: schema!.descriptorSet,
        deadlineSeconds: settings.deadlineSeconds ?? null,
        clientStreaming: method.clientStreaming,
        // Akışlı istekte ilk mesaj da gönderilir; sonrakiler editörden eklenir.
        firstMessage: message,
      });
    },
    [variables, loadGrpc, t],
  );

  const sendActive = useCallback(() => {
    if (!activeTab || !resolvedAuth) return;
    const { draft } = activeTab;
    const kind = draft.kind ?? 'Http';
    if (kind !== 'Http') {
      // Akış/WebSocket açıksa aynı düğme (ve Ctrl+Enter) bağlantıyı keser.
      if (isActive(useStreams.getState().sessions[activeTab.id])) {
        stop(activeTab.id);
        return;
      }
      void (async () => {
        let auth = resolvedAuth.auth;
        if (auth.type === 'OAuth2') {
          const token = await tokenForSend(auth, variables);
          if (!token) {
            failBeforeStart(activeTab.id, kind, draft.url, t('workspace.oauthTokenMissing'));
            return;
          }
          auth = { ...auth, oAuth2AccessToken: token };
        }
        if (kind === 'Sse') {
          const missing = [...resolveText(draft.url, variables).unresolved];
          if (missing.length) {
            failBeforeStart(
              activeTab.id,
              kind,
              draft.url,
              t('workspace.urlUndefinedVars', { names: missing.map((n) => `{{${n}}}`).join(', ') }),
            );
            return;
          }
          const scope = (k: 'environment' | 'collection' | 'global') => {
            const found = variableScopes.scopes.find((s) => s.kind === k);
            return found ? scopeValues(found) : null;
          };
          startSse(activeTab.id, {
            method: draft.method,
            url: draft.url,
            headers: draft.headers,
            body: draft.body,
            auth,
            variables: {
              environment: scope('environment'),
              collection: scope('collection'),
              globals: scope('global'),
              environmentName: variableScopes.environmentName,
            },
            info: { requestName: activeTab.name, requestId: activeTab.requestId },
          });
          return;
        }
        if (kind === 'Grpc') {
          await callGrpc(activeTab.id, draft, auth);
          return;
        }
        // WebSocket: köprü değişken çözmez; adres, header ve yetkilendirme burada çözülüp uygulanır.
        const protocols = resolveText(draft.protocols ?? '', variables);
        const applied = resolveConnection(draft, auth, variables, [draft.protocols ?? '']);
        if (applied.error) {
          failBeforeStart(activeTab.id, kind, applied.url, applied.error);
          return;
        }
        connectWebSocket(activeTab.id, {
          url: applied.url,
          headers: applied.headers,
          protocols: parseProtocols(protocols.text),
        });
      })();
      return;
    }
    const scripts = scriptChain(collection, folderId, draft.scripts);
    // URL'de tanımsız değişken varsa istek geçersizdir; pre-request script'i onu tanımlayabileceği için
    // yalnızca script yoksa göndermeden uyarıyoruz (aksi hâlde sunucu script'lerden sonra kontrol eder).
    const missing = scripts.preRequest.length ? [] : [...resolveText(draft.url, variables).unresolved];
    if (missing.length > 0) {
      useTabs.getState().setResponse(activeTab.id, {
        status: null,
        statusText: null,
        headers: [],
        body: '',
        bodyEncoding: 'text',
        size: 0,
        truncated: false,
        timeMs: 0,
        finalUrl: null,
        error: {
          code: 'unresolved_variables',
          message: t('workspace.urlUndefinedVars', { names: missing.map((n) => `{{${n}}}`).join(', ') }),
        },
      });
      return;
    }
    const scope = (kind: 'environment' | 'collection' | 'global') => {
      const found = variableScopes.scopes.find((s) => s.kind === kind);
      return found ? scopeValues(found) : null;
    };
    const payload: ExecutionVariables = {
      environment: scope('environment'),
      collection: scope('collection'),
      globals: scope('global'),
      environmentName: variableScopes.environmentName,
    };
    const auth = resolvedAuth.auth;
    void (async () => {
      let sendAuth = auth;
      if (auth.type === 'OAuth2') {
        const token = await tokenForSend(auth, variables);
        if (!token && auth.oAuth2GrantType === 'AuthorizationCode') {
          useTabs.getState().setResponse(activeTab.id, {
            status: null,
            statusText: null,
            headers: [],
            body: '',
            bodyEncoding: 'text',
            size: 0,
            truncated: false,
            timeMs: 0,
            finalUrl: null,
            error: {
              code: 'oauth2_token_required',
              message: t('workspace.oauthTokenMissing'),
            },
          });
          return;
        }
        sendAuth = { ...auth, oAuth2AccessToken: token };
      }
      await send(activeTab, {
        parts: { url: draft.url, headers: draft.headers, body: draft.body, auth: sendAuth },
        historyDefinition: { ...draft, auth },
        scripts,
        variables: payload,
        scopeKeys: variableScopes.keys,
      });
    })();
  }, [activeTab, resolvedAuth, variables, variableScopes, collection, folderId, send, callGrpc, t]);

  /** GraphQL: isteğin adresi, header'ları ve yetkilendirmesiyle şemayı introspection ile al. */
  const introspect = useCallback(() => {
    if (!activeTab || !resolvedAuth) return;
    const { draft } = activeTab;
    const key = graphqlSchemaKey(draft.url, variables);
    if (!key) return;
    const scope = (k: 'environment' | 'collection' | 'global') => {
      const found = variableScopes.scopes.find((s) => s.kind === k);
      return found ? scopeValues(found) : null;
    };
    void (async () => {
      let auth = resolvedAuth.auth;
      if (auth.type === 'OAuth2') {
        const token = await tokenForSend(auth, variables);
        if (token) auth = { ...auth, oAuth2AccessToken: token };
      }
      const { fetchSchema } = await import('../graphql/graphqlSchema');
      await fetchSchema(key, {
        url: draft.url,
        headers: draft.headers,
        auth,
        variables: {
          environment: scope('environment'),
          collection: scope('collection'),
          globals: scope('global'),
          environmentName: variableScopes.environmentName,
        },
      });
    })();
  }, [activeTab, resolvedAuth, variables, variableScopes]);

  /** Değişkenleri ve yetkilendirme mirası çözülmüş istek (kod üretimi için). */
  const buildCode = useCallback(() => {
    if (!activeTab || !resolvedAuth) return null;
    const { draft } = activeTab;
    const parts = resolveRequest(
      { url: draft.url, headers: draft.headers, body: draft.body, auth: resolvedAuth.auth },
      variables,
    );
    return {
      method: draft.method,
      url: parts.url,
      headers: parts.headers,
      body: parts.body,
      auth: parts.auth,
    };
  }, [activeTab, resolvedAuth, variables]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !activeTab || e.defaultPrevented) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        sendActive();
      } else if (e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeTab, sendActive, save]);

  if (!current || !workspaceId) return null;

  return (
    <>
      <TabBar tabs={tabs} activeId={activeTab?.id ?? null} onNew={newTab} />

      {activeTab && resolvedAuth ? (
        <div ref={split.container} className="flex min-h-0 flex-1 flex-col">
          <div style={{ height: `${split.ratio * 100}%` }} className="min-h-0 bg-bg">
            <RequestEditor
              key={activeTab.id}
              tab={activeTab}
              breadcrumb={collection?.name ?? null}
              resolvedAuth={resolvedAuth}
              variables={variables}
              canEdit={canEdit}
              onIntrospect={introspect}
              grpcSchemaKey={grpcKey}
              onGrpcLoad={onGrpcLoad}
              onSend={sendActive}
              buildCode={buildCode}
              onSave={() => void save()}
              onReload={() => void reload(activeTab)}
            />
          </div>
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label={t('workspace.splitter')}
            onPointerDown={split.onPointerDown}
            className="h-1.5 shrink-0 cursor-row-resize border-y border-line bg-surface hover:bg-accent/30"
          />
          <section aria-label={t('workspace.response')} className="min-h-0 flex-1 bg-surface">
            {(activeTab.draft.kind ?? 'Http') !== 'Http' ? (
              <StreamPanel
                key={activeTab.id}
                tabId={activeTab.id}
                kind={activeTab.draft.kind as 'Sse' | 'WebSocket' | 'Grpc'}
              />
            ) : (
              <ResponsePanel
                key={activeTab.id}
                response={activeTab.response}
                sending={activeTab.sending}
                name={activeTab.name}
                requestId={activeTab.requestId}
                onSaveExample={activeTab.requestId && canEdit ? () => setExampleDialogOpen(true) : undefined}
              />
            )}
          </section>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center p-8">
          <div className="flex max-w-sm flex-col items-center text-center">
            <Send className="mb-4 h-8 w-8 text-fg-subtle/60" aria-hidden="true" />
            <h1 className="text-lg font-semibold">{current.name}</h1>
            <p className="mt-2 text-sm text-fg-muted">{t('workspace.empty')}</p>
            <Button className="mt-6" onClick={newTab}>
              <Plus className="h-4 w-4" /> {t('workspace.newRequest')}
            </Button>
            <div className="mt-6 flex items-center gap-4 text-xs text-fg-subtle">
              <span className="flex items-center gap-1.5">
                <Kbd>Ctrl</Kbd>
                <Kbd>Enter</Kbd> {t('workspace.hintSend')}
              </span>
              <span className="flex items-center gap-1.5">
                <Kbd>Ctrl</Kbd>
                <Kbd>S</Kbd> {t('workspace.hintSave')}
              </span>
            </div>
          </div>
        </div>
      )}

      <ConsolePanel />

      {exampleDialogOpen && activeTab?.requestId && activeTab.response && (
        <SaveExampleDialog
          initialName={
            `${activeTab.response.status ?? ''} ${activeTab.response.statusText ?? ''}`.trim() ||
            t('workspace.exampleDefault')
          }
          onSave={async (name) => {
            const response = activeTab.response!;
            await api.examples.create(activeTab.requestId!, {
              name,
              status: response.status ?? 200,
              headers: response.headers.map((h) => ({ key: h.key, value: h.value, enabled: true })),
              body: response.body,
              request: activeTab.draft,
            });
            useUi.getState().setExpanded(activeTab.requestId!, true);
            useTabs
              .getState()
              .setNotice(activeTab.id, { tone: 'info', text: t('workspace.exampleSaved', { name }) });
            await queryClient.invalidateQueries({ queryKey: collectionsQueryKey(workspaceId) });
          }}
          onClose={() => setExampleDialogOpen(false)}
        />
      )}

      {saveDialogOpen && activeTab && (
        <SaveRequestDialog
          workspaceId={workspaceId}
          initialName={activeTab.name}
          collections={collections.filter((c) => canEditCollection(c, current.role))}
          onSave={async (target, name) => {
            await saveNew({ ...activeTab, name }, target.collectionId, target.folderId, name);
          }}
          onClose={() => setSaveDialogOpen(false)}
        />
      )}
    </>
  );
}
