import { useState } from 'react';
import { CloudOff } from 'lucide-react';
import { Spinner } from '@apivator/ui';
import { isDesktop } from '../lib/desktop';
import { isOnline, probe, useConnectivity } from '../lib/connectivity';
import { timeAgo } from '../features/activity/activity';
import { useTabs } from '../features/requests/tabsStore';
import { useT } from '../i18n';

/** Sunucuya ulaşılamazken: önbellekteki verilerle çalışıldığını ve bekleyen kayıtları gösterir. */
export function OfflineBanner() {
  const t = useT('shell');
  const online = useConnectivity((s) => isOnline(s));
  const browser = useConnectivity((s) => s.browser);
  const lastReachedAt = useConnectivity((s) => s.lastReachedAt);
  const pending = useTabs((s) => s.tabs.filter((t) => t.pendingSave).length);
  const [checking, setChecking] = useState(false);

  if (online) return null;

  return (
    <div
      role="status"
      className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-warning/30 bg-warning/10 px-3 py-1.5 text-xs text-fg"
    >
      <CloudOff className="h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
      <span className="font-medium">
        {browser ? t('banners.offline.unreachable') : t('banners.offline.noInternet')}
      </span>
      <span className="text-fg-muted">
        {lastReachedAt
          ? t('banners.offline.cachedSince', { ago: timeAgo(lastReachedAt) })
          : t('banners.offline.cached')}{' '}
        {isDesktop() ? t('banners.offline.sendDesktop') : t('banners.offline.sendServer')}{' '}
        {pending > 0 ? t('banners.offline.pending', { count: pending }) : t('banners.offline.noPending')}
      </span>
      <button
        type="button"
        onClick={() => {
          setChecking(true);
          void probe().finally(() => setChecking(false));
        }}
        disabled={checking}
        className="ms-auto flex items-center gap-1 rounded px-2 py-0.5 font-medium text-accent hover:bg-accent/10"
      >
        {checking && <Spinner className="h-3 w-3" />} {t('banners.offline.retry')}
      </button>
    </div>
  );
}
