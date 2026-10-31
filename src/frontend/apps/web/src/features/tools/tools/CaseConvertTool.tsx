import { useDeferredValue, useMemo } from 'react';
import { Alert } from '@apivator/ui';
import { CASE_STYLES, convertCase, type CaseOptions, type CaseStyle } from '@apivator/core/tools';
import { CopyButton } from '../../../components/ui/CopyButton';
import { useT, type TFunction } from '../../../i18n';
import { CodecCheckbox, CodecSelect } from '../CodecTool';
import { ToolOptions, ToolPane, TwoPanes } from '../ToolLayout';
import { useToolInput } from '../toolsStore';

const TOOL = 'case-convert';
/** "Tüm biçimler" listesi her değişiklikte 14 dönüşüm yapar; büyük metinde yalnızca bu kadarı listelenir. */
export const ALL_STYLES_LIMIT = 20_000;

/** Metnin baş kısmı; mümkünse satır sonunda kesilir. */
function head(text: string): string {
  const cut = text.lastIndexOf('\n', ALL_STYLES_LIMIT);
  return text.slice(0, cut > 0 ? cut : ALL_STYLES_LIMIT);
}

/** Biçim adları kod yazımıdır (camelCase…); yalnızca harf büyüklüğü biçimlerinin adı çevrilir. */
function styleLabel(t: TFunction<'toolsMisc'>, s: (typeof CASE_STYLES)[number]): string {
  return s.id === 'lower' || s.id === 'upper' || s.id === 'toggle'
    ? t(`caseConvert.styles.${s.id}`)
    : s.label;
}

/** Ad dönüşümü: tüm biçimler bir listede (her biri kopyalanabilir) ya da seçilen tek biçim çıktı alanında. */
export default function CaseConvertTool() {
  const t = useT('toolsMisc');
  const [input, setInput] = useToolInput(TOOL, 'input');
  const [mode, setMode] = useToolInput(TOOL, 'mode', 'all');
  const [styleText, setStyle] = useToolInput(TOOL, 'style', 'camel');
  const [locale, setLocale] = useToolInput(TOOL, 'locale', 'tr');
  const [ascii, setAscii] = useToolInput(TOOL, 'ascii', '');
  const [smallWords, setSmallWords] = useToolInput(TOOL, 'smallWords', '1');
  const [perLine, setPerLine] = useToolInput(TOOL, 'perLine', '1');

  const style = CASE_STYLES.find((s) => s.id === styleText)?.id ?? 'camel';
  const caseLocale = locale === 'en' ? 'en' : 'tr';
  const deferredInput = useDeferredValue(input);
  const single = mode === 'single';
  const truncated = !single && deferredInput.length > ALL_STYLES_LIMIT;
  const outputs = useMemo((): Partial<Record<CaseStyle, string>> => {
    const options: CaseOptions = {
      locale: caseLocale,
      ascii: ascii === '1',
      smallWords: smallWords === '1',
      perLine: perLine === '1',
    };
    const text = truncated ? head(deferredInput) : deferredInput;
    const convert = (id: CaseStyle) => (text ? convertCase(text, id, options) : '');
    return single
      ? { [style]: convert(style) }
      : Object.fromEntries(CASE_STYLES.map((s) => [s.id, convert(s.id)]));
  }, [deferredInput, single, truncated, style, caseLocale, ascii, smallWords, perLine]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <ToolOptions>
        <CodecSelect
          label={t('caseConvert.view')}
          value={mode}
          onChange={setMode}
          choices={[
            ['all', t('caseConvert.allStyles')],
            ['single', t('caseConvert.singleStyle')],
          ]}
        />
        {mode === 'single' && (
          <CodecSelect
            label={t('caseConvert.style')}
            value={style}
            onChange={setStyle}
            choices={CASE_STYLES.map((s) => [s.id, styleLabel(t, s)])}
          />
        )}
        <CodecSelect
          label={t('caseConvert.letterRule')}
          value={caseLocale}
          onChange={setLocale}
          choices={[
            ['tr', t('caseConvert.turkish')],
            ['en', t('caseConvert.english')],
          ]}
        />
        <CodecCheckbox label={t('caseConvert.ascii')} value={ascii} onChange={setAscii} />
        <CodecCheckbox label={t('caseConvert.smallWords')} value={smallWords} onChange={setSmallWords} />
        <CodecCheckbox label={t('caseConvert.perLine')} value={perLine} onChange={setPerLine} />
      </ToolOptions>
      {truncated && <Alert tone="info">{t('caseConvert.truncated', { limit: ALL_STYLES_LIMIT })}</Alert>}
      <TwoPanes>
        <ToolPane
          label={t('caseConvert.text')}
          value={input}
          onChange={setInput}
          placeholder={t('caseConvert.placeholder')}
          fileAccept=""
        />
        {single ? (
          <ToolPane
            label={t('caseConvert.output')}
            value={outputs[style] ?? ''}
            output
            downloadName={t('caseConvert.downloadName', { style })}
          />
        ) : (
          <section
            aria-label={t('caseConvert.styles.title')}
            className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto rounded-md border border-line"
          >
            {CASE_STYLES.map((s) => {
              const value = outputs[s.id] ?? '';
              return (
                <div
                  key={s.id}
                  className="flex items-start gap-2 border-b border-line px-2 py-1.5 last:border-b-0"
                >
                  <span className="w-28 shrink-0 pt-0.5 text-xs text-fg-muted">{styleLabel(t, s)}</span>
                  <code
                    data-testid={`case-${s.id}`}
                    className="min-w-0 flex-1 pt-0.5 font-mono text-xs break-all whitespace-pre-wrap text-fg"
                  >
                    {value}
                  </code>
                  <CopyButton text={value} label={t('shared.copyRow', { label: styleLabel(t, s) })} compact />
                </div>
              );
            })}
          </section>
        )}
      </TwoPanes>
    </div>
  );
}
