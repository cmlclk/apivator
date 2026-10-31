import { useMemo } from 'react';
import { urlDecode, urlEncode, type UrlMode } from '@apivator/core/tools';
import { useT } from '../../../i18n';
import { SwapButton, ToolErrorMessage, ToolOptions, ToolPane, TwoPanes } from '../ToolLayout';
import { toolErrorText, toolLabelClass, toolSelectClass } from '../toolUtils';
import { useToolInput } from '../toolsStore';

type Direction = 'encode' | 'decode';

export default function UrlTool() {
  const t = useT('tools');
  const [input, setInput] = useToolInput('url', 'input');
  const [direction, setDirection] = useToolInput('url', 'direction', 'encode');
  const [mode, setMode] = useToolInput('url', 'mode', 'component');

  const result = useMemo(() => {
    if (!input) return { output: '', error: null };
    try {
      const output =
        direction === 'decode' ? urlDecode(input, mode as UrlMode) : urlEncode(input, mode as UrlMode);
      return { output, error: null };
    } catch (error) {
      return { output: '', error: toolErrorText(error) };
    }
  }, [input, direction, mode]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <ToolOptions>
        <label className={toolLabelClass}>
          {t('codec.operation')}
          <select
            className={toolSelectClass}
            value={direction}
            onChange={(e) => setDirection(e.target.value as Direction)}
          >
            <option value="encode">{t('codec.encode')}</option>
            <option value="decode">{t('codec.decode')}</option>
          </select>
        </label>
        <label className={toolLabelClass}>
          {t('url.scope')}
          <select className={toolSelectClass} value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="component">{t('url.component')}</option>
            <option value="full">{t('url.full')}</option>
          </select>
        </label>
        <SwapButton
          onClick={() => {
            setInput(result.output);
            setDirection(direction === 'decode' ? 'encode' : 'decode');
          }}
        />
      </ToolOptions>
      <ToolErrorMessage error={result.error} />
      <TwoPanes>
        <ToolPane
          label={direction === 'decode' ? t('codec.encodedText') : t('codec.text')}
          value={input}
          onChange={setInput}
          placeholder={
            direction === 'decode' ? 'https%3A%2F%2Fornek.com%2F%3Fq%3D%C3%A7' : 'https://ornek.com/?q=ç'
          }
          fileAccept=""
        />
        <ToolPane
          label={direction === 'decode' ? t('codec.decodedText') : t('codec.encodedText')}
          value={result.output}
          output
          downloadName={direction === 'decode' ? 'cozulmus.txt' : 'kodlanmis.txt'}
        />
      </TwoPanes>
    </div>
  );
}
