import { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { Button, Input } from '@apivator/ui';
import { useT } from '../../../i18n';
import { saveFile } from '../../../lib/download';
import { ToolErrorMessage, ToolOptions, ToolPane } from '../ToolLayout';
import { toolErrorText, toolLabelClass, toolSelectClass } from '../toolUtils';
import { useToolInput } from '../toolsStore';
import {
  makeQrMatrix,
  qrPathData,
  qrPngBlob,
  qrSvgString,
  safeColor,
  type QrLevel,
  type QrMatrix,
} from './qrCode';

const LEVELS: [QrLevel, number][] = [
  ['L', 7],
  ['M', 15],
  ['Q', 25],
  ['H', 30],
];

function clamp(value: string, min: number, max: number, fallback: number): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

export default function QrTool() {
  const t = useT('toolsSecurity');
  const [input, setInput] = useToolInput('qr', 'input');
  const [levelText, setLevel] = useToolInput('qr', 'level', 'M');
  const [pixelsText, setPixelsText] = useToolInput('qr', 'pixels', '256');
  const [marginText, setMarginText] = useToolInput('qr', 'margin', '4');
  const [foreground, setForeground] = useToolInput('qr', 'foreground', '#000000');
  const [background, setBackground] = useToolInput('qr', 'background', '#ffffff');
  const [saveError, setSaveError] = useState<string | null>(null);

  const level = (LEVELS.some(([l]) => l === levelText) ? levelText : 'M') as QrLevel;
  const style = {
    pixels: clamp(pixelsText, 64, 2048, 256),
    margin: clamp(marginText, 0, 16, 4),
    foreground: safeColor(foreground, '#000000'),
    background: safeColor(background, '#ffffff'),
  };

  const result = useMemo((): { matrix?: QrMatrix; error?: string } => {
    if (!input) return {};
    try {
      return { matrix: makeQrMatrix(input, level) };
    } catch (e) {
      return { error: toolErrorText(e) };
    }
  }, [input, level]);
  const matrix = result.matrix;
  const total = matrix ? matrix.size + style.margin * 2 : 0;

  const downloadSvg = () => {
    if (!matrix) return;
    void saveFile({
      blob: new Blob([qrSvgString(matrix, style)], { type: 'image/svg+xml;charset=utf-8' }),
      fileName: 'qr.svg',
    });
  };
  const downloadPng = async () => {
    if (!matrix) return;
    try {
      setSaveError(null);
      await saveFile({ blob: await qrPngBlob(matrix, style), fileName: 'qr.png' });
    } catch (e) {
      setSaveError(toolErrorText(e));
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <ToolOptions>
        <label className={toolLabelClass}>
          {t('qr.errorCorrection')}
          <select className={toolSelectClass} value={level} onChange={(e) => setLevel(e.target.value)}>
            {LEVELS.map(([value, percent]) => (
              <option key={value} value={value}>
                {t('qr.levelOption', { level: value, percent })}
              </option>
            ))}
          </select>
        </label>
        <label className={toolLabelClass}>
          {t('qr.size')}
          <Input
            type="number"
            min={64}
            max={2048}
            className="h-7 w-20 text-xs"
            value={pixelsText}
            onChange={(e) => setPixelsText(e.target.value)}
            onBlur={() => setPixelsText(String(style.pixels))}
            aria-label={t('qr.size')}
          />
        </label>
        <label className={toolLabelClass}>
          {t('qr.margin')}
          <Input
            type="number"
            min={0}
            max={16}
            className="h-7 w-16 text-xs"
            value={marginText}
            onChange={(e) => setMarginText(e.target.value)}
            onBlur={() => setMarginText(String(style.margin))}
            aria-label={t('qr.marginLabel')}
          />
        </label>
        <label className={toolLabelClass}>
          {t('qr.foreground')}
          <input
            type="color"
            className="h-7 w-9 cursor-pointer rounded border border-line bg-surface"
            value={style.foreground}
            onChange={(e) => setForeground(e.target.value)}
            aria-label={t('qr.foregroundLabel')}
          />
        </label>
        <label className={toolLabelClass}>
          {t('qr.background')}
          <input
            type="color"
            className="h-7 w-9 cursor-pointer rounded border border-line bg-surface"
            value={style.background}
            onChange={(e) => setBackground(e.target.value)}
            aria-label={t('qr.backgroundLabel')}
          />
        </label>
        <Button size="sm" variant="secondary" disabled={!matrix} onClick={downloadSvg}>
          <Download className="h-3.5 w-3.5" /> SVG
        </Button>
        <Button size="sm" variant="secondary" disabled={!matrix} onClick={() => void downloadPng()}>
          <Download className="h-3.5 w-3.5" /> PNG
        </Button>
      </ToolOptions>
      <ToolErrorMessage error={result.error ?? saveError} />
      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
        <ToolPane
          label={t('qr.input')}
          value={input}
          onChange={setInput}
          placeholder={t('qr.inputPlaceholder')}
        />
        <section className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-2 rounded-md border border-line p-3">
          {matrix ? (
            <>
              {/* SVG yalnızca matristen ve doğrulanmış renklerden kurulur; kullanıcı metni işaretlemeye girmez. */}
              <svg
                role="img"
                aria-label={t('qr.svgLabel')}
                width={Math.min(style.pixels, 320)}
                height={Math.min(style.pixels, 320)}
                viewBox={`0 0 ${total} ${total}`}
                shapeRendering="crispEdges"
              >
                <rect width={total} height={total} fill={style.background} />
                <path d={qrPathData(matrix, style.margin)} fill={style.foreground} />
              </svg>
              <p className="text-xs text-fg-muted">
                {t('qr.info', {
                  version: matrix.version,
                  size: matrix.size,
                  bytes: matrix.bytes,
                  level,
                })}
              </p>
            </>
          ) : (
            <p className="text-xs text-fg-subtle">{t('qr.emptyHint')}</p>
          )}
        </section>
      </div>
      <p className="text-[11px] text-fg-subtle">{t('qr.note')}</p>
    </div>
  );
}
