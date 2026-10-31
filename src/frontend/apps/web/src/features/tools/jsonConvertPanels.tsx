import { useRef, useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { Button, Spinner } from '@apivator/ui';
import { toXlsx, XLSX_MIME, type ArrayCandidate, type Table } from '@apivator/core';
import { readXlsx, type ReadSheet } from '@apivator/core/tools';
import { useT } from '../../i18n';
import { saveFile } from '../../lib/download';
import { ToolErrorMessage } from './ToolLayout';
import { toolErrorText, toolLabelClass, toolSelectClass } from './toolUtils';

/** Tarayıcıda okunacak en büyük Excel dosyası. */
const MAX_XLSX_BYTES = 50 * 1024 * 1024;

/** Satır olacak dizinin seçimi (6.1'deki tablo kaydetme ile aynı yol biçimi). */
export function PathSelect({
  candidates,
  value,
  onChange,
}: {
  candidates: ArrayCandidate[];
  value: string;
  onChange: (path: string) => void;
}) {
  const t = useT('tools');
  const options = candidates.some((c) => c.path === '')
    ? candidates
    : [{ path: '', length: 0 }, ...candidates];
  return (
    <label className={toolLabelClass}>
      {t('convert.rows')}
      <select className={toolSelectClass} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((c) => (
          <option key={c.path} value={c.path}>
            {c.path === ''
              ? c.length
                ? t('convert.rootArray', { count: c.length })
                : t('convert.rootSingle')
              : `${c.path} (${c.length})`}
          </option>
        ))}
      </select>
    </label>
  );
}

const DELIMITERS = [
  [';', 'convert.delimiterSemicolon'],
  [',', 'convert.delimiterComma'],
  ['\t', 'convert.delimiterTab'],
] as const;

/** CSV ayırıcı ve ondalık seçimi; ayırıcı değişince ondalık Excel'in beklediğine ayarlanır. */
export function CsvFormatOptions({
  delimiter,
  decimal,
  onDelimiter,
  onDecimal,
}: {
  delimiter: string;
  decimal: string;
  onDelimiter: (value: string) => void;
  onDecimal: (value: string) => void;
}) {
  const t = useT('tools');
  return (
    <>
      <label className={toolLabelClass}>
        {t('convert.delimiter')}
        <select
          className={toolSelectClass}
          value={delimiter}
          onChange={(e) => {
            onDelimiter(e.target.value);
            onDecimal(e.target.value === ',' ? '.' : ',');
          }}
        >
          {DELIMITERS.map(([value, label]) => (
            <option key={value} value={value}>
              {t(label)}
            </option>
          ))}
        </select>
      </label>
      <label className={toolLabelClass}>
        {t('convert.decimal')}
        <select className={toolSelectClass} value={decimal} onChange={(e) => onDecimal(e.target.value)}>
          <option value=",">{t('convert.decimalComma')}</option>
          <option value=".">{t('convert.decimalDot')}</option>
        </select>
      </label>
    </>
  );
}

/** JSON → query string: dizi yazımı ve boşluk kodlaması. */
export function QueryOptions({
  arrays,
  plusSpaces,
  onArrays,
  onPlusSpaces,
}: {
  arrays: string;
  plusSpaces: boolean;
  onArrays: (value: string) => void;
  onPlusSpaces: (value: boolean) => void;
}) {
  const t = useT('tools');
  return (
    <>
      <label className={toolLabelClass}>
        {t('convert.arrays')}
        <select className={toolSelectClass} value={arrays} onChange={(e) => onArrays(e.target.value)}>
          <option value="brackets">a[]=1&amp;a[]=2</option>
          <option value="repeat">a=1&amp;a=2</option>
          <option value="indices">a[0]=1&amp;a[1]=2</option>
        </select>
      </label>
      <label className={toolLabelClass}>
        <input type="checkbox" checked={plusSpaces} onChange={(e) => onPlusSpaces(e.target.checked)} />
        {t('convert.plusSpaces')}
      </label>
    </>
  );
}

