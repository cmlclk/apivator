import { useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { Button, Input } from '@apivator/ui';
import {
  generateModel,
  inferModel,
  isOpenApiDocument,
  modelFromSchema,
  type GeneratedFile,
  type ModelSet,
} from '@apivator/core/models';
import { modelOptions, useModelPrefs } from '../../models/modelPrefs';
import { ModelFileTabs, ModelLanguageOptions, ModelLanguageSelect } from '../../models/ModelControls';
import { downloadModelFiles, MODEL_EDITOR_LANGUAGE, parseSchemaText } from '../../models/modelFiles';
import { parseJsonSample } from '../../models/sources';
import { ToolErrorMessage, ToolOptions, ToolPane, TwoPanes } from '../ToolLayout';
import { useToolInput } from '../toolsStore';
import { toolErrorText, toolLabelClass, toolSelectClass } from '../toolUtils';
import { useT } from '../../../i18n';

const TOOL = 'json-model';

type SourceKind = 'sample' | 'schema';

/** JSON örneğinden ya da JSON Schema / OpenAPI belgesinden model sınıfı üretir (6.2'deki üretici). */
export default function ModelTool() {
  const t = useT('toolsData');
  const [input, setInput] = useToolInput(TOOL, 'input');
  const [kind, setKind] = useToolInput(TOOL, 'kind', 'sample');
  const [rootName, setRootName] = useToolInput(TOOL, 'rootName', 'Root');
  const prefs = useModelPrefs();
  const [set, setSet] = useState<ModelSet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileIndex, setFileIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const source = kind as SourceKind;

  // Girdi, kaynak türü ya da kök adı değişince model yeniden çıkarılır.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setError(null);
      if (!input.trim()) return setSet(null);
      const name = rootName.trim() || 'Root';
      if (source === 'schema') {
        const doc = await parseSchemaText(input);
        if (!cancelled) setSet(modelFromSchema(doc, { rootName: name }));
        return;
      }
      const sample = parseJsonSample(input);
      if (sample === undefined) throw new Error(t('model.notJson'));
      // Kökte nesne dizisi verilirse her eleman ayrı örnek sayılır (opsiyonel alanlar böyle anlaşılır).
      const samples =
        Array.isArray(sample) && sample.length > 0 && sample.every((v) => typeof v === 'object' && v !== null)
          ? sample
          : [sample];
      setSet(inferModel(samples, { rootName: name }));
    };
    run().catch((e: unknown) => {
      if (cancelled) return;
      setSet(null);
      setError(toolErrorText(e));
    });
    return () => {
      cancelled = true;
    };
  }, [input, source, rootName, t]);

  const options = modelOptions(prefs);
  const files: GeneratedFile[] = useMemo(() => {
    if (!set) return [];
    try {
      return generateModel(set, options);
    } catch (e) {
      return [{ name: t('model.errorFile'), content: toolErrorText(e) }];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seçenekler tercih deposundan
  }, [set, JSON.stringify(options), t]);
  const file = files[Math.min(fileIndex, files.length - 1)];
  const isOpenApi =
    source === 'schema' &&
    set !== null &&
    (() => {
      try {
        return isOpenApiDocument(JSON.parse(input));
      } catch {
        return false;
      }
    })();

  async function download() {
    setBusy(true);
    try {
      await downloadModelFiles(files, rootName.trim() || 'Root');
    } catch (e) {
      setError(toolErrorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <ToolOptions>
        <label className={toolLabelClass}>
          {t('model.source')}
          <select
            aria-label={t('model.sourceKind')}
            className={toolSelectClass}
            value={source}
            onChange={(e) => setKind(e.target.value)}
          >
            <option value="sample">{t('model.sample')}</option>
            <option value="schema">{t('model.schemaOrOpenApi')}</option>
          </select>
        </label>
        <label className={toolLabelClass}>
          {t('model.language')}
          <ModelLanguageSelect className="h-7 text-xs" onChange={() => setFileIndex(0)} />
        </label>
        <label className={toolLabelClass}>
          {isOpenApi ? t('model.rootNameOpenApi') : t('model.rootName')}
          <Input
            aria-label={t('model.rootName')}
            value={rootName}
            onChange={(e) => setRootName(e.target.value)}
            className="h-7 w-44 text-xs"
          />
        </label>
        <ModelLanguageOptions />
      </ToolOptions>
      <ToolErrorMessage error={error} />
      <TwoPanes>
        <ToolPane
          label={source === 'schema' ? t('model.schema') : 'JSON'}
          value={input}
          onChange={setInput}
          language="Json"
          fileAccept=".json,.yaml,.yml,application/json"
          placeholder={
            source === 'schema'
              ? `{ "type": "object", "properties": { … } }\n\n${t('model.schemaPlaceholderOr')}`
              : `{ "id": 1, "name": "Ayşe", "tags": ["a"] }\n\n${t('model.samplePlaceholder')}`
          }
        />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
          <ModelFileTabs names={files.map((f) => f.name)} index={fileIndex} onChange={setFileIndex} />
          <ToolPane
            label={file ? file.name : t('model.generated')}
            value={file?.content ?? ''}
            language={MODEL_EDITOR_LANGUAGE[prefs.language] ?? 'none'}
            output
            toolbar={
              <span className="text-xs text-fg-subtle">
                {set && t('model.typeCount', { count: set.types.length })}
                {files.length > 1 && ` · ${t('model.fileCount', { count: files.length })}`}
              </span>
            }
          />
          <div className="flex justify-end">
            <Button size="sm" onClick={() => void download()} loading={busy} disabled={!files.length}>
              <Download className="h-3.5 w-3.5" />
              {files.length > 1 ? t('model.downloadZip') : t('model.downloadFile')}
            </Button>
          </div>
        </div>
      </TwoPanes>
    </div>
  );
}
