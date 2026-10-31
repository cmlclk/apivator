import { useMemo } from 'react';
import { cn } from '@apivator/ui';
import {
  reindentPython,
  type IndentStyle,
  type LineEnding,
  type PythonIndentIssue,
} from '@apivator/core/tools';
import { ToolOptions, ToolPane, TwoPanes } from '../ToolLayout';
import { toolLabelClass, toolSelectClass } from '../toolUtils';
import { useToolInput } from '../toolsStore';
import { useDebouncedText } from '../jsonToolHooks';
import { SideBySideDiff, UnifiedDiff } from '../diffView';
import { textDiff } from '../diffText';
import { useT } from '../../../i18n';

const TOOL = 'python-indent';

function Check({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className={toolLabelClass}>
      <input
        type="checkbox"
        checked={Boolean(value)}
        onChange={(e) => onChange(e.target.checked ? '1' : '')}
      />
      {label}
    </label>
  );
}

function Select({
  label,
  value,
  onChange,
  choices,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  choices: [string, string][];
}) {
  return (
    <label className={toolLabelClass}>
      {label}
      <select
        aria-label={label}
        className={toolSelectClass}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {choices.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}

const WIDTHS: [string, string][] = [
  ['2', '2'],
  ['4', '4'],
  ['8', '8'],
];

/** Python kaynağının girintisini düzenler: sekme ↔ boşluk, genişlik, karışık girinti uyarıları, boşluklar. */
export default function PythonIndentTool() {
  const t = useT('toolsData');
  const [input, setInput] = useToolInput(TOOL, 'input');
  const [style, setStyle] = useToolInput(TOOL, 'style', 'spaces');
  const [width, setWidth] = useToolInput(TOOL, 'width', '4');
  const [tabSize, setTabSize] = useToolInput(TOOL, 'tabSize', '8');
  const [trim, setTrim] = useToolInput(TOOL, 'trim', '1');
  const [collapse, setCollapse] = useToolInput(TOOL, 'collapse', '1');
  const [lineEnding, setLineEnding] = useToolInput(TOOL, 'lineEnding', 'keep');
  const [layout, setLayout] = useToolInput(TOOL, 'layout', 'split');
  const source = useDebouncedText(input);

  const result = useMemo(
    () =>
      source
        ? reindentPython(source, {
            style: style as IndentStyle,
            width: Number(width),
            tabSize: Number(tabSize),
            trimTrailing: Boolean(trim),
            collapseBlankLines: Boolean(collapse),
            lineEnding: lineEnding as LineEnding,
          })
        : null,
    [source, style, width, tabSize, trim, collapse, lineEnding],
  );
  const output = result?.output ?? '';
  const diff = useMemo(() => (result ? textDiff(source, output, false) : []), [result, source, output]);
  const changed = diff.filter((l) => l.kind === 'added').length;
  const eolOnly = Boolean(result) && changed === 0 && output !== source;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <ToolOptions>
        <Select
          label={t('pythonIndent.indent')}
          value={style}
          onChange={setStyle}
          choices={[
            ['spaces', t('pythonIndent.spaces')],
            ['tabs', t('pythonIndent.tabs')],
          ]}
        />
        {style === 'spaces' && (
          <Select label={t('pythonIndent.width')} value={width} onChange={setWidth} choices={WIDTHS} />
        )}
        <Select label={t('pythonIndent.inputTab')} value={tabSize} onChange={setTabSize} choices={WIDTHS} />
        <Select
          label={t('pythonIndent.lineEnding')}
          value={lineEnding}
          onChange={setLineEnding}
          choices={[
            ['keep', t('pythonIndent.keep')],
            ['lf', 'LF'],
            ['crlf', 'CRLF'],
          ]}
        />
        <Check label={t('pythonIndent.trim')} value={trim} onChange={setTrim} />
        <Check label={t('pythonIndent.collapse')} value={collapse} onChange={setCollapse} />
      </ToolOptions>
      <TwoPanes>
        <ToolPane
          label="Python"
          value={input}
          onChange={setInput}
          fileAccept=".py,.pyw,.pyi,text/x-python,text/plain"
          placeholder={'def selam(ad):\n  if ad:\n\treturn f"Merhaba {ad}"'}
          className="max-h-[40vh] lg:max-h-none"
        />
        <ToolPane
          label={t('pythonIndent.edited')}
          value={output}
          output
          downloadName={t('pythonIndent.fileName')}
          className="max-h-[40vh] lg:max-h-none"
        />
      </TwoPanes>
      {result && (
        <section aria-label={t('pythonIndent.report')} className="flex min-h-[30vh] flex-1 flex-col gap-2">
          <p className="text-xs text-fg-muted">
            {t('pythonIndent.summary', {
              change:
                changed > 0
                  ? t('pythonIndent.linesChanged', { count: changed })
                  : eolOnly
                    ? t('pythonIndent.eolOnly')
                    : t('pythonIndent.noChange'),
              stats: t(result.stats.mixedLines > 0 ? 'pythonIndent.statsMixed' : 'pythonIndent.stats', {
                spaces: result.stats.spaceLines,
                tabs: result.stats.tabLines,
                mixed: result.stats.mixedLines,
              }),
            })}
          </p>
          {result.issues.length > 0 && <IssueList issues={result.issues} />}
          {changed > 0 && (
            <>
              <Select
                label={t('pythonIndent.view')}
                value={layout}
                onChange={setLayout}
                choices={[
                  ['split', t('pythonIndent.split')],
                  ['unified', t('pythonIndent.unified')],
                ]}
              />
              {layout === 'unified' ? <UnifiedDiff lines={diff} /> : <SideBySideDiff lines={diff} />}
            </>
          )}
        </section>
      )}
    </div>
  );
}

function IssueList({ issues }: { issues: PythonIndentIssue[] }) {
  const t = useT('toolsData');
  return (
    <ul
      aria-label={t('pythonIndent.issues')}
      className="max-h-40 divide-y divide-line overflow-auto rounded-md border border-line text-xs"
    >
      {issues.map((issue, index) => (
        <li key={index} className="flex flex-wrap items-baseline gap-x-2 px-2 py-1">
          <span className="w-16 shrink-0 font-mono text-fg">
            {t('pythonIndent.line', { line: issue.line })}
          </span>
          <span className={cn(issue.fixed ? 'text-warning' : 'text-danger')}>{issue.message}</span>
          <span className="text-fg-subtle">
            {issue.fixed ? t('pythonIndent.fixed') : t('pythonIndent.manual')}
          </span>
        </li>
      ))}
    </ul>
  );
}
