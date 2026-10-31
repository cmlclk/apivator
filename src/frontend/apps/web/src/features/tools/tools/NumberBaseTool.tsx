import { useMemo } from 'react';
import { cn } from '@apivator/ui';
import {
  BIT_WIDTHS,
  convertNumberBase,
  formatInteger,
  fromTwosComplement,
  type BitWidth,
  type ThousandsSeparator,
} from '@apivator/core/tools';
import { useT } from '../../../i18n';
import { ToolErrorMessage, ToolOptions } from '../ToolLayout';
import { useToolInput } from '../toolsStore';
import { toolErrorText, toolLabelClass, toolSelectClass } from '../toolUtils';
import { ResultCard, ValueRow, unitInputClass } from './unitToolParts';

const TOOL = 'number-base';

const NAMED_BASES = [2, 8, 10, 16] as const;
const OTHER_BASES = Array.from({ length: 35 }, (_, i) => i + 2).filter(
  (b) => !(NAMED_BASES as readonly number[]).includes(b),
);

const PLACEHOLDERS: Record<number, string> = {
  2: '1010 1111, 0b1010',
  8: '777, 0o17',
  10: '255, -128, 1.000.000, 0xff',
  16: 'ff, DEAD_BEEF, 0x7f',
};

/** Bit görünümü: 8'li gruplar, en anlamlı bit solda; tıklanan bit tersine döner. */
function BitView({
  bits,
  width,
  onToggle,
}: {
  bits: bigint;
  width: number;
  onToggle: (index: number) => void;
}) {
  const t = useT('toolsMisc');
  const bytes = Array.from({ length: width / 8 }, (_, i) => width / 8 - 1 - i);
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={t('numberBase.bits')}>
      {bytes.map((byte) => (
        <div key={byte} className="flex flex-col items-center gap-0.5">
          <div className="flex">
            {Array.from({ length: 8 }, (_, i) => byte * 8 + 7 - i).map((index) => {
              const on = ((bits >> BigInt(index)) & 1n) === 1n;
              return (
                <button
                  key={index}
                  type="button"
                  aria-label={t('numberBase.bit', { index })}
                  aria-pressed={on}
                  title={t('numberBase.bit', { index })}
                  onClick={() => onToggle(index)}
                  className={cn(
                    'h-6 w-5 border border-line font-mono text-[11px] first:rounded-s last:rounded-e',
                    on
                      ? 'bg-accent/15 font-semibold text-accent'
                      : 'bg-surface text-fg-subtle hover:bg-muted',
                  )}
                >
                  {on ? 1 : 0}
                </button>
              );
            })}
          </div>
          <span className="font-mono text-[10px] text-fg-subtle">
            {byte * 8 + 7}–{byte * 8}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function NumberBaseTool() {
  const t = useT('toolsMisc');
  const [input, setInput] = useToolInput(TOOL, 'input');
  const [baseText, setBase] = useToolInput(TOOL, 'base', '10');
  const [widthText, setWidth] = useToolInput(TOOL, 'width');
  const [signedText, setSigned] = useToolInput(TOOL, 'signed', '1');
  const [group, setGroup] = useToolInput(TOOL, 'group');
  const [thousands, setThousands] = useToolInput(TOOL, 'thousands', ',');
  const [customText, setCustom] = useToolInput(TOOL, 'customBase');

  const base = Number(baseText) || 10;
  const width = (BIT_WIDTHS as readonly number[]).includes(Number(widthText))
    ? (Number(widthText) as BitWidth)
    : null;
  const signed = signedText === '1';
  const customBase = Number(customText) || undefined;

  const result = useMemo(() => {
    if (!input.trim()) return { data: null, error: null };
    try {
      const data = convertNumberBase(input, {
        base,
        width,
        signed,
        group: group === '1',
        thousands: thousands as ThousandsSeparator,
        customBase,
      });
      return { data, error: null };
    } catch (e) {
      return { data: null, error: toolErrorText(e) };
    }
  }, [input, base, width, signed, group, thousands, customBase]);
  const data = result.data;

  /** Biti çevirip girdiyi seçili tabanda yeniden yazar (onlu tabanda işaretli yorum, diğerlerinde bit deseni). */
  function toggleBit(index: number) {
    if (!data) return;
    const flipped = (data.pattern ?? data.value) ^ (1n << BigInt(index));
    const next = width && base === 10 ? fromTwosComplement(flipped, width, signed) : flipped;
    setInput(formatInteger(next, base, { upper: true }));
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto">
      <ToolOptions>
        <div className="min-w-64 flex-1">
          <input
            className={unitInputClass}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={PLACEHOLDERS[base] ?? t('numberBase.number')}
            spellCheck={false}
            aria-label={t('numberBase.number')}
          />
        </div>
        <label className={toolLabelClass}>
          {t('numberBase.inputBase')}
          <select className={toolSelectClass} value={base} onChange={(e) => setBase(e.target.value)}>
            {NAMED_BASES.map((b) => (
              <option key={b} value={b}>
                {t(`numberBase.bases.base${b}`)}
              </option>
            ))}
            {OTHER_BASES.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>
      </ToolOptions>
      <ToolOptions>
        <label className={toolLabelClass}>
          {t('numberBase.bitWidth')}
          <select className={toolSelectClass} value={width ?? ''} onChange={(e) => setWidth(e.target.value)}>
            <option value="">{t('numberBase.free')}</option>
            {BIT_WIDTHS.map((w) => (
              <option key={w} value={w}>
                {t('numberBase.widthBits', { width: w })}
              </option>
            ))}
          </select>
        </label>
        <label className={toolLabelClass}>
          <input
            type="checkbox"
            checked={signed}
            disabled={!width}
            onChange={(e) => setSigned(e.target.checked ? '1' : '')}
          />
          {t('numberBase.signed')}
        </label>
        <label className={toolLabelClass}>
          <input
            type="checkbox"
            checked={group === '1'}
            onChange={(e) => setGroup(e.target.checked ? '1' : '')}
          />
          {t('numberBase.group')}
        </label>
        <label className={toolLabelClass}>
          {t('numberBase.thousands')}
          <select
            className={toolSelectClass}
            value={thousands}
            disabled={group !== '1'}
            onChange={(e) => setThousands(e.target.value)}
          >
            <option value=",">1,000,000</option>
            <option value=".">1.000.000</option>
            <option value=" ">1 000 000</option>
          </select>
        </label>
        <label className={toolLabelClass}>
          {t('numberBase.extraBase')}
          <select className={toolSelectClass} value={customText} onChange={(e) => setCustom(e.target.value)}>
            <option value="">{t('numberBase.none')}</option>
            {OTHER_BASES.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>
      </ToolOptions>
      <ToolErrorMessage error={result.error} />
      {data && (
        <>
          <p className="text-xs text-fg-subtle">
            {t('numberBase.summary', {
              prefix: data.inputBase !== base ? 'yes' : 'no',
              inputBase: data.inputBase,
              bits: data.bitLength,
              mode: width ? (signed ? 'signed' : 'unsigned') : 'free',
              width: width ?? 0,
            })}
          </p>
          <ResultCard>
            <ValueRow label={t('numberBase.bases.base2')} value={data.binary} />
            <ValueRow label={t('numberBase.bases.base8')} value={data.octal} />
            <ValueRow label={t('numberBase.bases.base10')} value={data.decimal} />
            <ValueRow label={t('numberBase.bases.base16')} value={data.hex} />
            {data.custom !== null && (
              <ValueRow label={t('numberBase.customBase', { base: customBase ?? 0 })} value={data.custom} />
            )}
          </ResultCard>
          {data.viewWidth && (
            <ResultCard title={t('numberBase.bitView')}>
              <div className="p-2">
                <BitView bits={data.pattern ?? data.value} width={data.viewWidth} onToggle={toggleBit} />
              </div>
            </ResultCard>
          )}
        </>
      )}
      <p className="text-xs text-fg-subtle">{t('numberBase.note')}</p>
    </div>
  );
}
