import { useT } from '../../../i18n';
import { ToolPane } from '../ToolLayout';
import { useToolInput } from '../toolsStore';
import { TextStatsPanel } from './TextStatsPanel';

const ID = 'text-stats';

export default function TextStatsTool() {
  const t = useT('toolsMisc');
  const [input, setInput] = useToolInput(ID, 'input');
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
      <ToolPane
        label={t('textStats.text')}
        value={input}
        onChange={setInput}
        placeholder={t('textStats.placeholder')}
        fileAccept=""
      />
      <TextStatsPanel
        text={input}
        className="shrink-0 overflow-auto rounded-md border border-line p-3 lg:w-80"
      />
    </div>
  );
}
