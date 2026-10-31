import { useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { Alert, Button, cn, Input, Spinner } from '@apivator/ui';
import {
  generateModel,
  inferModel,
  isOpenApiDocument,
  modelFromSchema,
  type GeneratedFile,
  type ModelSet,
} from '@apivator/core/models';
import { Dialog } from '../../components/ui/Dialog';
import { translate, useT } from '../../i18n';
import { CopyButton } from '../../components/ui/CopyButton';
import { CodeEditor } from '../requests/CodeEditor';
import { errorMessage } from '../../lib/errors';
import { selectClass } from '../../lib/teams';
import { modelOptions, useModelPrefs } from './modelPrefs';
import { ModelFileTabs, ModelLanguageOptions, ModelLanguageSelect } from './ModelControls';
import { downloadModelFiles, MODEL_EDITOR_LANGUAGE, parseSchemaText } from './modelFiles';
import type { ModelSource } from './sources';

const PASTE = 'paste';

/**
 * Yanıttan, istek gövdesinden, kayıtlı örneklerden ya da şemadan model (sınıf) üretir. Dil ve seçenekler bu
 * cihazda hatırlanır.
 */
export function ModelDialog({ sources, onClose }: { sources: ModelSource[]; onClose: () => void }) {
  const t = useT('models');
  const prefs = useModelPrefs();
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? PASTE);
  const source = sources.find((s) => s.id === sourceId);
  const [rootName, setRootName] = useState(source?.rootName ?? 'Root');
  const [pasted, setPasted] = useState('');
  const [samples, setSamples] = useState<{ id: string; values: unknown[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [set, setSet] = useState<ModelSet | null>(null);
  const [fileIndex, setFileIndex] = useState(0);
  const [busy, setBusy] = useState(false);

  // Örnekler kaynak değişince bir kez yüklenir (kayıtlı örnekler sunucudan gelir). Yükleniyor durumu ayrıca
  // tutulmaz, örneklerin bu kaynağa ait olup olmadığından çıkarılır (effect'ler arasında yarış olmasın).
  useEffect(() => {
    if (source?.kind !== 'samples' || samples?.id === source.id) return;
    let cancelled = false;
    source
      .samples()
      .then((values) => !cancelled && setSamples({ id: source.id, values }))
      .catch((e: unknown) => {
        if (cancelled) return;
        setSamples({ id: source.id, values: [] });
        setError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [source, samples?.id]);
  const loading = source?.kind === 'samples' && samples?.id !== source.id;

  // Model: kaynak, kök adı ya da yapıştırılan şema değişince yeniden çıkarılır.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setError(null);
      if (sourceId === PASTE) {
        if (!pasted.trim()) return setSet(null);
        const doc = await parseSchemaText(pasted);
        return setSet(modelFromSchema(doc, { rootName }));
      }
      if (source?.kind === 'schema') return setSet(modelFromSchema(source.schema, { rootName }));
      if (!samples || samples.id !== source?.id) return;
      if (samples.values.length === 0) {
        setSet(null);
        return setError(translate('models', 'dialog.noSamples'));
      }
      setSet(inferModel(samples.values, { rootName }));
    };
    run().catch((e: unknown) => {
      if (cancelled) return;
      setSet(null);
      setError(e instanceof Error ? e.message : String(e));
    });
    return () => {
      cancelled = true;
    };
  }, [sourceId, source, samples, rootName, pasted]);

  const options = modelOptions(prefs);
  const files: GeneratedFile[] = useMemo(() => {
    if (!set) return [];
    try {
      return generateModel(set, options);
    } catch (e) {
      return [
        {
          name: translate('models', 'dialog.errorFile'),
          content: e instanceof Error ? e.message : String(e),
        },
      ];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seçenekler tercih deposundan
  }, [set, JSON.stringify(options)]);
  const file = files[Math.min(fileIndex, files.length - 1)];
  const isOpenApi =
    sourceId === PASTE &&
    set !== null &&
    (() => {
      try {
        return isOpenApiDocument(JSON.parse(pasted));
      } catch {
        return false;
      }
    })();

  async function download() {
    if (!files.length) return;
    setBusy(true);
    try {
      await downloadModelFiles(files, rootName);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const language = prefs.language;
  return (
    <Dialog
      title={t('dialog.title')}
      size="xl"
      onClose={onClose}
      footer={
        <>
          <span className="me-auto text-xs text-fg-subtle">
            {set && t('dialog.typeCount', { count: set.types.length })}
            {files.length > 1 && ` · ${t('dialog.fileCount', { count: files.length })}`}
          </span>
          {file && <CopyButton text={file.content} label={t('dialog.copyCode')} />}
          <Button onClick={() => void download()} loading={busy} disabled={!files.length}>
            <Download className="h-3.5 w-3.5" />{' '}
            {files.length > 1 ? t('dialog.downloadZip') : t('dialog.downloadFile')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-[13px]">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1.5">
            <span className="font-medium">{t('dialog.source')}</span>
            <select
              aria-label={t('dialog.sourceLabel')}
              className={cn(selectClass, 'h-9')}
              value={sourceId}
              onChange={(e) => {
                const next = sources.find((s) => s.id === e.target.value);
                setSourceId(e.target.value);
                setRootName(next?.rootName ?? 'Root');
                setFileIndex(0);
              }}
            >
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
              <option value={PASTE}>{t('dialog.pasteSchema')}</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="font-medium">{t('dialog.language')}</span>
            <ModelLanguageSelect className="h-9" onChange={() => setFileIndex(0)} />
          </label>
          <Input
            label={isOpenApi ? t('dialog.rootOpenApi') : t('dialog.rootName')}
            value={rootName}
            onChange={(e) => setRootName(e.target.value)}
            className="h-9"
          />
        </div>

        <ModelLanguageOptions />

        {sourceId === PASTE && (
          <div className="h-40 overflow-hidden rounded-md border border-line">
            <CodeEditor
              value={pasted}
              onChange={setPasted}
              language="Json"
              label={t('dialog.schemaLabel')}
              placeholder={t('dialog.pastePlaceholder', {
                example: '{ "type": "object", "properties": { … } }',
              })}
            />
          </div>
        )}

        {error && <Alert tone="error">{error}</Alert>}

        <ModelFileTabs names={files.map((f) => f.name)} index={fileIndex} onChange={setFileIndex} />

        <div className="h-[46vh] overflow-hidden rounded-md border border-line">
          {loading ? (
            <div className="flex h-full items-center justify-center text-fg-subtle">
              <Spinner className="h-4 w-4" />
            </div>
          ) : file ? (
            <CodeEditor
              value={file.content}
              language={MODEL_EDITOR_LANGUAGE[language] ?? 'none'}
              readOnly
              label={t('dialog.generatedLabel')}
            />
          ) : (
            <p className="p-6 text-center text-fg-subtle">
              {sourceId === PASTE ? t('dialog.pasteAbove') : t('dialog.noData')}
            </p>
          )}
        </div>
      </div>
    </Dialog>
  );
}
