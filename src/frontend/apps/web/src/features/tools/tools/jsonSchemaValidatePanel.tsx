import { useEffect, useRef, useState, type ReactNode } from 'react';
import { EditorView } from '@codemirror/view';
import { CheckCircle2 } from 'lucide-react';
import { Alert, Spinner } from '@apivator/ui';
import { parseJsonDetailed, type SchemaValidationResult, type ValidateDraft } from '@apivator/core/tools';
import { isOpenApiDocument, openApiSchemaNames } from '@apivator/core/models';
import { parseSchemaText } from '../../models/modelFiles';
import { ToolErrorMessage, ToolOptions, ToolPane, TwoPanes } from '../ToolLayout';
import { useDebouncedText } from '../jsonToolHooks';
import { jsonPointerOffset } from '../jsonPointerOffset';
import { useToolInput } from '../toolsStore';
import { toolErrorText, toolLabelClass, toolSelectClass } from '../toolUtils';
import type { SchemaValidateJob } from './schemaValidateWorker';
import { useSchemaValidator } from './useSchemaValidator';
import { useT } from '../../../i18n';

const TOOL = 'json-schema';

interface Prepared {
  job: SchemaValidateJob;
  schemaNames: string[];
}

/** "Doğrula" kipi: JSON Schema (ya da OpenAPI şeması) + JSON veri → yollarıyla hata listesi. */
export function JsonSchemaValidatePanel({ modeSelect }: { modeSelect: ReactNode }) {
  const t = useT('toolsData');
  const [schemaText, setSchemaText] = useToolInput(TOOL, 'input');
  const [dataText, setDataText] = useToolInput(TOOL, 'data');
  const [draft, setDraft] = useToolInput(TOOL, 'validateDraft', 'auto');
  const [assertFormats, setAssertFormats] = useToolInput(TOOL, 'assertFormats', '1');
  const [schemaName, setSchemaName] = useToolInput(TOOL, 'schemaName');
  const schemaSource = useDebouncedText(schemaText);
  const dataSource = useDebouncedText(dataText);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const dataEditor = useRef<EditorView | null>(null);

  // Şema (JSON / YAML; YAML ayrıştırıcısı gerektiğinde yüklenir) ve veri değişince ayrıştırılır; doğrulama
  // Worker'da çalışır (şemadaki pattern felaket geri izleme yapabilir).
  useEffect(() => {
    let cancelled = false;
    const run = async (): Promise<Prepared | null> => {
      if (!schemaSource.trim() || !dataSource.trim()) return null;
      let doc: unknown;
      try {
        doc = await parseSchemaText(schemaSource);
      } catch (e) {
        throw new Error(t('schemaValidate.schemaError', { message: toolErrorText(e) }));
      }
      const parsed = parseJsonDetailed(dataSource);
      if (!parsed.ok)
        throw new Error(
          t('schemaValidate.dataError', {
            line: parsed.line,
            column: parsed.column,
            message: parsed.message,
          }),
        );
      const options = {
        draft: draft as ValidateDraft,
        assertFormats: Boolean(assertFormats),
        schemaName: schemaName || undefined,
      };
      return {
        job: { doc, data: parsed.value, options },
        schemaNames: isOpenApiDocument(doc) ? openApiSchemaNames(doc) : [],
      };
    };
    run().then(
      (next) => {
        if (cancelled) return;
        setParseError(null);
        setPrepared(next);
      },
      (e: unknown) => {
        if (cancelled) return;
        setPrepared(null);
        setParseError(toolErrorText(e));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [schemaSource, dataSource, draft, assertFormats, schemaName, t]);

  // Hatanın gösterdiği değer veri alanında seçilir.
  const goTo = (pointer: string) => {
    const view = dataEditor.current;
    const range = jsonPointerOffset(dataText, pointer);
    if (!view || !range) return;
    const to = Math.min(range.to, view.state.doc.length);
    const from = Math.min(range.from, to);
    view.dispatch({
      selection: { anchor: from, head: to },
      effects: EditorView.scrollIntoView(from, { y: 'center' }),
    });
    view.focus();
  };

  const validation = useSchemaValidator(prepared?.job ?? null);
  const schemaNames = prepared?.schemaNames ?? [];
  const result = validation.result;
  const error = parseError ?? validation.error;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <ToolOptions>
        {modeSelect}
        <label className={toolLabelClass}>
          {t('jsonSchema.version')}
          <select
            aria-label={t('schemaValidate.validationVersion')}
            className={toolSelectClass}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          >
            <option value="auto">{t('schemaValidate.auto')}</option>
            <option value="2020-12">Draft 2020-12</option>
            <option value="07">Draft-07</option>
          </select>
        </label>
        {schemaNames.length > 0 && (
          <label className={toolLabelClass}>
            {t('jsonSchema.schema')}
            <select
              aria-label={t('jsonSchema.openApiSchema')}
              className={toolSelectClass}
              value={schemaNames.includes(schemaName) ? schemaName : schemaNames[0]}
              onChange={(e) => setSchemaName(e.target.value)}
            >
              {schemaNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className={toolLabelClass}>
          <input
            type="checkbox"
            checked={Boolean(assertFormats)}
            onChange={(e) => setAssertFormats(e.target.checked ? '1' : '')}
          />
          {t('schemaValidate.assertFormats')}
        </label>
        {validation.busy && (
          <span className="flex items-center gap-1.5 text-xs text-fg-muted" role="status">
            <Spinner className="h-3.5 w-3.5" />
            {t('schemaValidate.validating')}
          </span>
        )}
      </ToolOptions>
      <ToolErrorMessage error={error} />
      <TwoPanes>
        <ToolPane
          label={t('jsonSchema.schema')}
          value={schemaText}
          onChange={setSchemaText}
          language="Json"
          fileAccept=".json,.yaml,.yml,application/json"
          placeholder={`{ "type": "object", "required": ["id"] }\n\n${t('jsonSchema.schemaPlaceholderOr')}`}
          className="max-h-[40vh] lg:max-h-none"
        />
        <ToolPane
          label={t('schemaValidate.data')}
          value={dataText}
          onChange={setDataText}
          language="Json"
          fileAccept=".json,application/json"
          placeholder='{ "id": 1 }'
          className="max-h-[40vh] lg:max-h-none"
          onEditorReady={(view) => (dataEditor.current = view)}
        />
      </TwoPanes>
      {result && <ValidationErrors result={result} onSelect={goTo} />}
    </div>
  );
}

function ValidationErrors({
  result,
  onSelect,
}: {
  result: SchemaValidationResult;
  onSelect: (pointer: string) => void;
}) {
  const t = useT('toolsData');
  return (
    <section aria-label={t('schemaValidate.result')} className="flex min-h-[20vh] flex-col gap-2">
      {result.valid ? (
        <Alert tone="success">
          <CheckCircle2 className="me-1 inline h-4 w-4" />
          {t('schemaValidate.valid')}
        </Alert>
      ) : (
        <p className="text-sm font-medium text-danger">
          {result.truncated
            ? t('schemaValidate.errorsTruncated', { count: result.errors.length })
            : t('schemaValidate.errorCount', { count: result.errors.length })}
        </p>
      )}
      {result.notes.map((note) => (
        <p key={note} className="text-xs text-fg-muted">
          {t('schemaValidate.note', { note })}
        </p>
      ))}
      {result.errors.length > 0 && (
        <ul
          aria-label={t('schemaValidate.errorList')}
          className="min-h-0 flex-1 divide-y divide-line overflow-auto rounded-md border border-line text-xs"
        >
          {result.errors.map((e, index) => (
            <li key={index}>
              <button
                type="button"
                className="flex w-full flex-wrap items-baseline gap-x-2 px-2 py-1 text-start hover:bg-muted"
                title={t('schemaValidate.showInData')}
                onClick={() => onSelect(e.instancePath)}
              >
                <span className="break-all font-mono text-fg">
                  {e.instancePath || t('schemaValidate.root')}
                </span>
                <span className="text-danger">{e.message}</span>
                <span className="break-all font-mono text-fg-subtle">{e.schemaPath}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
