import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button, Input } from '@apivator/ui';
import { LOREM_MAX_COUNT, generateLorem, type LoremUnit } from '@apivator/core/tools';
import { useT } from '../../../i18n';
import { ToolErrorMessage, ToolOptions, ToolPane } from '../ToolLayout';
import { toolErrorText, toolLabelClass, toolSelectClass } from '../toolUtils';
import { useToolInput } from '../toolsStore';

const UNITS: LoremUnit[] = ['paragraphs', 'sentences', 'words'];

export default function LoremTool() {
  const t = useT('toolsSecurity');
  const [unitText, setUnit] = useToolInput('lorem', 'unit', 'paragraphs');
  const [countText, setCountText] = useToolInput('lorem', 'count', '3');
  const [language, setLanguage] = useToolInput('lorem', 'language', 'latin');
  const [classic, setClassic] = useToolInput('lorem', 'classic', '1');
  const [html, setHtml] = useToolInput('lorem', 'html', '');
  const [seedText, setSeedText] = useToolInput('lorem', 'seed', '');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const unit: LoremUnit = UNITS.some((u) => u === unitText) ? (unitText as LoremUnit) : 'paragraphs';
  const max = LOREM_MAX_COUNT[unit];
  const n = Math.floor(Number(countText));
  const count = Number.isFinite(n) ? Math.min(max, Math.max(1, n)) : 1;
  const seed = seedText.trim() === '' ? undefined : Math.floor(Number(seedText));

  const regenerate = () => {
    try {
      if (seed !== undefined && !Number.isSafeInteger(seed)) throw new Error(t('lorem.seedInvalid'));
      setText(
        generateLorem({
          unit,
          count,
          language: language === 'tr' ? 'tr' : 'latin',
          classicStart: classic === '1',
          html: html === '1',
          seed,
        }),
      );
      setError(null);
    } catch (e) {
      setText('');
      setError(toolErrorText(e));
    }
  };

  // Seçenek değişince yeniden üretilir.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(regenerate, [unit, count, language, classic, html, seedText]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <ToolOptions>
        <label className={toolLabelClass}>
          {t('lorem.count')}
          <Input
            type="number"
            min={1}
            max={max}
            className="h-7 w-20 text-xs"
            value={countText}
            onChange={(e) => setCountText(e.target.value)}
            onBlur={() => setCountText(String(count))}
            aria-label={t('lorem.count')}
          />
        </label>
        <label className={toolLabelClass}>
          {t('lorem.unit')}
          <select className={toolSelectClass} value={unit} onChange={(e) => setUnit(e.target.value)}>
            {UNITS.map((value) => (
              <option key={value} value={value}>
                {t(`lorem.units.${value}`)}
              </option>
            ))}
          </select>
        </label>
        <label className={toolLabelClass}>
          {t('lorem.language')}
          <select className={toolSelectClass} value={language} onChange={(e) => setLanguage(e.target.value)}>
            <option value="latin">{t('lorem.latin')}</option>
            <option value="tr">{t('lorem.turkish')}</option>
          </select>
        </label>
        <label className={toolLabelClass}>
          <input
            type="checkbox"
            checked={classic === '1'}
            onChange={(e) => setClassic(e.target.checked ? '1' : '')}
          />
          {t('lorem.classic')}
        </label>
        <label className={toolLabelClass}>
          <input
            type="checkbox"
            checked={html === '1'}
            onChange={(e) => setHtml(e.target.checked ? '1' : '')}
          />
          {t('lorem.html')}
        </label>
        <label className={toolLabelClass}>
          {t('lorem.seed')}
          <Input
            className="h-7 w-24 text-xs"
            value={seedText}
            onChange={(e) => setSeedText(e.target.value)}
            placeholder={t('lorem.seedPlaceholder')}
            aria-label={t('lorem.seed')}
            inputMode="numeric"
          />
        </label>
        <Button size="sm" onClick={regenerate} disabled={seed !== undefined}>
          <RefreshCw className="h-3.5 w-3.5" /> {t('lorem.regenerate')}
        </Button>
      </ToolOptions>
      <ToolErrorMessage error={error} />
      <ToolPane
        label={t('lorem.text')}
        value={text}
        language={html === '1' ? 'Html' : 'Text'}
        downloadName={html === '1' ? 'lorem.html' : 'lorem.txt'}
        output
      />
      <p className="text-[11px] text-fg-subtle">{t('lorem.note')}</p>
    </div>
  );
}
