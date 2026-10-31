import { useEffect, useState } from 'react';
import { HardDrive, Server } from 'lucide-react';
import { Alert, Button } from '@apivator/ui';
import { LanguageSelect } from './LanguageSelect';
import { Logo } from './Logo';
import { useT } from '../i18n';
import { appMode, setAppMode, type AppMode, type AppModeInfo } from '../lib/desktop';
import { errorMessage } from '../lib/errors';

/** Kabuktan gelen hatalar (desktopError) zaten etkin dilde, kullanıcıya gösterilebilir metindir. */
function modeError(error: unknown): string {
  return error instanceof Error ? error.message : errorMessage(error);
}

/** Mod kaydedilir ve uygulama yeni modda baştan açılır (API adresi ve oturum moda göre değişir). */
async function switchTo(mode: AppMode) {
  await setAppMode(mode);
  location.reload();
}

const options = [
  { mode: 'local', icon: HardDrive },
  { mode: 'server', icon: Server },
] as const;

/** Masaüstü ilk açılış: kişisel kullanım mı, sunucuya bağlanma mı. */
export function ModeChoice() {
  const t = useT('shell');
  const [busy, setBusy] = useState<AppMode | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(mode: AppMode) {
    setBusy(mode);
    setError(null);
    try {
      await switchTo(mode);
    } catch (e) {
      setError(t('mode.choice.failed', { error: modeError(e) }));
      setBusy(null);
    }
  }

  return (
    <main className="flex min-h-full items-center justify-center px-6 py-12">
      <div className="w-full max-w-xl">
        <div className="mb-8 flex items-center gap-2.5">
          <Logo />
          <span className="text-lg font-semibold tracking-tight">Apivator</span>
          <LanguageSelect compact className="ms-auto" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('mode.choice.title')}</h1>
        <p className="mt-1.5 text-sm text-fg-muted">{t('mode.choice.subtitle')}</p>
        {error && (
          <Alert tone="error" className="mt-6">
            {error}
          </Alert>
        )}
        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          {options.map(({ mode, icon: Icon }) => (
            <button
              key={mode}
              type="button"
              disabled={busy !== null}
              onClick={() => void choose(mode)}
              className="flex flex-col items-start gap-2 rounded-lg border border-line bg-surface p-5 text-start hover:border-accent hover:bg-accent/5 disabled:opacity-60"
            >
              <Icon className="h-5 w-5 text-accent" aria-hidden="true" />
              <span className="font-medium">{t(`mode.choice.${mode}.title`)}</span>
              <span className="text-[13px] text-fg-muted">{t(`mode.choice.${mode}.description`)}</span>
            </button>
          ))}
        </div>
      </div>
    </main>
  );
}

/** Ayarlar (masaüstü): çalışma modunu değiştirme. Yerel veriler silinmez. */
export function AppModeSetting() {
  const t = useT('shell');
  const [info, setInfo] = useState<AppModeInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    appMode().then(setInfo, (e: unknown) => setError(modeError(e)));
  }, []);

  const current: AppMode = info?.mode ?? 'server';
  const target: AppMode = current === 'local' ? 'server' : 'local';

  async function change() {
    setBusy(true);
    setError(null);
    try {
      await switchTo(target);
    } catch (e) {
      setError(modeError(e));
      setBusy(false);
    }
  }

  return (
    <section
      aria-label={t('mode.setting.title')}
      className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4"
    >
      <h2 className="text-sm font-semibold">{t('mode.setting.title')}</h2>
      {error && <Alert tone="error">{error}</Alert>}
      {info && (
        <>
          <p className="text-[13px]">{t('mode.setting.current', { mode: t(`mode.setting.${current}`) })}</p>
          <p className="break-all text-xs text-fg-muted">
            {t('mode.setting.dataDir', { path: info.dataDir })}
          </p>
          <p className="text-xs text-fg-muted">{t('mode.setting.keepsData')}</p>
          {current === 'local' && <p className="text-xs text-fg-muted">{t('mode.setting.moveToTeam')}</p>}
          <div>
            <Button size="sm" variant="secondary" loading={busy} onClick={() => void change()}>
              {t(target === 'local' ? 'mode.setting.toLocal' : 'mode.setting.toServer')}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

/** Yerel mod seçili ama uygulamanın içindeki API başlatılamadı: tekrar denenir ya da sunucuya bağlanılır. */
export function LocalApiFailed({ message }: { message: string }) {
  const t = useT('shell');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toServer() {
    setBusy(true);
    setError(null);
    try {
      await switchTo('server');
    } catch (e) {
      setError(modeError(e));
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-full items-center justify-center px-6 py-12">
      <div className="flex w-full max-w-xl flex-col gap-4">
        <div className="flex items-center gap-2.5">
          <Logo />
          <span className="text-lg font-semibold tracking-tight">Apivator</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('mode.failed.title')}</h1>
        <Alert tone="error">
          <span className="whitespace-pre-wrap break-words">{message}</span>
        </Alert>
        {error && <Alert tone="error">{error}</Alert>}
        <div className="flex gap-2">
          <Button onClick={() => location.reload()}>{t('mode.failed.retry')}</Button>
          <Button variant="secondary" loading={busy} onClick={() => void toServer()}>
            {t('mode.setting.toServer')}
          </Button>
        </div>
      </div>
    </main>
  );
}
