import { useMemo } from 'react';
import { Input } from '@apivator/ui';
import { ToolErrorMessage, ToolOptions, ToolPane, TwoPanes } from '../ToolLayout';
import { toolLabelClass, toolSelectClass } from '../toolUtils';
import { useToolInput } from '../toolsStore';
import { useDebouncedText } from '../jsonToolHooks';
import { QUERY_LANGUAGES, runQuery, type QueryLanguage } from '../queryEngines';
import { CopyButton } from '../../../components/ui/CopyButton';
import { useT } from '../../../i18n';

/** Eşleşme listesinde gösterilen en fazla satır; sonuçta hepsi var. */
const MAX_LISTED = 500;

/** Sorgu aracı: aynı girdide JSONPath, JMESPath ya da XPath (XML) ifadesini canlı dener. */
export default function JsonPathTool() {
  const t = useT('toolsData');
  const [input, setInput] = useToolInput('jsonpath', 'input');
  const [languageId, setLanguage] = useToolInput('jsonpath', 'language', 'jsonpath');
  const language = QUERY_LANGUAGES.find((l) => l.id === languageId) ?? QUERY_LANGUAGES[0]!;
  // Her dilin ifadesi ayrı saklanır; dil değişince yazılan ifade kaybolmaz.
  const expressions = {
    jsonpath: useToolInput('jsonpath', 'expression', QUERY_LANGUAGES[0]!.initial),
    jmespath: useToolInput('jsonpath', 'jmespathExpression', QUERY_LANGUAGES[1]!.initial),
    xpath: useToolInput('jsonpath', 'xpathExpression', QUERY_LANGUAGES[2]!.initial),
  } satisfies Record<QueryLanguage, unknown>;
  const [expression, setExpression] = expressions[language.id];
  const [jsonOutput, setJsonOutput] = useToolInput('jsonpath', 'output', 'values');
  const [xpathOutput, setXpathOutput] = useToolInput('jsonpath', 'xpathOutput', 'xml');
  const [output, setOutput] =
    language.id === 'xpath' ? [xpathOutput, setXpathOutput] : [jsonOutput, setJsonOutput];
  const source = useDebouncedText(input);
  const isXml = language.id === 'xpath';

  const query = useMemo(
    () => runQuery(language.id, source, expression, output),
    [language.id, source, expression, output],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <div className="flex gap-2">
          <select
            aria-label={t('jsonPath.queryLanguage')}
            className={toolSelectClass + ' h-9'}
            value={language.id}
            onChange={(e) => setLanguage(e.target.value)}
          >
            {QUERY_LANGUAGES.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
          <Input
            aria-label={t('jsonPath.expression', { language: language.label })}
            value={expression}
            onChange={(e) => setExpression(e.target.value)}
            placeholder={language.placeholder}
            spellCheck={false}
            className="flex-1 font-mono"
          />
        </div>
        {query.position !== undefined && (
          <pre className="overflow-x-auto px-3 font-mono text-xs" aria-hidden>
            <span className="text-fg-muted">{expression}</span>
            {'\n'}
            <span className="text-danger">{' '.repeat(query.position)}^</span>
          </pre>
        )}
        <div className="flex flex-wrap gap-1.5">
          {language.examples.map((example) => (
            <button
              key={example}
              type="button"
              className="rounded-full border border-line px-2 py-0.5 font-mono text-xs text-fg-muted hover:border-accent hover:text-fg"
              onClick={() => setExpression(example)}
            >
              {example}
            </button>
          ))}
        </div>
      </div>
      <ToolErrorMessage error={query.error} />
      <ToolOptions>
        {language.outputs.length > 0 && (
          <label className={toolLabelClass}>
            {t('jsonPath.result')}
            <select className={toolSelectClass} value={output} onChange={(e) => setOutput(e.target.value)}>
              {language.outputs.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        )}
        {query.summary && <span className="text-xs text-fg-muted">{query.summary}</span>}
      </ToolOptions>
      <TwoPanes>
        <ToolPane
          label={isXml ? 'XML' : 'JSON'}
          value={input}
          onChange={setInput}
          language={isXml ? 'Xml' : 'Json'}
          placeholder={
            isXml
              ? '<kitaplar><kitap id="1"><fiyat>8</fiyat></kitap></kitaplar>'
              : '{"kitaplar": [{"id": 1, "fiyat": 8}, {"id": 2, "fiyat": 12}]}'
          }
          fileAccept={
            isXml ? '.xml,application/xml,text/xml,text/plain' : '.json,application/json,text/plain'
          }
        />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
          {query.items && query.items.length > 0 && (
            <section
              className="max-h-56 overflow-auto rounded-md border border-line"
              aria-label={t('jsonPath.matches')}
            >
              <ul className="divide-y divide-line font-mono text-xs">
                {/* Birleşimlerde aynı yol birden çok kez eşleşebilir ($[0,0]); anahtar sıra numarası. */}
                {query.items.slice(0, MAX_LISTED).map((item, index) => (
                  <li key={index} className="flex items-start gap-2 px-2 py-1">
                    <div className="min-w-0 flex-1">
                      <div className="break-all text-accent">{item.label}</div>
                      <div className="break-all text-fg-muted">{item.preview}</div>
                    </div>
                    <CopyButton
                      text={item.copy}
                      label={isXml ? t('jsonPath.copyNode') : t('jsonPath.copyPath')}
                      compact
                    />
                  </li>
                ))}
                {query.items.length > MAX_LISTED && (
                  <li className="px-2 py-1 text-fg-subtle">
                    {t('jsonPath.listedFirst', { count: MAX_LISTED })}
                  </li>
                )}
              </ul>
            </section>
          )}
          <ToolPane
            label={isXml ? t('jsonPath.result') : t('jsonPath.resultJson')}
            value={query.text}
            output
            language={query.textLanguage}
            downloadName={t('jsonPath.downloadName', {
              language: language.id,
              ext: query.textLanguage === 'Json' ? 'json' : query.textLanguage === 'Xml' ? 'xml' : 'txt',
            })}
          />
        </div>
      </TwoPanes>
    </div>
  );
}
