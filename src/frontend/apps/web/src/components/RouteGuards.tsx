import { Navigate, Outlet, useLocation, useSearchParams } from 'react-router';
import { useSession } from '../stores/session';
import { safeRedirect } from '../lib/safeRedirect';
import { isLocalMode } from '../lib/localMode';

export function RequireAuth() {
  const status = useSession((s) => s.status);
  const location = useLocation();

  // Çevrimdışı: bu cihazdaki son oturumla, önbellekteki verilerle açılır.
  if (status !== 'authenticated' && status !== 'offline') {
    const redirect = location.pathname + location.search;
    const to = redirect === '/' ? '/login' : `/login?redirect=${encodeURIComponent(redirect)}`;
    return <Navigate to={to} replace />;
  }

  return <Outlet />;
}

export function GuestOnly() {
  const status = useSession((s) => s.status);
  const [params] = useSearchParams();

  if (status === 'authenticated' || status === 'offline') {
    return <Navigate to={safeRedirect(params.get('redirect'))} replace />;
  }

  return <Outlet />;
}

/** Ekip sayfaları (ekip, davet): kişisel kullanımda (yerel mod) yok, ana ekrana dönülür. */
export function TeamOnly() {
  return isLocalMode() ? <Navigate to="/" replace /> : <Outlet />;
}
