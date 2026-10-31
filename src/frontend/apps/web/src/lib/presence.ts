import { useRealtime } from './realtime';
import { toUpper } from '../i18n';
import { useSession } from '../stores/session';

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => toUpper(part[0]!))
    .join('');
}

// Kişiye göre sabit renk: aynı kişi her yerde aynı renkte görünür.
const COLORS = [
  'bg-sky-600',
  'bg-violet-600',
  'bg-amber-600',
  'bg-rose-600',
  'bg-emerald-600',
  'bg-fuchsia-600',
];

export function presenceColor(userId: string) {
  let hash = 0;
  for (const ch of userId) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return COLORS[Math.abs(hash) % COLORS.length]!;
}

/** Bu workspace'te çevrimiçi olan diğer kişiler. */
export function useOthersOnline() {
  const me = useSession((s) => s.user?.id);
  const users = useRealtime((s) => s.presence?.users);
  return users?.filter((u) => u.userId !== me) ?? [];
}

/** Bu isteği açık tutan diğer kişiler. */
export function useRequestViewers(requestId: string | null) {
  const others = useOthersOnline();
  return requestId ? others.filter((u) => u.requestIds.includes(requestId)) : [];
}
