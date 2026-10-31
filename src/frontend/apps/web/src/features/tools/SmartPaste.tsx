import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Sparkles } from 'lucide-react';
import { Button } from '@apivator/ui';
import { CurlParseError, parseCurl } from '@apivator/core';
import { detectContent } from '@apivator/core/tools';
import { useT } from '../../i18n';
import { useWorkspaces } from '../../lib/useWorkspaces';
import { useTabs } from '../requests/tabsStore';
import { openInTool } from './openInTool';
import { findTool } from './registry';

/** Bu boyutun üstündeki metinler tanınmaya çalışılmaz (yazarken arayüz takılmasın). */
const MAX_DETECT_LENGTH = 1_000_000;

/** Araçlar ana sayfasındaki "Yapıştır, uygun aracı önerelim" alanı. */
export function SmartPaste() {
  const t = useT('tools');
  const navigate = useNavigate();
  const { current } = useWorkspaces();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const suggestions = useMemo(() => {
    if (text.length > MAX_DETECT_LENGTH) return [];
    // cURL için araç yok; komut istek çalışma alanında yeni sekme olarak açılır.
    return detectContent(text).filter((d) => d.toolId === 'curl' || findTool(d.toolId));
  }, [text]);

  function openCurl() {
    if (!current) return;
    try {
      const { definition, warnings } = parseCurl(text.trim());
      useTabs.getState().newTab(current.id, {
        name: definition.url.replace(/^https?:\/\//i, '').slice(0, 80) || t('request.curlName'),
        draft: definition,
        notice: warnings.length
          ? { tone: 'warning', text: t('request.curlSkipped'), details: warnings }
          : undefined,
      });
      void navigate('/');
    } catch (e) {
      setError(e instanceof CurlParseError ? e.message : String(e));
    }
  }

  return (
    <section className="flex flex-col gap-2 rounded-md border border-line p-3">
      <label htmlFor="smart-paste" className="flex items-center gap-1.5 text-xs font-semibold text-fg-muted">
        <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> {t('smartPaste.title')}
      </label>
      <textarea
        id="smart-paste"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setError(null);
        }}
        placeholder={t('smartPaste.placeholder')}
        rows={2}
        spellCheck={false}
        className="w-full resize-y rounded-md border border-line bg-surface px-3 py-2 font-mono text-xs text-fg placeholder:font-sans placeholder:text-fg-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
      />
      {text.trim() && (
        <div className="flex flex-wrap items-center gap-2" aria-live="polite">
          {suggestions.length === 0 ? (
            <span className="text-xs text-fg-subtle">{t('smartPaste.noMatch')}</span>
          ) : (
            suggestions.map((d) =>
              d.toolId === 'curl' ? (
                <Button key={d.toolId} size="sm" variant="secondary" disabled={!current} onClick={openCurl}>
                  {t('smartPaste.suggestionRequest', { reason: d.reason })}
                </Button>
              ) : (
                <Button
                  key={d.toolId}
                  size="sm"
                  variant="secondary"
                  onClick={() => openInTool(navigate, d.toolId, toolInput(d.toolId, text))}
                >
                  {t('smartPaste.suggestion', { reason: d.reason, tool: findTool(d.toolId)!.name })}
                </Button>
              ),
            )
          )}
          {error && <span className="text-xs text-danger">{error}</span>}
        </div>
      )}
    </section>
  );
}

/** JWT aracına "Bearer " öneki olmadan gönderilir. */
function toolInput(toolId: string, text: string): string {
  const trimmed = text.trim();
  return toolId === 'jwt' ? trimmed.replace(/^bearer\s+/i, '') : trimmed;
}
