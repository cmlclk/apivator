import { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { Button, Input } from '@apivator/ui';
import {
  SQL_DIALECTS,
  buildSqlInsert,
  type ReadSheet,
  type SqlDialect,
  type SqlInsertResult,
} from '@apivator/core/tools';
import { useT } from '../../../i18n';
import { saveFile } from '../../../lib/download';
import { ToolErrorMessage, ToolOptions, ToolPane, TwoPanes } from '../ToolLayout';
import { formatSize, toolErrorText, toolLabelClass, toolSelectClass } from '../toolUtils';
import { useToolInput } from '../toolsStore';
import { useDebouncedText } from '../jsonToolHooks';
import { parseDelimited } from '../convert';
import { ExcelImportPanel } from '../jsonConvertPanels';
import { resolveDecimal, resolveDelimiter } from './sqlInsertSource';

const TOOL = 'sql-insert';
/** Bundan büyük SQL ekranda gösterilmez (editörü dondurur); indirilir. */
const MAX_DISPLAY_CHARS = 5 * 1024 * 1024;
const MAX_ROWS_PER_STATEMENT = 10_000;

const DIALECT_LABELS: Record<SqlDialect, string> = {
  postgres: 'PostgreSQL',
  mysql: 'MySQL / MariaDB',
  sqlserver: 'SQL Server',
  sqlite: 'SQLite',
  oracle: 'Oracle',
};

const checkbox = (value: string, set: (value: string) => void) => ({
  checked: Boolean(value),
  onChange: (e: { target: { checked: boolean } }) => set(e.target.checked ? '1' : ''),
});

export default function SqlInsertTool() {
  const t = useT('toolsData');
  const tc = useT('tools');
  const [source, setSource] = useToolInput(TOOL, 'source', 'csv');
  const [input, setInput] = useToolInput(TOOL, 'input');
  const [delimiter, setDelimiter] = useToolInput(TOOL, 'delimiter', 'auto');
  const [decimal, setDecimal] = useToolInput(TOOL, 'decimal', 'auto');
  const [table, setTable] = useToolInput(TOOL, 'table', t('sqlInsert.defaultTable'));
  const [dialect, setDialect] = useToolInput(TOOL, 'dialect', 'postgres');
  const [rowsText, setRowsText] = useToolInput(TOOL, 'rows', '1');
  const [header, setHeader] = useToolInput(TOOL, 'header', '1');
  const [infer, setInfer] = useToolInput(TOOL, 'infer', '1');
  const [emptyAs, setEmptyAs] = useToolInput(TOOL, 'emptyAs', 'null');
  const [create, setCreate] = useToolInput(TOOL, 'create', '');
  const [transaction, setTransaction] = useToolInput(TOOL, 'transaction', '');
  // Excel dosyasının içeriği hatırlanmaz (büyük ve kişisel veri olabilir).
  const [sheets, setSheets] = useState<{ fileName: string; list: ReadSheet[] } | null>(null);
  const [sheetIndex, setSheetIndex] = useState(0);
  const text = useDebouncedText(input);

  const excel = source === 'excel';
  const dialectId = (dialect in DIALECT_LABELS ? dialect : 'postgres') as SqlDialect;
  const requested = Math.min(MAX_ROWS_PER_STATEMENT, Math.max(1, Math.floor(Number(rowsText)) || 1));

  // t: dil değişince hatalar yeni dilde yeniden üretilir.
  const result = useMemo((): { output: SqlInsertResult | null; error: string | null } => {
    try {
      let rows;
      if (excel) {
        const sheet = sheets?.list[sheetIndex];
        if (!sheet) return { output: null, error: null };
        rows = sheet.rows;
      } else {
        if (!text.trim()) return { output: null, error: null };
        rows = parseDelimited(text, resolveDelimiter(delimiter, text));
      }
      const output = buildSqlInsert(rows, {
        table,
        dialect: dialectId,
        header: Boolean(header),
        rowsPerStatement: requested,
        inferTypes: Boolean(infer),
        decimal: resolveDecimal(decimal, resolveDelimiter(delimiter, text)),
        emptyAs: emptyAs === 'empty' ? 'empty' : 'null',
        createTable: Boolean(create),
        transaction: Boolean(transaction),
      });
      return { output, error: null };
    } catch (error) {
      return { output: null, error: toolErrorText(error) };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    excel,
    sheets,
    sheetIndex,
    text,
    delimiter,
    decimal,
    table,
    dialectId,
    header,
    infer,
    emptyAs,
    create,
    transaction,
    requested,
    t,
  ]);

  const { output } = result;
  const sql = output?.sql ?? '';
  const tooLarge = sql.length > MAX_DISPLAY_CHARS;
  const fileName = t('sqlInsert.fileName');
  const download = () =>
    void saveFile({ blob: new Blob([sql], { type: 'text/plain;charset=utf-8' }), fileName });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <ToolOptions>
        <label className={toolLabelClass}>
          {t('sqlInsert.source')}
          <select
            className={toolSelectClass}
            value={excel ? 'excel' : 'csv'}
            onChange={(e) => setSource(e.target.value)}
          >
            <option value="csv">{t('sqlInsert.sourceCsv')}</option>
            <option value="excel">{t('sqlInsert.sourceExcel')}</option>
          </select>
        </label>
        <label className={toolLabelClass}>
          {t('sqlInsert.table')}
          <Input
            className="h-7 w-40 text-xs"
            value={table}
            onChange={(e) => setTable(e.target.value)}
            aria-label={t('sqlInsert.tableLabel')}
            title={t('sqlInsert.tableHint')}
          />
        </label>
        <label className={toolLabelClass}>
          {t('sqlInsert.dialect')}
          <select className={toolSelectClass} value={dialectId} onChange={(e) => setDialect(e.target.value)}>
            {SQL_DIALECTS.map((id) => (
              <option key={id} value={id}>
                {DIALECT_LABELS[id]}
              </option>
            ))}
          </select>
        </label>
        <label className={toolLabelClass} title={t('sqlInsert.rowsHint')}>
          {t('sqlInsert.rowsPerInsert')}
          <Input
            type="number"
            min={1}
            max={MAX_ROWS_PER_STATEMENT}
            className="h-7 w-20 text-xs"
            value={rowsText}
            onChange={(e) => setRowsText(e.target.value)}
            aria-label={t('sqlInsert.rowsPerInsert')}
          />
        </label>
        {!excel && (
          <>
            <label className={toolLabelClass}>
              {tc('convert.delimiter')}
              <select
                className={toolSelectClass}
                value={delimiter}
                onChange={(e) => setDelimiter(e.target.value)}
              >
                <option value="auto">{t('sqlInsert.auto')}</option>
                <option value=";">{tc('convert.delimiterSemicolon')}</option>
                <option value=",">{tc('convert.delimiterComma')}</option>
                <option value={'\t'}>{tc('convert.delimiterTab')}</option>
              </select>
            </label>
            <label className={toolLabelClass}>
              {tc('convert.decimal')}
              <select
                className={toolSelectClass}
                value={decimal}
                onChange={(e) => setDecimal(e.target.value)}
              >
                <option value="auto">{t('sqlInsert.decimalAuto')}</option>
                <option value=",">{tc('convert.decimalComma')}</option>
                <option value=".">{tc('convert.decimalDot')}</option>
              </select>
            </label>
          </>
        )}
        <label className={toolLabelClass}>
          {t('sqlInsert.emptyCell')}
          <select className={toolSelectClass} value={emptyAs} onChange={(e) => setEmptyAs(e.target.value)}>
            <option value="null">NULL</option>
            <option value="empty">{t('sqlInsert.emptyString')}</option>
          </select>
        </label>
        <label className={toolLabelClass}>
          <input type="checkbox" {...checkbox(header, setHeader)} />
          {tc('convert.firstRowHeader')}
        </label>
        <label className={toolLabelClass}>
          <input type="checkbox" {...checkbox(infer, setInfer)} />
          {t('sqlInsert.inferTypes')}
        </label>
        <label className={toolLabelClass}>
          <input type="checkbox" {...checkbox(create, setCreate)} />
          CREATE TABLE
        </label>
        <label className={toolLabelClass}>
          <input type="checkbox" {...checkbox(transaction, setTransaction)} />
          {t('sqlInsert.transaction')}
        </label>
      </ToolOptions>
      <ToolErrorMessage error={result.error} />
      <TwoPanes>
        {excel ? (
          <ExcelImportPanel
            sheets={sheets}
            onSheets={setSheets}
            sheetIndex={sheetIndex}
            onSheetIndex={setSheetIndex}
            header={Boolean(header)}
            onHeader={() => undefined}
            showHeader={false}
          />
        ) : (
          <ToolPane
            label="CSV"
            value={input}
            onChange={setInput}
            fileAccept=".csv,.tsv,.txt,text/csv,text/plain"
            placeholder={t('sqlInsert.placeholder')}
          />
        )}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
          {output && (
            <section className="flex max-h-44 min-h-0 flex-col gap-1 rounded-md border border-line p-2">
              <h3 className="text-xs font-semibold text-fg-muted">
                {t('sqlInsert.columns', { columns: output.columns.length, rows: output.rowCount })}
              </h3>
              <div className="min-h-0 overflow-auto">
                <table className="w-full text-xs">
                  <tbody>
                    {output.columns.map((column, i) => (
                      <tr key={i} className="border-t border-line first:border-t-0">
                        <td className="py-0.5 pe-3 font-medium">{column.name}</td>
                        <td className="py-0.5 font-mono text-fg-muted">{column.sqlType}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {output.rowsPerStatement < requested && (
                <p className="text-[11px] text-fg-subtle">
                  {t('sqlInsert.rowsClamped', { count: output.rowsPerStatement })}
                </p>
              )}
            </section>
          )}
          {tooLarge ? (
            <section className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-3 rounded-md border border-line p-4 text-center">
              <p className="text-sm text-fg-muted">
                {t('sqlInsert.largeOutput', {
                  size: formatSize(sql.length),
                  max: formatSize(MAX_DISPLAY_CHARS),
                })}
              </p>
              <Button size="sm" variant="secondary" onClick={download}>
                <Download className="h-3.5 w-3.5" /> {t('sqlInsert.download')}
              </Button>
            </section>
          ) : (
            <ToolPane label="SQL" value={sql} output downloadName={fileName} />
          )}
        </div>
      </TwoPanes>
    </div>
  );
}
