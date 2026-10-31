import { useEffect, useMemo, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { Button, Input } from '@apivator/ui';
import {
  NANOID_ALPHABET,
  NANOID_DEFAULT_SIZE,
  NANOID_MAX_SIZE,
  formatIdList,
  inspectId,
  monotonicUlidFactory,
  nanoid,
  nanoidCollisionHint,
  ulid,
  uuidV4,
  uuidV7,
  type IdListFormat,
} from '@apivator/core/tools';
import { formatDateTime, formatNumber, translate, useT } from '../../../i18n';
import { saveFile } from '../../../lib/download';
import { ToolErrorMessage, ToolOptions, ToolPane } from '../ToolLayout';
import { toolErrorText, toolLabelClass, toolSelectClass } from '../toolUtils';
import { useToolInput } from '../toolsStore';

const MAX_COUNT = 10000;

function clamp(value: string, min: number, max: number, fallback: number): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

interface GenerateOptions {
  kind: string;
  count: number;
  uppercase: boolean;
  hyphens: boolean;
  monotonic: boolean;
  size: number;
  alphabet: string;
}

function generate({ kind, count, uppercase, hyphens, monotonic, size, alphabet }: GenerateOptions): string[] {
  if (kind === 'nanoid') return Array.from({ length: count }, () => nanoid(size, alphabet));
  if (kind === 'ulid') {
    const next = monotonic ? monotonicUlidFactory() : ulid;
    return Array.from({ length: count }, () => next());
  }
  const list: string[] = [];
  for (let i = 0; i < count; i++) {
    let id = kind === '7' ? uuidV7() : uuidV4();
    if (!hyphens) id = id.replace(/-/g, '');
    list.push(uppercase ? id.toUpperCase() : id);
  }
  // Aynı milisaniyedeki v7'ler rastgele kısma göre karışmasın diye sıralanır.
  return kind === '7' ? list.sort() : list;
}

const KIND_NAMES: Record<string, string> = { '4': 'uuid', '7': 'uuid', ulid: 'ulid', nanoid: 'nanoid' };
const KIND_LABELS: Record<string, string> = { '4': 'UUID', '7': 'UUID', ulid: 'ULID', nanoid: 'nanoid' };

const VERSION_KEYS = [
  'uuid.versions.v0',
  'uuid.versions.v1',
  'uuid.versions.v2',
  'uuid.versions.v3',
  'uuid.versions.v4',
  'uuid.versions.v5',
  'uuid.versions.v6',
  'uuid.versions.v7',
  'uuid.versions.v8',
] as const;

const FORMAT_FILES: Record<IdListFormat, { ext: string; type: string }> = {
  lines: { ext: 'txt', type: 'text/plain' },
  json: { ext: 'json', type: 'application/json' },
  csv: { ext: 'csv', type: 'text/csv' },
};

/** Büyük sayıları okunur yazar: 1.234.567 ya da ≈ 1,6 × 10^18. */
function formatCount(n: number): string {
  if (!Number.isFinite(n)) return translate('toolsSecurity', 'uuid.tooBig');
  if (n < 1e9) return formatNumber(Math.round(n));
  const exp = Math.floor(Math.log10(n));
  return `${formatNumber(n / 10 ** exp, { maximumFractionDigits: 1 })} × 10^${exp}`;
}

export default function UuidTool() {
  const t = useT('toolsSecurity');
  const [input, setInput] = useToolInput('uuid', 'input');
  // Alan adı geriye uyumluluk için `version`: '4' | '7' | 'ulid' | 'nanoid'.
  const [kind, setKind] = useToolInput('uuid', 'version', '4');
  const [countText, setCountText] = useToolInput('uuid', 'count', '10');
  const [uppercase, setUppercase] = useToolInput('uuid', 'uppercase', '');
  const [noHyphens, setNoHyphens] = useToolInput('uuid', 'noHyphens', '');
  const [monotonic, setMonotonic] = useToolInput('uuid', 'monotonic', '1');
  const [sizeText, setSizeText] = useToolInput('uuid', 'nanoidSize', String(NANOID_DEFAULT_SIZE));
  const [alphabet, setAlphabet] = useToolInput('uuid', 'nanoidAlphabet', NANOID_ALPHABET);
  const [format, setFormat] = useToolInput('uuid', 'format', 'lines');
  const [ids, setIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const count = clamp(countText, 1, MAX_COUNT, 1);
  const size = clamp(sizeText, 1, NANOID_MAX_SIZE, NANOID_DEFAULT_SIZE);
  const listFormat = (format in FORMAT_FILES ? format : 'lines') as IdListFormat;
  const regenerate = () => {
    try {
      setIds(
        generate({
          kind,
          count,
          uppercase: uppercase === '1',
          hyphens: noHyphens !== '1',
          monotonic: monotonic === '1',
          size,
          alphabet,
        }),
      );
      setError(null);
    } catch (e) {
      setIds([]);
      setError(toolErrorText(e));
    }
  };

  // Seçenek değişince liste yeniden üretilir.
  useEffect(regenerate, [kind, count, uppercase, noHyphens, monotonic, size, alphabet]);

  const inspected = useMemo(() => (input.trim() ? inspectId(input) : undefined), [input]);
  const text = useMemo(
    () => (ids.length ? formatIdList(ids, listFormat, KIND_NAMES[kind] ?? 'id') : ''),
    [ids, listFormat, kind],
  );
  const hint = kind === 'nanoid' ? nanoidCollisionHint(size, [...alphabet].length) : null;

  const download = () => {
    const { ext, type } = FORMAT_FILES[listFormat];
    void saveFile({
      blob: new Blob([`${text}\n`], { type: `${type};charset=utf-8` }),
      fileName: `${KIND_NAMES[kind] ?? 'id'}.${ext}`,
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <section className="flex flex-col gap-2 rounded-md border border-line p-3">
        <h3 className="text-xs font-semibold text-fg-muted">{t('uuid.inspect')}</h3>
        <Input
          className="h-8 font-mono text-xs"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t('uuid.inspectPlaceholder')}
          aria-label={t('uuid.inspectLabel')}
          spellCheck={false}
        />
        {inspected === null && <p className="text-xs text-danger">{t('uuid.invalid')}</p>}
        {inspected && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <dt className="text-fg-muted">{t('uuid.type')}</dt>
            <dd className="text-fg">
              {inspected.kind === 'ulid'
                ? t('uuid.ulidDescription')
                : t('uuid.uuidVersion', {
                    version: VERSION_KEYS[inspected.version]
                      ? t(VERSION_KEYS[inspected.version]!)
                      : `v${inspected.version}`,
                  })}
            </dd>
            {inspected.time && (
              <>
                <dt className="text-fg-muted">{t('uuid.time')}</dt>
                <dd className="text-fg">
                  {formatDateTime(inspected.time, { dateStyle: 'long', timeStyle: 'medium' })}
                  <span className="text-fg-muted"> · {inspected.time.toISOString()}</span>
                </dd>
              </>
            )}
          </dl>
        )}
      </section>
      <ToolOptions>
        <label className={toolLabelClass}>
          {t('uuid.type')}
          <select className={toolSelectClass} value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="4">{t('uuid.kindV4')}</option>
            <option value="7">{t('uuid.kindV7')}</option>
            <option value="ulid">ULID</option>
            <option value="nanoid">nanoid</option>
          </select>
        </label>
        <label className={toolLabelClass}>
          {t('uuid.count')}
          <Input
            type="number"
            min={1}
            max={MAX_COUNT}
            className="h-7 w-20 text-xs"
            value={countText}
            onChange={(e) => setCountText(e.target.value)}
            onBlur={() => setCountText(String(count))}
            aria-label={t('uuid.count')}
          />
        </label>
        <label className={toolLabelClass}>
          {t('uuid.output')}
          <select className={toolSelectClass} value={listFormat} onChange={(e) => setFormat(e.target.value)}>
            <option value="lines">{t('uuid.formatLines')}</option>
            <option value="json">{t('uuid.formatJson')}</option>
            <option value="csv">{t('uuid.formatCsv')}</option>
          </select>
        </label>
        <Button size="sm" onClick={regenerate}>
          <RefreshCw className="h-3.5 w-3.5" /> {t('uuid.regenerate')}
        </Button>
        <Button size="sm" variant="secondary" disabled={!ids.length} onClick={download}>
          <Download className="h-3.5 w-3.5" /> {t('uuid.download')}
        </Button>
      </ToolOptions>
      <ToolOptions>
        {(kind === '4' || kind === '7') && (
          <>
            <label className={toolLabelClass}>
              <input
                type="checkbox"
                checked={uppercase === '1'}
                onChange={(e) => setUppercase(e.target.checked ? '1' : '')}
              />
              {t('uuid.uppercase')}
            </label>
            <label className={toolLabelClass}>
              <input
                type="checkbox"
                checked={noHyphens === '1'}
                onChange={(e) => setNoHyphens(e.target.checked ? '1' : '')}
              />
              {t('uuid.noHyphens')}
            </label>
          </>
        )}
        {kind === 'ulid' && (
          <label className={toolLabelClass}>
            <input
              type="checkbox"
              checked={monotonic === '1'}
              onChange={(e) => setMonotonic(e.target.checked ? '1' : '')}
            />
            {t('uuid.monotonic')}
          </label>
        )}
        {kind === 'nanoid' && (
          <>
            <label className={toolLabelClass}>
              {t('uuid.length')}
              <Input
                type="number"
                min={1}
                max={NANOID_MAX_SIZE}
                className="h-7 w-16 text-xs"
                value={sizeText}
                onChange={(e) => setSizeText(e.target.value)}
                onBlur={() => setSizeText(String(size))}
                aria-label={t('uuid.length')}
              />
            </label>
            <label className={toolLabelClass}>
              {t('uuid.alphabet')}
              <Input
                className="h-7 w-72 font-mono text-xs"
                value={alphabet}
                onChange={(e) => setAlphabet(e.target.value)}
                aria-label={t('uuid.alphabet')}
                spellCheck={false}
              />
            </label>
            {alphabet !== NANOID_ALPHABET && (
              <Button size="sm" variant="ghost" onClick={() => setAlphabet(NANOID_ALPHABET)}>
                {t('uuid.defaultAlphabet')}
              </Button>
            )}
            {hint && !error && (
              <span className="text-xs text-fg-muted" aria-label={t('uuid.collisionHint')}>
                {t('uuid.collisionText', {
                  bits: formatNumber(Math.floor(hint.bits)),
                  ids: formatCount(hint.idsForOnePercent),
                })}
              </span>
            )}
          </>
        )}
      </ToolOptions>
      <ToolErrorMessage error={error} />
      <ToolPane
        label={t('uuid.generated', { kind: KIND_LABELS[kind] ?? t('uuid.kindFallback'), count: ids.length })}
        value={text}
        output
      />
    </div>
  );
}
