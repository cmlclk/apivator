import { useDeferredValue, useMemo } from 'react';
import { Input } from '@apivator/ui';
import { slugifyLines } from '@apivator/core/tools';
import { useT } from '../../../i18n';
import { CodecCheckbox, CodecSelect } from '../CodecTool';
import { ToolOptions, ToolPane, TwoPanes } from '../ToolLayout';
import { toolLabelClass } from '../toolUtils';
import { useToolInput } from '../toolsStore';

const TOOL = 'slug';

/** Başlıklardan URL dostu slug; her satır ayrı slug olur. */
export default function SlugTool() {
  const t = useT('toolsMisc');
  const [input, setInput] = useToolInput(TOOL, 'input');
  const [separator, setSeparator] = useToolInput(TOOL, 'separator', '-');
  const [lowercase, setLowercase] = useToolInput(TOOL, 'lowercase', '1');
  const [maxText, setMaxText] = useToolInput(TOOL, 'maxLength', '');
  const [stopWords, setStopWords] = useToolInput(TOOL, 'stopWords', '');
  const [locale, setLocale] = useToolInput(TOOL, 'locale', 'tr');

  const max = Math.floor(Number(maxText));
  const maxLength = Number.isFinite(max) && max > 0 ? max : 0;
  // Büyük metinde (5 MB ≈ 200 ms) her tuş vuruşunda yazma gecikmesin.
  const deferredInput = useDeferredValue(input);
  const output = useMemo(
    () =>
      deferredInput
        ? slugifyLines(deferredInput, {
            separator: separator === '_' ? '_' : '-',
            lowercase: lowercase === '1',
            maxLength,
            removeStopWords: stopWords === '1',
            locale: locale === 'en' ? 'en' : 'tr',
          })
        : '',
    [deferredInput, separator, lowercase, maxLength, stopWords, locale],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <ToolOptions>
        <CodecSelect
          label={t('slug.separator')}
          value={separator}
          onChange={setSeparator}
          choices={[
            ['-', t('slug.dash')],
            ['_', t('slug.underscore')],
          ]}
        />
        <CodecCheckbox label={t('slug.lowercase')} value={lowercase} onChange={setLowercase} />
        <label className={toolLabelClass}>
          {t('slug.maxLength')}
          <Input
            type="number"
            min={0}
            className="h-7 w-20 text-xs"
            value={maxText}
            placeholder={t('slug.unlimited')}
            onChange={(e) => setMaxText(e.target.value)}
            aria-label={t('slug.maxLength')}
          />
        </label>
        <CodecCheckbox label={t('slug.removeStopWords')} value={stopWords} onChange={setStopWords} />
        <CodecSelect
          label={t('slug.stopList')}
          value={locale}
          onChange={setLocale}
          choices={[
            ['tr', t('slug.stopTr')],
            ['en', t('slug.stopEn')],
          ]}
        />
      </ToolOptions>
      <TwoPanes>
        <ToolPane
          label={t('slug.text')}
          value={input}
          onChange={setInput}
          placeholder={t('slug.placeholder')}
          fileAccept=""
        />
        <ToolPane label={t('slug.slug')} value={output} output downloadName="slug.txt" />
      </TwoPanes>
    </div>
  );
}
