import { useCallback, useRef, useState, type ReactNode } from 'react';
import { useInRouterContext, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { FilePlus2, Forward, Variable as VariableIcon, Wrench } from 'lucide-react';
import { Alert, Button, Input, cn } from '@apivator/ui';
import { emptyDefinition, type Variable } from '@apivator/core';
import { Dialog } from '../../components/ui/Dialog';
import { useDismiss } from '../../components/useDismiss';
import { translate, useT } from '../../i18n';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { useWorkspaces } from '../../lib/useWorkspaces';
import { scopeKeys, useEnvironmentStore } from '../environments/environmentStore';
import {
  environmentsQueryKey,
  globalsQueryKey,
  useActiveEnvironment,
  useEnvironments,
  useGlobals,
} from '../environments/useVariables';
import { useTabs } from '../requests/tabsStore';
import { openInTool } from './openInTool';
import { TOOLS } from './registry';
import { toolLabelClass, toolSelectClass } from './toolUtils';

/** Tetikleyici düğmenin altında açılan küçük menü. */
function Dropdown({
  trigger,
  children,
  align = 'right',
}: {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);
  return (
    <div ref={ref} className="relative">
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div
          role="menu"
          className={cn(
            'absolute top-full z-30 mt-1 w-max min-w-44 max-w-80 rounded-lg border border-line bg-surface p-1 shadow-lg',
            align === 'right' ? 'end-0' : 'start-0',
          )}
        >
          {children(close)}
        </div>
      )}
    </div>
  );
}

const menuItem =
  'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-start text-sm whitespace-nowrap text-fg-muted hover:bg-muted hover:text-fg disabled:opacity-50';

/** Metni gövde olarak taşıyan yeni bir istek sekmesi açar (JSON ise dil JSON seçilir). */
function openInNewRequest(workspaceId: string, text: string) {
  let isJson = false;
  try {
    JSON.parse(text);
    isJson = true;
  } catch {
    // Düz metin.
  }
  const draft = emptyDefinition();
  draft.method = 'POST';
  draft.body = { ...draft.body, mode: 'Raw', rawLanguage: isJson ? 'Json' : 'Text', raw: text };
  useTabs.getState().newTab(workspaceId, { name: translate('tools', 'request.fromTool'), draft });
}

/** Araç çıktısını isteklere taşıyan düğmeler (ToolPane'in `output` alanlarında görünür). */
export function OutputActions({ text }: { text: string }) {
  const t = useT('tools');
  const navigate = useNavigate();
  const { current } = useWorkspaces();
  const [saving, setSaving] = useState(false);
  return (
    <>
      <Dropdown
        trigger={({ open, toggle }) => (
          <Button
            size="icon"
            variant="ghost"
            title={t('output.use')}
            aria-label={t('output.use')}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={toggle}
          >
            <Forward className="h-3.5 w-3.5" />
          </Button>
        )}
      >
        {(close) => (
          <>
            <button
              type="button"
              role="menuitem"
              className={menuItem}
              disabled={!current}
              onClick={() => {
                close();
                setSaving(true);
              }}
            >
              <VariableIcon className="h-3.5 w-3.5" aria-hidden="true" /> {t('output.saveVariable')}
            </button>
            <button
              type="button"
              role="menuitem"
              className={menuItem}
              disabled={!current}
              onClick={() => {
                close();
                openInNewRequest(current!.id, text);
                void navigate('/');
              }}
            >
              <FilePlus2 className="h-3.5 w-3.5" aria-hidden="true" /> {t('output.useInRequest')}
            </button>
          </>
        )}
      </Dropdown>
      {saving && current && (
        <SaveVariableDialog
          workspaceId={current.id}
          canEdit={current.role !== 'Viewer'}
          value={text}
          onClose={() => setSaving(false)}
        />
      )}
    </>
  );
}

/**
 * Değeri aktif environment'a ya da globals'a yazar. Varsayılan olarak yalnızca "güncel değer" (bu cihazda)
 * güncellenir; ekiple paylaşmak istenirse başlangıç değeri de sunucuya kaydedilir.
 */
