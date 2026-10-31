import { useQuery } from '@tanstack/react-query';
import {
  KeyRound,
  LifeBuoy,
  Lock,
  LogIn,
  LogOut,
  Mail,
  ShieldCheck,
  ShieldOff,
  ShieldX,
  type LucideIcon,
} from 'lucide-react';
import { Alert, Spinner, cn } from '@apivator/ui';
import type { SecurityEventDto, SecurityEventKind } from '@apivator/core';
import { useT } from '../../i18n';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { fullTime, timeAgo } from '../activity/activity';
import { securityEventsQueryKey } from './preferences';

const kinds: Record<SecurityEventKind, { icon: LucideIcon; warn?: boolean }> = {
  LoginSucceeded: { icon: LogIn },
  LoginFailed: { icon: ShieldX, warn: true },
  LockedOut: { icon: Lock, warn: true },
  PasswordChanged: { icon: KeyRound },
  PasswordReset: { icon: KeyRound },
  EmailChanged: { icon: Mail },
  TwoFactorEnabled: { icon: ShieldCheck },
  TwoFactorDisabled: { icon: ShieldOff, warn: true },
  RecoveryCodesRegenerated: { icon: LifeBuoy },
  RecoveryCodeUsed: { icon: LifeBuoy },
  SessionsRevokedByAdmin: { icon: LogOut, warn: true },
  PasswordResetSentByAdmin: { icon: KeyRound },
};

function EventRow({ event }: { event: SecurityEventDto }) {
  const t = useT('account');
  const known = event.kind in kinds;
  const kind = kinds[event.kind] ?? { icon: LogIn };
  const Icon = kind.icon;
  const meta = [
    event.actorName && `${event.actorName}${event.detail ? ` (${event.detail})` : ''}`,
    !event.actorName && event.detail,
    event.device,
    event.ipAddress,
  ].filter(Boolean);
  return (
    <li className="flex items-start gap-3 px-3 py-2">
      <Icon
        className={cn('mt-0.5 h-4 w-4 shrink-0', kind.warn ? 'text-warning' : 'text-fg-subtle')}
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium">
          {known ? t(`history.kinds.${event.kind}`) : event.kind}
        </span>
        {meta.length > 0 && <span className="block truncate text-xs text-fg-subtle">{meta.join(' · ')}</span>}
      </span>
      <span className="shrink-0 text-xs text-fg-subtle" title={fullTime(event.createdAt)}>
        {timeAgo(event.createdAt)}
      </span>
    </li>
  );
}

/** Son 100 güvenlik olayı: girişler, başarısız denemeler, şifre/e-posta/2FA değişiklikleri, yönetici işlemleri. */
export function SecurityHistory() {
  const t = useT('account');
  const { data, isLoading, error } = useQuery({
    queryKey: securityEventsQueryKey,
    queryFn: api.account.securityEvents,
  });
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] text-fg-muted">{t('history.intro')}</p>
      {isLoading ? (
        <Spinner className="mx-auto h-4 w-4 text-fg-subtle" />
      ) : error ? (
        <Alert tone="error">{errorMessage(error)}</Alert>
      ) : (
        <ul
          aria-label={t('history.list')}
          className="max-h-96 divide-y divide-line overflow-y-auto rounded-md border border-line"
        >
          {(data ?? []).map((e, i) => (
            <EventRow key={`${e.createdAt}-${i}`} event={e} />
          ))}
          {data?.length === 0 && (
            <li className="px-3 py-4 text-center text-xs text-fg-subtle">{t('history.empty')}</li>
          )}
        </ul>
      )}
    </div>
  );
}
