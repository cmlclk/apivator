import { useMemo } from 'react';
import { cn } from '@apivator/ui';
import {
  colorPalette,
  colorToHex,
  contrastRatio,
  formatColor,
  parseColor,
  type ContrastResult,
  type Rgba,
} from '@apivator/core/tools';
import { numberFormatter, useT } from '../../../i18n';
import { ToolErrorMessage, ToolOptions } from '../ToolLayout';
import { useToolInput } from '../toolsStore';
import { toolErrorText, toolLabelClass } from '../toolUtils';
import { ResultCard, ValueRow, unitInputClass } from './unitToolParts';

const TOOL = 'color';

const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };
const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 };

/** Saydamlık görünsün diye damalı zemin. */
const CHECKER = 'repeating-conic-gradient(#d4d4d4 0% 25%, #ffffff 0% 50%) 0 0 / 12px 12px';

function tryParse(text: string): { color: Rgba | null; error: string | null } {
  if (!text.trim()) return { color: null, error: null };
  try {
    return { color: parseColor(text), error: null };
  } catch (e) {
    return { color: null, error: toolErrorText(e) };
  }
}

/** Yalnızca doğrulanmış renkten üretilen `rgb()`/`rgba()` metniyle boyanan kutu. */
function Swatch({ color, className }: { color: Rgba; className?: string }) {
  return (
    <div
      className={cn('overflow-hidden rounded-md border border-line', className)}
      style={{ background: CHECKER }}
    >
      <div className="h-full w-full" style={{ background: formatColor(color).rgb }} />
    </div>
  );
}

function Badge({ ok, label }: { ok: boolean; label: string }) {
  const t = useT('toolsMisc');
  return (
    <span
      className={cn(
        'rounded px-1.5 py-0.5 text-[11px] font-semibold',
        ok ? 'bg-success/15 text-success' : 'bg-danger/10 text-danger',
      )}
      title={ok ? t('color.pass') : t('color.fail')}
    >
      {label} {ok ? '✓' : '✗'}
    </span>
  );
}

function ContrastRow({
  label,
  fg,
  bg,
  result,
}: {
  label: string;
  fg: Rgba;
  bg: Rgba;
  result: ContrastResult;
}) {
  const t = useT('toolsMisc');
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line px-2 py-1.5 last:border-b-0">
      <span className="w-32 shrink-0 text-xs text-fg-muted">{label}</span>
      <span
        className="rounded border border-line px-2 py-0.5 text-sm font-semibold"
        style={{ color: formatColor(fg).rgb, background: formatColor(bg).rgb }}
        aria-hidden="true"
        // eslint-disable-next-line apivator/no-literal-jsx-text -- yazı tipi örnek önizlemesi, çevrilmez
      >
        Aa
      </span>
      <span className="w-16 font-mono text-[12.5px] text-fg">
        {numberFormatter({ minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(result.ratio)}:1
      </span>
      <Badge ok={result.aa} label="AA" />
      <Badge ok={result.aaLarge} label={t('color.aaLarge')} />
      <Badge ok={result.aaa} label="AAA" />
      <Badge ok={result.aaaLarge} label={t('color.aaaLarge')} />
    </div>
  );
}

function PaletteRow({
  label,
  colors,
  onPick,
}: {
  label: string;
  colors: Rgba[];
  onPick: (hex: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5">
      <span className="w-32 shrink-0 text-xs text-fg-muted">{label}</span>
      <div className="flex flex-wrap gap-1">
        {colors.map((c) => {
          const hex = colorToHex(c);
          return (
            <button
              key={hex}
              type="button"
              title={hex}
              aria-label={`${label}: ${hex}`}
              onClick={() => onPick(hex)}
              className="h-7 w-10 rounded border border-line"
              style={{ background: formatColor(c).rgb }}
            />
          );
        })}
      </div>
    </div>
  );
}

export default function ColorTool() {
  const t = useT('toolsMisc');
  const [input, setInput] = useToolInput(TOOL, 'input');
  const [other, setOther] = useToolInput(TOOL, 'other', '#ffffff');
  const [upper, setUpper] = useToolInput(TOOL, 'upper');

  const main = useMemo(() => tryParse(input), [input]);
  const second = useMemo(() => tryParse(other), [other]);
  const color = main.color;
  const formats = color ? formatColor(color, upper === '1') : null;
  const palette = color ? colorPalette(color) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto">
      <ToolOptions>
        <div className="flex min-w-64 flex-1 items-center gap-2">
          <input
            className={unitInputClass}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t('color.placeholder')}
            spellCheck={false}
            aria-label={t('color.color')}
          />
          <input
            type="color"
            className="h-8 w-10 shrink-0 cursor-pointer rounded border border-line bg-surface"
            value={color ? colorToHex({ ...color, a: 1 }) : '#000000'}
            onChange={(e) => setInput(e.target.value)}
            aria-label={t('color.picker')}
            title={t('color.picker')}
          />
        </div>
        <label className={toolLabelClass}>
          <input
            type="checkbox"
            checked={upper === '1'}
            onChange={(e) => setUpper(e.target.checked ? '1' : '')}
          />
          {t('color.upperHex')}
        </label>
      </ToolOptions>
      <ToolErrorMessage error={main.error} />
      {color && formats && palette && (
        <>
          <div className="flex flex-col gap-3 md:flex-row">
            <Swatch color={color} className="h-24 md:h-auto md:w-40" />
            <div className="min-w-0 flex-1">
              <ResultCard>
                <ValueRow label="HEX" value={formats.hex} />
                <ValueRow label="RGB" value={formats.rgb} />
                <ValueRow label="HSL" value={formats.hsl} />
                <ValueRow label="HWB" value={formats.hwb} />
                <ValueRow label="OKLCH" value={formats.oklch} />
                {formats.name && <ValueRow label={t('color.cssName')} value={formats.name} />}
              </ResultCard>
            </div>
          </div>
          <ResultCard title={t('color.contrastTitle')}>
            <ContrastRow
              label={t('color.whiteBg')}
              fg={color}
              bg={WHITE}
              result={contrastRatio(color, WHITE)}
            />
            <ContrastRow
              label={t('color.blackBg')}
              fg={color}
              bg={BLACK}
              result={contrastRatio(color, BLACK)}
            />
            {second.color && (
              <ContrastRow
                label={t('color.secondColor')}
                fg={color}
                bg={second.color}
                result={contrastRatio(color, second.color)}
              />
            )}
          </ResultCard>
          <ToolOptions>
            <label className={toolLabelClass}>
              {t('color.secondColorBg')}
              <input
                className={`${unitInputClass} w-48`}
                value={other}
                onChange={(e) => setOther(e.target.value)}
                spellCheck={false}
              />
            </label>
          </ToolOptions>
          <ToolErrorMessage error={second.error} />
          <ResultCard title={t('color.paletteTitle')}>
            <PaletteRow label={t('color.tints')} colors={palette.tints} onPick={setInput} />
            <PaletteRow label={t('color.shades')} colors={palette.shades} onPick={setInput} />
          </ResultCard>
          <p className="text-xs text-fg-subtle">{t('color.note')}</p>
        </>
      )}
    </div>
  );
}
