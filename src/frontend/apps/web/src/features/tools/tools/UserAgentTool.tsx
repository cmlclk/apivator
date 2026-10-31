import { useMemo } from 'react';
import { Monitor } from 'lucide-react';
import { Button } from '@apivator/ui';
import { parseUserAgent, uaDeviceLabel, type UaPart, type UserAgentInfo } from '@apivator/core/tools';
import { useT, type TFunction } from '../../../i18n';
import { ToolErrorMessage, ToolOptions } from '../ToolLayout';
import { useToolInput } from '../toolsStore';
import { toolErrorText } from '../toolUtils';
import { ResultCard, ValueRow, unitInputClass } from './unitToolParts';
import { NoteList } from './netToolParts';

const TOOL = 'user-agent';
const partText = (t: TFunction<'toolsMisc'>, part: UaPart | null) =>
  part ? [part.name, part.version].filter(Boolean).join(' ') : t('userAgent.unrecognized');

export default function UserAgentTool() {
  const t = useT('toolsMisc');
  const [input, setInput] = useToolInput(TOOL, 'input');

  const result = useMemo((): { info: UserAgentInfo | null; error: string | null } => {
    if (!input.trim()) return { info: null, error: null };
    try {
      return { info: parseUserAgent(input), error: null };
    } catch (e) {
      return { info: null, error: toolErrorText(e) };
    }
  }, [input]);
  const info = result.info;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
      <ToolOptions>
        <div className="min-w-64 flex-1">
          <textarea
            className={`${unitInputClass} h-16 resize-y py-1`}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            // eslint-disable-next-line apivator/no-literal-jsx-text -- örnek User-Agent dizesi
            placeholder="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
            spellCheck={false}
            aria-label="User-Agent"
          />
        </div>
        <Button size="sm" variant="secondary" onClick={() => setInput(navigator.userAgent)}>
          <Monitor className="h-3.5 w-3.5" /> {t('userAgent.thisBrowser')}
        </Button>
      </ToolOptions>
      <ToolErrorMessage error={result.error} />
      {info && (
        <>
          <ResultCard title={t('userAgent.result')}>
            {info.bot && (
              <ValueRow
                label={t('userAgent.bot')}
                value={`${[info.bot.name, info.bot.version].filter(Boolean).join(' ')} · ${t(`userAgent.botKinds.${info.bot.kind}`)}`}
              />
            )}
            {(!info.bot || info.browser) && (
              <ValueRow label={t('userAgent.browser')} value={partText(t, info.browser)} />
            )}
            {info.webView && <ValueRow label={t('userAgent.inApp')} value={info.webView} />}
            {(!info.bot || info.engine) && (
              <ValueRow label={t('userAgent.engine')} value={partText(t, info.engine)} />
            )}
            <ValueRow label={t('userAgent.os')} value={partText(t, info.os)} />
            <ValueRow label={t('userAgent.deviceType')} value={uaDeviceLabel(info.device.type)} />
            {(info.device.vendor || info.device.model) && (
              <ValueRow
                label={t('userAgent.device')}
                value={[info.device.vendor, info.device.model].filter(Boolean).join(' ')}
              />
            )}
          </ResultCard>
          <NoteList notes={info.notes} />
        </>
      )}
      <p className="text-[11px] text-fg-subtle">
        {t.rich('userAgent.note', { code: (c) => <code>{c}</code> })}
      </p>
    </div>
  );
}
