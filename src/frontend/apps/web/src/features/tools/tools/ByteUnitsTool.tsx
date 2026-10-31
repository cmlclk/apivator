import { useMemo } from 'react';
import {
  BYTE_UNITS,
  convertByteSize,
  formatByteSize,
  parseBandwidth,
  parseByteSize,
  transferTime,
  type ByteUnit,
  type ParsedByteSize,
} from '@apivator/core/tools';
import { useT } from '../../../i18n';
import { ToolErrorMessage, ToolOptions } from '../ToolLayout';
import { useToolInput } from '../toolsStore';
import { toolErrorText, toolLabelClass, toolSelectClass } from '../toolUtils';
import { ResultCard, ValueRow, unitInputClass } from './unitToolParts';

const TOOL = 'byte-units';

const GROUPS: { id: 'byteSi' | 'byteIec' | 'bitSi' | 'bitIec'; units: ByteUnit[] }[] = [
  { id: 'byteSi', units: BYTE_UNITS.filter((u) => u.kind === 'byte' && u.standard !== 'iec') },
  { id: 'byteIec', units: BYTE_UNITS.filter((u) => u.kind === 'byte' && u.standard === 'iec') },
  { id: 'bitSi', units: BYTE_UNITS.filter((u) => u.kind === 'bit' && u.standard !== 'iec') },
  { id: 'bitIec', units: BYTE_UNITS.filter((u) => u.kind === 'bit' && u.standard === 'iec') },
];

export default function ByteUnitsTool() {
  const t = useT('toolsMisc');
  const [input, setInput] = useToolInput(TOOL, 'input');
  const [legacy, setLegacy] = useToolInput(TOOL, 'legacyBinary');
  const [precisionText, setPrecision] = useToolInput(TOOL, 'precision', '4');
  const [separator, setSeparator] = useToolInput(TOOL, 'decimal', ',');
  const [bandwidth, setBandwidth] = useToolInput(TOOL, 'bandwidth', '100 Mbps');

  const precision = Number(precisionText) || 0;
  const decimalSeparator = separator === '.' ? '.' : ',';

  const parsed = useMemo((): { data: ParsedByteSize | null; error: string | null } => {
    if (!input.trim()) return { data: null, error: null };
    try {
      return { data: parseByteSize(input, { legacyBinary: legacy === '1' }), error: null };
    } catch (e) {
      return { data: null, error: toolErrorText(e) };
    }
  }, [input, legacy]);

  const transfer = useMemo(() => {
    if (!parsed.data || !bandwidth.trim()) return { text: null, error: null };
    try {
      return { text: transferTime(parsed.data.quantity, parseBandwidth(bandwidth)).text, error: null };
    } catch (e) {
      return { text: null, error: toolErrorText(e) };
    }
  }, [parsed.data, bandwidth]);

  const quantity = parsed.data?.quantity;
  const options = { precision, decimalSeparator } as const;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto">
      <ToolOptions>
        <div className="min-w-64 flex-1">
          <input
            className={unitInputClass}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t('byteUnits.placeholder')}
            spellCheck={false}
            aria-label={t('byteUnits.size')}
          />
        </div>
        <label className={toolLabelClass}>
          {t('byteUnits.decimals')}
          <select
            className={toolSelectClass}
            value={precision}
            onChange={(e) => setPrecision(e.target.value)}
          >
            {[0, 2, 4, 6, 10].map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label className={toolLabelClass}>
          {t('byteUnits.decimalSeparator')}
          <select
            className={toolSelectClass}
            value={decimalSeparator}
            onChange={(e) => setSeparator(e.target.value)}
          >
            <option value=",">{t('byteUnits.comma')}</option>
            <option value=".">{t('byteUnits.dot')}</option>
          </select>
        </label>
        <label className={toolLabelClass} title={t('byteUnits.legacyHint')}>
          <input
            type="checkbox"
            checked={legacy === '1'}
            onChange={(e) => setLegacy(e.target.checked ? '1' : '')}
          />
          KB/MB/GB = 1024
        </label>
      </ToolOptions>
      <ToolErrorMessage error={parsed.error} />
      {quantity && parsed.data && (
        <>
          <p className="text-xs text-fg-subtle">
            {t('byteUnits.inputUnit', { symbol: parsed.data.unit.symbol })}
          </p>
          <ResultCard title={t('byteUnits.readable')}>
            <ValueRow label="IEC (1024)" value={formatByteSize(quantity, { ...options, standard: 'iec' })} />
            <ValueRow label="SI (1000)" value={formatByteSize(quantity, { ...options, standard: 'si' })} />
            <ValueRow
              label="Bit (SI)"
              value={formatByteSize(quantity, { ...options, standard: 'si', bits: true })}
            />
          </ResultCard>
          <div className="grid gap-3 md:grid-cols-2">
            {GROUPS.map((group) => (
              <ResultCard key={group.id} title={t(`byteUnits.groups.${group.id}`)}>
                {group.units.map((u) => (
                  <ValueRow key={u.symbol} label={u.symbol} value={convertByteSize(quantity, u, options)} />
                ))}
              </ResultCard>
            ))}
          </div>
        </>
      )}
      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold text-fg-muted">{t('byteUnits.transferTime')}</h3>
        <ToolOptions>
          <label className={toolLabelClass}>
            {t('byteUnits.bandwidth')}
            <input
              className={`${unitInputClass} w-40`}
              value={bandwidth}
              onChange={(e) => setBandwidth(e.target.value)}
              // eslint-disable-next-line apivator/no-literal-jsx-text -- ölçü birimi örnekleri
              placeholder="100 Mbps, 12,5 MB/s"
              spellCheck={false}
            />
          </label>
          {transfer.text && (
            <span className="text-sm text-fg">
              ≈ <strong>{transfer.text}</strong>
            </span>
          )}
        </ToolOptions>
        <ToolErrorMessage error={transfer.error} />
        <p className="text-xs text-fg-subtle">{t('byteUnits.transferNote')}</p>
      </section>
    </div>
  );
}
