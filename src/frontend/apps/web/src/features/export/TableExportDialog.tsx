import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Download, FileSpreadsheet } from 'lucide-react';
import { Alert, Button, cn, Spinner } from '@apivator/ui';
import type {
  AnalyzeResult,
  ArrayMode,
  CellValue,
  ColumnType,
  CsvOptions,
  ExportFormat,
  ExportSource,
} from '@apivator/core';
import { Dialog } from '../../components/ui/Dialog';
import { useT } from '../../i18n';
import { errorMessage } from '../../lib/errors';
import { safeFileName, saveFile } from '../../lib/download';
import { selectClass } from '../../lib/teams';
import { openTableEngine, type TableEngine } from './tableEngine';

const TYPE_KEYS = {
  number: 'export.dialog.types.number',
  date: 'export.dialog.types.date',
  datetime: 'export.dialog.types.datetime',
  boolean: 'export.dialog.types.boolean',
  text: 'export.dialog.types.text',
} as const satisfies Record<ColumnType, string>;

const DELIMITERS = [
  { value: ';', key: 'export.dialog.delimiters.semicolon' },
  { value: ',', key: 'export.dialog.delimiters.comma' },
  { value: '\t', key: 'export.dialog.delimiters.tab' },
] as const satisfies { value: NonNullable<CsvOptions['delimiter']>; key: string }[];