function SaveVariableDialog({
  workspaceId,
  canEdit,
  value,
  onClose,
}: {
  workspaceId: string;
  canEdit: boolean;
  value: string;
  onClose: () => void;
}) {
  const t = useT('tools');
  const queryClient = useQueryClient();
  const environments = useEnvironments(workspaceId);
  const environment = useActiveEnvironment(workspaceId);
  const globalsQuery = useGlobals(workspaceId);
  const globals = globalsQuery.data;
  const [name, setName] = useState('');
  // 'auto': aktif environment varsa o (environment listesi geç yüklenebilir), yoksa globals.
  const [target, setTarget] = useState<'auto' | 'environment' | 'globals'>('auto');
  const [share, setShare] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const scope = target !== 'globals' && environment ? 'environment' : 'globals';
  // Liste yüklenmeden kaydetmek sunucudaki değişkenleri tek değişkenle ezerdi.
  const loaded = environments.isSuccess && (scope === 'environment' || globalsQuery.isSuccess);
  const loadError = environments.error ?? globalsQuery.error;
  const variables: Variable[] = scope === 'environment' ? environment!.variables : (globals?.variables ?? []);

  async function save() {
    const key = name.trim();
    if (!key || !loaded) return;
    setBusy(true);
    setError(null);
    try {
      const exists = variables.some((v) => v.key === key);
      if ((share || !exists) && !canEdit) {
        throw new Error(t('saveVariable.noPermission'));
      }
      if (share || !exists) {
        // Yeni değişkenin başlangıç değeri, paylaşılmadıkça boş kalır; değer yalnızca bu cihazda tutulur.
        const next = exists
          ? variables.map((v) => (v.key === key ? { ...v, value } : v))
          : [...variables, { key, value: share ? value : '', enabled: true, isSecret: false }];
        if (scope === 'environment') {
          await api.environments.update(environment!.id, environment!.name, next, environment!.version);
        } else {
          await api.globals.update(workspaceId, next);
        }
      }
      const scopeKey =
        scope === 'environment' ? scopeKeys.environment(environment!.id) : scopeKeys.globals(workspaceId);
      const { currentValues, setCurrentValues } = useEnvironmentStore.getState();
      setCurrentValues(scopeKey, { ...currentValues[scopeKey], [key]: value });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: environmentsQueryKey(workspaceId) }),
        queryClient.invalidateQueries({ queryKey: globalsQueryKey(workspaceId) }),
      ]);
      setDone(
        t('saveVariable.saved', {
          variable: `{{${key}}}`,
          target: scope === 'environment' ? environment!.name : 'Globals',
        }),
      );
    } catch (e) {
      setError(e instanceof Error && !('status' in e) ? e.message : errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={t('output.saveVariable')}
      onClose={onClose}
      footer={
        done ? (
          <Button onClick={onClose}>{t('saveVariable.close')}</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              {t('saveVariable.cancel')}
            </Button>
            <Button loading={busy} disabled={!name.trim() || !loaded} onClick={() => void save()}>
              {t('saveVariable.save')}
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-3">
        {error && <Alert tone="error">{error}</Alert>}
        {loadError && !error && <Alert tone="error">{errorMessage(loadError)}</Alert>}
        {done && <Alert tone="success">{done}</Alert>}
        <Input
          label={t('saveVariable.name')}
          value={name}
          // eslint-disable-next-line apivator/no-literal-jsx-text -- örnek değişken adı
          placeholder="token"
          list="tool-variable-names"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !busy) void save();
          }}
        />
        <datalist id="tool-variable-names">
          {variables.map((v) => (
            <option key={v.key} value={v.key} />
          ))}
        </datalist>
        <label className={toolLabelClass}>
          {t('saveVariable.target')}
          <select
            className={toolSelectClass}
            value={scope}
            onChange={(e) => setTarget(e.target.value as 'environment' | 'globals')}
          >
            {environment && (
              <option value="environment">
                {t('saveVariable.activeEnvironment', { name: environment.name })}
              </option>
            )}
            <option value="globals">{t('saveVariable.globals')}</option>
          </select>
        </label>
        <label className={toolLabelClass}>
          <input
            type="checkbox"
            checked={share}
            disabled={!canEdit}
            onChange={(e) => setShare(e.target.checked)}
            className="h-3.5 w-3.5 accent-[var(--app-accent)]"
          />
          {t('saveVariable.shareInitial')}
        </label>
        <p className="text-xs text-fg-subtle">{t('saveVariable.localNote')}</p>
      </div>
    </Dialog>
  );
}

/** Ekrandaki yanıtın (ya da seçili metnin) gönderilebileceği araçlar. */
const RESPONSE_TOOLS = [
  'json-format',
  'jsonpath',
  'json-convert',
  'json-model',
  'diff',
  'base64',
  'jwt',
  'url',
  'regex',
  'hash',
];

/** Yanıt panelindeki "Araçlarda aç": metin tıklama anında `getText` ile alınır (seçim varsa seçim). */
export function OpenInToolsMenu(props: { getText: () => string; className?: string }) {
  // Yönlendirici dışında (ör. bileşen testleri) gidilecek yer olmadığından gösterilmez.
  return useInRouterContext() ? <OpenInToolsDropdown {...props} /> : null;
}

function OpenInToolsDropdown({ getText, className }: { getText: () => string; className?: string }) {
  // Yanıt panelinde de görünür: tembel 'tools' ad alanı yerine açılışta yüklü katalog kullanılır (Suspense beklenmez).
  const t = useT('toolCatalog');
  const navigate = useNavigate();
  const tools = RESPONSE_TOOLS.map((id) => TOOLS.find((t) => t.id === id)).filter((t) => t !== undefined);
  return (
    <Dropdown
      trigger={({ open, toggle }) => (
        <button
          type="button"
          className={className}
          title={t('openIn.hint')}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={toggle}
        >
          <Wrench className="h-3.5 w-3.5" /> {t('openIn.label')}
        </button>
      )}
    >
      {(close) =>
        tools.map((tool) => (
          <button
            key={tool.id}
            type="button"
            role="menuitem"
            className={menuItem}
            onClick={() => {
              close();
              openInTool(navigate, tool.id, getText());
            }}
          >
            {tool.name}
          </button>
        ))
      }
    </Dropdown>
  );
}
