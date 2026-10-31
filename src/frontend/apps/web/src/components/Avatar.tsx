import { useState } from 'react';
import { cn } from '@apivator/ui';
import { avatarUrl, initials } from '../features/account/avatar';

/** Profil görseli; yoksa (ya da yüklenemezse) baş harfler. */
export function Avatar({
  userId,
  name,
  version,
  className,
}: {
  userId: string;
  name: string;
  version?: number | null;
  className?: string;
}) {
  const src = avatarUrl(userId, version);
  const [failed, setFailed] = useState<string | null>(null);

  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent/15 font-semibold text-accent',
        className,
      )}
    >
      {src && failed !== src ? (
        <img src={src} alt="" className="h-full w-full object-cover" onError={() => setFailed(src)} />
      ) : (
        <span aria-hidden="true">{initials(name)}</span>
      )}
    </span>
  );
}
