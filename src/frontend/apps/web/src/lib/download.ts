import type { DownloadedFile } from '@apivator/core';
import { isDesktop, saveWithDialog } from './desktop';

/**
 * Dosyayı kaydeder: tarayıcıda indirme olarak, masaüstü uygulamasında "Farklı kaydet" diyaloğuyla.
 * Kullanıcı diyaloğu iptal ederse false döner.
 */
export async function saveFile({ blob, fileName }: DownloadedFile): Promise<boolean> {
  if (isDesktop()) return saveWithDialog(fileName, new Uint8Array(await blob.arrayBuffer()));
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

/** Dosya adında işletim sistemlerinin kabul etmediği karakterleri temizler. */
export function safeFileName(name: string, fallback = 'dosya'): string {
  const cleaned = name
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  return cleaned.slice(0, 120) || fallback;
}
