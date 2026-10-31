import { useDeferredValue, useMemo } from 'react';
import { Alert } from '@apivator/ui';
import {
  binaryToBytes,
  bytesToBinary,
  bytesToHex,
  decodeBytes,
  encodeText,
  findSuspiciousChars,
  formatCodePoint,
  hexToBytes,
  hexdump,
  hexdumpToBytes,
  type ByteEncoding,
} from '@apivator/core/tools';
import { useT } from '../../../i18n';
import { CodecSelect } from '../CodecTool';
import { SwapButton, ToolErrorMessage, ToolOptions, ToolPane, TwoPanes } from '../ToolLayout';
import { toolErrorText, toolLabelClass, toolSelectClass } from '../toolUtils';
import { useToolInput } from '../toolsStore';
import { CharTable } from './byteViewTable';

const ID = 'byte-view';
/** Görünüme dökülen en fazla bayt; daha büyüğü editörü yavaşlatır. */
export const BYTE_VIEW_LIMIT = 64 * 1024;

type View = 'hexdump' | 'hex' | 'binary';

const ENCODINGS: [ByteEncoding, string][] = [
  ['utf-8', 'UTF-8'],
  ['utf-16le', 'UTF-16LE'],
  ['utf-16be', 'UTF-16BE'],
  ['latin1', 'Latin-1 (ISO-8859-1)'],
];

function render(bytes: Uint8Array, view: View): string {
  if (view === 'hexdump') return hexdump(bytes);
  if (view === 'binary') return bytesToBinary(bytes);
  return bytesToHex(bytes, { separator: 'space' });
}

function parse(text: string, view: View): Uint8Array {
  if (view === 'hexdump') return hexdumpToBytes(text);
  if (view === 'binary') return binaryToBytes(text);
  return hexToBytes(text);
}

interface Result {
  output: string;
  /** Karakter dökümü yapılacak metin (kodlamada girdi, çözmede çıktı). */
  plain: string;
  byteCount: number;
  unmappable: number;
  error: string | null;
}

export default function ByteViewTool() {
  const t = useT('toolsMisc');
  const [input, setInput] = useToolInput(ID, 'input');
  const [direction, setDirection] = useToolInput(ID, 'direction', 'encode');
  const [encoding, setEncoding] = useToolInput(ID, 'encoding', 'utf-8');
  const [view, setView] = useToolInput(ID, 'view', 'hexdump');
  const decoding = direction === 'decode';
  const deferredInput = useDeferredValue(input);

  const result = useMemo((): Result => {
    const empty = { output: '', plain: '', byteCount: 0, unmappable: 0, error: null };
    if (!deferredInput) return empty;
    try {
      if (decoding) {
        const bytes = parse(deferredInput, view as View);
        const plain = decodeBytes(bytes, encoding as ByteEncoding);
        return { ...empty, output: plain, plain, byteCount: bytes.length };
      }
      const { bytes, unmappable } = encodeText(deferredInput, encoding as ByteEncoding);
      const output = render(bytes.subarray(0, BYTE_VIEW_LIMIT), view as View);
      return { output, plain: deferredInput, byteCount: bytes.length, unmappable, error: null };
    } catch (caught) {
      return { ...empty, error: toolErrorText(caught) };
    }
  }, [deferredInput, decoding, encoding, view]);
  const suspicious = useMemo(() => findSuspiciousChars(result.plain), [result.plain]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <ToolOptions>
        <label className={toolLabelClass}>
          {t('byteView.operation')}
          <select
            className={toolSelectClass}
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
          >
            <option value="encode">{t('byteView.textToBytes')}</option>
            <option value="decode">{t('byteView.bytesToText')}</option>
          </select>
        </label>
        <CodecSelect
          label={t('byteView.encoding')}
          value={encoding}
          onChange={setEncoding}
          choices={ENCODINGS}
        />
        <CodecSelect
          label={decoding ? t('byteView.inputFormat') : t('byteView.view')}
          value={view}
          onChange={setView}
          choices={[
            ['hexdump', t('byteView.hexdump')],
            ['hex', 'Hex'],
            ['binary', t('byteView.binary')],
          ]}
        />
        <SwapButton
          onClick={() => {
            // Kesilmiş döküm geri çevrilirse metin eksik kalırdı.
            if (result.error || (!decoding && result.byteCount > BYTE_VIEW_LIMIT)) return;
            setInput(result.output);
            setDirection(decoding ? 'encode' : 'decode');
          }}
        />
        {result.byteCount > 0 && (
          <span className="text-xs text-fg-muted">{t('shared.bytes', { n: result.byteCount })}</span>
        )}
      </ToolOptions>
      <ToolErrorMessage error={result.error} />
      {!decoding && result.byteCount > BYTE_VIEW_LIMIT && (
        <Alert tone="info">
          {t('byteView.truncated', { kb: BYTE_VIEW_LIMIT / 1024, count: result.byteCount })}
        </Alert>
      )}
      {result.unmappable > 0 && (
        <Alert tone="warning">{t('byteView.unmappable', { count: result.unmappable })}</Alert>
      )}
      {suspicious.length > 0 && (
        <Alert tone="warning">
          <span className="font-semibold">{t('byteView.suspicious')} </span>
          {suspicious.map((s, i) => (
            <span key={s.codePoint}>
              {i > 0 && ', '}
              {t.rich(
                'byteView.suspiciousItem',
                { mono: (c) => <span className="font-mono">{c}</span> },
                {
                  codePoint: formatCodePoint(s.codePoint),
                  name: s.name,
                  count: String(s.count),
                  line: String(s.line),
                  column: String(s.column),
                },
              )}
            </span>
          ))}
        </Alert>
      )}
      <TwoPanes>
        <ToolPane
          label={decoding ? t('byteView.bytes') : t('byteView.text')}
          value={input}
          onChange={setInput}
          placeholder={decoding ? t('byteView.placeholderBytes') : t('byteView.placeholderText')}
          fileAccept=""
        />
        <ToolPane
          label={decoding ? t('byteView.text') : t('byteView.bytes')}
          value={result.output}
          output
          downloadName={decoding ? t('byteView.downloadText') : t('byteView.downloadBytes')}
        />
      </TwoPanes>
      {result.plain && <CharTable text={result.plain} encoding={encoding as ByteEncoding} />}
    </div>
  );
}
