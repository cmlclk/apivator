import { lazy, Suspense, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BookmarkPlus,
  Check,
  Copy,
  Download,
  FileSpreadsheet,
  Search,
  Send,
} from 'lucide-react';
import { openSearchPanel } from '@codemirror/search';
import type { EditorView } from '@codemirror/view';
import { Kbd, Spinner, cn } from '@apivator/ui';
import {
  cookiesFromHeaders,
  formatBytes,
  responseFileName,
  formatDuration,
  prettyJson,
  type ExecuteResponse,
  type ExportSource,
  type RawLanguage,
} from '@apivator/core';
import { SegmentedTabs } from '../../components/ui/SegmentedTabs';
import { saveFile } from '../../lib/download';
import { CodeEditor } from './CodeEditor';
import { TestResults } from './TestResults';
import { useConsole } from '../console/consoleStore';
import { tableSource, tableSourceKind } from '../export/sourceKind';
import { ModelButton } from '../models/ModelButton';
import { jsonSamples, rootNameFor } from '../models/sources';
import { api } from '../../lib/api';
import { OpenInToolsMenu } from '../tools/OutputActions';

const TableExportDialog = lazy(() =>
  import('../export/TableExportDialog').then((m) => ({ default: m.TableExportDialog })),
);
import { errorMessage } from '../../lib/errors';
import { useT, type MessageKey } from '../../i18n';

type View = 'body' | 'cookies' | 'headers' | 'tests';

function responseBlob(response: ExecuteResponse, contentType: string | undefined): Blob {
  if (response.bodyEncoding === 'base64') {
    const binary = atob(response.body);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: contentType ?? 'application/octet-stream' });
  }
  return new Blob([response.body], { type: contentType ?? 'text/plain' });
}

const toolButton =
  'flex items-center gap-1 rounded px-2 py-1 text-xs text-fg-subtle hover:bg-muted hover:text-fg';

/** Hata koduna göre ipucu anahtarı; metin render anında çevrilir. */
const errorHintKeys: Record<string, MessageKey<'requests'>> = {
  script_error: 'response.hints.scriptError',
  missing_file: 'response.hints.missingFile',
  unresolved_variables: 'response.hints.unresolvedVariables',
  blocked: 'response.hints.blocked',
  connection_refused: 'response.hints.connectionRefused',
  dns: 'response.hints.dns',
  timeout: 'response.hints.timeout',
  ssl: 'response.hints.ssl',
  invalid_url: 'response.hints.invalidUrl',
};

const COOKIE_COLUMNS = [
  'name',
  'value',
  'domain',
  'path',
  'expires',
  'httpOnly',
  'secure',
  'sameSite',
] as const;

function statusTone(status: number) {
  if (status < 300) return 'text-success bg-success/10';
  if (status < 400) return 'text-accent bg-accent/10';
  if (status < 500) return 'text-warning bg-warning/10';
  return 'text-danger bg-danger/10';
}

function languageOf(contentType: string | undefined): RawLanguage | 'none' {
  const ct = contentType?.toLowerCase() ?? '';
  if (ct.includes('json')) return 'Json';
  if (ct.includes('html')) return 'Html';
  if (ct.includes('xml')) return 'Xml';
  if (ct.includes('javascript')) return 'JavaScript';
  return 'none';
}

