import { useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { Alert, cn, Spinner } from '@apivator/ui';
import type { PreferencesDto, ThemePreference } from '@apivator/core';
import { LanguageSelect } from '../../components/LanguageSelect';
import { useT } from '../../i18n';
import { errorMessage } from '../../lib/errors';
import { groupWorkspaces, selectClass } from '../../lib/teams';
import { useWorkspaces } from '../../lib/useWorkspaces';
import { useUi } from '../../stores/ui';
import { usePreferences, useSavePreferences } from './preferences';

const themes: { id: ThemePreference; icon: typeof Sun }[] = [
  { id: 'system', icon: Monitor },
  { id: 'light', icon: Sun },
  { id: 'dark', icon: Moon },
];

const emails = ['emailMentions', 'emailMergeRequests', 'emailMonitorAlerts'] as const;

export function PreferencesTab() {
  const t = useT('account');
  const { data: preferences, isLoading, error: loadError } = usePreferences();
  const save = useSavePreferences();
  const setTheme = useUi((s) => s.setTheme);
  const { workspaces } = useWorkspaces();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  if (isLoading) return <Spinner className="mx-auto h-5 w-5 text-fg-subtle" />;
  if (!preferences) return <Alert tone="error">{errorMessage(loadError)}</Alert>;

  async function change(patch: Partial<PreferencesDto>) {
    setError(null);
    setSaved(false);
    try {
      await save(patch);
      setSaved(true);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const groups = groupWorkspaces(workspaces);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] text-fg-muted">
        {t('preferences.intro')}
        {saved && <span className="ms-2 text-success">{t('preferences.saved')}</span>}
      </p>
      {error && <Alert tone="error">{error}</Alert>}

      <section
        aria-label={t('preferences.appearance')}
        className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4"
      >
        <h2 className="text-sm font-semibold">{t('preferences.appearance')}</h2>
        <div role="radiogroup" aria-label={t('preferences.theme')} className="flex gap-2">
          {themes.map(({ id, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={preferences.theme === id}
              onClick={() => {
                // Önce önbellek güncellenir (iyimser), böylece PreferencesSync aynı değişikliği ikinci kez yazmaz.
                void change({ theme: id });
                setTheme(id);
              }}
              className={cn(
                'flex flex-1 flex-col items-center gap-1.5 rounded-md border px-3 py-3 text-[13px]',
                preferences.theme === id
                  ? 'border-accent bg-accent/10 font-medium text-fg'
                  : 'border-line text-fg-muted hover:bg-muted',
              )}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {t(`preferences.themes.${id}`)}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-1.5 text-[13px]">
          <span className="font-medium">{t('preferences.language')}</span>
          {/* Dil hemen uygulanır; sunucuya yazılınca diğer cihazlar ve e-postalar da bu dili kullanır. */}
          <LanguageSelect onChange={(language) => void change({ language })} />
          <span className="text-xs text-fg-subtle">{t('preferences.languageHint')}</span>
        </div>
      </section>

      <section
        aria-label={t('preferences.startup')}
        className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4"
      >
        <h2 className="text-sm font-semibold">{t('preferences.startup')}</h2>
        <label className="flex flex-col gap-1.5 text-[13px]">
          <span className="font-medium">{t('preferences.defaultWorkspace')}</span>
          <select
            aria-label={t('preferences.defaultWorkspace')}
            className={cn(selectClass, 'h-9 max-w-md')}
            value={preferences.defaultWorkspaceId ?? ''}
            onChange={(e) => void change({ defaultWorkspaceId: e.target.value || null })}
          >
            <option value="">{t('preferences.lastUsedWorkspace')}</option>
            {groups.map((group) => (
              <optgroup
                key={group.personal ? 'personal' : group.name}
                label={group.personal ? t('preferences.personal') : group.name}
              >
                {group.items.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <span className="text-xs text-fg-subtle">{t('preferences.defaultWorkspaceHint')}</span>
        </label>
      </section>

      <section
        aria-label={t('preferences.emailNotifications')}
        className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4"
      >
        <h2 className="text-sm font-semibold">{t('preferences.emailNotifications')}</h2>
        <p className="text-xs text-fg-subtle">{t('preferences.emailNotificationsHint')}</p>
        <ul className="flex flex-col gap-3">
          {emails.map((key) => (
            <li key={key}>
              <label className="flex cursor-pointer items-start gap-3 text-[13px]">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 accent-[var(--app-accent)]"
                  checked={preferences[key]}
                  onChange={(e) => void change({ [key]: e.target.checked })}
                />
                <span>
                  <span className="block font-medium">{t(`preferences.emails.${key}.label`)}</span>
                  <span className="block text-xs text-fg-subtle">{t(`preferences.emails.${key}.hint`)}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      </section>

      <section
        aria-label={t('preferences.history')}
        className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4"
      >
        <h2 className="text-sm font-semibold">{t('preferences.history')}</h2>
        <label className="flex cursor-pointer items-start gap-3 text-[13px]">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 accent-[var(--app-accent)]"
            checked={preferences.saveHistoryResponses ?? false}
            onChange={(e) => void change({ saveHistoryResponses: e.target.checked })}
          />
          <span>
            <span className="block font-medium">{t('preferences.saveHistoryResponses')}</span>
            <span className="block text-xs text-fg-subtle">{t('preferences.saveHistoryResponsesHint')}</span>
          </span>
        </label>
      </section>
    </div>
  );
}
