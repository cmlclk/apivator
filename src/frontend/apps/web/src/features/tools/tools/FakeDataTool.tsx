import { useEffect, useMemo, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { Button, Input } from '@apivator/ui';
import {
  FAKE_GENERATORS,
  createFakeContext,
  ibanValid,
  luhnValid,
  tcknValid,
  type FakeField,
  type FakeLocale,
} from '@apivator/core/tools';
import { useT } from '../../../i18n';
import { saveFile } from '../../../lib/download';
import { ToolErrorMessage, ToolOptions, ToolPane } from '../ToolLayout';
import { toolErrorText, toolLabelClass, toolSelectClass } from '../toolUtils';
import { useToolInput } from '../toolsStore';
import {
  DEFAULT_SCHEMA,
  FAKE_MAX_COUNT,
  FORMAT_FILES,
  formatRecords,
  generateRecords,
  parseSchema,
  type FakeOutputFormat,
  type FakeRecord,
} from './fakeDataFormat';

const TOOL = 'fake-data';
const EMPTY = { fields: [], records: [] };

const textareaClass =
  'min-h-40 w-full flex-1 resize-y rounded-md border border-line bg-surface px-2 py-1.5 font-mono text-xs ' +
  'text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25';

function clampCount(text: string): number {
  const n = Math.floor(Number(text));
  return Number.isFinite(n) ? Math.min(FAKE_MAX_COUNT, Math.max(1, n)) : 10;
}

export default function FakeDataTool() {
  const t = useT('toolsSecurity');
  const [schema, setSchema] = useToolInput(TOOL, 'schema', DEFAULT_SCHEMA);
  const [locale, setLocale] = useToolInput(TOOL, 'locale', 'tr');
  const [countText, setCountText] = useToolInput(TOOL, 'count', '10');
  const [seed, setSeed] = useToolInput(TOOL, 'seed', '');
  const [format, setFormat] = useToolInput(TOOL, 'format', 'json');
  const [tableName, setTableName] = useToolInput(TOOL, 'table', 'test_verisi');
  // Kayıtlar üretildikleri alanlarla birlikte tutulur: biçim değişince eski kayıt yeni şemayla karışmaz.
  const [result, setResult] = useState<{ fields: FakeField[]; records: FakeRecord[] }>(EMPTY);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState(0);

  // t: dil değişince şema hataları yeni dilde yeniden üretilir.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const parsed = useMemo(() => parseSchema(schema), [schema, t]);
  const count = clampCount(countText);
  const outputFormat = (format in FORMAT_FILES ? format : 'json') as FakeOutputFormat;

  // Şema ya da seçenek değişince yeniden üretilir; önceki (yarım kalmış) üretim iptal edilir.
  useEffect(() => {
    if (parsed.errors.length || !parsed.fields.length) {
      setResult(EMPTY);
      return;
    }
    const controller = new AbortController();
    const ctx = createFakeContext({ locale: locale as FakeLocale, seed: seed || undefined });
    setProgress(0);
    const { fields } = parsed;
    generateRecords(fields, count, ctx, { signal: controller.signal, onProgress: setProgress })
      .then((records) => {
        if (!records) return;
        setResult({ fields, records });
        setError(null);
        setProgress(null);
      })
      .catch((e: unknown) => {
        setResult(EMPTY);
        setError(toolErrorText(e));
        setProgress(null);
      });
    return () => controller.abort();
  }, [parsed, count, locale, seed, round]);

  const { records } = result;
  const output = useMemo(
    () =>
      result.records.length ? formatRecords(result.records, result.fields, outputFormat, tableName) : '',
    [result, outputFormat, tableName],
  );

  const download = () => {
    const { ext, mime } = FORMAT_FILES[outputFormat];
    // Türkçe Excel UTF-8'i tanısın diye CSV'ye BOM eklenir.
    const text = outputFormat === 'csv' ? '﻿' + output : output;
    void saveFile({
      blob: new Blob([text], { type: `${mime};charset=utf-8` }),
      fileName: `sahte-veri.${ext}`,
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <ToolOptions>
        <label className={toolLabelClass}>
          {t('fakeData.language')}
          <select className={toolSelectClass} value={locale} onChange={(e) => setLocale(e.target.value)}>
            <option value="tr">{t('fakeData.localeTr')}</option>
            <option value="en">{t('fakeData.localeEn')}</option>
          </select>
        </label>
        <label className={toolLabelClass}>
          {t('fakeData.count')}
          <Input
            type="number"
            min={1}
            max={FAKE_MAX_COUNT}
            className="h-7 w-24 text-xs"
            value={countText}
            onChange={(e) => setCountText(e.target.value)}
            aria-label={t('fakeData.count')}
          />
        </label>
        <label className={toolLabelClass} title={t('fakeData.seedHint')}>
          {t('fakeData.seed')}
          <Input
            className="h-7 w-32 text-xs"
            value={seed}
            placeholder={t('fakeData.seedPlaceholder')}
            onChange={(e) => setSeed(e.target.value)}
            aria-label={t('fakeData.seed')}
          />
        </label>
        <label className={toolLabelClass}>
          {t('fakeData.format')}
          <select
            className={toolSelectClass}
            value={outputFormat}
            onChange={(e) => setFormat(e.target.value)}
          >
            <option value="json">{t('fakeData.formatJson')}</option>
            <option value="csv">CSV (;)</option>
            <option value="sql">SQL INSERT</option>
          </select>
        </label>
        {outputFormat === 'sql' && (
          <label className={toolLabelClass}>
            {t('fakeData.table')}
            <Input
              className="h-7 w-32 text-xs"
              value={tableName}
              onChange={(e) => setTableName(e.target.value)}
              aria-label={t('fakeData.tableLabel')}
            />
          </label>
        )}
        <Button size="sm" onClick={() => setRound((r) => r + 1)} disabled={Boolean(seed)}>
          <RefreshCw className="h-3.5 w-3.5" /> {t('fakeData.regenerate')}
        </Button>
        {progress !== null && count > 500 && (
          <span className="text-xs text-fg-muted" role="status">
            {t('fakeData.generating', { done: progress, total: count })}
          </span>
        )}
      </ToolOptions>
      <ToolErrorMessage error={error ?? (parsed.errors.length ? parsed.errors.join(' ') : null)} />
      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
        <section className="flex min-w-0 flex-col gap-2 lg:w-80">
          <label className="text-xs font-semibold text-fg-muted" htmlFor="fake-data-schema">
            {t.rich('fakeData.schema', { code: (c) => <code>{c}</code> })}
          </label>
          <textarea
            id="fake-data-schema"
            className={textareaClass}
            value={schema}
            spellCheck={false}
            onChange={(e) => setSchema(e.target.value)}
          />
          <label className={toolLabelClass}>
            {t('fakeData.addField')}
            <select
              className={toolSelectClass}
              value=""
              aria-label={t('fakeData.addField')}
              onChange={(e) => {
                const id = e.target.value;
                if (id) setSchema(`${schema.trimEnd()}${schema.trim() ? '\n' : ''}${id}: ${id}`);
              }}
            >
              <option value="">{t('fakeData.pickGenerator')}</option>
              {FAKE_GENERATORS.map((g) => (
                <option key={g.id} value={g.id}>
                  {t(`fakeData.generators.${g.id}`)} ({g.id})
                </option>
              ))}
            </select>
          </label>
          <Validator />
        </section>
        <ToolPane
          label={t('fakeData.output', { count: records.length })}
          value={output}
          language={outputFormat === 'json' ? 'Json' : 'Text'}
          output
          toolbar={
            <Button
              size="icon"
              variant="ghost"
              title={t('fakeData.download')}
              aria-label={t('fakeData.download')}
              disabled={!output}
              onClick={download}
            >
              <Download className="h-3.5 w-3.5" />
            </Button>
          }
        />
      </div>
      <p className="text-[11px] text-fg-subtle">
        {t('fakeData.note', { email: '{{$randomEmail}}', tckn: '{{$randomTckn}}', iban: '{{$randomIban}}' })}
      </p>
    </div>
  );
}

/** TCKN, Luhn ve IBAN denetimi. Girilen değer gerçek kişisel veri olabileceğinden hatırlanmaz. */
function Validator() {
  const t = useT('toolsSecurity');
  const [value, setValue] = useToolInput(TOOL, 'check', '', { remember: false });
  const text = value.trim();
  const checks = [
    ['TCKN', tcknValid(text)],
    [t('fakeData.checkLuhn'), luhnValid(text)],
    ['IBAN', ibanValid(text)],
  ] as const;
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-line p-2">
      <Input
        className="h-7 text-xs"
        value={value}
        placeholder={t('fakeData.checkPlaceholder')}
        onChange={(e) => setValue(e.target.value)}
        aria-label={t('fakeData.checkLabel')}
      />
      {text && (
        <ul className="flex flex-wrap gap-x-3 text-xs" aria-label={t('fakeData.checkResult')}>
          {checks.map(([label, ok]) => (
            <li key={label} className={ok ? 'text-success' : 'text-fg-subtle'}>
              {t('fakeData.check', { label, status: ok ? t('fakeData.valid') : t('fakeData.invalid') })}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
