import { CloudOff } from 'lucide-react';
import { cn } from '@apivator/ui';
import { useRealtime, type PresenceUser } from '../lib/realtime';
import { initials, presenceColor, useOthersOnline } from '../lib/presence';
import { useT } from '../i18n';

export function Avatar({
  user,
  size = 'md',
}: {
  user: Pick<PresenceUser, 'userId' | 'displayName'>;
  size?: 'sm' | 'md';
}) {
  return (
    <span
      title={user.displayName}
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full font-semibold text-white ring-2 ring-surface',
        size === 'sm' ? 'h-5 w-5 text-[9px]' : 'h-7 w-7 text-[11px]',
        presenceColor(user.userId),
      )}
    >
      {initials(user.displayName)}
    </span>
  );
}

/** Bu workspace'te şu an çevrimiçi olan ekip arkadaşları; bağlantı koptuysa uyarı. */
export function PresenceAvatars() {
  const t = useT('shell');
  const status = useRealtime((s) => s.status);
  const others = useOthersOnline();

  if (status === 'reconnecting' || status === 'offline') {
    return (
      <span
        role="status"
        title={t('presence.pausedTitle')}
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-fg-subtle"
      >
        <CloudOff className="h-3.5 w-3.5" aria-hidden="true" />
        {status === 'reconnecting' ? t('presence.reconnecting') : t('presence.offline')}
      </span>
    );
  }
  if (others.length === 0) return null;

  const shown = others.slice(0, 4);
  const names = others.map((u) => u.displayName).join(', ');
  return (
    <div
      role="group"
      aria-label={t('presence.onlineAria', { names })}
      title={t('presence.onlineTitle', { names })}
      className="flex items-center -space-x-1.5"
    >
      {shown.map((u) => (
        <Avatar key={u.userId} user={u} />
      ))}
      {others.length > shown.length && (
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-fg-muted ring-2 ring-surface">
          +{others.length - shown.length}
        </span>
      )}
    </div>
  );
}
