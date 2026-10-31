import { useCallback } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  ApiError,
  NetworkError,
  scopeChanges,
  type ApiRequestDto,
  type ExecutionVariables,
  type PreferencesDto,
  type RequestDefinition,
  type RequestParts,
  type ScopeName,
  type VariableChanges,
} from '@apivator/core';
import { translate } from '../../i18n';
import { useConsole } from '../console/consoleStore';
import { useEnvironmentStore } from '../environments/environmentStore';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { collectionsQueryKey } from '../collections/useCollections';
import { requestQueryKey } from '../../lib/offlineCache';
import { historyQueryKey, historyResponsePayload } from '../history/useHistory';
import { preferencesQueryKey } from '../account/preferences';
import { collectFiles, MAX_UPLOAD_BYTES } from './fileStore';
import { useTabs, type RequestTab } from './tabsStore';

function failure(code: string, message: string) {
  return {
    status: null,
    statusText: null,
    headers: [],
    body: '',
    bodyEncoding: 'text' as const,
    size: 0,
    truncated: false,
    timeMs: 0,
    finalUrl: null,
    error: { code, message },
  };
}

export interface SendInput {
  /** {{değişken}}'li parçalar; değişkenler sunucuda, pre-request script'lerinden sonra çözülür. Auth mirası çözülmüş. */
  parts: RequestParts;
  /** Geçmişe yazılacak tanım ({{değişken}}'li, yetkilendirme mirası çözülmüş). */
  historyDefinition: RequestDefinition;
  scripts: { preRequest: string[]; postResponse: string[] };
  variables: ExecutionVariables;
  /** Kapsam → yerel güncel değer anahtarı; script'lerin değiştirdiği değişkenler buraya yazılır. */
  scopeKeys: Partial<Record<ScopeName, string>>;
}

/** Script'lerin değiştirdiği değişkenleri bu tarayıcıdaki güncel değerlere yazar (Postman'deki gibi). */
export function applyVariableChanges(
  sent: ExecutionVariables,
  received: ExecutionVariables | null | undefined,
  keys: Partial<Record<ScopeName, string>>,
) {
  const store = useEnvironmentStore.getState();
  for (const [scope, changes] of Object.entries(scopeChanges(sent, received)) as [
    ScopeName,
    VariableChanges,
  ][]) {
    const key = keys[scope];
    if (!key) continue;
    const current = { ...(store.currentValues[key] ?? {}), ...changes.set };
    for (const name of changes.unset) delete current[name];
    store.setCurrentValues(key, current);
  }
}

/**
 * Sekmedeki isteği gönderir; sonuç (ya da ağ hatası) sekmeye ve konsola yazılır. Script'lerin değiştirdiği
 * değişkenler yerel güncel değerlere işlenir. Yanıt alınınca istek geçmişe yazılır.
 */
export function useSendRequest() {
  const queryClient = useQueryClient();
  return useCallback(
    async (tab: RequestTab, input: SendInput) => {
      const { setSending, setResponse } = useTabs.getState();
      if (tab.sending) return;
      setSending(tab.id, true);
      const { parts } = input;
      try {
        const { files, missing, tooLarge } = await collectFiles(tab.id, parts.body);
        if (missing.length) {
          setResponse(
            tab.id,
            failure(
              'missing_file',
              translate('requests', 'actions.filesMissing', { files: missing.join(', ') }),
            ),
          );
          return;
        }
        if (tooLarge) {
          setResponse(
            tab.id,
            failure(
              'file_too_large',
              translate('requests', 'actions.filesTooLarge', { mb: MAX_UPLOAD_BYTES / 1024 / 1024 }),
            ),
          );
          return;
        }
        const response = await api.execute({
          method: tab.draft.method,
          url: parts.url,
          headers: parts.headers,
          body: parts.body,
          auth: parts.auth,
          files: files.length ? files : undefined,
          preRequestScripts: input.scripts.preRequest,
          postResponseScripts: input.scripts.postResponse,
          variables: input.variables,
          info: { requestName: tab.name, requestId: tab.requestId },
        });
        setResponse(tab.id, response);
        applyVariableChanges(input.variables, response.variables, input.scopeKeys);
        useConsole.getState().add(tab.name, tab.draft.method, parts.url, response);
        // Hedefe gerçekten gönderildiyse (ağ hatası olsa da) geçmişe yaz.
        if (response.request) {
          void api.history
            .record(tab.workspaceId, {
              definition: input.historyDefinition,
              requestId: tab.requestId,
              status: response.status,
              timeMs: response.timeMs,
              size: response.size,
              response: queryClient.getQueryData<PreferencesDto>(preferencesQueryKey)?.saveHistoryResponses
                ? historyResponsePayload(response)
                : null,
            })
            .then(() => queryClient.invalidateQueries({ queryKey: historyQueryKey(tab.workspaceId) }))
            // Geçmiş kaydı yardımcı bir özellik; başarısız olursa isteği etkilemez.
            .catch(() => undefined);
        }
      } catch (error) {
        setResponse(tab.id, failure('apivator', errorMessage(error)));
      } finally {
        setSending(tab.id, false);
      }
    },
    [queryClient],
  );
}

