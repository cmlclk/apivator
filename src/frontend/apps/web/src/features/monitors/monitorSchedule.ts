// Cron açıklayıcısı ayrı dosyada: sorgu anahtarları (useMonitors) ana pakette, monitör ekranları tembel yükleniyor.
// Tüm araç kütüphanesi değil yalnız cron alınır.
import { describeCron } from '@apivator/core/tools/cron';
import { translate } from '../../i18n';

const SCHEDULE_PRESET_CRONS = [
  '*/5 * * * *',
  '*/15 * * * *',
  '*/30 * * * *',
  '0 * * * *',
  '0 */6 * * *',
  '0 9 * * *',
  '0 9 * * 1-5',
];

/** Etiketler cron aracıyla aynı açıklayıcıdan gelir ("Her 15 dakikada bir"); dil değişince yeniden hesaplanır. */
export function schedulePresets(): { cron: string; label: string }[] {
  return SCHEDULE_PRESET_CRONS.map((cron) => ({ cron, label: describeCron(cron) }));
}

/** Cron ifadesini okunur hâle getirir (cron aracıyla aynı açıklayıcı); geçersiz ifade olduğu gibi gösterilir. */
export function describeSchedule(cron: string): string {
  try {
    return describeCron(cron);
  } catch {
    return translate('monitors', 'schedule.invalid', { cron: cron.trim().replace(/\s+/g, ' ') });
  }
}
