import { useMemo, useRef, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { EditorView } from '@codemirror/view';
import { CheckCircle2 } from 'lucide-react';
import { Alert, Button } from '@apivator/ui';
import type { RawLanguage } from '@apivator/core';
import {
  formatGraphql,
  formatHtml,
  formatXml,
  FormatError,
  minifyGraphql,
  type FormatIndent,
} from '@apivator/core/tools';
import { ToolErrorMessage, ToolOptions, ToolPane, TwoPanes } from '../ToolLayout';
import { toolErrorText, toolLabelClass, toolSelectClass } from '../toolUtils';
import { useToolInput } from '../toolsStore';
import { useDebouncedText } from '../jsonToolHooks';
import { openInTool } from '../openInTool';
import { useT } from '../../../i18n';
import {
  detectCodeLanguage,
  formatSql,
  formatYaml,
  minifySql,
  SQL_DIALECTS,
  type CodeLanguage,
  type SqlDialect,
} from '../codeFormat';

/** Bundan büyük girdi biçimlendirilmez (sekme donmasın). */
const MAX_FORMAT_INPUT = 5 * 1024 * 1024;

type Language = Exclude<CodeLanguage, 'json'>;

interface LanguageDef {
  toolId: string;
  label: string;
  editor: RawLanguage;
  placeholder: string;
  accept: string;
  extension: string;
  /** Küçültme destekleniyor mu (YAML'da yok). */
  minify: boolean;
}

const LANGUAGES: Record<Language, LanguageDef> = {
  xml: {
    toolId: 'xml-format',
    label: 'XML',
    editor: 'Xml',
    placeholder: '<kitap id="1"><ad>Örnek</ad></kitap>',
    accept: '.xml,.xsd,.xsl,.svg,.wsdl,application/xml,text/xml,text/plain',
    extension: 'xml',
    minify: true,
  },
  yaml: {
    toolId: 'yaml-format',
    label: 'YAML',
    editor: 'Text',
    placeholder: 'ad: Ayşe\netiketler: [a, b]',
    accept: '.yaml,.yml,text/yaml,text/plain',
    extension: 'yaml',
    minify: false,
  },
  sql: {
    toolId: 'sql-format',
    label: 'SQL',
    editor: 'Text',
    placeholder: 'select id, ad from kullanicilar where aktif = 1 order by ad',
    accept: '.sql,text/plain',
    extension: 'sql',
    minify: true,
  },
  graphql: {
    toolId: 'graphql-format',
    label: 'GraphQL',
    editor: 'Text',
    placeholder: 'query { kullanici(id: 1) { id ad } }',
    accept: '.graphql,.gql,.graphqls,text/plain',
    extension: 'graphql',
    minify: true,
  },
  html: {
    toolId: 'html-format',
    label: 'HTML',
    editor: 'Html',
    placeholder: '<div><p>Merhaba <b>dünya</b></p></div>',
    accept: '.html,.htm,text/html,text/plain',
    extension: 'html',
    minify: true,
  },
};

const TOOL_FOR: Record<CodeLanguage, { toolId: string; label: string }> = {
  ...LANGUAGES,
  json: { toolId: 'json-format', label: 'JSON' },
};

const INDENTS: Record<string, FormatIndent> = { '2': 2, '4': 4, tab: '\t' };

interface Settings {
  minify: boolean;
  indent: FormatIndent;
  removeComments: boolean;
  dialect: SqlDialect;
  keywordCase: 'upper' | 'lower' | 'preserve';
  lineWidth: number;
  sortKeys: boolean;
}

function run(language: Language, text: string, s: Settings): string {
  switch (language) {
    case 'xml':
      return formatXml(text, { indent: s.indent, minify: s.minify, removeComments: s.removeComments });
    case 'html':
      return formatHtml(text, { indent: s.indent, minify: s.minify, removeComments: s.removeComments });
    case 'graphql':
      return s.minify ? minifyGraphql(text) : formatGraphql(text, { indent: s.indent });
    case 'sql':
      return s.minify
        ? minifySql(text, { removeComments: s.removeComments, dialect: s.dialect })
        : formatSql(text, { dialect: s.dialect, keywordCase: s.keywordCase, indent: s.indent });
    case 'yaml':
      return formatYaml(text, {
        indent: s.indent === '\t' ? 2 : s.indent,
        lineWidth: s.lineWidth,
        sortKeys: s.sortKeys,
      });
  }
}

/** XML, YAML, SQL, GraphQL ve HTML biçimlendiricilerinin ortak kabuğu; her dil ayrı araç kaydıdır. */
function CodeFormatTool({ language }: { language: Language }) {
  const t = useT('toolsData');
  const def = LANGUAGES[language];
  const id = def.toolId;
  const [input, setInput] = useToolInput(id, 'input');
  const [mode, setMode] = useToolInput(id, 'mode', 'format');
  const [indent, setIndent] = useToolInput(id, 'indent', '2');
  const [removeComments, setRemoveComments] = useToolInput(id, 'removeComments', '');
  const [dialect, setDialect] = useToolInput(id, 'dialect', 'sql');
  const [keywordCase, setKeywordCase] = useToolInput(id, 'keywordCase', 'upper');
  const [lineWidth, setLineWidth] = useToolInput(id, 'lineWidth', '80');
  const [sortKeys, setSortKeys] = useToolInput(id, 'sortKeys', '');
  const source = useDebouncedText(input);
  const editor = useRef<EditorView | null>(null);
  const navigate = useNavigate();
  const minify = def.minify && mode === 'minify';

  const result = useMemo(() => {
    if (!source.trim()) return null;
    if (source.length > MAX_FORMAT_INPUT)
      return { output: '', error: t('codeFormat.tooLarge'), offset: null };
    try {
      const output = run(language, source, {
        minify,
        indent: INDENTS[indent] ?? 2,
        removeComments: Boolean(removeComments),
        dialect: (SQL_DIALECTS.some((d) => d.value === dialect) ? dialect : 'sql') as SqlDialect,
        keywordCase: keywordCase as Settings['keywordCase'],
        lineWidth: Number(lineWidth) || 0,
        sortKeys: Boolean(sortKeys),
      });
      return { output, error: null, offset: null };
    } catch (error) {
      return {
        output: '',
        // Çok derin iç içe girdide özyinelemeli yazıcılar yığını aşar; İngilizce motor mesajı yerine açıklama.
        error: error instanceof RangeError ? t('codeFormat.tooDeep') : toolErrorText(error),
        offset: error instanceof FormatError ? error.offset : null,
      };
    }
  }, [language, source, minify, indent, removeComments, dialect, keywordCase, lineWidth, sortKeys, t]);

  const detected = useMemo(() => detectCodeLanguage(source), [source]);
  const suggestion = detected && detected !== language ? TOOL_FOR[detected] : null;
  const errorLine = result?.offset != null ? excerpt(source, result.offset) : null;

  const goToError = () => {
    const view = editor.current;
    if (!view || result?.offset == null) return;
    const pos = Math.min(result.offset, view.state.doc.length);
    view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
    view.focus();
  };

  const options: ReactNode[] = [];
  if (def.minify)
    options.push(
      <label key="mode" className={toolLabelClass}>
        {t('codeFormat.operation')}
        <select className={toolSelectClass} value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="format">{t('codeFormat.format')}</option>
          <option value="minify">{t('codeFormat.minify')}</option>
        </select>
      </label>,
    );
  if (!minify)
    options.push(
      <label key="indent" className={toolLabelClass}>
        {t('codeFormat.indent')}
        <select className={toolSelectClass} value={indent} onChange={(e) => setIndent(e.target.value)}>
          <option value="2">{t('codeFormat.indentTwo')}</option>
          <option value="4">{t('codeFormat.indentFour')}</option>
          {language !== 'yaml' && <option value="tab">{t('codeFormat.indentTab')}</option>}
        </select>
      </label>,
    );
  if (language === 'sql')
    options.push(
      <label key="dialect" className={toolLabelClass}>
        {t('codeFormat.dialect')}
        <select className={toolSelectClass} value={dialect} onChange={(e) => setDialect(e.target.value)}>
          {SQL_DIALECTS.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
      </label>,
    );
  if (language === 'sql' && !minify)
    options.push(
      <label key="case" className={toolLabelClass}>
        {t('codeFormat.keywords')}
        <select
          className={toolSelectClass}
          value={keywordCase}
          onChange={(e) => setKeywordCase(e.target.value)}
        >
          <option value="upper">{t('codeFormat.upper')}</option>
          <option value="lower">{t('codeFormat.lower')}</option>
          <option value="preserve">{t('codeFormat.preserve')}</option>
        </select>
      </label>,
    );
  if (minify && language !== 'graphql')
    options.push(
      <label key="comments" className={toolLabelClass}>
        <input
          type="checkbox"
          checked={Boolean(removeComments)}
          onChange={(e) => setRemoveComments(e.target.checked ? '1' : '')}
        />
        {t('codeFormat.removeComments')}
      </label>,
    );
  if (language === 'yaml')
    options.push(
      <label key="width" className={toolLabelClass}>
        {t('codeFormat.lineWidth')}
        <select className={toolSelectClass} value={lineWidth} onChange={(e) => setLineWidth(e.target.value)}>
          <option value="80">80</option>
          <option value="120">120</option>
          <option value="0">{t('codeFormat.noFold')}</option>
        </select>
      </label>,
      <label key="sort" className={toolLabelClass}>
        <input
          type="checkbox"
          checked={Boolean(sortKeys)}
          onChange={(e) => setSortKeys(e.target.checked ? '1' : '')}
        />
        {t('codeFormat.sortKeys')}
      </label>,
    );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <ToolOptions>
        {options}
        <Button
          size="sm"
          variant="secondary"
          disabled={!result?.output}
          onClick={() => result?.output && setInput(result.output)}
          title={t('codeFormat.applyTitle')}
        >
          {t('codeFormat.applyToInput')}
        </Button>
        {result?.output && (
          <span className="flex items-center gap-1 text-xs text-success">
            <CheckCircle2 className="h-3.5 w-3.5" /> {t('codeFormat.valid', { language: def.label })}
          </span>
        )}
      </ToolOptions>
      {suggestion && (
        <Alert tone="info">
          <span className="flex flex-wrap items-center gap-2">
            {t('codeFormat.looksLike', { language: suggestion.label })}
            <Button
              size="sm"
              variant="secondary"
              onClick={() => openInTool(navigate, suggestion.toolId, input)}
            >
              {t('codeFormat.openIn', { language: suggestion.label })}
            </Button>
          </span>
        </Alert>
      )}
      <ToolErrorMessage error={result?.error} />
      {errorLine && (
        <div className="flex items-start gap-2">
          <pre className="min-w-0 flex-1 overflow-x-auto rounded-md border border-line bg-surface px-2 py-1 font-mono text-xs">
            {errorLine.text}
            {'\n'}
            <span className="text-danger">{' '.repeat(errorLine.caret)}^</span>
          </pre>
          <Button size="sm" variant="secondary" onClick={goToError} disabled={source !== input}>
            {t('codeFormat.goToError')}
          </Button>
        </div>
      )}
      <TwoPanes>
        <ToolPane
          label={def.label}
          value={input}
          onChange={setInput}
          language={def.editor}
          placeholder={def.placeholder}
          fileAccept={def.accept}
          onEditorReady={(view) => (editor.current = view)}
        />
        <ToolPane
          label={t('codeFormat.result')}
          value={result?.output ?? ''}
          output
          language={def.editor}
          downloadName={t(minify ? 'codeFormat.minifiedFile' : 'codeFormat.formattedFile', {
            ext: def.extension,
          })}
        />
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

export const XmlFormatTool = () => <CodeFormatTool language="xml" />;
export const YamlFormatTool = () => <CodeFormatTool language="yaml" />;
export const SqlFormatTool = () => <CodeFormatTool language="sql" />;
export const GraphqlFormatTool = () => <CodeFormatTool language="graphql" />;
export const HtmlFormatTool = () => <CodeFormatTool language="html" />;
