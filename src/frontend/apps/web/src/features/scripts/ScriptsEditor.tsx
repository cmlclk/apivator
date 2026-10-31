import { useMemo, useRef, useState } from 'react';
import { autocompletion } from '@codemirror/autocomplete';
import type { EditorView } from '@codemirror/view';
import { Code2 } from 'lucide-react';
import type { ScriptSet } from '@apivator/core';
import { cn } from '@apivator/ui';
import { useT } from '../../i18n';
import { SegmentedTabs } from '../../components/ui/SegmentedTabs';
import { CodeEditor } from '../requests/CodeEditor';
import { pmCompletionSource } from './pmCompletions';
import { snippets } from './snippets';

type Phase = 'preRequest' | 'postResponse';

/** Pre-request / post-response script editörü: pm otomatik tamamlama ve hazır parçalar. */
export function ScriptsEditor({
  value,
  onChange,
  readOnly = false,
  hint,
}: {
  value: ScriptSet;
  onChange: (value: ScriptSet) => void;
  readOnly?: boolean;
  /** Script'lerin hangi sırayla çalıştığını anlatan kısa not. */
  hint?: string;
}) {
  const t = useT('scripts');
  const [phase, setPhase] = useState<Phase>(
    value.preRequest.trim() && !value.postResponse.trim() ? 'preRequest' : 'postResponse',
  );
  const view = useRef<EditorView | null>(null);
  const extensions = useMemo(
    () => [autocompletion({ override: [pmCompletionSource], activateOnTyping: true })],
    [],
  );

  const insert = (code: string) => {
    const editor = view.current;
    if (!editor || readOnly) {
      onChange({
        ...value,
        [phase]: value[phase] + (value[phase] && !value[phase].endsWith('\n') ? '\n' : '') + code,
      });
      return;
    }
    const { from, to } = editor.state.selection.main;
    const line = editor.state.doc.lineAt(from);
    const prefix = from === line.from || from === 0 ? '' : '\n';
    editor.dispatch({
      changes: { from, to, insert: prefix + code },
      selection: { anchor: from + prefix.length + code.length },
    });
    editor.focus();
  };

  const visible = snippets.filter((s) => s.phase === 'both' || s.phase === phase);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <SegmentedTabs<Phase>
          label={t('phaseLabel')}
          value={phase}
          onChange={setPhase}
          tabs={[
            { id: 'preRequest', label: 'Pre-request', badge: value.preRequest.trim() ? '●' : null },
            { id: 'postResponse', label: 'Post-response', badge: value.postResponse.trim() ? '●' : null },
          ]}
        />
        {hint && <span className="truncate text-[11px] text-fg-subtle">{hint}</span>}
      </div>
      <div className="flex min-h-24 flex-1 gap-3">
        <div className="min-w-0 flex-1 overflow-hidden rounded-md border border-line bg-surface">
          <CodeEditor
            key={phase}
            value={value[phase]}
            onChange={readOnly ? undefined : (code) => onChange({ ...value, [phase]: code })}
            readOnly={readOnly}
            language="JavaScript"
            label={phase === 'preRequest' ? t('preRequestLabel') : t('postResponseLabel')}
            collabField={`scripts.${phase}`}
            placeholder={t(phase === 'preRequest' ? 'placeholder.preRequest' : 'placeholder.postResponse')}
            extensions={extensions}
            onReady={(v) => (view.current = v)}
          />
        </div>
        {!readOnly && (
          <aside aria-label={t('snippetsTitle')} className="hidden w-52 shrink-0 overflow-y-auto lg:block">
            <p className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold tracking-wide text-fg-subtle uppercase">
              <Code2 className="h-3 w-3" aria-hidden="true" /> {t('snippetsTitle')}
            </p>
            <ul className="space-y-0.5">
              {visible.map((s) => (
                <li key={s.label}>
                  <button
                    type="button"
                    onClick={() => insert(s.code)}
                    className={cn(
                      'w-full rounded px-1.5 py-1 text-start text-[12px] text-accent hover:bg-accent/10 hover:underline',
                    )}
                  >
                    {s.label}
                  </button>
                </li>
              ))}
            </ul>
          </aside>
        )}
      </div>
    </div>
  );
}
