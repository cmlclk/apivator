import { useMemo, useRef, useState } from 'react';
import { FileUp, X } from 'lucide-react';
import { Button } from '@apivator/ui';
import { MAX_HAR_BYTES, parseHar } from '@apivator/core/tools';
import { ToolErrorMessage, ToolOptions, ToolPane } from '../ToolLayout';
import { toolErrorText } from '../toolUtils';
import { useToolInput } from '../toolsStore';
import { HarDetail } from './harDetail';
import { formatBytes } from './harFormat';
import { HarTable } from './harTable';
import { translate, useT } from '../../../i18n';

/** FileReader her ortamda var (jsdom'daki File'da text() yok). */
function readText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error(translate('toolsData', 'har.readFailed')));
    reader.readAsText(file);
  });
}

/**
 * HAR (HTTP Archive) görüntüleyici: kayıt tablosu, süzgeç ve sıralama; seçili kaydın istek/yanıt ayrıntısı.
 * Dosya içeriği yalnızca bu bileşende tutulur (büyük dosyalar yerel depolamaya yazılmasın); yapıştırılan metin
 * oturum boyunca araç girdisidir ama diske yazılmaz (çerez ve Authorization başlıkları içerir; bkz. toolsStore).
 */
export default function HarTool() {
  const t = useT('toolsData');
  const [input, setInput] = useToolInput('har', 'input');
  const [file, setFile] = useState<{ name: string; size: number; text: string } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const source = file?.text ?? input;
  const result = useMemo(() => {
    if (!source.trim()) return { log: null, error: null };
    try {
      return { log: parseHar(source), error: null };
    } catch (error) {
      return { log: null, error: toolErrorText(error) };
    }
  }, [source]);

  const loadFile = (picked: File) => {
    setFileError(null);
    if (picked.size > MAX_HAR_BYTES) {
      setFileError(t('har.tooLarge', { max: formatBytes(MAX_HAR_BYTES) }));
      return;
    }
    void readText(picked).then(
      (text) => {
        setSelected(null);
        setFile({ name: picked.name, size: picked.size, text });
      },
      () => setFileError(t('har.readFailed')),
    );
  };

  const clear = () => {
    setFile(null);
    setInput('');
    setSelected(null);
    setFileError(null);
  };

  const log = result.log;
  const entry = log && selected !== null ? log.entries[selected] : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <ToolOptions>
        <input
          ref={fileInput}
          type="file"
          accept=".har,.json,application/json"
          className="hidden"
          aria-label={t('har.pickFile')}
          onChange={(e) => {
            const picked = e.target.files?.[0];
            e.target.value = '';
            if (picked) loadFile(picked);
          }}
        />
        <Button size="sm" variant="secondary" onClick={() => fileInput.current?.click()}>
          <FileUp className="h-3.5 w-3.5" /> {t('har.openFile')}
        </Button>
        {(file || log) && (
          <Button size="sm" variant="ghost" onClick={clear}>
            <X className="h-3.5 w-3.5" /> {t('har.close')}
          </Button>
        )}
        {(file || log) && (
          <span className="text-xs text-fg-muted">
            {file && (
              <>
                <span className="font-medium text-fg">{file.name}</span> ({formatBytes(file.size)})
                {log && ' · '}
              </>
            )}
            {log && (
              <>
                HAR {log.version || '?'}
                {log.creator && ` · ${log.creator}`}
              </>
            )}
          </span>
        )}
      </ToolOptions>
      <ToolErrorMessage error={fileError ?? result.error} />
      {log ? (
        <>
          <HarTable entries={log.entries} selected={selected} onSelect={setSelected} />
          {entry ? (
            <HarDetail entry={entry} />
          ) : (
            log.entries.length > 0 && <p className="text-sm text-fg-muted">{t('har.selectEntry')}</p>
          )}
        </>
      ) : (
        !file && (
          <ToolPane
            label="HAR (JSON)"
            value={input}
            onChange={setInput}
            language="Json"
            placeholder={`{"log": {"version": "1.2", "entries": [...]}}\n\n${t('har.placeholderHint')}`}
          />
        )
      )}
    </div>
  );
}
