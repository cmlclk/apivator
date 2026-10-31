import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { Button } from '@apivator/ui';
import { isDesktop, updates, type UpdateInfo } from '../lib/desktop';
import { useT } from '../i18n';

/** Masaüstü: yeni sürüm varsa üstte bildirir; kurulum sonrası uygulama yeniden başlar. */
export function UpdateBanner() {
  const t = useT('shell');
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isDesktop()) return;
    // Güncelleme sunucusuna ulaşılamazsa sessizce geçilir; bir sonraki açılışta yeniden denenir.
    updates
      .check()
      .then(setUpdate)
      .catch(() => undefined);
  }, []);

  if (!update || dismissed) return null;

  async function install() {
    setInstalling(true);
    setError(null);
    try {
      await updates.install();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setInstalling(false);
    }
  }

  return (
    <div
      role="status"
      className="flex items-center gap-3 border-b border-line bg-accent/10 px-4 py-1.5 text-[13px] text-fg"
    >
      <Download className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">
        {t('banners.update.ready', { version: update.version })}
        {error ? (
          <span className="ms-2 text-danger">{t('banners.update.failed', { error })}</span>
        ) : (
          ` ${t('banners.update.restartHint')}`
        )}
      </span>
      <Button size="sm" onClick={() => void install()} loading={installing}>
        {t('banners.update.install')}
      </Button>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label={t('banners.update.later')}
        className="rounded p-1 text-fg-subtle hover:bg-muted hover:text-fg"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
