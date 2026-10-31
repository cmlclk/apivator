import { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@apivator/ui';
import { defaultPath, findArrays, toCsv, toTables, type ArrayMode, type RawLanguage } from '@apivator/core';
import type { QueryArrayFormat, ReadSheet } from '@apivator/core/tools';
import { SwapButton, ToolErrorMessage, ToolOptions, ToolPane, TwoPanes } from '../ToolLayout';
import { toolErrorText, toolLabelClass, toolSelectClass } from '../toolUtils';
import { useToolInput } from '../toolsStore';
import { useDebouncedText } from '../jsonToolHooks';
import {
  csvToJson,
  csvToTables,
  jsonToQuery,
  jsonToToml,
  jsonToXml,
  jsonToYaml,
  parseJsonInput,
  queryToJson,
  sheetToCsv,
  sheetToJson,
  tomlToJson,
  xmlToJson,
  yamlToJson,
  type CsvDelimiter,
} from '../convert';
import {
  CsvFormatOptions,
  ExcelExportPanel,
  ExcelImportPanel,
  PathSelect,
  QueryOptions,
} from '../jsonConvertPanels';
import { saveFile } from '../../../lib/download';
import { useT } from '../../../i18n';

type Format = 'json' | 'csv' | 'xlsx' | 'yaml' | 'xml' | 'toml' | 'query';

const MODE_GROUPS = [
  [
    'table',
    [
      ['json-csv', 'JSON → CSV'],
      ['csv-json', 'CSV → JSON'],
      ['json-xlsx', 'JSON → Excel'],
      ['xlsx-json', 'Excel → JSON'],
      ['csv-xlsx', 'CSV → Excel'],
      ['xlsx-csv', 'Excel → CSV'],
    ],
  ],
  [
    'config',
    [
      ['json-yaml', 'JSON → YAML'],
      ['yaml-json', 'YAML → JSON'],
      ['json-toml', 'JSON → TOML'],
      ['toml-json', 'TOML → JSON'],
      ['json-xml', 'JSON → XML'],
      ['xml-json', 'XML → JSON'],
    ],
  ],
  [
    'web',
    [
      ['json-query', 'JSON → Query string'],
      ['query-json', 'Query string → JSON'],
    ],
  ],
] as const;

const FORMAT: Record<Format, { label: string; language: RawLanguage | 'none'; ext: string; accept: string }> =
  {
    json: { label: 'JSON', language: 'Json', ext: 'json', accept: '.json,application/json,text/plain' },
    csv: { label: 'CSV', language: 'Text', ext: 'csv', accept: '.csv,.tsv,text/csv,text/plain' },
    xlsx: { label: 'Excel', language: 'none', ext: 'xlsx', accept: '.xlsx' },
    yaml: { label: 'YAML', language: 'Text', ext: 'yaml', accept: '.yaml,.yml,text/yaml,text/plain' },
    xml: { label: 'XML', language: 'Xml', ext: 'xml', accept: '.xml,application/xml,text/xml' },
    toml: { label: 'TOML', language: 'Text', ext: 'toml', accept: '.toml,text/plain' },
    query: { label: 'Query string', language: 'Text', ext: 'txt', accept: '.txt,text/plain' },
  };

export default function JsonConvertTool() {
  const t = useT('toolsData');
  const [input, setInput] = useToolInput('json-convert', 'input');
  const [mode, setMode] = useToolInput('json-convert', 'mode', 'json-csv');
  const [delimiter, setDelimiter] = useToolInput('json-convert', 'delimiter', ';');
  const [decimal, setDecimal] = useToolInput('json-convert', 'decimal', ',');
  const [arrays, setArrays] = useToolInput('json-convert', 'arrays', 'json');
  const [coerce, setCoerce] = useToolInput('json-convert', 'coerce', '1');
  const [unflatten, setUnflatten] = useToolInput('json-convert', 'unflatten', '');
  const [header, setHeader] = useToolInput('json-convert', 'header', '1');
  const [queryArrays, setQueryArrays] = useToolInput('json-convert', 'queryArrays', 'brackets');
  const [plusSpaces, setPlusSpaces] = useToolInput('json-convert', 'plusSpaces', '');
  // Seçilen yol yalnızca bu girdide geçerli; geçersizse en olası dizi kullanılır.
  const [path, setPath] = useState<string | null>(null);
  const [sheets, setSheets] = useState<{ fileName: string; list: ReadSheet[] } | null>(null);
  const [sheetIndex, setSheetIndex] = useState(0);
  const source = useDebouncedText(input);

  const [from, to] = mode.split('-') as [Format, Format];
  const tabular = mode === 'json-csv' || mode === 'json-xlsx';

  // Tablo modlarında yol seçimi için girdi bir kez çözülür.
  const table = useMemo(() => {
    if (!tabular || !source.trim()) return null;
    try {
      const value = parseJsonInput(source);
      const candidates = findArrays(value);
      const valid = path !== null && (path === '' || candidates.some((c) => c.path === path));
      return { value, candidates, path: valid ? path : defaultPath(value), error: null };
    } catch (error) {
      return { value: undefined, candidates: [], path: '', error: toolErrorText(error) };
    }
  }, [tabular, source, path]);

  const result = useMemo((): { output: string; error: string | null } => {
    try {
      if (from === 'xlsx') {
        const sheet = sheets?.list[sheetIndex];
        if (!sheet) return { output: '', error: null };
        return {
          output:
            to === 'csv'
              ? sheetToCsv(sheet, { delimiter: delimiter as CsvDelimiter, decimal: decimal as ',' | '.' })
              : sheetToJson(sheet, { header: Boolean(header), unflatten: Boolean(unflatten) }),
          error: null,
        };
      }
      if (to === 'xlsx' || !source.trim()) return { output: '', error: null };
      if (mode === 'json-csv') {
        if (!table || table.error) return { output: '', error: table?.error ?? null };
        // Girdi yol seçimi için zaten çözüldü; yeniden çözülmez. Ekranda BOM yok, indirirken eklenir.
        const [first] = toTables(table.value, { path: table.path, arrays: 'json' });
        return {
          output: toCsv(first!, {
            delimiter: delimiter as CsvDelimiter,
            decimal: decimal as ',' | '.',
            bom: false,
          }),
          error: null,
        };
      }
      const convert: Record<string, () => string> = {
        'csv-json': () => csvToJson(source, { coerce: Boolean(coerce), unflatten: Boolean(unflatten) }),
        'json-yaml': () => jsonToYaml(source),
        'yaml-json': () => yamlToJson(source),
        'json-toml': () => jsonToToml(source),
        'toml-json': () => tomlToJson(source),
        'json-xml': () => jsonToXml(source),
        'xml-json': () => xmlToJson(source, Boolean(coerce)),
        'json-query': () =>
          jsonToQuery(source, { arrays: queryArrays as QueryArrayFormat, plusSpaces: Boolean(plusSpaces) }),
        'query-json': () => queryToJson(source, Boolean(coerce)),
      };
      return { output: convert[mode]?.() ?? '', error: null };
    } catch (error) {
      return { output: '', error: toolErrorText(error) };
    }
  }, [
    mode,
    from,
    to,
    source,
    table,
    delimiter,
    decimal,
    coerce,
    unflatten,
    header,
    queryArrays,
    plusSpaces,
    sheets,
    sheetIndex,
  ]);

  const excel = useMemo(() => {
    try {
      if (mode === 'csv-xlsx')
        return {
          tables: source.trim()
            ? csvToTables(source, {
                delimiter: delimiter as CsvDelimiter,
                decimal: decimal as ',' | '.',
                coerce: Boolean(coerce),
              })
            : null,
          error: null,
        };
      if (mode !== 'json-xlsx' || !table || table.error) return { tables: null, error: table?.error ?? null };
      return {
        tables: toTables(table.value, { path: table.path, arrays: arrays as ArrayMode }),
        error: null,
      };
    } catch (error) {
      return { tables: null, error: toolErrorText(error) };
    }
  }, [mode, source, table, arrays, delimiter, decimal, coerce]);

  const swap = () => {
    const reverse = `${to}-${from}`;
    // Metin sonucu yeni girdi olur (Excel → JSON/CSV'nin sonucu da tersinin girdisidir).
    if (to !== 'xlsx' && result.output) setInput(result.output);
    setMode(reverse);
  };

  const downloadCsv = () =>
    void saveFile({
      // Excel UTF-8'i tanısın diye BOM'lu.
      blob: new Blob([String.fromCharCode(0xfeff) + result.output], { type: 'text/csv;charset=utf-8' }),
      fileName: t('jsonConvert.fileName', { ext: 'csv' }),
    });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <ToolOptions>
        <label className={toolLabelClass}>
          {t('jsonConvert.conversion')}
          <select className={toolSelectClass} value={mode} onChange={(e) => setMode(e.target.value)}>
            {MODE_GROUPS.map(([group, modes]) => (
              <optgroup key={group} label={t(`jsonConvert.groups.${group}`)}>
                {modes.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <SwapButton onClick={swap} />
        {tabular && table && !table.error && (
          <PathSelect candidates={table.candidates} value={table.path} onChange={setPath} />
        )}
        {(mode === 'json-csv' || mode === 'csv-xlsx' || mode === 'xlsx-csv') && (
          <CsvFormatOptions
            delimiter={delimiter}
            decimal={decimal}
            onDelimiter={setDelimiter}
            onDecimal={setDecimal}
          />
        )}
        {mode === 'json-xlsx' && (
          <label className={toolLabelClass}>
            {t('jsonConvert.nestedArrays')}
            <select className={toolSelectClass} value={arrays} onChange={(e) => setArrays(e.target.value)}>
              <option value="json">{t('jsonConvert.arraysInCell')}</option>
              <option value="sheet">{t('jsonConvert.arraysSeparate')}</option>
            </select>
          </label>
        )}
        {mode === 'json-query' && (
          <QueryOptions
            arrays={queryArrays}
            plusSpaces={Boolean(plusSpaces)}
            onArrays={setQueryArrays}
            onPlusSpaces={(value) => setPlusSpaces(value ? '1' : '')}
          />
        )}
        {(mode === 'csv-json' || mode === 'xml-json' || mode === 'csv-xlsx' || mode === 'query-json') && (
          <label className={toolLabelClass}>
            <input
              type="checkbox"
              checked={Boolean(coerce)}
              onChange={(e) => setCoerce(e.target.checked ? '1' : '')}
            />
            {t('jsonConvert.coerce')}
          </label>
        )}
        {(mode === 'csv-json' || mode === 'xlsx-json') && (
          <label className={toolLabelClass}>
            <input
              type="checkbox"
              checked={Boolean(unflatten)}
              onChange={(e) => setUnflatten(e.target.checked ? '1' : '')}
            />
            {t('jsonConvert.unflatten')}
          </label>
        )}
      </ToolOptions>
      <ToolErrorMessage error={to === 'xlsx' ? null : result.error} />
      <TwoPanes>
        {from === 'xlsx' ? (
          <ExcelImportPanel
            sheets={sheets}
            onSheets={setSheets}
            sheetIndex={sheetIndex}
            onSheetIndex={setSheetIndex}
            header={Boolean(header)}
            onHeader={(value) => setHeader(value ? '1' : '')}
            showHeader={to === 'json'}
          />
        ) : (
          <ToolPane
            label={FORMAT[from].label}
            value={input}
            onChange={setInput}
            language={FORMAT[from].language}
            fileAccept={FORMAT[from].accept}
            placeholder={from === 'query' ? t('jsonConvert.queryPlaceholder') : undefined}
          />
        )}
        {to === 'xlsx' ? (
          <ExcelExportPanel tables={excel.tables} error={excel.error} />
        ) : (
          <ToolPane
            label={FORMAT[to].label}
            value={result.output}
            output
            language={FORMAT[to].language}
            downloadName={to === 'csv' ? undefined : t('jsonConvert.fileName', { ext: FORMAT[to].ext })}
            toolbar={
              to === 'csv' && (
                <Button
                  size="icon"
                  variant="ghost"
                  title={t('jsonConvert.downloadExcelCsv')}
                  aria-label={t('jsonConvert.downloadExcelCsv')}
                  disabled={!result.output}
                  onClick={downloadCsv}
                >
                  <Download className="h-3.5 w-3.5" />
                </Button>
              )
            }
          />
        )}
      </TwoPanes>
    </div>
  );
}
