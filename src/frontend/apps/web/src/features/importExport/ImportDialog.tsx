import { useCallback, useRef, useState, type DragEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, FileJson, Terminal, Upload, XCircle } from 'lucide-react';
import { Button, Spinner, cn } from '@apivator/ui';
import { CurlParseError, looksLikeCurl, parseCurl, type ImportResult } from '@apivator/core';
import { Dialog } from '../../components/ui/Dialog';
import { SegmentedTabs } from '../../components/ui/SegmentedTabs';
import { translate, useT } from '../../i18n';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { useUi } from '../../stores/ui';
import { collectionsQueryKey } from '../collections/useCollections';
import { environmentsQueryKey } from '../environments/useVariables';
import { useTabs } from '../requests/tabsStore';
import { UrlImportForm } from './UrlImportForm';

const MAX_FILE_BYTES = 20 * 1024 * 1024;

function succeeded(result: ImportResult, source: string): Outcome {
  const summary =
    result.kind === 'collection'
      ? translate('exchange', 'import.summaryCollection', {
          folders: result.folders,
          requests: result.requests,
          variables: result.variables,
          examples: result.examples ?? 0,
        })
      : translate('exchange', 'import.summaryEnvironment', { variables: result.variables });
  return {
    kind: result.kind,
    source,
    ok: true,
    title: translate(
      'exchange',
      result.kind === 'collection' ? 'import.addedCollection' : 'import.addedEnvironment',
      { name: result.name },
    ),
    detail: summary,
    warnings: result.warnings,
  };
}

type Mode = 'file' | 'url' | 'text';

interface Outcome {
  kind?: 'collection' | 'environment' | 'curl';
  source: string;
  ok: boolean;
  title: string;
  detail?: string;
  warnings: string[];
}

/**
 * Postman collection / environment, OpenAPI ve HAR dosyalarını ya da yapıştırılan JSON / cURL metnini içe aktarır.
 * Dosyanın türü içeriğinden anlaşılır; kullanıcının seçmesi gerekmez.
 */
