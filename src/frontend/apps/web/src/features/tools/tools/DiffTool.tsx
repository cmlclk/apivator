import { useMemo } from 'react';
import { diffJson, type JsonChange } from '@apivator/core/tools';
import { SwapButton, ToolErrorMessage, ToolOptions, ToolPane, TwoPanes } from '../ToolLayout';
import { toolErrorText, toolLabelClass, toolSelectClass } from '../toolUtils';
import { useToolInput } from '../toolsStore';
import { useDebouncedText } from '../jsonToolHooks';
import { parseJsonInput } from '../convert';
import { JsonChangeList, SideBySideDiff, UnifiedDiff } from '../diffView';
import { textDiff } from '../diffText';
import { HistoryResponsePicker } from './historyResponsePicker';
import { useT } from '../../../i18n';

export default function DiffTool() {
  const t = useT('toolsData');
  const [input, setInput] = useToolInput('diff', 'input');
  const [right, setRight] = useToolInput('diff', 'right');
  const [mode, setMode] = useToolInput('diff', 'mode', 'text');
  const [layout, setLayout] = useToolInput('diff', 'layout', 'split');
  const [ignoreWhitespace, setIgnoreWhitespace] = useToolInput('diff', 'ignoreWhitespace', '');
  const [ignoreOrder, setIgnoreOrder] = useToolInput('diff', 'ignoreOrder', '');
  const before = useDebouncedText(input);
  const after = useDebouncedText(right);

  const text = useMemo(
    () => (mode === 'text' && (before || after) ? textDiff(before, after, Boolean(ignoreWhitespace)) : null),
    [mode, before, after, ignoreWhitespace],
  );

  const json = useMemo((): { changes: JsonChange[] | null; error: string | null } => {
    const parseSide = (text: string, side: 'left' | 'right'): unknown => {
      try {
        return parseJsonInput(text);
      } catch (error) {
        throw new Error(t('diff.side', { side: t(`diff.${side}`), message: toolErrorText(error) }));
      }
    };
    if (mode !== 'json' || !before.trim() || !after.trim()) return { changes: null, error: null };
    try {
      const changes = diffJson(parseSide(before, 'left'), parseSide(after, 'right'), {
        ignoreArrayOrder: Boolean(ignoreOrder),
      });
      return { changes, error: null };
    } catch (error) {
      return { changes: null, error: toolErrorText(error) };
    }
  }, [mode, before, after, ignoreOrder, t]);

  const added = text?.filter((l) => l.kind === 'added').length ?? 0;
  const removed = text?.filter((l) => l.kind === 'removed').length ?? 0;
  const count = (kind: JsonChange['kind']) => json.changes?.filter((c) => c.kind === kind).length ?? 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <ToolOptions>
        <label className={toolLabelClass}>
          {t('diff.comparison')}
          <select className={toolSelectClass} value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="text">{t('diff.modeText')}</option>
            <option value="json">{t('diff.modeJson')}</option>
          </select>
        </label>
        {mode === 'text' ? (
          <>
            <label className={toolLabelClass}>
              {t('diff.view')}
              <select className={toolSelectClass} value={layout} onChange={(e) => setLayout(e.target.value)}>
                <option value="split">{t('diff.layoutSplit')}</option>
                <option value="unified">{t('diff.layoutUnified')}</option>
              </select>
            </label>
            <label className={toolLabelClass}>
              <input
                type="checkbox"
                checked={Boolean(ignoreWhitespace)}
                onChange={(e) => setIgnoreWhitespace(e.target.checked ? '1' : '')}
              />
              {t('diff.ignoreWhitespace')}
            </label>
          </>
        ) : (
          <label className={toolLabelClass}>
            <input
              type="checkbox"
              checked={Boolean(ignoreOrder)}
              onChange={(e) => setIgnoreOrder(e.target.checked ? '1' : '')}
            />
            {t('diff.ignoreOrder')}
          </label>
        )}
        <SwapButton
          onClick={() => {
            setInput(right);
            setRight(input);
          }}
        />
        {text && (
          <span className="text-xs text-fg-muted">
            {t.rich(
              'diff.lineSummary',
              {
                add: (c) => <span className="text-success">{c}</span>,
                del: (c) => <span className="text-danger">{c}</span>,
              },
              { added, removed },
            )}
          </span>
        )}
        {json.changes && (
          <span className="text-xs text-fg-muted">
            {json.changes.length === 0
              ? t('diff.noDifference')
              : t('diff.jsonSummary', {
                  added: count('added'),
                  removed: count('removed'),
                  changed: count('changed'),
                })}
          </span>
        )}
      </ToolOptions>
      <ToolErrorMessage error={json.error} />
      <TwoPanes>
        <ToolPane
          label={t('diff.leftOld')}
          value={input}
          onChange={setInput}
          toolbar={<HistoryResponsePicker side="left" onPick={setInput} />}
          language={mode === 'json' ? 'Json' : 'Text'}
          fileAccept=""
          className="max-h-[40vh] lg:max-h-none"
        />
        <ToolPane
          label={t('diff.rightNew')}
          value={right}
          onChange={setRight}
          toolbar={<HistoryResponsePicker side="right" onPick={setRight} />}
          language={mode === 'json' ? 'Json' : 'Text'}
          fileAccept=""
          className="max-h-[40vh] lg:max-h-none"
        />
      </TwoPanes>
      <div className="flex min-h-[30vh] flex-1 flex-col">
        {text &&
          text.length > 0 &&
          (layout === 'unified' ? <UnifiedDiff lines={text} /> : <SideBySideDiff lines={text} />)}
        {json.changes && json.changes.length > 0 && <JsonChangeList changes={json.changes} />}
        {json.changes?.length === 0 && <p className="text-sm text-fg-muted">{t('diff.jsonSame')}</p>}
        {text && added + removed === 0 && text.length > 0 && (
          <p className="pt-1 text-xs text-fg-muted">{t('diff.textSame')}</p>
        )}
      </div>
    </div>
  );
}