/**
 * Kaydedilmiş isteği günceller. Yeni sekmeyse false döner; çağıran "Kaydet" penceresini açar.
 * Başkası arada değiştirdiyse sekmeye anlaşılır bir hata yazılır.
 */
/**
 * Kaydedilmiş isteğin taslağını kaydeder. Sunucuya ulaşılamazsa taslak bu cihazda kalır ve sekme "kaydedilmeyi
 * bekliyor" olarak işaretlenir; bağlantı gelince kendiliğinden kaydedilir (bkz. flushPendingSaves). Yeni sekmeyse
 * false döner; çağıran "Kaydet" penceresini açar. Başkası arada değiştirdiyse farklar gösterilir.
 */
export async function saveExistingTab(queryClient: QueryClient, tab: RequestTab): Promise<boolean> {
  if (!tab.requestId || !tab.saved) return false;
  const { markSaved, setSaveError, setPendingSave, setNotice } = useTabs.getState();
  try {
    const saved = await api.requests.update(tab.requestId, tab.name, tab.draft, tab.saved.version);
    markSaved(tab.id, saved);
    queryClient.setQueryData(requestQueryKey(saved.id), saved);
    await queryClient.invalidateQueries({ queryKey: collectionsQueryKey(tab.workspaceId) });
  } catch (error) {
    if (error instanceof NetworkError) {
      setPendingSave(tab.id, true);
      setNotice(tab.id, {
        tone: 'info',
        text: translate('requests', 'actions.offline'),
      });
      return true;
    }
    setPendingSave(tab.id, false);
    if (error instanceof ApiError && error.status === 409) {
      // Arada başkası kaydetti: güncel sürüm alınır, farkı görüp seçmek kullanıcıya bırakılır.
      try {
        const latest = await api.requests.get(tab.requestId);
        useTabs.getState().setRemote(tab.id, { deleted: false, byName: null, request: latest });
        return true;
      } catch {
        // Aşağıdaki genel hata gösterilir.
      }
    }
    setSaveError(
      tab.id,
      error instanceof ApiError && error.status === 404
        ? translate('requests', 'actions.deleted')
        : errorMessage(error),
    );
  }
  return true;
}

/** Bağlantı gelince çevrimdışıyken kaydedilen sekmeleri sırayla kaydeder. */
export async function flushPendingSaves(queryClient: QueryClient): Promise<number> {
  let count = 0;
  for (const tab of useTabs.getState().tabs.filter((t) => t.pendingSave)) {
    // Arada sekme değişmiş olabilir; mağazadaki güncel hâli kaydedilir.
    const current = useTabs.getState().tabs.find((t) => t.id === tab.id);
    if (!current?.pendingSave) continue;
    await saveExistingTab(queryClient, current);
    const after = useTabs.getState().tabs.find((t) => t.id === tab.id);
    if (after && !after.pendingSave) {
      count++;
      if (!after.remote && !after.saveError)
        useTabs
          .getState()
          .setNotice(tab.id, { tone: 'info', text: translate('requests', 'actions.offlineSaved') });
    } else {
      // Yine ulaşılamadı; kalanlar bir sonraki bağlantıda denenir.
      break;
    }
  }
  return count;
}

export function useSaveRequest() {
  const queryClient = useQueryClient();

  const saveExisting = useCallback((tab: RequestTab) => saveExistingTab(queryClient, tab), [queryClient]);

  const saveNew = useCallback(
    async (
      tab: RequestTab,
      collectionId: string,
      folderId: string | null,
      name: string,
    ): Promise<ApiRequestDto> => {
      const created = await api.requests.create(collectionId, name, folderId, tab.draft);
      useTabs.getState().markSaved(tab.id, created);
      await queryClient.invalidateQueries({ queryKey: collectionsQueryKey(tab.workspaceId) });
      return created;
    },
    [queryClient],
  );

  /** Sunucudaki güncel hâli yükler; yerel değişiklikler atılır. */
  const reload = useCallback(async (tab: RequestTab) => {
    if (!tab.requestId) return;
    const latest = await api.requests.get(tab.requestId);
    useTabs.getState().markSaved(tab.id, latest);
  }, []);

  return { saveExisting, saveNew, reload };
}