export function ImportDialog({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const t = useT('exchange');
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>('file');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  const importText = useCallback(
    async (source: string, content: string): Promise<Outcome> => {
      const trimmed = content.trim();
      if (looksLikeCurl(trimmed)) {
        try {
          const { definition, warnings } = parseCurl(trimmed);
          useTabs.getState().newTab(workspaceId, {
            name: definition.url.replace(/^https?:\/\//i, '').slice(0, 80) || t('import.curlName'),
            draft: definition,
            notice: warnings.length
              ? { tone: 'warning', text: t('import.curlSkipped'), details: warnings }
              : undefined,
          });
          return {
            kind: 'curl',
            source,
            ok: true,
            title: t('import.curlOpened', { method: definition.method }),
            warnings,
          };
        } catch (error) {
          return {
            source,
            ok: false,
            title: t('import.curlFailed'),
            detail: error instanceof CurlParseError ? error.message : errorMessage(error),
            warnings: [],
          };
        }
      }

      let document: unknown;
      try {
        document = JSON.parse(trimmed);
      } catch {
        // OpenAPI belgeleri çoğunlukla YAML'dır; YAML kütüphanesi yalnızca gerektiğinde yüklenir.
        if (/\.ya?ml$/i.test(source) || /^\s*(openapi|swagger)\s*:/m.test(trimmed)) {
          try {
            const { parse } = await import('yaml');
            document = parse(trimmed, { maxAliasCount: 1000 });
          } catch (e) {
            return {
              source,
              ok: false,
              title: t('import.yamlFailed'),
              detail: errorMessage(e),
              warnings: [],
            };
          }
        } else {
          return {
            source,
            ok: false,
            title: t('import.fileUnreadable'),
            detail: t('import.fileUnreadableDetail'),
            warnings: [],
          };
        }
      }

      try {
        return succeeded(await api.importExport.importPostman(workspaceId, document), source);
      } catch (error) {
        return {
          source,
          ok: false,
          title: t('import.importFailed'),
          detail: errorMessage(error),
          warnings: [],
        };
      }
    },
    [workspaceId, t],
  );

  const finish = async (results: Outcome[]) => {
    setOutcomes(results);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: collectionsQueryKey(workspaceId) }),
      queryClient.invalidateQueries({ queryKey: environmentsQueryKey(workspaceId) }),
    ]);
  };

  const importFiles = async (files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    const results: Outcome[] = [];
    for (const file of files) {
      if (file.size > MAX_FILE_BYTES) {
        results.push({
          source: file.name,
          ok: false,
          title: t('import.fileTooLarge'),
          detail: t('import.fileTooLargeDetail'),
          warnings: [],
        });
        continue;
      }
      results.push(await importText(file.name, await file.text()));
    }
    await finish(results);
    setBusy(false);
  };

  const importPasted = async () => {
    setBusy(true);
    await finish([await importText(t('import.pastedText'), text)]);
    setBusy(false);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void importFiles([...e.dataTransfer.files]);
  };

  const done = () => {
    const kinds = new Set(outcomes.filter((o) => o.ok).map((o) => o.kind));
    if (kinds.has('collection')) useUi.getState().setSidebarSection('collections');
    else if (kinds.has('environment')) useUi.getState().setSidebarSection('environments');
    onClose();
  };

  return (
    <Dialog
      title={t('import.title')}
      size="lg"
      onClose={onClose}
      footer={
        outcomes.length ? (
          <>
            <Button variant="secondary" onClick={() => setOutcomes([])}>
              {mode === 'url' ? t('import.anotherUrl') : t('import.anotherFile')}
            </Button>
            <Button onClick={done}>{t('import.done')}</Button>
          </>
        ) : mode === 'text' ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              {t('import.cancel')}
            </Button>
            <Button onClick={() => void importPasted()} disabled={busy || !text.trim()}>
              {busy && <Spinner className="h-3.5 w-3.5" />} {t('import.import')}
            </Button>
          </>
        ) : undefined
      }
    >
      {outcomes.length > 0 ? (
        <ul className="space-y-3" aria-label={t('import.results')}>
          {outcomes.map((o, i) => (
            <li key={i} className="rounded-md border border-line p-3">
              <div className="flex items-start gap-2">
                {o.ok ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
                ) : (
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{o.title}</p>
                  <p className="truncate text-xs text-fg-subtle">{o.source}</p>
                  {o.detail && <p className="mt-1 text-xs text-fg-muted">{o.detail}</p>}
                </div>
              </div>
              {o.warnings.length > 0 && (
                <details className="mt-2 rounded bg-warning/10 px-2 py-1.5 text-xs">
                  <summary className="flex cursor-pointer items-center gap-1.5 font-medium">
                    <AlertTriangle className="h-3.5 w-3.5 text-warning" aria-hidden="true" />
                    {t('import.warnings', { count: o.warnings.length })}
                  </summary>
                  <ul className="mt-1.5 list-disc space-y-0.5 ps-5 text-fg-muted">
                    {o.warnings.map((w, j) => (
                      <li key={j}>{w}</li>
                    ))}
                  </ul>
                </details>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <>
          <div className="mb-4">
            <SegmentedTabs<Mode>
              label={t('import.method')}
              value={mode}
              onChange={setMode}
              tabs={[
                { id: 'file', label: t('import.tabFile') },
                { id: 'url', label: t('import.tabUrl') },
                { id: 'text', label: t('import.tabText') },
              ]}
            />
          </div>

          {mode === 'url' ? (
            <UrlImportForm
              workspaceId={workspaceId}
              onImported={(result, source) => void finish([succeeded(result, source)])}
            />
          ) : mode === 'file' ? (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={cn(
                'flex flex-col items-center gap-3 rounded-lg border-2 border-dashed px-6 py-10 text-center',
                dragging ? 'border-accent bg-accent/5' : 'border-line',
              )}
            >
              {busy ? (
                <Spinner className="h-6 w-6 text-accent" />
              ) : (
                <Upload className="h-8 w-8 text-fg-subtle" aria-hidden="true" />
              )}
              <p className="text-fg-muted">{t('import.dropHere')}</p>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => fileInput.current?.click()}
                disabled={busy}
              >
                <FileJson className="h-3.5 w-3.5" /> {t('import.chooseFile')}
              </Button>
              <input
                ref={fileInput}
                type="file"
                accept=".json,.yaml,.yml,.har,application/json"
                multiple
                hidden
                aria-label={t('import.filesLabel')}
                onChange={(e) => {
                  void importFiles([...(e.target.files ?? [])]);
                  e.target.value = '';
                }}
              />
              <p className="text-xs text-fg-subtle">{t('import.supported')}</p>
            </div>
          ) : (
            <div className="space-y-2">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={10}
                spellCheck={false}
                aria-label={t('import.textLabel')}
                placeholder={t('import.textPlaceholder')}
                className="w-full resize-y rounded-md border border-line bg-bg p-3 font-mono text-xs placeholder:text-fg-subtle focus:border-accent focus:ring-2 focus:ring-accent/20 focus:outline-none"
              />
              <p className="flex items-center gap-1.5 text-xs text-fg-subtle">
                <Terminal className="h-3.5 w-3.5" aria-hidden="true" />
                {t('import.curlHint')}
              </p>
            </div>
          )}
        </>
      )}
    </Dialog>
  );
}
