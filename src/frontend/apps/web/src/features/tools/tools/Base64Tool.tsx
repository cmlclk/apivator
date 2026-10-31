import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, FileUp, X } from 'lucide-react';
import { Button, Spinner } from '@apivator/ui';
import { base64Decode, base64Encode, sniffMime, utf8Decode, utf8Encode } from '@apivator/core/tools';
import { useT } from '../../../i18n';
import { saveFile } from '../../../lib/download';
import { SwapButton, ToolErrorMessage, ToolOptions, ToolPane, TwoPanes } from '../ToolLayout';
import { formatSize, toolErrorText, toolLabelClass, toolSelectClass } from '../toolUtils';
import { useToolInput } from '../toolsStore';
import { splitDataUri, type BytesJob } from './bytesWorker';
import { useBytesWorker } from './useBytesWorker';

const MIME_LINE_LENGTH = 76;
/** Dosya Worker'da kodlanır; sınır bellek içindir (çıktı girdinin ~1,33 katı). */
const MAX_ENCODE_MB = 100;
/** 100 MB'lık dosyanın Base64 metni satır sonlarıyla birlikte ~137 MB tutar. */
const MAX_DECODE_MB = 140;
/** Bundan büyük çıktı editöre yazılmaz (arayüzü kilitler); yalnızca indirilebilir. */
const MAX_DISPLAY_BYTES = 5 * 1024 * 1024;

/** Uzantı önerisi: indirilen dosyaya verilecek ad. */
const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/x-icon': 'ico',
  'image/svg+xml': 'svg',
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'application/gzip': 'gz',
};

interface DecodeResult {
  text: string;
  /** Metin olarak gösterilemeyen veri. */
  binary: { bytes: Uint8Array; mime: string | null } | null;
  /** Editörde gösterilemeyecek kadar büyük Base64 çıktısı (ASCII bayt); yalnızca indirilir. */
  largeText?: Uint8Array | null;
  error: string | null;
}

const EMPTY: DecodeResult = { text: '', binary: null, error: null };

/** Yazdırılamayan kontrol karakteri içeriyorsa metin sayılmaz. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/;

/** Çözülen baytları metin ya da ikili veri olarak sınıflandırır. */
function classifyDecoded(bytes: Uint8Array, declaredMime: string | null): DecodeResult {
  const sniffed = sniffMime(bytes);
  const mime = sniffed ?? declaredMime;
  // Bildirilen tip (ör. application/json) metni engellemez; imzası tanınan ikili veri metin sayılmaz.
  // Çok büyük veri editöre yazılmaz; ikili veri gibi indirilir.
  if ((!sniffed || sniffed === 'image/svg+xml') && bytes.length <= MAX_DISPLAY_BYTES) {
    try {
      const decoded = utf8Decode(bytes, true);
      if (!CONTROL_CHARS.test(decoded)) {
        return { text: decoded, binary: mime === 'image/svg+xml' ? { bytes, mime } : null, error: null };
      }
    } catch {
      // İkili veri olarak gösterilir.
    }
  }
  return { text: '', binary: { bytes, mime }, error: null };
}

// data:image/png;base64,... biçimi de kabul edilir.
function decodeInput(input: string): DecodeResult {
  const { body, mime } = splitDataUri(input.trim());
  return classifyDecoded(base64Decode(body), mime);
}

