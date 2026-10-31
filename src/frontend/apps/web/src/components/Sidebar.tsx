import {
  Activity,
  Clock,
  FolderTree,
  GitPullRequest,
  HeartPulse,
  Layers,
  Server,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { lazy, Suspense } from 'react';
import { Link } from 'react-router';
import { cn } from '@apivator/ui';
import { useUi, type SidebarSection } from '../stores/ui';
import { CollectionsPanel } from '../features/collections/CollectionsPanel';
import { EnvironmentsPanel } from '../features/environments/EnvironmentsPanel';
import { HistoryPanel } from '../features/history/HistoryPanel';
import { useT, type MessageKey } from '../i18n';
import { isLocalMode } from '../lib/localMode';

// Seyrek açılan bölümler ana pakete girmez; yüklenirken yerleri boş panel olarak tutulur.
const ActivityPanel = lazy(() =>
  import('../features/activity/ActivityPanel').then((m) => ({ default: m.ActivityPanel })),
);
const MocksPanel = lazy(() =>
  import('../features/mocks/MocksPanel').then((m) => ({ default: m.MocksPanel })),
);
const MonitorsPanel = lazy(() =>
  import('../features/monitors/MonitorsPanel').then((m) => ({ default: m.MonitorsPanel })),
);
const MergeRequestsPanel = lazy(() =>
  import('../features/forks/MergeRequestsPanel').then((m) => ({ default: m.MergeRequestsPanel })),
);

const sections: { id: SidebarSection; label: MessageKey<'shell'>; icon: LucideIcon }[] = [
  {
    id: 'collections',
    label: 'sidebar.collections',
    icon: FolderTree,
  },
  {
    id: 'environments',
    label: 'sidebar.environments',
    icon: Layers,
  },
  {
    id: 'mocks',
    label: 'sidebar.mocks',
    icon: Server,
  },
  {
    id: 'monitors',
    label: 'sidebar.monitors',
    icon: HeartPulse,
  },
  {
    id: 'merges',
    label: 'sidebar.merges',
    icon: GitPullRequest,
  },
  {
    id: 'history',
    label: 'sidebar.history',
    icon: Clock,
  },
  {
    id: 'activity',
    label: 'sidebar.activity',
    icon: Activity,
  },
];

// Kişisel kullanımda ekip bölümleri (merge istekleri, aktivite) yok.
const teamSections: SidebarSection[] = ['merges', 'activity'];

export function Sidebar() {
  const t = useT('shell');
  const local = isLocalMode();
  const visible = local ? sections.filter((s) => !teamSections.includes(s.id)) : sections;
  const stored = useUi((s) => s.sidebarSection);
  const active = visible.some((s) => s.id === stored) ? stored : 'collections';
  const setActive = useUi((s) => s.setSidebarSection);

  return (
    <div className="flex h-full">
      <nav
        aria-label={t('sidebar.sections')}
        className="flex w-20 shrink-0 flex-col items-center gap-1 border-e border-line bg-surface py-2"
      >
        {visible.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setActive(id)}
            aria-current={id === active ? 'page' : undefined}
            className={cn(
              'flex w-[72px] flex-col items-center gap-1 rounded-md px-1 py-2 text-center text-[10.5px] leading-tight font-medium hyphens-auto [overflow-wrap:anywhere]',
              id === active ? 'bg-accent/10 text-accent' : 'text-fg-subtle hover:bg-muted hover:text-fg',
            )}
          >
            <Icon className="h-4.5 w-4.5" aria-hidden="true" />
            {t(label)}
          </button>
        ))}
        {/* Araçlar tam sayfa açılır (/tools); istek ekranının paneli değildir. */}
        <Link
          to="/tools"
          className="flex w-[72px] flex-col items-center gap-1 rounded-md px-1 py-2 text-center text-[10.5px] leading-tight font-medium hyphens-auto [overflow-wrap:anywhere] text-fg-subtle hover:bg-muted hover:text-fg"
        >
          <Wrench className="h-4.5 w-4.5" aria-hidden="true" />
          {t('sidebar.tools')}
        </Link>
      </nav>

      <Suspense fallback={<div className="w-72 shrink-0 border-e border-line bg-surface" />}>
        {active === 'collections' ? (
          <CollectionsPanel />
        ) : active === 'environments' ? (
          <EnvironmentsPanel />
        ) : active === 'mocks' ? (
          <MocksPanel />
        ) : active === 'monitors' ? (
          <MonitorsPanel />
        ) : active === 'merges' ? (
          <MergeRequestsPanel />
        ) : active === 'activity' ? (
          <ActivityPanel />
        ) : (
          <HistoryPanel />
        )}
      </Suspense>
    </div>
  );
}
