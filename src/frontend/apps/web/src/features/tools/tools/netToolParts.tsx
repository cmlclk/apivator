import { Alert } from '@apivator/ui';
import type { CookieWarning } from '@apivator/core/tools';
import { useT } from '../../../i18n';

/** Çerez, User-Agent ve CIDR araçlarının ortak parçaları. */

const TONES = { error: 'error', warning: 'warning', info: 'info' } as const;

/** Uyarıları önem sırasıyla (hata, uyarı, bilgi) listeler. */
export function WarningList({ warnings }: { warnings: CookieWarning[] }) {
  const t = useT('toolsMisc');
  if (!warnings.length) return null;
  const order = { error: 0, warning: 1, info: 2 };
  const sorted = [...warnings].sort((a, b) => order[a.level] - order[b.level]);
  return (
    <ul className="flex flex-col gap-1" aria-label={t('net.warnings')}>
      {sorted.map((w, i) => (
        <li key={i}>
          <Alert tone={TONES[w.level]} className="px-2 py-1 text-xs">
            {w.message}
          </Alert>
        </li>
      ))}
    </ul>
  );
}

/** Açıklayıcı notlar (küçük, soluk metin). */
export function NoteList({ notes, label }: { notes: string[]; label?: string }) {
  const t = useT('toolsMisc');
  if (!notes.length) return null;
  return (
    <ul
      className="flex list-disc flex-col gap-1 ps-5 text-xs text-fg-muted"
      aria-label={label ?? t('net.notes')}
    >
      {notes.map((note) => (
        <li key={note}>{note}</li>
      ))}
    </ul>
  );
}
