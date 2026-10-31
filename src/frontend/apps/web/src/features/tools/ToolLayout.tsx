import { useRef, useState, type ReactNode } from 'react';
import { ArrowLeftRight, Download, Eraser, Upload } from 'lucide-react';
import { Alert, Button, cn } from '@apivator/ui';
import type { RawLanguage } from '@apivator/core';
import type { EditorView } from '@codemirror/view';
import { CodeEditor } from '../requests/CodeEditor';
import { CopyButton } from '../../components/ui/CopyButton';
import { saveFile } from '../../lib/download';
import { useT } from '../../i18n';
import { OutputActions } from './OutputActions';

/** Metin olarak editöre yüklenebilecek en büyük dosya; daha büyüğü sekmeyi dondurur. */
const MAX_TEXT_FILE = 20 * 1024 * 1024;

/**
 * Aracın bir girdi ya da çıktı alanı: başlık, araç çubuğu (dosyadan yükle, indir, kopyala, temizle) ve editör.
 * `output` verilirse alan salt okunurdur ve "Değişken olarak kaydet" / "Yeni istekte kullan" eklenir.
 */
export function ToolPane({
  label,
  value,
  onChange,
  language = 'Text',
  placeholder,
  output = false,
  fileAccept,
  onLoadFile,
  downloadName,
  toolbar,
  className,
  onEditorReady,
}: {
  /** Editör oluşunca çağrılır (ör. hata konumuna imleç taşımak için). */
  onEditorReady?: (view: EditorView) => void;
  label: string;
  value: string;
  onChange?: (value: string) => void;
  language?: RawLanguage | 'none';
  placeholder?: string;
  output?: boolean;
  /** Dosyadan yükleme düğmesi gösterilir; `onLoadFile` yoksa dosya metin olarak okunur. */
  fileAccept?: string;
  onLoadFile?: (file: File) => void;
  /** Verilirse içerik bu adla indirilebilir. */
  downloadName?: string;
  /** Başlık satırına eklenecek araç-özel seçenekler. */
  toolbar?: ReactNode;
  className?: string;
}) {
  const t = useT('tools');
  const fileInput = useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const editable = !output && Boolean(onChange);
  return (
    <section className={cn('flex min-h-0 min-w-0 flex-1 flex-col rounded-md border border-line', className)}>
      <header className="flex min-h-9 flex-wrap items-center gap-2 border-b border-line px-2 py-1">
        <h3 className="text-xs font-semibold text-fg-muted">{label}</h3>
        {toolbar}
        <div className="flex-1" />
        {fileAccept !== undefined && (
          <>
            <input
              ref={fileInput}
              type="file"
              accept={fileAccept}
              className="hidden"
              aria-label={t('pane.loadFileLabel', { label })}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                setFileError(null);
                if (onLoadFile) onLoadFile(file);
                else if (file.size > MAX_TEXT_FILE) setFileError(t('pane.fileTooLarge'));
                else void file.text().then((text) => onChange?.(text));
              }}
            />
            <Button
              size="icon"
              variant="ghost"
              title={t('pane.loadFile')}
              aria-label={t('pane.loadFile')}
              onClick={() => fileInput.current?.click()}
            >
              <Upload className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
        {downloadName && (
          <Button
            size="icon"
            variant="ghost"
            title={t('pane.download')}
            aria-label={t('pane.download')}
            disabled={!value}
            onClick={() =>
              void saveFile({
                blob: new Blob([value], { type: 'text/plain;charset=utf-8' }),
                fileName: downloadName,
              })
            }
          >
            <Download className="h-3.5 w-3.5" />
          </Button>
        )}
        {editable && (
          <Button
            size="icon"
            variant="ghost"
            title={t('pane.clear')}
            aria-label={t('pane.clearLabel', { label })}
            disabled={!value}
            onClick={() => onChange?.('')}
          >
            <Eraser className="h-3.5 w-3.5" />
          </Button>
        )}
        <CopyButton text={value} label={t('pane.copyLabel', { label })} compact />
        {output && value && <OutputActions text={value} />}
      </header>
      {fileError && (
        <p role="alert" className="border-b border-line px-2 py-1 text-xs text-danger">
          {fileError}
        </p>
      )}
      <div className="min-h-0 flex-1">
        <CodeEditor
          value={value}
          onChange={editable ? onChange : undefined}
          readOnly={!editable}
          language={language}
          label={label}
          placeholder={placeholder}
          onReady={onEditorReady}
        />
      </div>
    </section>
  );
}

/** Girdi ile çıktının yerini değiştirir (encode ↔ decode). */
export function SwapButton({ onClick, title }: { onClick: () => void; title?: string }) {
  const t = useT('tools');
  const label = title ?? t('pane.swap');
  return (
    <Button size="sm" variant="secondary" onClick={onClick} title={label} aria-label={label}>
      <ArrowLeftRight className="h-3.5 w-3.5" /> {t('pane.swap')}
    </Button>
  );
}

/** Aracın üst seçenek satırı. */
export function ToolOptions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-3">{children}</div>;
}

export function ToolErrorMessage({ error }: { error: string | null | undefined }) {
  if (!error) return null;
  return <Alert tone="error">{error}</Alert>;
}

/** Yan yana (geniş ekran) ya da alt alta iki alan. */
export function TwoPanes({ children }: { children: ReactNode }) {
  return <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">{children}</div>;
}