export default function Base64Tool() {
  const t = useT('tools');
  const [input, setInput] = useToolInput('base64', 'input');
  const [direction, setDirection] = useToolInput('base64', 'direction', 'encode');
  const [source, setSource] = useToolInput('base64', 'source', 'text');
  const [urlSafe, setUrlSafe] = useToolInput('base64', 'urlSafe', '');
  const [wrap, setWrap] = useToolInput('base64', 'wrap', '');
  // Dosya yalnızca bu bileşende tutulur; içeriğini Worker okur.
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const decoding = direction === 'decode';
  const fromFile = source === 'file';
  const lineLength = wrap === '1' ? MIME_LINE_LENGTH : 0;
  const maxFileMb = decoding ? MAX_DECODE_MB : MAX_ENCODE_MB;

  const textResult = useMemo<DecodeResult>(() => {
    if (fromFile) return EMPTY;
    try {
      if (decoding) return input.trim() ? decodeInput(input) : EMPTY;
      const bytes = utf8Encode(input);
      return {
        text: bytes.length ? base64Encode(bytes, { urlSafe: urlSafe === '1', lineLength }) : '',
        binary: null,
        error: null,
      };
    } catch (error) {
      return { text: '', binary: null, error: toolErrorText(error) };
    }
  }, [decoding, fromFile, input, urlSafe, lineLength]);

  const job = useMemo<BytesJob | null>(() => {
    if (!fromFile || !file) return null;
    return decoding
      ? { op: 'base64-decode', file }
      : { op: 'base64-encode', file, urlSafe: urlSafe === '1', lineLength };
  }, [fromFile, file, decoding, urlSafe, lineLength]);
  const fileJob = useBytesWorker(job);

  const fileResult = useMemo<DecodeResult>(() => {
    const done = fileJob.result;
    if (!done) return EMPTY;
    if (done.type === 'error') return { ...EMPTY, error: done.error };
    if (done.type === 'base64-encode') {
      if (done.ascii.length > MAX_DISPLAY_BYTES) return { ...EMPTY, largeText: done.ascii };
      return { ...EMPTY, text: utf8Decode(done.ascii) };
    }
    if (done.type === 'base64-decode') return classifyDecoded(done.bytes, done.declaredMime);
    return EMPTY;
  }, [fileJob.result]);

  const result = fromFile ? fileResult : textResult;
  const binary = result.binary;
  const previewUrl = useObjectUrl(binary?.mime?.startsWith('image/') ? binary : null);
  const fileBusy = fromFile && fileJob.status === 'busy';
  const fileCancelled = fromFile && fileJob.status === 'cancelled';

  const loadFile = (picked: File) => {
    setFileError(null);
    if (picked.size > maxFileMb * 1024 * 1024) {
      setFileError(
        t(decoding ? 'base64.fileTooLargeDecode' : 'base64.fileTooLargeEncode', { max: maxFileMb }),
      );
      return;
    }
    setFile(picked);
  };

  // Seçili dosya bir yön içindir (kodlanacak dosya ≠ Base64 metni).
  const changeDirection = (next: string) => {
    setDirection(next);
    setFile(null);
    setFileError(null);
  };

  const swap = () => {
    if (!result.text) return;
    setInput(result.text);
    if (fromFile) setSource('text');
    changeDirection(decoding ? 'encode' : 'decode');
  };

  const downloadBinary = () => {
    if (!binary) return;
    const ext = (binary.mime && EXTENSIONS[binary.mime]) ?? 'bin';
    void saveFile({
      blob: new Blob([binary.bytes as BlobPart], { type: binary.mime ?? 'application/octet-stream' }),
      fileName: `cozulmus.${ext}`,
    });
  };

  const downloadLargeText = () => {
    if (!result.largeText) return;
    void saveFile({
      blob: new Blob([result.largeText as BlobPart], { type: 'text/plain' }),
      fileName: 'base64.txt',
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <ToolOptions>
        <label className={toolLabelClass}>
          {t('codec.operation')}
          <select
            className={toolSelectClass}
            value={direction}
            onChange={(e) => changeDirection(e.target.value)}
          >
            <option value="encode">{t('codec.encode')}</option>
            <option value="decode">{t('codec.decode')}</option>
          </select>
        </label>
        <label className={toolLabelClass}>
          {t('base64.source')}
          <select className={toolSelectClass} value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="text">
              {t(decoding ? 'base64.sourceTextDecode' : 'base64.sourceTextEncode')}
            </option>
            <option value="file">
              {t(decoding ? 'base64.sourceFileDecode' : 'base64.sourceFileEncode')}
            </option>
          </select>
        </label>
        {!decoding && (
          <>
            <label className={toolLabelClass}>
              <input
                type="checkbox"
                checked={urlSafe === '1'}
                onChange={(e) => setUrlSafe(e.target.checked ? '1' : '')}
              />
              {t('base64.urlSafe')}
            </label>
            <label className={toolLabelClass}>
              <input
                type="checkbox"
                checked={wrap === '1'}
                onChange={(e) => setWrap(e.target.checked ? '1' : '')}
              />
              {t('base64.wrap', { length: MIME_LINE_LENGTH })}
            </label>
          </>
        )}
        <SwapButton onClick={swap} />
      </ToolOptions>
      <ToolErrorMessage error={result.error ?? fileError} />
      <TwoPanes>
        {fromFile ? (
          <section className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-3 rounded-md border border-dashed border-line p-4 text-center">
            <input
              ref={fileInput}
              type="file"
              className="hidden"
              aria-label={t(decoding ? 'base64.fileLabelDecode' : 'base64.fileLabelEncode')}
              onChange={(e) => {
                const picked = e.target.files?.[0];
                e.target.value = '';
                if (picked) loadFile(picked);
              }}
            />
            {file ? (
              <p className="text-sm text-fg">
                <span className="font-medium">{file.name}</span>{' '}
                <span className="text-fg-muted">
                  ({formatSize(file.size)}
                  {file.type ? `, ${file.type}` : ''})
                </span>
              </p>
            ) : (
              <p className="text-sm text-fg-muted">
                {t(decoding ? 'base64.pickDecode' : 'base64.pickEncode', { max: maxFileMb })}
              </p>
            )}
            <Button size="sm" variant="secondary" onClick={() => fileInput.current?.click()}>
              <FileUp className="h-3.5 w-3.5" /> {file ? t('base64.pickOtherFile') : t('base64.pickFile')}
            </Button>
          </section>
        ) : (
          <ToolPane
            label={decoding ? 'Base64' : t('codec.text')}
            value={input}
            onChange={setInput}
            placeholder={decoding ? t('base64.placeholderDecode') : t('base64.placeholderEncode')}
            fileAccept=""
          />
        )}
        {fileBusy || fileCancelled ? (
          <section
            role="status"
            className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-3 rounded-md border border-line p-4 text-sm text-fg-muted"
          >
            {fileBusy ? (
              <>
                <p className="flex items-center gap-2">
                  <Spinner className="h-3.5 w-3.5" /> {decoding ? t('base64.decoding') : t('base64.encoding')}
                </p>
                <Button size="sm" variant="secondary" onClick={fileJob.cancel}>
                  <X className="h-3.5 w-3.5" /> {t('base64.cancel')}
                </Button>
              </>
            ) : (
              <>
                <p>{t('base64.cancelled')}</p>
                <Button size="sm" variant="secondary" onClick={fileJob.retry}>
                  {t('base64.retry')}
                </Button>
              </>
            )}
          </section>
        ) : result.largeText ? (
          <section className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-3 rounded-md border border-line p-4 text-center">
            <p className="text-sm text-fg-muted">
              {t('base64.largeOutput', {
                size: formatSize(result.largeText.length),
                max: formatSize(MAX_DISPLAY_BYTES),
              })}
            </p>
            <Button size="sm" variant="secondary" onClick={downloadLargeText}>
              <Download className="h-3.5 w-3.5" /> {t('base64.downloadTxt')}
            </Button>
          </section>
        ) : binary && !result.text ? (
          <section className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-3 overflow-auto rounded-md border border-line p-4">
            {previewUrl && (
              <img
                src={previewUrl}
                alt={t('base64.decodedImage')}
                className="max-h-80 max-w-full object-contain"
              />
            )}
            <p className="text-sm text-fg-muted">
              {t(previewUrl ? 'base64.imageInfo' : 'base64.binaryInfo', {
                info: `${formatSize(binary.bytes.length)}${binary.mime ? `, ${binary.mime}` : ''}`,
              })}
            </p>
            <Button size="sm" variant="secondary" onClick={downloadBinary}>
              <Download className="h-3.5 w-3.5" /> {t('codec.downloadAsFile')}
            </Button>
          </section>
        ) : (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
            <ToolPane
              label={decoding ? t('codec.decodedText') : 'Base64'}
              value={result.text}
              output
              downloadName={decoding ? 'cozulmus.txt' : 'base64.txt'}
            />
            {previewUrl && (
              <img
                src={previewUrl}
                alt={t('base64.decodedImage')}
                className="max-h-40 self-start object-contain"
              />
            )}
          </div>
        )}
      </TwoPanes>
    </div>
  );
}

/** Önizleme için geçici adres üretir; veri değişince ya da bileşen kapanınca serbest bırakır. */
function useObjectUrl(data: { bytes: Uint8Array; mime: string | null } | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!data) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(new Blob([data.bytes as BlobPart], { type: data.mime ?? undefined }));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [data]);
  return url;
}
