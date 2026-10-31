import { useContext, useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { json } from '@codemirror/lang-json';
import { xml } from '@codemirror/lang-xml';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { githubDark, githubLight } from '@uiw/codemirror-theme-github';
import type { RawLanguage } from '@apivator/core';
import { useIsDark } from '../../components/useIsDark';
import { CollabSessionContext } from '../collab/CollabContext';
import { collabCursors, minimalExternalChange } from '../collab/cmCollab';

const baseTheme = EditorView.theme({
  '&': { fontSize: '12.5px', height: '100%', backgroundColor: 'transparent' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.55' },
  '.cm-gutters': { backgroundColor: 'transparent', borderRight: '1px solid var(--app-line)' },
  '&.cm-focused': { outline: 'none' },
});

function languageExtension(language: RawLanguage | 'none') {
  switch (language) {
    case 'Json':
      return [json()];
    case 'Xml':
      return [xml()];
    case 'Html':
      return [html()];
    case 'JavaScript':
      return [javascript()];
    default:
      return [];
  }
}

export function CodeEditor({
  value,
  onChange,
  language,
  readOnly = false,
  label,
  placeholder,
  onReady,
  extensions: extra,
  collabField,
}: {
  /** Ortak düzenlemede bu editörün bağlı olduğu alanın yolu (ör. "body.raw"): diğer kişilerin imleci çizilir. */
  collabField?: string;
  onReady?: (view: EditorView) => void;
  /** Ek CodeMirror eklentileri (ör. otomatik tamamlama). Kararlı bir dizi verilmeli. */
  extensions?: Extension[];
  value: string;
  onChange?: (value: string) => void;
  language: RawLanguage | 'none';
  readOnly?: boolean;
  label: string;
  placeholder?: string;
}) {
  const dark = useIsDark();
  const session = useContext(CollabSessionContext);
  const extensions = useMemo(
    () => [
      baseTheme,
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ 'aria-label': label }),
      ...languageExtension(language),
      minimalExternalChange,
      ...(session && collabField ? [collabCursors(session, collabField)] : []),
      ...(extra ?? []),
    ],
    [language, label, extra, session, collabField],
  );

  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      readOnly={readOnly}
      editable={!readOnly}
      theme={dark ? githubDark : githubLight}
      extensions={extensions}
      placeholder={placeholder}
      onCreateEditor={onReady}
      height="100%"
      className="h-full min-h-0 overflow-hidden"
      basicSetup={{ foldGutter: true, highlightActiveLine: !readOnly, highlightActiveLineGutter: !readOnly }}
    />
  );
}