export function ResponsePanel({
  response,
  sending,
  name,
  requestId,
  onSaveExample,
}: {
  /** Kayıtlı isteğin kimliği: model üretiminde kayıtlı örnek yanıtlar da kullanılır. */
  requestId?: string | null;
  response: ExecuteResponse | null;
  sending: boolean;
  /** İsteğin adı; tablo olarak kaydederken dosya adı olur. */
  name?: string;
  /** Kayıtlı isteklerde yanıtı örnek olarak kaydetme; yoksa düğme gösterilmez. */
  onSaveExample?: () => void;
}) {
  const t = useT('requests');
  const [view, setView] = useState<View>('body');
  const [pretty, setPretty] = useState(true);
  const [copied, setCopied] = useState(false);
  const editor = useRef<EditorView | null>(null);
  const [tableSourceState, setTableSourceState] = useState<ExportSource | null>(null);
  const [tableError, setTableError] = useState<string | null>(null);
  const tests = response?.tests ?? [];
  const cookies = useMemo(() => (response ? cookiesFromHeaders(response.headers) : []), [response]);

  const contentType = response?.headers.find((h) => h.key.toLowerCase() === 'content-type')?.value;
  const formatted = useMemo(
    () => (response ? prettyJson(response.body) : { text: '', isJson: false }),
    [response],
  );

  if (sending) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-fg-muted">
        <Spinner className="h-4 w-4" /> {t('response.sending')}
      </div>
    );
  }

  if (!response) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-fg-subtle">
        <Send className="h-7 w-7 opacity-50" aria-hidden="true" />
        <p>{t('response.emptyHint')}</p>
        <span className="flex items-center gap-1.5 text-xs">
          <Kbd>Ctrl</Kbd>
          <Kbd>Enter</Kbd>
        </span>
      </div>
    );
  }

  if (response.error) {
    const skipped = response.skipped === true;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center" role="alert">
        <AlertTriangle
          className={cn('h-7 w-7', skipped ? 'text-warning' : 'text-danger')}
          aria-hidden="true"
        />
        <p className="font-medium text-fg">{skipped ? t('response.skipped') : t('response.failed')}</p>
        <p className="max-w-lg text-sm whitespace-pre-wrap text-fg-muted">{response.error.message}</p>
        {errorHintKeys[response.error.code] && (
          <p className="max-w-lg text-xs text-fg-subtle">{t(errorHintKeys[response.error.code]!)}</p>
        )}
        {(response.console?.length ?? 0) > 0 && (
          <button
            type="button"
            onClick={() => useConsole.getState().setOpen(true)}
            className="mt-1 text-xs text-accent hover:underline"
          >
            {t('response.showConsole', { count: response.console!.length })}
          </button>
        )}
      </div>
    );
  }

  const isBinary = response.bodyEncoding === 'base64';
  const isImage = isBinary && contentType?.toLowerCase().startsWith('image/');
  const shownBody = pretty && formatted.isJson ? formatted.text : response.body;
  const tableKind = tableSourceKind(response, contentType);

  function openTableExport() {
    setTableError(null);
    try {
      setTableSourceState(tableSource(tableKind!, response!.body));
    } catch (e) {
      setTableError(errorMessage(e));
    }
  }

  async function copy() {
    await navigator.clipboard.writeText(response!.body);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-4 border-b border-line px-4">
        <SegmentedTabs<View>
          tabs={[
            { id: 'body', label: 'Body' },
            { id: 'cookies', label: 'Cookies', badge: cookies.length || null },
            { id: 'headers', label: 'Headers', badge: response.headers.length },
            {
              id: 'tests',
              label: 'Test Results',
              badge: tests.length
                ? `${tests.filter((x) => x.status === 'passed').length}/${tests.length}`
                : null,
            },
          ]}
          value={view}
          onChange={setView}
          label={t('response.sectionsLabel')}
        />
        <div className="flex items-center gap-3 text-xs" aria-label={t('response.summaryLabel')}>
          <span className={cn('rounded px-2 py-0.5 font-mono font-semibold', statusTone(response.status!))}>
            {response.status} {response.statusText}
          </span>
          <span className="text-fg-subtle">
            <span className="text-fg-muted">{formatDuration(response.timeMs)}</span>
          </span>
          <span className="text-fg-subtle">
            <span className="text-fg-muted">{formatBytes(response.size)}</span>
            {response.truncated && <span className="ms-1 text-warning">{t('response.truncated')}</span>}
          </span>
        </div>
      </div>

      {view === 'body' && (
        <div className="flex min-h-0 flex-1 flex-col">
          {response.body && (
            <div className="flex items-center justify-between px-4 py-1.5">
              {isBinary ? (
                <span />
              ) : (
                <div className="flex rounded-md bg-muted p-0.5 text-xs">
                  {[
                    { id: true, label: 'Pretty' },
                    { id: false, label: 'Raw' },
                  ].map((option) => (
                    <button
                      key={option.label}
                      type="button"
                      onClick={() => setPretty(option.id)}
                      aria-pressed={pretty === option.id}
                      className={cn(
                        'rounded px-2.5 py-1 font-medium',
                        pretty === option.id
                          ? 'bg-surface text-fg shadow-sm'
                          : 'text-fg-subtle hover:text-fg',
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-1">
                {!isBinary && (
                  <button
                    type="button"
                    onClick={() => editor.current && openSearchPanel(editor.current)}
                    className={toolButton}
                    title={t('response.searchTitle')}
                  >
                    <Search className="h-3.5 w-3.5" /> {t('response.search')}
                  </button>
                )}
                {!isBinary && (
                  <OpenInToolsMenu
                    className={toolButton}
                    getText={() => {
                      // Editörde seçim varsa yalnızca seçili metin gönderilir.
                      const view = editor.current;
                      const range = view?.state.selection.main;
                      return view && range && !range.empty
                        ? view.state.sliceDoc(range.from, range.to)
                        : response.body;
                    }}
                  />
                )}
                {!isBinary && (
                  <button type="button" onClick={copy} className={toolButton}>
                    {copied ? (
                      <Check className="h-3.5 w-3.5 text-success" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                    {copied ? t('response.copied') : t('response.copy')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() =>
                    void saveFile({
                      blob: responseBlob(response, contentType),
                      fileName: responseFileName(response.headers),
                    })
                  }
                  className={toolButton}
                  title={t('response.saveFileTitle')}
                >
                  <Download className="h-3.5 w-3.5" /> {t('response.saveFile')}
                </button>
                {tableKind && (
                  <button
                    type="button"
                    onClick={openTableExport}
                    className={toolButton}
                    title={t('response.saveTableTitle')}
                  >
                    <FileSpreadsheet className="h-3.5 w-3.5" /> {t('response.saveTable')}
                  </button>
                )}
                {tableKind === 'json' && (
                  <ModelButton
                    className={toolButton}
                    sources={() => {
                      const body = response.body;
                      const rootName = rootNameFor(name, 'Response');
                      return [
                        {
                          id: 'response',
                          label: t('response.modelThis'),
                          kind: 'samples' as const,
                          rootName,
                          samples: async () => jsonSamples([body]),
                        },
                        ...(requestId
                          ? [
                              {
                                id: 'examples',
                                label: t('response.modelWithExamples'),
                                kind: 'samples' as const,
                                rootName,
                                samples: async () => {
                                  const summaries = await api.examples.list(requestId);
                                  // Hata yanıtları (4xx/5xx) başka bir yapıdadır; modele katılmaz.
                                  const ok = summaries.filter((e) => e.status < 400);
                                  const examples = await Promise.all(ok.map((e) => api.examples.get(e.id)));
                                  return jsonSamples([body, ...examples.map((e) => e.body)]);
                                },
                              },
                            ]
                          : []),
                      ];
                    }}
                  />
                )}
                {onSaveExample && !isBinary && (
                  <button
                    type="button"
                    onClick={onSaveExample}
                    className={toolButton}
                    title={t('response.saveExampleTitle')}
                  >
                    <BookmarkPlus className="h-3.5 w-3.5" /> {t('response.saveExample')}
                  </button>
                )}
              </div>
            </div>
          )}
          {tableError && <p className="px-4 pb-1 text-xs text-danger">{tableError}</p>}
          <div className="min-h-0 flex-1 overflow-hidden">
            {isImage ? (
              <div className="flex h-full items-center justify-center p-4">
                <img
                  src={`data:${contentType};base64,${response.body}`}
                  alt={t('response.imageAlt')}
                  className="max-h-full max-w-full rounded border border-line"
                />
              </div>
            ) : isBinary ? (
              <p className="p-6 text-center text-sm text-fg-subtle">
                {t('response.binary', {
                  type: contentType ?? t('response.unknownType'),
                  size: formatBytes(response.size),
                })}
              </p>
            ) : !response.body ? (
              <p className="p-6 text-center text-sm text-fg-subtle">{t('response.emptyBody')}</p>
            ) : (
              <CodeEditor
                value={shownBody}
                language={pretty ? languageOf(contentType) : 'none'}
                readOnly
                label={t('response.bodyLabel')}
                onReady={(view) => (editor.current = view)}
              />
            )}
          </div>
        </div>
      )}

      {view === 'tests' && <TestResults tests={tests} console={response.console ?? []} />}

      {view === 'cookies' && (
        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
          {cookies.length === 0 ? (
            <p className="p-6 text-center text-sm text-fg-subtle">{t('response.noCookies')}</p>
          ) : (
            <table className="w-full border-collapse text-[12.5px]" aria-label={t('response.cookiesLabel')}>
              <thead>
                <tr className="text-start text-[11px] font-medium tracking-wide text-fg-subtle uppercase">
                  {COOKIE_COLUMNS.map((h) => (
                    <th key={h} className="border border-line px-2 py-1.5 font-medium">
                      {t(`response.cookieColumns.${h}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cookies.map((c, i) => (
                  <tr key={`${c.name}-${i}`} className="align-top font-mono">
                    <td className="border border-line px-2 py-1.5 font-medium text-fg-muted">{c.name}</td>
                    <td className="max-w-xs border border-line px-2 py-1.5 break-all text-fg">{c.value}</td>
                    <td className="border border-line px-2 py-1.5">
                      {c.domain ?? (response.finalUrl ? new URL(response.finalUrl).hostname : '—')}
                    </td>
                    <td className="border border-line px-2 py-1.5">{c.path ?? '/'}</td>
                    <td className="border border-line px-2 py-1.5">
                      {c.maxAge !== null
                        ? t('response.cookieSeconds', { seconds: c.maxAge })
                        : (c.expires ?? t('response.cookieSession'))}
                    </td>
                    <td className="border border-line px-2 py-1.5">{c.httpOnly ? t('response.yes') : '—'}</td>
                    <td className="border border-line px-2 py-1.5">{c.secure ? t('response.yes') : '—'}</td>
                    <td className="border border-line px-2 py-1.5">{c.sameSite ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {view === 'headers' && (
        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
          <table
            className="w-full table-fixed border-collapse text-[12.5px]"
            aria-label={t('response.headersLabel')}
          >
            <tbody>
              {response.headers.map((h, i) => (
                <tr key={`${h.key}-${i}`} className="align-top">
                  <td className="w-1/3 break-all border border-line px-2 py-1.5 font-mono font-medium text-fg-muted">
                    {h.key}
                  </td>
                  <td className="break-all border border-line px-2 py-1.5 font-mono text-fg">{h.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {tableSourceState && (
        <Suspense fallback={null}>
          <TableExportDialog
            source={tableSourceState}
            baseName={name || responseFileName(response.headers).replace(/\.[^.]+$/, '')}
            onClose={() => setTableSourceState(null)}
          />
        </Suspense>
      )}
    </div>
  );
}
