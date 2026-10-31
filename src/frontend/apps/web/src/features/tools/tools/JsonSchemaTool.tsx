import { useEffect, useState } from 'react';
import { Dices } from 'lucide-react';
import { Button, Input } from '@apivator/ui';
import { inferJsonSchema, parseJsonDetailed, sampleFromSchema, type SchemaDraft } from '@apivator/core/tools';
import { isOpenApiDocument, openApiSchemaNames } from '@apivator/core/models';
import { parseSchemaText } from '../../models/modelFiles';
import { SwapButton, ToolErrorMessage, ToolOptions, ToolPane, TwoPanes } from '../ToolLayout';
import { useDebouncedText } from '../jsonToolHooks';
import { useToolInput } from '../toolsStore';
import { toolErrorText, toolLabelClass, toolSelectClass } from '../toolUtils';
import { JsonSchemaValidatePanel } from './jsonSchemaValidatePanel';
import { useT } from '../../../i18n';

const TOOL = 'json-schema';

type Mode = 'infer' | 'sample' | 'validate';

interface Result {
  output: string;
  /** Örnek üretiminde OpenAPI belgesinin şema adları. */
  schemaNames: string[];
}

/** Onay kutusu alanı: değer '1' ya da ''. */
function Check({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className={toolLabelClass}>
      <input
        type="checkbox"
        checked={Boolean(value)}
        onChange={(e) => onChange(e.target.checked ? '1' : '')}
      />
      {label}
    </label>
  );
}

/**
 * JSON örneğinden JSON Schema çıkarır, JSON Schema / OpenAPI şemasından örnek veri üretir ya da veriyi şemaya
 * göre doğrular.
 */
