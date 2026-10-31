import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { Button } from '@apivator/ui';
import {
  MAX_DECOMPRESSED_BYTES,
  base64Decode,
  base64Encode,
  bytesToHex,
  compressBytes,
  decompressBytes,
  detectCompressFormat,
  hexToBytes,
  utf8Decode,
  utf8Encode,
  type CompressFormat,
} from '@apivator/core/tools';
import { formatPercent, translate, useT } from '../../../i18n';
import { saveFile } from '../../../lib/download';
import { CodecSelect } from '../CodecTool';
import { SwapButton, ToolErrorMessage, ToolOptions, ToolPane, TwoPanes } from '../ToolLayout';
import { formatSize, toolErrorText, toolLabelClass, toolSelectClass } from '../toolUtils';
import { useToolInput } from '../toolsStore';

const ID = 'compress';
/** Belleğe okunacak en büyük dosya. */
const MAX_FILE_MB = 50;

const EXTENSIONS: Record<CompressFormat, string> = { gzip: 'gz', deflate: 'zz', 'deflate-raw': 'deflate' };

interface LoadedFile {
  name: string;
  bytes: Uint8Array;
}

interface Result {
  /** Çıktı alanındaki metin: sıkıştırmada Base64/hex, açmada UTF-8 metin (ikili veride boş). */
  text: string;
  /** İndirilecek ham çıktı. */
  bytes: Uint8Array | null;
  /** Sıkıştırılmamış ve sıkıştırılmış boyutlar. */
  sizes: { plain: number; packed: number } | null;
  /** Açmada kullanılan biçim (otomatik tanındıysa bilgi için). */
  format: CompressFormat | null;
  error: string | null;
}

const EMPTY: Result = { text: '', bytes: null, sizes: null, format: null, error: null };

/** FileReader her ortamda var (jsdom'daki File'da arrayBuffer() yok). */
function readBytes(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error(translate('tools', 'worker.unreadable')));
    reader.readAsArrayBuffer(file);
  });
}

/** Base64 ya da hex metni bayta çevirir; `auto` yalnızca hex karakterleri varsa hex sayar. */
function decodeInput(text: string, encoding: string): Uint8Array {
  const clean = text.trim();
  const isHex =
    encoding === 'hex' || (encoding === 'auto' && /^(?:[0-9a-fA-F]{2}|[\s:,]|0x|\\x)+$/.test(clean));
  return isHex ? hexToBytes(clean) : base64Decode(clean);
}

async function run(data: Uint8Array, decompress: boolean, format: string, encoding: string): Promise<Result> {
  if (!decompress) {
    const fmt = format === 'auto' ? 'gzip' : (format as CompressFormat);
    const packed = await compressBytes(data, fmt);
    const text = encoding === 'hex' ? bytesToHex(packed) : base64Encode(packed);
    return {
      text,
      bytes: packed,
      sizes: { plain: data.length, packed: packed.length },
      format: fmt,
      error: null,
    };
  }
  const fmt = format === 'auto' ? (detectCompressFormat(data) ?? 'deflate-raw') : (format as CompressFormat);
  const plain = await decompressBytes(data, fmt);
  let text = '';
  try {
    text = utf8Decode(plain, true);
  } catch {
    // İkili veri: yalnızca indirilebilir.
  }
  return {
    text,
    bytes: plain,
    sizes: { plain: plain.length, packed: data.length },
    format: fmt,
    error: null,
  };
}

