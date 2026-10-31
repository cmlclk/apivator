import { Globe } from 'lucide-react';
import { cn } from '@apivator/ui';
import { LANGUAGE_NAMES, LANGUAGES, isLanguage, setLanguage, useLocale, useT, type Language } from '../i18n';
import { selectClass } from '../lib/teams';

/** Yalnızca geliştirmede görünen sözde dil seçeneğinin değeri (`Language` değildir, sunucuya yazılmaz). */
const PSEUDO = 'pseudo';
/** Yalnızca geliştirmede görünür; çevrilmez. */
const PSEUDO_LABEL = 'Pseudo';

/**
 * Dil seçici. `onChange` verilirse seçim ayrıca oraya bildirilir (hesap ayarlarında sunucuya yazmak için);
 * verilmezse yalnızca bu cihazda uygulanır (giriş ve kayıt sayfaları). Geliştirme modunda ek olarak sözde dil
 * seçilebilir; bu yalnızca yerel bir görüntüleme aracıdır (`onChange` çağrılmaz, tercih saklanmaz).
 */
export function LanguageSelect({
  compact,
  className,
  onChange,
}: {
  compact?: boolean;
  className?: string;
  onChange?: (language: Language) => void;
}) {
  const t = useT('common');
  const language = useLocale((s) => s.language);
  const pseudo = useLocale((s) => s.pseudo);
  return (
    <label className={cn('inline-flex items-center gap-1.5 text-[13px] text-fg-muted', className)}>
      {compact && <Globe className="h-3.5 w-3.5" aria-hidden="true" />}
      <select
        aria-label={t('language')}
        className={cn(selectClass, compact ? 'h-7 border-transparent bg-transparent px-1' : 'h-9 max-w-xs')}
        value={import.meta.env.DEV && pseudo ? PSEUDO : language}
        onChange={(e) => {
          const next = e.target.value;
          if (import.meta.env.DEV && next === PSEUDO) {
            void import('../i18n/pseudo').then((m) => m.setPseudoLanguage());
            return;
          }
          if (!isLanguage(next)) return;
          void setLanguage(next);
          onChange?.(next);
        }}
      >
        {LANGUAGES.map((l) => (
          <option key={l} value={l} lang={l} className="bg-surface text-fg">
            {LANGUAGE_NAMES[l]}
          </option>
        ))}
        {import.meta.env.DEV && (
          <option value={PSEUDO} lang="en-XA" className="bg-surface text-fg">
            {PSEUDO_LABEL}
          </option>
        )}
      </select>
    </label>
  );
}