function preview(value: CellValue) {
  if (value === null) return <span className="text-fg-subtle">—</span>;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  const text = String(value);
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

/**
 * Yanıtı tablo olarak kaydetme: hangi dizinin satır olacağı, iç içe dizilerin nasıl yazılacağı, kolon seçimi
 * ve sırası; ilk 100 satırın önizlemesi. Çözümleme ve dosya üretimi Web Worker'da yapılır.
 */
export function TableExportDialog({
  source,
  baseName,
  onClose,
}: {
  source: ExportSource;
  baseName: string;
  onClose: () => void;
}) {
  const t = useT('exchange');
  // Motor (Web Worker) effect içinde açılır ve kapanır; StrictMode'daki ikinci açılışta yenisi oluşur.
  const [engine, setEngine] = useState<TableEngine | null>(null);
  useEffect(() => {
    const opened = openTableEngine(source);
    setEngine(opened);
    return () => opened.dispose();
  }, [source]);

  const [path, setPath] = useState<string | undefined>(undefined);
  const [arrays, setArrays] = useState<ArrayMode>('json');
  const [format, setFormat] = useState<ExportFormat>('xlsx');
  const [delimiter, setDelimiter] = useState<NonNullable<CsvOptions['delimiter']>>(';');
  const [analysis, setAnalysis] = useState<AnalyzeResult | null>(null);
  const [columns, setColumns] = useState<{ key: string; type: ColumnType; on: boolean }[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // CSV tek tablodur: iç içe diziler hücrede JSON olarak kalır.
  const effectiveArrays: ArrayMode = format === 'csv' ? 'json' : arrays;

  useEffect(() => {
    if (!engine) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    engine
      .analyze({ path, arrays: effectiveArrays })
      .then((result) => {
        if (cancelled) return;
        setAnalysis(result);
        setColumns((previous) => {
          const keys = result.tables[0]!.columns;
          // Kullanıcının seçimi ve sırası korunur: önceki kolonlar aynı sırayla (kaybolanlar düşer), yeniler sona eklenir.
          const kept = previous
            .filter((c) => keys.some((k) => k.key === c.key))
            .map((c) => ({ ...c, type: keys.find((k) => k.key === c.key)!.type }));
          const added = keys
            .filter((k) => !previous.some((c) => c.key === k.key))
            .map((k) => ({ key: k.key, type: k.type, on: true }));
          return [...kept, ...added];
        });
      })
      .catch((e: unknown) => !cancelled && setError(errorMessage(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [engine, path, effectiveArrays]);

  const main = analysis?.tables[0];
  const children = analysis?.tables.slice(1) ?? [];
  const selected = columns.filter((c) => c.on);
  const indexes = main ? selected.map((c) => main.columns.findIndex((k) => k.key === c.key)) : [];

  function move(index: number, delta: -1 | 1) {
    setColumns((list) => {
      const next = [...list];
      const [item] = next.splice(index, 1);
      next.splice(index + delta, 0, item!);
      return next;
    });
  }

  async function download() {
    if (!analysis || !engine) return;
    setSaving(true);
    setError(null);
    try {
      const file = await engine.export({
        path: analysis.path,
        arrays: effectiveArrays,
        columns: selected.map((c) => c.key),
        format,
        csv: { delimiter },
      });
      const saved = await saveFile({
        blob: new Blob([file.data as BlobPart], { type: file.mime }),
        fileName: `${safeFileName(baseName, t('export.dialog.fallbackName'))}.${file.extension}`,
      });
      if (saved) onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  // Önerilen diziler; seçili yol bir dizi değilse (kök nesne) "tek satır" olarak eklenir.
  const pathOptions = analysis
    ? [
        ...(analysis.candidates.some((c) => c.path === analysis.path)
          ? []
          : [
              {
                path: analysis.path,
                label: t('export.dialog.singleRow', { path: analysis.path || t('export.dialog.root') }),
              },
            ]),
        ...analysis.candidates.map((c) => ({
          path: c.path,
          label: t('export.dialog.itemCount', { path: c.path || t('export.dialog.root'), count: c.length }),
        })),
        ...(analysis.path !== '' && !analysis.candidates.some((c) => c.path === '')
          ? [{ path: '', label: t('export.dialog.singleRow', { path: t('export.dialog.root') }) }]
          : []),
      ]
    : [];

  return (
    <Dialog
      title={t('export.dialog.title')}
      size="xl"
      onClose={onClose}
      footer={
        <>
          <span className="me-auto text-xs text-fg-subtle">
            {main &&
              t('export.dialog.footer', {
                rows: main.rowCount,
                selected: selected.length,
                columns: columns.length,
                sheets: format === 'xlsx' && children.length > 0 ? children.length + 1 : 0,
              })}
          </span>
          <Button variant="secondary" onClick={onClose}>
            {t('export.dialog.cancel')}
          </Button>
          <Button
            onClick={() => void download()}
            loading={saving}
            disabled={!main || selected.length === 0 || loading}
          >
            <Download className="h-3.5 w-3.5" />{' '}
            {format === 'xlsx' ? t('export.dialog.saveExcel') : t('export.dialog.saveCsv')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 text-[13px]">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1.5">
            <span className="font-medium">{t('export.dialog.rows')}</span>
            <select
              aria-label={t('export.dialog.rowsArray')}
              className={cn(selectClass, 'h-9')}
              value={analysis?.path ?? ''}
              disabled={!analysis}
              onChange={(e) => {
                // Başka bir dizi: kolonlar baştan.
                setColumns([]);
                setPath(e.target.value);
              }}
            >
              {pathOptions.map((c) => (
                <option key={c.path} value={c.path}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="font-medium">{t('export.dialog.nestedArrays')}</span>
            <select
              aria-label={t('export.dialog.nestedArrays')}
              className={cn(selectClass, 'h-9')}
              value={effectiveArrays}
              disabled={format === 'csv'}
              onChange={(e) => setArrays(e.target.value as ArrayMode)}
            >
              <option value="json">{t('export.dialog.nestedJson')}</option>
              <option value="sheet">{t('export.dialog.nestedSheet')}</option>
            </select>
          </label>
          <div className="flex flex-col gap-1.5">
            <span className="font-medium">{t('export.dialog.format')}</span>
            <div
              role="radiogroup"
              aria-label={t('export.dialog.format')}
              className="flex h-9 rounded-md bg-muted p-0.5"
            >
              {(['xlsx', 'csv'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  role="radio"
                  aria-checked={format === f}
                  onClick={() => setFormat(f)}
                  className={cn(
                    'flex flex-1 items-center justify-center gap-1.5 rounded px-2 font-medium',
                    format === f ? 'bg-surface text-fg shadow-sm' : 'text-fg-subtle hover:text-fg',
                  )}
                >
                  {f === 'xlsx' ? (
                    <>
                      <FileSpreadsheet className="h-3.5 w-3.5" /> Excel
                    </>
                  ) : (
                    'CSV'
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>

        {format === 'csv' && (
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="font-medium">{t('export.dialog.delimiter')}</span>
              <select
                aria-label={t('export.dialog.csvDelimiter')}
                className={cn(selectClass, 'h-9')}
                value={delimiter}
                onChange={(e) => setDelimiter(e.target.value as typeof delimiter)}
              >
                {DELIMITERS.map((d) => (
                  <option key={d.key} value={d.value}>
                    {t(d.key)}
                  </option>
                ))}
              </select>
            </label>
            <p className="pb-2 text-xs text-fg-subtle">
              {t('export.dialog.csvNote', { delimiter: delimiter === ',' ? 'comma' : 'other' })}
            </p>
          </div>
        )}

        {error && <Alert tone="error">{error}</Alert>}

        {loading && !analysis ? (
          <div className="flex items-center justify-center gap-2 py-10 text-fg-subtle">
            <Spinner className="h-4 w-4" /> {t('export.dialog.analyzing')}
          </div>
        ) : (
          main && (
            <div className="grid min-h-0 gap-4 md:grid-cols-[14rem_1fr]">
              <section aria-label={t('export.dialog.columns')} className="flex min-h-0 flex-col gap-2">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">{t('export.dialog.columns')}</h3>
                  <span className="flex gap-2 text-xs">
                    <button
                      type="button"
                      className="text-accent hover:underline"
                      onClick={() => setColumns((l) => l.map((c) => ({ ...c, on: true })))}
                    >
                      {t('export.dialog.all')}
                    </button>
                    <button
                      type="button"
                      className="text-accent hover:underline"
                      onClick={() => setColumns((l) => l.map((c) => ({ ...c, on: false })))}
                    >
                      {t('export.dialog.none')}
                    </button>
                  </span>
                </div>
                <ul className="max-h-80 overflow-y-auto rounded-md border border-line">
                  {columns.map((c, i) => (
                    <li key={c.key} className="group flex items-center gap-2 px-2 py-1 hover:bg-muted">
                      <input
                        type="checkbox"
                        aria-label={c.key}
                        className="accent-[var(--app-accent)]"
                        checked={c.on}
                        onChange={(e) =>
                          setColumns((l) =>
                            l.map((x) => (x.key === c.key ? { ...x, on: e.target.checked } : x)),
                          )
                        }
                      />
                      <span className="min-w-0 flex-1 truncate font-mono text-xs" title={c.key}>
                        {c.key}
                      </span>
                      <span className="text-[10.5px] text-fg-subtle group-hover:hidden">
                        {t(TYPE_KEYS[c.type])}
                      </span>
                      <span className="hidden gap-0.5 group-hover:flex">
                        <button
                          type="button"
                          aria-label={t('export.dialog.moveUp', { key: c.key })}
                          disabled={i === 0}
                          onClick={() => move(i, -1)}
                          className="rounded p-0.5 text-fg-subtle hover:bg-line hover:text-fg disabled:opacity-30"
                        >
                          <ArrowUp className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          aria-label={t('export.dialog.moveDown', { key: c.key })}
                          disabled={i === columns.length - 1}
                          onClick={() => move(i, 1)}
                          className="rounded p-0.5 text-fg-subtle hover:bg-line hover:text-fg disabled:opacity-30"
                        >
                          <ArrowDown className="h-3 w-3" />
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
                {format === 'xlsx' && children.length > 0 && (
                  <p className="text-xs text-fg-subtle">
                    {t('export.dialog.extraSheets', {
                      list: children
                        .map((c) => t('export.dialog.sheetRows', { name: c.name, count: c.rowCount }))
                        .join(t('source.listSeparator')),
                    })}
                  </p>
                )}
              </section>

              <section aria-label={t('export.dialog.preview')} className="flex min-w-0 flex-col gap-2">
                <h3 className="flex items-center gap-2 font-semibold">
                  {t('export.dialog.preview')}
                  <span className="text-xs font-normal text-fg-subtle">
                    {main.rowCount > main.rows.length
                      ? t('export.dialog.previewPartial', { shown: main.rows.length, total: main.rowCount })
                      : t('export.dialog.previewAll', { total: main.rowCount })}
                  </span>
                  {loading && <Spinner className="h-3.5 w-3.5 text-fg-subtle" />}
                </h3>
                <div className="max-h-80 overflow-auto rounded-md border border-line">
                  <table
                    className="w-full border-collapse text-xs"
                    aria-label={t('export.dialog.previewTable')}
                  >
                    <thead className="sticky top-0 bg-muted">
                      <tr>
                        {selected.map((c) => (
                          <th
                            key={c.key}
                            className={cn(
                              'border-b border-line px-2 py-1.5 text-start font-semibold whitespace-nowrap',
                              c.type === 'number' && 'text-end',
                            )}
                          >
                            {c.key}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {main.rows.map((row, r) => (
                        <tr key={r} className="odd:bg-surface even:bg-muted/40">
                          {indexes.map((index, i) => (
                            <td
                              key={selected[i]!.key}
                              className={cn(
                                'border-b border-line px-2 py-1 whitespace-nowrap',
                                selected[i]!.type === 'number' && 'text-end tabular-nums',
                              )}
                            >
                              {preview(row[index] ?? null)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {main.rowCount === 0 && (
                    <p className="p-4 text-center text-fg-subtle">{t('export.dialog.emptyArray')}</p>
                  )}
                </div>
              </section>
            </div>
          )
        )}
      </div>
    </Dialog>
  );
}
