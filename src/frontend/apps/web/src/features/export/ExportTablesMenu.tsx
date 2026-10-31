import { useCallback, useRef, useState } from 'react';
import { ChevronDown, FileSpreadsheet, FileText } from 'lucide-react';
import { Button, cn } from '@apivator/ui';
import type { ExportFormat, Table } from '@apivator/core';
import { useDismiss } from '../../components/useDismiss';
import { useT } from '../../i18n';
import { safeFileName, saveFile } from '../../lib/download';
import { errorMessage } from '../../lib/errors';

/**
 * Hazır tabloları (runner sonuçları, geçmiş) Excel ya da CSV olarak indiren düğme. CSV yalnızca ilk tabloyu
 * içerir (Türkçe Excel için `;` ayırıcı, ondalık virgül).
 */
export function ExportTablesMenu({
  tables,
  baseName,
  disabled,
  size = 'sm',
  iconOnly,
  className,
  onError,
}: {
  /** Dar yerlerde (geçmiş paneli) yalnızca simge. */
  iconOnly?: boolean;
  tables: () => Table[];
  baseName: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
  className?: string;
  onError?: (message: string) => void;
}) {
  const t = useT('exchange');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);

  async function run(format: ExportFormat) {
    close();
    setBusy(true);
    try {
      // Excel yazıcı ayrı parçada; ilk kullanımda yüklenir.
      const { exportTables } = await import('@apivator/core/tableExport');
      const file = await exportTables(tables(), format);
      await saveFile({
        blob: new Blob([file.data as BlobPart], { type: file.mime }),
        fileName: `${safeFileName(baseName)}.${file.extension}`,
      });
    } catch (e) {
      onError?.(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={ref} className={cn('relative', className)}>
      {iconOnly ? (
        <Button
          variant="ghost"
          size="icon"
          loading={busy}
          disabled={disabled}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={t('export.menu.label')}
          title={t('export.menu.label')}
          onClick={() => setOpen((o) => !o)}
        >
          {!busy && <FileSpreadsheet className="h-4 w-4" />}
        </Button>
      ) : (
        <Button
          variant="secondary"
          size={size}
          loading={busy}
          disabled={disabled}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <FileSpreadsheet className="h-3.5 w-3.5" /> {t('export.menu.button')}{' '}
          <ChevronDown className="h-3 w-3" />
        </Button>
      )}
      {open && (
        <div
          role="menu"
          className="absolute end-0 top-full z-30 mt-1 w-max min-w-44 rounded-lg border border-line bg-surface p-1 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => void run('xlsx')}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-start text-sm text-fg-muted hover:bg-muted hover:text-fg"
          >
            <FileSpreadsheet className="h-3.5 w-3.5" /> {t('export.menu.excel')}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => void run('csv')}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-start text-sm text-fg-muted hover:bg-muted hover:text-fg"
          >
            <FileText className="h-3.5 w-3.5" /> {t('export.menu.csv')}
          </button>
        </div>
      )}
    </div>
  );
}
