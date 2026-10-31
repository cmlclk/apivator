import { useNavigate, useSearchParams } from 'react-router';
import { ArrowLeft, UserCog } from 'lucide-react';
import { useT } from '../../i18n';
import { SegmentedTabs } from '../../components/ui/SegmentedTabs';
import { ApiKeysSection } from './ApiKeysSection';
import { DataTab } from './DataTab';
import { PreferencesTab } from './PreferencesTab';
import { ProfileTab } from './ProfileTab';
import { SecurityTab } from './SecurityTab';
import { isLocalMode } from '../../lib/localMode';

type Tab = 'profile' | 'security' | 'api-keys' | 'preferences' | 'data';

const tabIds: Tab[] = ['profile', 'security', 'api-keys', 'preferences', 'data'];

/** Hesap ayarları: profil, güvenlik, API anahtarları, tercihler, veri dışa aktarma ve hesap silme. */
export function AccountPage() {
  const t = useT('account');
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  // Kişisel kullanımda giriş yok: güvenlik (şifre, 2FA, oturumlar) ve API anahtarları gösterilmez.
  const ids = isLocalMode() ? tabIds.filter((id) => id !== 'security' && id !== 'api-keys') : tabIds;
  const tab = ids.find((id) => id === params.get('tab')) ?? 'profile';
  const tabs = ids.map((id) => ({ id, label: t(`page.tabs.${id}`) }));

  return (
    <div className="flex-1 overflow-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-5 p-6">
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label={t('page.back')}
            title={t('page.back')}
            onClick={() => navigate('/')}
            className="rounded-md p-1.5 text-fg-subtle hover:bg-muted hover:text-fg"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <UserCog className="h-5 w-5 text-fg-subtle" aria-hidden="true" />
          <h1 className="text-lg font-semibold">{t('page.title')}</h1>
        </div>

        <div className="overflow-x-auto border-b border-line">
          <SegmentedTabs
            label={t('page.sections')}
            value={tab}
            onChange={(id) => setParams({ tab: id }, { replace: true })}
            tabs={tabs}
          />
        </div>

        {tab === 'profile' && <ProfileTab />}
        {tab === 'security' && <SecurityTab />}
        {tab === 'api-keys' && <ApiKeysSection />}
        {tab === 'preferences' && <PreferencesTab />}
        {tab === 'data' && <DataTab />}
      </div>
    </div>
  );
}
