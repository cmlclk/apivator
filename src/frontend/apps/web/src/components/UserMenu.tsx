import { useCallback, useRef, useState } from 'react';
import { Building2, LogOut, UserCog } from 'lucide-react';
import { Avatar } from './Avatar';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { api } from '../lib/api';
import { isLocalMode } from '../lib/localMode';
import { useSession } from '../stores/session';
import { useDismiss } from './useDismiss';
import { useT } from '../i18n';

export function UserMenu() {
  const t = useT('shell');
  const user = useSession((s) => s.user);
  const setSession = useSession((s) => s.setSession);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);

  if (!user) return null;

  async function logout() {
    try {
      await api.auth.logout();
    } finally {
      setSession(null);
      queryClient.clear();
      navigate('/login', { replace: true });
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('userMenu.account')}
        className="rounded-full hover:ring-2 hover:ring-accent/25"
      >
        <Avatar
          userId={user.id}
          name={user.displayName}
          version={user.avatarVersion}
          className="h-8 w-8 text-xs"
        />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute end-0 top-full z-20 mt-1 w-64 rounded-lg border border-line bg-surface p-1 shadow-lg"
        >
          <div className="flex items-center gap-3 px-3 py-2">
            <Avatar
              userId={user.id}
              name={user.displayName}
              version={user.avatarVersion}
              className="h-9 w-9 text-sm"
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{user.displayName}</p>
              {/* Yerel kullanıcının e-postası yapaydır (local@apivator.local). */}
              {!isLocalMode() && <p className="truncate text-xs text-fg-subtle">{user.email}</p>}
            </div>
          </div>
          <div className="my-1 border-t border-line" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              close();
              navigate('/account');
            }}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-fg-muted hover:bg-muted hover:text-fg"
          >
            <UserCog className="h-4 w-4" /> {t('userMenu.settings')}
          </button>
          {!isLocalMode() && (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  close();
                  navigate('/team');
                }}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-fg-muted hover:bg-muted hover:text-fg"
              >
                <Building2 className="h-4 w-4" /> {t('userMenu.team')}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={logout}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-fg-muted hover:bg-muted hover:text-fg"
              >
                <LogOut className="h-4 w-4" /> {t('userMenu.logout')}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