/** JSON → Excel: oluşacak sayfaların özeti ve indirme. */
export function ExcelExportPanel({ tables, error }: { tables: Table[] | null; error: string | null }) {
  const t = useT('tools');
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const download = async () => {
    if (!tables) return;
    setBusy(true);
    setSaveError(null);
    try {
      const data = await toXlsx(tables);
      await saveFile({ blob: new Blob([data as BlobPart], { type: XLSX_MIME }), fileName: 'veri.xlsx' });
    } catch (e) {
      setSaveError(toolErrorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 rounded-md border border-line p-3">
      <h3 className="text-xs font-semibold text-fg-muted">{t('convert.excelFile')}</h3>
      <ToolErrorMessage error={error ?? saveError} />
      {tables && (
        <ul className="flex flex-col gap-1 text-sm">
          {tables.map((table, i) => (
            <li key={i}>
              <span className="font-medium">{table.name}</span>{' '}
              <span className="text-fg-muted">
                {t('convert.sheetSummary', { rows: table.rows.length, columns: table.columns.length })}
              </span>
              {table.columns.length > 0 && (
                <div className="truncate text-xs text-fg-subtle">
                  {table.columns.map((c) => c.key).join(', ')}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-fg-muted">{t('convert.excelNote')}</p>
      <div>
        <Button size="sm" disabled={!tables || busy} onClick={() => void download()}>
          {busy ? <Spinner className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />}{' '}
          {t('convert.downloadExcel')}
        </Button>
      </div>
    </section>
  );
}

/** Excel → JSON: dosya yükleme, sayfa ve başlık seçimi. */
export function ExcelImportPanel({
  sheets,
  onSheets,
  sheetIndex,
  onSheetIndex,
  header,
  onHeader,
  showHeader = true,
}: {
  /** Başlık seçimi yalnızca JSON'a çevirirken anlamlı; CSV'de satırlar olduğu gibi yazılır. */
  showHeader?: boolean;
  sheets: { fileName: string; list: ReadSheet[] } | null;
  onSheets: (sheets: { fileName: string; list: ReadSheet[] }) => void;
  sheetIndex: number;
  onSheetIndex: (index: number) => void;
  header: boolean;
  onHeader: (header: boolean) => void;
}) {
  const t = useT('tools');
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      if (file.size > MAX_XLSX_BYTES) throw new Error(t('convert.fileTooLarge'));
      const list = await readXlsx(new Uint8Array(await file.arrayBuffer()));
      onSheets({ fileName: file.name, list });
      onSheetIndex(0);
    } catch (e) {
      setError(toolErrorText(e));
    } finally {
      setBusy(false);
    }
  };
  const current = sheets?.list[sheetIndex];
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 rounded-md border border-line p-3">
      <h3 className="text-xs font-semibold text-fg-muted">{t('convert.excelFileXlsx')}</h3>
      <input
        ref={fileInput}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        aria-label={t('convert.pickExcel')}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void load(file);
        }}
      />
      <div className="flex items-center gap-2">
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => fileInput.current?.click()}>
          {busy ? <Spinner className="h-3.5 w-3.5" /> : <Upload className="h-3.5 w-3.5" />}{' '}
          {t('convert.pickFile')}
        </Button>
        {sheets && <span className="truncate text-xs text-fg-muted">{sheets.fileName}</span>}
      </div>
      <ToolErrorMessage error={error} />
      {sheets && (
        <div className="flex flex-wrap items-center gap-3">
          <label className={toolLabelClass}>
            {t('convert.sheet')}
            <select
              className={toolSelectClass}
              value={sheetIndex}
              onChange={(e) => onSheetIndex(Number(e.target.value))}
            >
              {sheets.list.map((s, i) => (
                <option key={i} value={i}>
                  {t('convert.sheetOption', { name: s.name, rows: s.rows.length })}
                </option>
              ))}
            </select>
          </label>
          {showHeader && (
            <label className={toolLabelClass}>
              <input type="checkbox" checked={header} onChange={(e) => onHeader(e.target.checked)} />
              {t('convert.firstRowHeader')}
            </label>
          )}
        </div>
      )}
      {current && current.rows.length === 0 && (
        <p className="text-xs text-fg-muted">{t('convert.sheetEmpty')}</p>
      )}
      <p className="text-xs text-fg-muted">{t('convert.localRead')}</p>
    </section>
  );
}