export default function JsonSchemaTool() {
  const t = useT('toolsData');
  const [input, setInput] = useToolInput(TOOL, 'input');
  const [modeValue, setMode] = useToolInput(TOOL, 'mode', 'infer');
  const [draft, setDraft] = useToolInput(TOOL, 'draft', '2020-12');
  const [title, setTitle] = useToolInput(TOOL, 'title');
  const [formats, setFormats] = useToolInput(TOOL, 'formats', '1');
  const [examples, setExamples] = useToolInput(TOOL, 'examples', '');
  const [strict, setStrict] = useToolInput(TOOL, 'strict', '');
  const [samples, setSamples] = useToolInput(TOOL, 'samples', '');
  const [requiredOnly, setRequiredOnly] = useToolInput(TOOL, 'requiredOnly', '');
  const [random, setRandom] = useToolInput(TOOL, 'random', '');
  const [seed, setSeed] = useToolInput(TOOL, 'seed', '1');
  const [schemaName, setSchemaName] = useToolInput(TOOL, 'schemaName');
  const mode = modeValue as Mode;
  const source = useDebouncedText(input);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Girdi ya da seçenekler değişince sonuç yeniden hesaplanır (YAML ayrıştırıcısı gerektiğinde yüklenir).
  useEffect(() => {
    let cancelled = false;
    const run = async (): Promise<Result | null> => {
      if (!source.trim() || mode === 'validate') return null;
      if (mode === 'infer') {
        const parsed = parseJsonDetailed(source);
        if (!parsed.ok)
          throw new Error(
            t('jsonSchema.errorAt', { line: parsed.line, column: parsed.column, message: parsed.message }),
          );
        const schema = inferJsonSchema(parsed.value, {
          draft: draft as SchemaDraft,
          title,
          detectFormats: Boolean(formats),
          examples: Boolean(examples),
          noAdditionalProperties: Boolean(strict),
          rootArrayAsSamples: Boolean(samples),
        });
        return { output: JSON.stringify(schema, null, 2), schemaNames: [] };
      }
      const doc = await parseSchemaText(source);
      const sample = sampleFromSchema(doc, {
        requiredOnly: Boolean(requiredOnly),
        random: Boolean(random),
        seed: Number.parseInt(seed, 10) || 0,
        schemaName: schemaName || undefined,
      });
      return {
        output: JSON.stringify(sample, null, 2),
        schemaNames: isOpenApiDocument(doc) ? openApiSchemaNames(doc) : [],
      };
    };
    run().then(
      (next) => {
        if (cancelled) return;
        setError(null);
        setResult(next);
      },
      (e: unknown) => {
        if (cancelled) return;
        setResult(null);
        setError(toolErrorText(e));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [
    source,
    mode,
    draft,
    title,
    formats,
    examples,
    strict,
    samples,
    requiredOnly,
    random,
    seed,
    schemaName,
    t,
  ]);

  const output = result?.output ?? '';
  const schemaNames = result?.schemaNames ?? [];

  // Çıktı girdiye geçer ve kip değişir: çıkarılan şemadan örnek, örnekten şema.
  const swap = () => {
    if (!output) return;
    setInput(output);
    setMode(mode === 'infer' ? 'sample' : 'infer');
  };

  const modeSelect = (
    <label className={toolLabelClass}>
      {t('jsonSchema.operation')}
      <select
        aria-label={t('jsonSchema.operation')}
        className={toolSelectClass}
        value={mode}
        onChange={(e) => setMode(e.target.value)}
      >
        <option value="infer">{t('jsonSchema.opInfer')}</option>
        <option value="sample">{t('jsonSchema.opSample')}</option>
        <option value="validate">{t('jsonSchema.opValidate')}</option>
      </select>
    </label>
  );

  if (mode === 'validate') return <JsonSchemaValidatePanel modeSelect={modeSelect} />;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <ToolOptions>
        {modeSelect}
        {mode === 'infer' ? (
          <>
            <label className={toolLabelClass}>
              {t('jsonSchema.version')}
              <select
                aria-label={t('jsonSchema.schemaVersion')}
                className={toolSelectClass}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              >
                <option value="2020-12">Draft 2020-12</option>
                <option value="07">Draft-07</option>
              </select>
            </label>
            <label className={toolLabelClass}>
              {t('jsonSchema.titleLabel')}
              <Input
                aria-label={t('jsonSchema.schemaTitle')}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="h-7 w-36 text-xs"
              />
            </label>
            <Check label={t('jsonSchema.detectFormats')} value={formats} onChange={setFormats} />
            <Check label={t('jsonSchema.addExamples')} value={examples} onChange={setExamples} />
            <Check label={t('jsonSchema.noAdditional')} value={strict} onChange={setStrict} />
            <Check label={t('jsonSchema.rootArraySamples')} value={samples} onChange={setSamples} />
          </>
        ) : (
          <>
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
            <Check label={t('jsonSchema.requiredOnly')} value={requiredOnly} onChange={setRequiredOnly} />
            <Check label={t('jsonSchema.random')} value={random} onChange={setRandom} />
            {random && (
              <label className={toolLabelClass}>
                {t('jsonSchema.seed')}
                <Input
                  aria-label={t('jsonSchema.seed')}
                  inputMode="numeric"
                  value={seed}
                  onChange={(e) => setSeed(e.target.value.replace(/\D/g, '').slice(0, 9))}
                  className="h-7 w-24 text-xs"
                />
                <Button
                  size="icon"
                  variant="ghost"
                  title={t('jsonSchema.newSeed')}
                  aria-label={t('jsonSchema.newSeed')}
                  onClick={() => setSeed(String(Math.floor(Math.random() * 1_000_000_000)))}
                >
                  <Dices className="h-3.5 w-3.5" />
                </Button>
              </label>
            )}
          </>
        )}
        <SwapButton onClick={swap} title={t('jsonSchema.swapTitle')} />
      </ToolOptions>
      <ToolErrorMessage error={error} />
      <TwoPanes>
        <ToolPane
          label={mode === 'infer' ? 'JSON' : t('jsonSchema.schema')}
          value={input}
          onChange={setInput}
          language="Json"
          fileAccept={mode === 'infer' ? '.json,application/json' : '.json,.yaml,.yml,application/json'}
          placeholder={
            mode === 'infer'
              ? '{ "id": 1, "ad": "Ayşe", "eposta": "ayse@ornek.com" }'
              : `{ "type": "object", "properties": { … } }\n\n${t('jsonSchema.schemaPlaceholderOr')}`
          }
        />
        <ToolPane
          label={mode === 'infer' ? 'JSON Schema' : t('jsonSchema.sampleData')}
          value={output}
          output
          language="Json"
          downloadName={mode === 'infer' ? 'schema.json' : t('jsonSchema.sampleFile')}
        />
      </TwoPanes>
    </div>
  );
}
