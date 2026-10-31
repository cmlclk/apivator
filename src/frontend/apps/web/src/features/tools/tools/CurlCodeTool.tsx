import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { FilePlus2 } from 'lucide-react';
import { Alert, Button } from '@apivator/ui';
import { CODE_LANGUAGES, CurlParseError, generateCode, parseCurl, type CodeLanguage } from '@apivator/core';
import { useWorkspaces } from '../../../lib/useWorkspaces';
import { ToolErrorMessage, ToolOptions, ToolPane, TwoPanes } from '../ToolLayout';
import { openRequestTab } from '../requestTab';
import { toolErrorText, toolLabelClass, toolSelectClass } from '../toolUtils';
import { useToolInput } from '../toolsStore';
import { useT } from '../../../i18n';

const EXTENSIONS: Record<CodeLanguage, string> = {
  curl: 'sh',
  csharp: 'cs',
  javascript: 'js',
  python: 'py',
  go: 'go',
  powershell: 'ps1',
};

/** cURL komutunu istek tanımına çevirir ve seçilen dilde kod üretir (istek ekranındaki "Kod" ile aynı üreteçler). */
export default function CurlCodeTool() {
  const t = useT('toolsData');
  const navigate = useNavigate();
  const { current } = useWorkspaces();
  const [input, setInput] = useToolInput('curl-code', 'input');
  const [saved, setLanguage] = useToolInput('curl-code', 'language', 'javascript');
  const language = (CODE_LANGUAGES.some((l) => l.id === saved) ? saved : 'javascript') as CodeLanguage;

  const result = useMemo(() => {
    if (!input.trim()) return { parsed: null, code: '', error: null };
    try {
      const parsed = parseCurl(input);
      return { parsed, code: generateCode(language, parsed.definition), error: null };
    } catch (error) {
      const message = toolErrorText(error);
      return {
        parsed: null,
        code: '',
        error: error instanceof CurlParseError ? t('curlCode.parseFailed', { message }) : message,
      };
    }
  }, [input, language, t]);

  const warnings = result.parsed?.warnings ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <ToolOptions>
        <label className={toolLabelClass}>
          {t('curlCode.language')}
          <select className={toolSelectClass} value={language} onChange={(e) => setLanguage(e.target.value)}>
            {CODE_LANGUAGES.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        <Button
          size="sm"
          variant="secondary"
          disabled={!current || !result.parsed}
          title={t('curlCode.openTitle')}
          onClick={() => openRequestTab(navigate, current!.id, result.parsed!.definition, warnings)}
        >
          <FilePlus2 className="h-3.5 w-3.5" /> {t('curlCode.openNew')}
        </Button>
      </ToolOptions>
      <ToolErrorMessage error={result.error} />
      {warnings.length > 0 && (
        <Alert tone="warning">
          <p>{t('curlCode.skipped')}</p>
          <ul className="mt-1 list-disc ps-5 text-xs">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </Alert>
      )}
      <TwoPanes>
        <ToolPane
          label={t('curlCode.command')}
          value={input}
          onChange={setInput}
          language="none"
          placeholder={"curl 'https://api.ornek.com/v1/users' \\\n  -H 'Accept: application/json'"}
          fileAccept=".sh,.txt"
        />
        <ToolPane
          label={t('curlCode.codeLabel', { language: CODE_LANGUAGES.find((l) => l.id === language)!.label })}
          value={result.code}
          output
          language={language === 'javascript' ? 'JavaScript' : 'none'}
          downloadName={t('curlCode.fileName', { ext: EXTENSIONS[language] })}
        />
      </TwoPanes>
    </div>
  );
}
