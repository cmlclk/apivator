import { toUpper, translate } from '../../i18n';
import { UserError } from '../../lib/errors';
import { serverUrl } from '../../lib/serverUrl';

/** Ad soyadın baş harfleri (en fazla iki). */
export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => toUpper(part[0]!))
    .join('');
}

/** Profil görselinin adresi; sürüm değişince tarayıcı önbelleği atlanır. Görsel yoksa null. */
export function avatarUrl(userId: string, version: number | null | undefined): string | null {
  return version ? `${serverUrl()}/api/users/${userId}/avatar?v=${version}` : null;
}

export const AVATAR_SIZE = 256;
export const AVATAR_MAX_FILE = 10 * 1024 * 1024;

/**
 * Seçilen görseli ortadan kare kırpıp 256×256'ya küçültür (WebP; desteklenmiyorsa PNG). Sunucuya küçük ve
 * meta verisi (konum vb.) temizlenmiş bir dosya gider.
 */
export async function prepareAvatar(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new UserError(translate('account', 'avatar.notImage'));
  if (file.size > AVATAR_MAX_FILE) throw new UserError(translate('account', 'avatar.tooLarge'));

  const bitmap = await createImageBitmap(file).catch(() => {
    throw new UserError(translate('account', 'avatar.unreadable'));
  });
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const context = canvas.getContext('2d');
  if (!context) throw new UserError(translate('account', 'avatar.failed'));
  context.imageSmoothingQuality = 'high';
  context.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    AVATAR_SIZE,
    AVATAR_SIZE,
  );
  bitmap.close();

  const encode = (type: string, quality?: number) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  // Safari WebP üretemezse PNG döner; tür kontrolüyle ayırt edilir.
  const webp = await encode('image/webp', 0.9);
  if (webp?.type === 'image/webp') return webp;
  const png = await encode('image/png');
  if (!png) throw new UserError(translate('account', 'avatar.failed'));
  return png;
}