export default function CompressTool() {
  const t = useT('tools');
  const [input, setInput] = useToolInput(ID, 'input');
  const [direction, setDirection] = useToolInput(ID, 'direction', 'compress');
  const [format, setFormat] = useToolInput(ID, 'format', 'gzip');
  const [encoding, setEncoding] = useToolInput(ID, 'encoding', 'base64');
  // Dosya içeriği yalnızca bellekte tutulur.
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [result, setResult] = useState<Result>(EMPTY);
  const decompress = direction === 'decompress';

  useEffect(() => {
    let cancelled = false;
    const finish = (next: Result) => !cancelled && setResult(next);
    try {
      const data = file ? file.bytes : decompress ? decodeInput(input, encoding) : utf8Encode(input);
      if (!data.length) finish(EMPTY);
      else
        run(data, decompress, format, encoding).then(finish, (error: unknown) =>
          finish({ ...EMPTY, error: toolErrorText(error) }),
        );
    } catch (error) {
      finish({ ...EMPTY, error: toolErrorText(error) });
    }
    return () => {
      cancelled = true;
    };
  }, [input, file, decompress, format, encoding]);

  const loadFile = (picked: File) => {
    setFileError(null);
    if (picked.size > MAX_FILE_MB * 1024 * 1024) {
      setFileError(t('compress.fileTooLarge', { max: MAX_FILE_MB }));
      return;
    }
    readBytes(picked)
      .then((bytes) => setFile({ name: picked.name, bytes }))
      .catch((error: unknown) => setFileError(toolErrorText(error)));
  };

  const swap = () => {
    if (!result.text) return;
    setInput(result.text);
    setFile(null);
    setDirection(decompress ? 'compress' : 'decompress');
  };

  const download = () => {
    if (!result.bytes) return;
    const fileName = decompress
      ? `cozulmus.${result.text ? 'txt' : 'bin'}`
      : `sikistirilmis.${EXTENSIONS[result.format ?? 'gzip']}`;
    void saveFile({ blob: new Blob([result.bytes as BlobPart]), fileName });
  };

  const binaryButton = result.bytes && (
    <Button size="sm" variant="ghost" onClick={download} title={t('compress.downloadRaw')}>
      <Download className="h-3.5 w-3.5" /> {t('compress.downloadBinary')}
    </Button>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <ToolOptions>
        <label className={toolLabelClass}>
          {t('codec.operation')}
          <select
            className={toolSelectClass}
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
          >
            <option value="compress">{t('compress.compress')}</option>
            <option value="decompress">{t('compress.decompress')}</option>
          </select>
        </label>
        <CodecSelect
          label={t('compress.format')}
          value={!decompress && format === 'auto' ? 'gzip' : format}
          onChange={setFormat}
          choices={[
            ...(decompress ? [['auto', t('compress.auto')] as [string, string]] : []),
            ['gzip', 'gzip'],
            ['deflate', 'deflate (zlib)'],
            ['deflate-raw', 'deflate-raw'],
          ]}
        />
        <CodecSelect
          label={decompress ? t('compress.input') : t('compress.output')}
          value={!decompress && encoding === 'auto' ? 'base64' : encoding}
          onChange={setEncoding}
          choices={[
            ...(decompress ? [['auto', t('compress.auto')] as [string, string]] : []),
            ['base64', 'Base64'],
            ['hex', 'Hex'],
          ]}
        />
        <SwapButton onClick={swap} />
      </ToolOptions>
      {result.sizes && (
        <p className="text-xs text-fg-muted" data-testid="compress-stats">
          {t(
            decompress && format === 'auto' && result.format ? 'compress.statsWithFormat' : 'compress.stats',
            {
              plain: formatSize(result.sizes.plain),
              packed: formatSize(result.sizes.packed),
              ratio: result.sizes.plain
                ? formatPercent((result.sizes.packed / result.sizes.plain) * 100)
                : '—',
              format: result.format,
            },
          )}
        </p>
      )}
      <ToolErrorMessage error={result.error ?? fileError} />
      {file && (
        <div className="flex items-center gap-2 text-xs text-fg">
          <span>
            {t.rich(
              'compress.file',
              {
                b: (c) => <span className="font-medium">{c}</span>,
                muted: (c) => <span className="text-fg-muted">{c}</span>,
              },
              { name: file.name, size: formatSize(file.bytes.length) },
            )}
          </span>
          <Button size="sm" variant="ghost" onClick={() => setFile(null)} title={t('compress.removeFile')}>
            <X className="h-3.5 w-3.5" /> {t('compress.remove')}
          </Button>
        </div>
      )}
      <TwoPanes>
        <ToolPane
          label={decompress ? t('compress.packedData') : t('codec.text')}
          value={file ? '' : input}
          onChange={(value) => {
            setFile(null);
            setInput(value);
          }}
          placeholder={
            file
              ? t('compress.usingFile')
              : decompress
                ? t('compress.placeholderDecompress')
                : t('compress.placeholderCompress')
          }
          fileAccept=""
          onLoadFile={loadFile}
        />
        {result.bytes && !result.text ? (
          <section className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-3 rounded-md border border-line p-4">
            <p className="text-sm text-fg-muted">
              {t('compress.binaryData', { size: formatSize(result.bytes.length) })}
            </p>
            <Button size="sm" variant="secondary" onClick={download}>
              <Download className="h-3.5 w-3.5" /> {t('codec.downloadAsFile')}
            </Button>
          </section>
        ) : (
          <ToolPane
            label={decompress ? t('compress.unpackedText') : outputLabel(encoding)}
            value={result.text}
            output
            toolbar={binaryButton}
            downloadName={decompress ? 'cozulmus.txt' : 'sikistirilmis.txt'}
          />
        )}
      </TwoPanes>
      <p className="text-xs text-fg-muted">
        {t('compress.limit', { max: MAX_DECOMPRESSED_BYTES / 1024 / 1024 })}
      </p>
    </div>
  );
}

function outputLabel(encoding: string): string {
  return translate('tools', encoding === 'hex' ? 'compress.packedHex' : 'compress.packedBase64');
}
