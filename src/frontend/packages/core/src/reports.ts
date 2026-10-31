/** Runner sonuçları ve istek geçmişi için hazır tablolar (Excel/CSV dışa aktarma). */
import { msg } from './i18n';
import type { HistoryEntryDto, RunResultEntry } from './types';
import type { CellValue, ColumnType, Table } from './tabular';

function table(name: string, columns: [string, ColumnType][], rows: CellValue[][]): Table {
  return { name, columns: columns.map(([key, type]) => ({ key, type })), rows };
}

/**
 * Collection runner sonuçları: her iterasyon × istek bir satır ("Sonuçlar"), her test bir satır ("Testler").
 * İki tablo `#` kolonuyla bağlıdır.
 */
export function runResultTables(results: RunResultEntry[]): Table[] {
  const summary = table(
    msg('core.reports.sheetResults', 'Sonuçlar'),
    [
      ['#', 'number'],
      [msg('core.reports.iteration', 'İterasyon'), 'number'],
      [msg('core.reports.request', 'İstek'), 'text'],
      [msg('core.reports.method', 'Metot'), 'text'],
      ['URL', 'text'],
      [msg('core.reports.status', 'Durum'), 'number'],
      [msg('core.reports.timeMs', 'Süre (ms)'), 'number'],
      [msg('core.reports.sizeBytes', 'Boyut (bayt)'), 'number'],
      [msg('core.reports.passedTests', 'Geçen test'), 'number'],
      [msg('core.reports.failedCount', 'Kalan test'), 'number'],
      [msg('core.reports.skippedTests', 'Atlanan test'), 'number'],
      [msg('core.reports.failedTests', 'Başarısız testler'), 'text'],
      [msg('core.reports.error', 'Hata'), 'text'],
    ],
    results.map((r, i) => {
      const count = (status: string) => r.tests.filter((t) => t.status === status).length;
      return [
        i + 1,
        r.iteration,
        r.name,
        r.method,
        r.url,
        r.status,
        r.timeMs,
        r.size,
        count('passed'),
        count('failed'),
        count('skipped'),
        r.tests
          .filter((t) => t.status === 'failed')
          .map((t) => t.name)
          .join('; ') || null,
        r.error,
      ];
    }),
  );
  const tests = table(
    msg('core.reports.sheetTests', 'Testler'),
    [
      ['#', 'number'],
      [msg('core.reports.iteration', 'İterasyon'), 'number'],
      [msg('core.reports.request', 'İstek'), 'text'],
      [msg('core.reports.test', 'Test'), 'text'],
      [msg('core.reports.result', 'Sonuç'), 'text'],
      [msg('core.reports.error', 'Hata'), 'text'],
    ],
    results.flatMap((r, i) =>
      r.tests.map((t): CellValue[] => [
        i + 1,
        r.iteration,
        r.name,
        t.name,
        t.status === 'passed'
          ? msg('core.reports.passed', 'Geçti')
          : t.status === 'failed'
            ? msg('core.reports.failed', 'Kaldı')
            : msg('core.reports.skipped', 'Atlandı'),
        t.error,
      ]),
    ),
  );
  return tests.rows.length ? [summary, tests] : [summary];
}

/** İstek geçmişi (yanıt gövdeleri geçmişte saklanmaz; durum, süre ve boyut bulunur). */
export function historyTable(entries: HistoryEntryDto[]): Table {
  return table(
    msg('core.reports.sheetHistory', 'Geçmiş'),
    [
      [msg('core.reports.time', 'Zaman'), 'datetime'],
      [msg('core.reports.method', 'Metot'), 'text'],
      ['URL', 'text'],
      [msg('core.reports.status', 'Durum'), 'number'],
      [msg('core.reports.timeMs', 'Süre (ms)'), 'number'],
      [msg('core.reports.sizeBytes', 'Boyut (bayt)'), 'number'],
    ],
    entries.map((e) => [localIso(e.executedAt), e.method, e.url, e.status, e.timeMs, e.size]),
  );
}

/** UTC zamanı bu bilgisayarın saatine çevirir (Excel'de görülen saat kullanıcının saati olsun). */
function localIso(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
