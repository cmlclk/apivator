import { lazy, Suspense, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import { Network } from 'lucide-react';
import { Logo } from './Logo';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { ThemeToggle } from './ThemeToggle';
import { LanguageSelect } from './LanguageSelect';
import { useSavePreferences } from '../features/account/preferences';
import { UserMenu } from './UserMenu';
import { EmailBanner } from './EmailBanner';
import { TwoFactorBanner } from './TwoFactorBanner';
import { Sidebar } from './Sidebar';
import { EnvironmentSwitcher } from '../features/environments/EnvironmentSwitcher';
import { UpdateBanner } from './UpdateBanner';
import { InvitationsBanner } from './InvitationsBanner';
import { OfflineBanner } from './OfflineBanner';
import { RealtimeBridge } from './RealtimeBridge';
import { PresenceAvatars } from './PresenceAvatars';
import { WorkspaceSide } from './WorkspaceSide';
import { NotificationsMenu } from './NotificationsMenu';
import { isDesktop } from '../lib/desktop';
import { PreferencesSync } from '../features/account/preferences';
import { useT } from '../i18n';

// Ağ ayarları yalnızca açılınca yüklenir.
const NetworkSettingsDialog = lazy(() =>
  import('./NetworkSettingsDialog').then((m) => ({ default: m.NetworkSettingsDialog })),
);

export function AppShell() {
  const savePreferences = useSavePreferences();
  const t = useT('shell');
  const [networkOpen, setNetworkOpen] = useState(false);
  // Ekip sayfası tam genişlik kullanır; collection kenar çubuğu istek ekranına aittir.
  const showSidebar = useLocation().pathname === '/';
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-surface px-3">
        <Link
          to="/"
          title={t('appShell.home')}
          aria-label={t('appShell.homeAria')}
          className="-ms-1 flex items-center gap-2 rounded-md px-1 py-1 pe-2 hover:bg-muted"
        >
          <Logo className="h-6 w-6" />
          <span className="text-sm font-semibold tracking-tight">Apivator</span>
        </Link>
        <div className="h-5 w-px bg-line" />
        <WorkspaceSwitcher />
        <div className="flex-1" />
        <PresenceAvatars />
        <EnvironmentSwitcher />
        {isDesktop() && (
          <button
            type="button"
            onClick={() => setNetworkOpen(true)}
            aria-label={t('appShell.network')}
            title={t('appShell.networkTitle')}
            className="flex h-8 w-8 items-center justify-center rounded-md text-fg-muted hover:bg-muted hover:text-fg"
          >
            <Network className="h-4 w-4" />
          </button>
        )}
        <NotificationsMenu />
        {/* Seçim hemen uygulanır ve hesaba yazılır (diğer cihazlar ve e-postalar da bu dili kullanır). */}
        <LanguageSelect
          compact
          onChange={(language) => void savePreferences({ language }).catch(() => undefined)}
        />
        <ThemeToggle />
        <UserMenu />
      </header>
      <OfflineBanner />
      <UpdateBanner />
      <EmailBanner />
      <TwoFactorBanner />
      <InvitationsBanner />
      <div className="flex min-h-0 flex-1">
        {showSidebar && <Sidebar />}
        <main className="flex min-w-0 flex-1 flex-col">
          <Outlet />
        </main>
        {showSidebar && <WorkspaceSide />}
      </div>
      <RealtimeBridge />
      <PreferencesSync />
      {networkOpen && (
        <Suspense fallback={null}>
          <NetworkSettingsDialog onClose={() => setNetworkOpen(false)} />
        </Suspense>
      )}
    </div>
  );
}
