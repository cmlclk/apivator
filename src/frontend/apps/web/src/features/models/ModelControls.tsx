import { MODEL_LANGUAGES, type ModelLanguage } from '@apivator/core/models';
import { cn } from '@apivator/ui';
import { useT } from '../../i18n';
import { selectClass } from '../../lib/teams';
import { useModelPrefs } from './modelPrefs';

const NAMESPACE_LABEL: Partial<Record<ModelLanguage, 'controls.namespace' | 'controls.package'>> = {
  csharp: 'controls.namespace',
  java: 'controls.package',
  kotlin: 'controls.package',
  go: 'controls.package',
};

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-fg-muted">
      <input
        type="checkbox"
        className="accent-[var(--app-accent)]"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <select
      aria-label={label}
      className={cn(selectClass, 'h-7 text-xs')}
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
    >
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** Model dili seçimi; tercih bu cihazda hatırlanır. */
export function ModelLanguageSelect({ className, onChange }: { className?: string; onChange?: () => void }) {
  const t = useT('models');
  const language = useModelPrefs((s) => s.language);
  const set = useModelPrefs((s) => s.set);
  return (
    <select
      aria-label={t('controls.languageLabel')}
      className={cn(selectClass, className)}
      value={language}
      onChange={(e) => {
        set({ language: e.target.value as ModelLanguage });
        onChange?.();
      }}
    >
      {MODEL_LANGUAGES.map((l) => (
        <option key={l.id} value={l.id}>
          {l.label}
        </option>
      ))}
    </select>
  );
}

/** Seçili dile özgü seçenekler: namespace/paket, stil, serileştirici, ondalık tipi. */
export function ModelLanguageOptions() {
  const t = useT('models');
  const prefs = useModelPrefs();
  const language = prefs.language;
  const namespaceKey = NAMESPACE_LABEL[language];
  const namespaceLabel = namespaceKey ? t(namespaceKey) : '';
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2" aria-label={t('controls.optionsLabel')}>
      {namespaceKey && (
        <input
          aria-label={namespaceLabel}
          placeholder={t(language === 'go' ? 'controls.placeholderGo' : 'controls.placeholderOptional', {
            label: namespaceLabel,
          })}
          value={prefs.namespaces[language] ?? ''}
          onChange={(e) => prefs.set({ namespaces: { ...prefs.namespaces, [language]: e.target.value } })}
          className="h-7 w-56 rounded-md border border-line bg-surface px-2 font-mono text-xs"
        />
      )}
      {language === 'csharp' && (
        <>
          <Choice
            label={t('controls.csharpStyle')}
            value={prefs.csharp.style ?? 'class'}
            options={[
              { id: 'class', label: t('controls.styleClass') },
              { id: 'record', label: 'Record' },
            ]}
            onChange={(style) => prefs.set({ csharp: { ...prefs.csharp, style } })}
          />
          <Choice
            label={t('controls.jsonLibrary')}
            value={prefs.csharp.serializer ?? 'system-text-json'}
            options={[
              { id: 'system-text-json', label: 'System.Text.Json' },
              { id: 'newtonsoft', label: 'Newtonsoft.Json' },
            ]}
            onChange={(serializer) => prefs.set({ csharp: { ...prefs.csharp, serializer } })}
          />
        </>
      )}
      {language === 'java' && (
        <>
          <Choice
            label={t('controls.javaStyle')}
            value={prefs.java.style ?? 'class'}
            options={[
              { id: 'class', label: 'POJO (Jackson)' },
              { id: 'record', label: 'Record (Java 16+)' },
            ]}
            onChange={(style) => prefs.set({ java: { ...prefs.java, style } })}
          />
          {prefs.java.style !== 'record' && (
            <Toggle
              label="Lombok"
              checked={prefs.java.lombok ?? false}
              onChange={(lombok) => prefs.set({ java: { ...prefs.java, lombok } })}
            />
          )}
        </>
      )}
      {language === 'typescript' && (
        <Toggle
          label={t('controls.zod')}
          checked={prefs.typescript.zod ?? false}
          onChange={(zod) => prefs.set({ typescript: { zod } })}
        />
      )}
      {language === 'python' && (
        <Choice
          label={t('controls.pythonStyle')}
          value={prefs.python.style ?? 'pydantic'}
          options={[
            { id: 'pydantic', label: 'Pydantic v2' },
            { id: 'dataclass', label: 'dataclass' },
          ]}
          onChange={(style) => prefs.set({ python: { style } })}
        />
      )}
      {['csharp', 'java', 'swift', 'python'].includes(language) && (
        <Toggle
          label={t('controls.decimal', {
            type: language === 'java' ? 'BigDecimal' : language === 'swift' ? 'Decimal' : 'decimal',
          })}
          checked={prefs.decimal}
          onChange={(decimal) => prefs.set({ decimal })}
        />
      )}
    </div>
  );
}

/** Üretilen dosyaların sekmeleri (birden çok dosya üreten dillerde, ör. Java). */
export function ModelFileTabs({
  names,
  index,
  onChange,
}: {
  names: string[];
  index: number;
  onChange: (index: number) => void;
}) {
  const t = useT('models');
  if (names.length < 2) return null;
  return (
    <div role="tablist" aria-label={t('controls.filesLabel')} className="flex flex-wrap gap-1">
      {names.map((name, i) => (
        <button
          key={name}
          type="button"
          role="tab"
          aria-selected={i === index}
          onClick={() => onChange(i)}
          className={cn(
            'rounded px-2 py-1 font-mono text-xs',
            i === index ? 'bg-accent/15 text-accent' : 'text-fg-muted hover:bg-muted',
          )}
        >
          {name}
        </button>
      ))}
    </div>
  );
}
