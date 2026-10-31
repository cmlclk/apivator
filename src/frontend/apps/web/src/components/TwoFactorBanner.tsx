import { Link } from 'react-router';
import { ShieldAlert } from 'lucide-react';
import { useT } from '../i18n';
import { useSession } from '../stores/session';

/** Organizasyon iki adımlı doğrulamayı zorunlu kılmış ama kullanıcınınki kapalı: workspace'leri görünmez. */
export function TwoFactorBanner() {
  const t = useT('shell');
  const user = useSession((s) => s.user);
  const required = user?.twoFactorRequiredBy ?? [];
  if (!user || user.twoFactorEnabled || required.length === 0) return null;
  return (
    <div
      role="status"
      className="flex items-center gap-2 border-b border-warning/30 bg-warning/10 px-4 py-1.5 text-xs"
    >
      <ShieldAlert className="h-3.5 w-3.5 text-warning" aria-hidden="true" />
      <span>
        {t.rich(
          'banners.twoFactor.required',
          { b: (c) => <strong className="font-medium">{c}</strong> },
          { organizations: required.join(', '), count: required.length },
        )}
      </span>
      <Link to="/account?tab=security" className="font-medium text-accent hover:underline">
        {t('banners.twoFactor.setUp')}
      </Link>
    </div>
  );
}
