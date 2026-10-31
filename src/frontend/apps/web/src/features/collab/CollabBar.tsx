import { Users } from 'lucide-react';
import { Alert, Button } from '@apivator/ui';
import { useT, type TFunction } from '../../i18n';
import { initials } from '../../lib/presence';
import { collabManager } from './collabManager';
import { useTabCollab } from './collabStore';
import type { CollabPeer } from './CollabSession';

const FIELD_KEYS = {
  url: 'fields.url',
  'body.raw': 'fields.body',
  'body.graphqlVariables': 'fields.graphqlVariables',
  'scripts.preRequest': 'fields.preRequest',
  'scripts.postResponse': 'fields.postResponse',
  description: 'fields.description',
  'grpc.message': 'fields.message',
} as const;

function fieldLabel(t: TFunction<'collab'>, field: string | null) {
  if (!field) return null;
  return field in FIELD_KEYS ? t(FIELD_KEYS[field as keyof typeof FIELD_KEYS]) : field;
}

/** Aynı kişinin birden fazla sekmesi tek avatar olur. */
function uniquePeers(peers: CollabPeer[]): CollabPeer[] {
  const seen = new Map<string, CollabPeer>();
  for (const peer of peers) {
    const known = seen.get(peer.userId);
    if (!known || (!known.field && peer.field)) seen.set(peer.userId, peer);
  }
  return [...seen.values()];
}

/** Ortak düzenleyenlerin avatarları (imleç rengiyle) ve ortak taslağın durumu. */
export function CollabAvatars({ tabId }: { tabId: string }) {
  const t = useT('collab');
  const { peers } = useTabCollab(tabId);
  const people = uniquePeers(peers);
  if (people.length === 0) return null;
  const names = people
    .map((p) => (p.field ? t('bar.peerWithField', { name: p.name, field: fieldLabel(t, p.field)! }) : p.name))
    .join(', ');
  return (
    <div
      role="group"
      aria-label={t('bar.editorsLabel', { names })}
      title={t('bar.editorsTitle', { names })}
      className="flex items-center gap-1.5"
    >
      <Users className="h-3.5 w-3.5 text-fg-subtle" aria-hidden="true" />
      <div className="flex items-center -space-x-1">
        {people.slice(0, 4).map((p) => (
          <span
            key={p.userId}
            title={
              p.field ? t('bar.peerTitleWithField', { name: p.name, field: fieldLabel(t, p.field)! }) : p.name
            }
            style={{ backgroundColor: p.color }}
            className="flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-semibold text-white ring-2 ring-surface"
          >
            {initials(p.name)}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Kaydedilmemiş yerel değişiklik ortak taslakla çakıştığında seçim; bekleme ve salt okunur bilgileri. */
export function CollabNotice({ tabId }: { tabId: string }) {
  const t = useT('collab');
  const { status } = useTabCollab(tabId);
  if (status === 'conflict') {
    const session = collabManager.session(tabId);
    return (
      <Alert tone="warning" className="mx-4 mt-2 flex flex-wrap items-center justify-between gap-3">
        <span>{t('bar.conflict')}</span>
        <span className="flex shrink-0 gap-2">
          <Button size="sm" variant="secondary" onClick={() => session?.adopt()}>
            {t('bar.join')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void session?.goSolo()}>
            {t('bar.solo')}
          </Button>
        </span>
      </Alert>
    );
  }
  if (status === 'waiting') {
    return (
      <Alert tone="info" className="mx-4 mt-2">
        {t('bar.waiting')}
      </Alert>
    );
  }
  return null;
}
