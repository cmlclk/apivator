import { useMemo, useRef } from 'react';
import { EditorView } from '@codemirror/view';
import { CheckCircle2 } from 'lucide-react';
import { Alert, Button } from '@apivator/ui';
import { hasPrecisionLoss, parseJsonDetailed, sortKeysDeep } from '@apivator/core/tools';
import { ToolErrorMessage, ToolOptions, ToolPane, TwoPanes } from '../ToolLayout';
import { toolLabelClass, toolSelectClass } from '../toolUtils';
import { useToolInput } from '../toolsStore';
import { useDebouncedText } from '../jsonToolHooks';
import { JsonTree } from '../jsonTree';
import { useT } from '../../../i18n';

const INDENTS: Record<string, number | '\t'> = { '2': 2, '4': 4, tab: '\t', '0': 0 };

export default function JsonFormatTool() {
  const t = useT('toolsData');
  const [input, setInput] = useToolInput('json-format', 'input');
  const [indent, setIndent] = useToolInput('json-format', 'indent', '2');
  const [sortKeys, setSortKeys] = useToolInput('json-format', 'sortKeys', '');
  const [view, setView] = useToolInput('json-format', 'view', 'text');
  const source = useDebouncedText(input);
  const editor = useRef<EditorView | null>(null);

  const result = useMemo(() => {
    if (!source.trim()) return null;
    const parsed = parseJsonDetailed(source);
    if (!parsed.ok) return { parsed, output: '', value: undefined };
    const value = sortKeys ? sortKeysDeep(parsed.value) : parsed.value;
    const space = INDENTS[indent] ?? 2;
    return {
      parsed,
      value,
      output: space === 0 ? JSON.stringify(value) : JSON.stringify(value, null, space),
    };
  }, [source, indent, sortKeys]);
  const precisionLoss = useMemo(
    () => Boolean(result?.parsed.ok) && hasPrecisionLoss(source),
    [result, source],
  );

  const error =
    result && !result.parsed.ok
      ? t('jsonFormat.errorAt', {
          line: result.parsed.line,
          column: result.parsed.column,
          message: result.parsed.message,
        })
      : null;
  const errorLine = result && !result.parsed.ok ? excerpt(source, result.parsed.offset) : null;

  // İmleci hatanın yerine taşır (her tuşta değil, istenince: yazarken imleç kaçmasın).
  const goToError = () => {
    const view = editor.current;
    if (!view || !result || result.parsed.ok) return;
    const pos = Math.min(result.parsed.offset, view.state.doc.length);
    view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
    view.focus();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <ToolOptions>
        <label className={toolLabelClass}>
          {t('jsonFormat.indent')}
          <select className={toolSelectClass} value={indent} onChange={(e) => setIndent(e.target.value)}>
            <option value="2">{t('jsonFormat.indentTwo')}</option>
            <option value="4">{t('jsonFormat.indentFour')}</option>
            <option value="tab">{t('jsonFormat.indentTab')}</option>
            <option value="0">{t('jsonFormat.indentMinify')}</option>
          </select>
        </label>
        <label className={toolLabelClass}>
          <input
            type="checkbox"
            checked={Boolean(sortKeys)}
            onChange={(e) => setSortKeys(e.target.checked ? '1' : '')}
          />
          {t('jsonFormat.sortKeys')}
        </label>
        <label className={toolLabelClass}>
          {t('jsonFormat.view')}
          <select className={toolSelectClass} value={view} onChange={(e) => setView(e.target.value)}>
            <option value="text">{t('jsonFormat.viewText')}</option>
            <option value="tree">{t('jsonFormat.viewTree')}</option>
          </select>
        </label>
        <Button
          size="sm"
          variant="secondary"
          disabled={!result?.output}
          onClick={() => result?.output && setInput(result.output)}
          title={t('jsonFormat.applyTitle')}
        >
          {t('jsonFormat.applyToInput')}
        </Button>
        {result?.parsed.ok && (
          <span className="flex items-center gap-1 text-xs text-success">
            <CheckCircle2 className="h-3.5 w-3.5" /> {t('jsonFormat.valid')}
          </span>
        )}
      </ToolOptions>
      <ToolErrorMessage error={error} />
      {precisionLoss && <Alert tone="warning">{t('jsonFormat.precisionLoss')}</Alert>}
      {errorLine && (
        <div className="flex items-start gap-2">
          <pre className="min-w-0 flex-1 overflow-x-auto rounded-md border border-line bg-surface px-2 py-1 font-mono text-xs">
            {errorLine.text}
            {'\n'}
            <span className="text-danger">{' '.repeat(errorLine.caret)}^</span>
          </pre>
          <Button size="sm" variant="secondary" onClick={goToError} disabled={source !== input}>
            {t('jsonFormat.goToError')}
          </Button>
        </div>
      )}
      <TwoPanes>
        <ToolPane
          label="JSON"
          value={input}
          onChange={setInput}
          language="Json"
          placeholder='{"ad": "Ayşe", "etiketler": ["a", "b"]}'
          fileAccept=".json,application/json,text/plain"
          onEditorReady={(view) => (editor.current = view)}
        />
        {view === 'tree' && result?.parsed.ok ? (
          <section className="flex min-h-0 min-w-0 flex-1 flex-col rounded-md border border-line">
            <header className="flex min-h-9 items-center border-b border-line px-2 py-1">
              <h3 className="text-xs font-semibold text-fg-muted">{t('jsonFormat.viewTree')}</h3>
            </header>
            {/* Seçenek değişince ağaç yeniden açılsın. */}
            <JsonTree key={`${indent}${sortKeys}`} value={result.value} className="min-h-0 flex-1" />
          </section>
        ) : (
          <ToolPane
            label={t('jsonFormat.result')}
            value={result?.output ?? ''}
            output
            language="Json"
            downloadName={indent === '0' ? t('jsonFormat.minifiedFile') : t('jsonFormat.formattedFile')}
          />
        )}
      </TwoPanes>
    </div>
  );
}

/** Hatalı satırın (uzunsa hata çevresinin) metni ve imlecin sütunu. */
function excerpt(text: string, offset: number): { text: string; caret: number } {
  const start = text.lastIndexOf('\n', offset - 1) + 1;
  const endIndex = text.indexOf('\n', offset);
  const line = text.slice(start, endIndex < 0 ? text.length : endIndex).replace(/\t/g, ' ');
  const column = offset - start;
  const from = Math.max(0, column - 60);
  return { text: line.slice(from, from + 120), caret: column - from };
}
