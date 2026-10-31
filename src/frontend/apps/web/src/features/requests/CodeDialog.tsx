import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { CODE_LANGUAGES, generateCode, type CodeLanguage, type CodeRequest } from '@apivator/core';
import { Button, cn } from '@apivator/ui';
import { Dialog } from '../../components/ui/Dialog';
import { useT } from '../../i18n';
import { CodeEditor } from './CodeEditor';

const STORAGE_KEY = 'apivator-code-language';

function initialLanguage(): CodeLanguage {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && CODE_LANGUAGES.some((l) => l.id === saved)) return saved as CodeLanguage;
  } catch {
    /* tarayıcı depolaması kapalı olabilir */
  }
  return 'curl';
}

/** İsteği seçilen dilde koda çevirir; değişkenler ve yetkilendirme mirası çözülmüştür. */
export function CodeDialog({ request, onClose }: { request: CodeRequest; onClose: () => void }) {
  const t = useT('requests');
  const [language, setLanguage] = useState<CodeLanguage>(initialLanguage);
  const [copied, setCopied] = useState(false);
  const code = generateCode(language, request);

  const choose = (id: CodeLanguage) => {
    setLanguage(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* yok say */
    }
  };

  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Dialog
      title={t('code.title')}
      size="xl"
      onClose={onClose}
      footer={
        <Button onClick={() => void copy()}>
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? t('code.copied') : t('code.copy')}
        </Button>
      }
    >
      <div className="flex gap-4">
        <nav aria-label={t('code.language')} className="w-44 shrink-0 space-y-0.5">
          {CODE_LANGUAGES.map((l) => (
            <button
              key={l.id}
              type="button"
              aria-current={language === l.id ? 'true' : undefined}
              onClick={() => choose(l.id)}
              className={cn(
                'w-full rounded-md px-2.5 py-1.5 text-start text-[13px]',
                language === l.id
                  ? 'bg-accent/10 font-medium text-accent'
                  : 'text-fg-muted hover:bg-muted hover:text-fg',
              )}
            >
              {l.label}
            </button>
          ))}
        </nav>
        <div className="h-[55vh] min-w-0 flex-1 overflow-hidden rounded-md border border-line bg-surface">
          <CodeEditor
            value={code}
            readOnly
            language={language === 'javascript' ? 'JavaScript' : 'none'}
            label={t('code.editorLabel', {
              language: CODE_LANGUAGES.find((l) => l.id === language)?.label ?? '',
            })}
          />
        </div>
      </div>
      <p className="mt-2 text-xs text-fg-subtle">{t('code.note')}</p>
    </Dialog>
  );
}
