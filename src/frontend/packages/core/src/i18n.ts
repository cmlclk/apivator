import { formatMessage, type MessageParams } from './icu';

/**
 * Core'un kullanıcıya gösterilen metinleri (araç hataları, cron açıklaması, başvuru verileri…).
 *
 * Türkçe kaynak dildir ve metin kodda kalır: `msg('jwt.invalid', 'Geçersiz JWT: {reason}', { reason })`.
 * Diğer diller `locales/<dil>/*.json` kataloglarından gelir; arayüz dili değişince istemci kataloğu
 * `registerCoreMessages` ile yükler ve `setCoreLanguage` çağırır. Katalogda olmayan metin önce İngilizce, o da yoksa Türkçe gösterilir.
 * Kimlikler katalog dosyasının adıyla başlar (`cron.*` → `cron.json`); `core.json` ve `cron.json` açılışta,
 * araç katalogları (`tools*.json`) araçlar açılınca yüklenir.
 */

export type CoreLanguage = 'tr' | 'en';

/** Etkin dilde bulunmayan metin için ikinci durak (sonra kodda yazan Türkçe). */
const FALLBACK_LANGUAGE: CoreLanguage = 'en';

let language: CoreLanguage = 'tr';
/** Sözde dil (yalnızca geliştirme/test): etkin şablon biçimlenmeden önce bu işlevden geçer. */
let templateTransform: ((template: string) => string) | null = null;
const catalogs = new Map<CoreLanguage, Map<string, string>>();

export function setCoreLanguage(next: CoreLanguage): void {
  language = next;
}

export function setCoreTemplateTransform(transform: ((template: string) => string) | null): void {
  templateTransform = transform;
}

export function coreLanguage(): CoreLanguage {
  return language;
}

const LOCALE_TAGS: Record<CoreLanguage, string> = { tr: 'tr-TR', en: 'en-US' };

/** `Intl` için etkin dil etiketi. */
export function coreLocale(): string {
  return LOCALE_TAGS[language];
}

/** Katalog ekler (iç içe nesneler nokta ile düzleşir); aynı kimlik yeniden yazılırsa yenisi geçerlidir. */
export function registerCoreMessages(target: CoreLanguage, messages: Record<string, unknown>): void {
  let catalog = catalogs.get(target);
  if (!catalog) catalogs.set(target, (catalog = new Map()));
  const walk = (source: Record<string, unknown>, prefix: string) => {
    for (const [key, value] of Object.entries(source)) {
      if (typeof value === 'string') catalog.set(prefix + key, value);
      else if (value && typeof value === 'object') walk(value as Record<string, unknown>, `${prefix}${key}.`);
    }
  };
  walk(messages, '');
}

/** Etkin dilde metin; `tr` kodda yazan Türkçe metindir (ICU söz dizimi). */
export function msg(id: string, tr: string, params?: MessageParams): string {
  const template =
    language === 'tr'
      ? tr
      : (catalogs.get(language)?.get(id) ?? catalogs.get(FALLBACK_LANGUAGE)?.get(id) ?? tr);
  return formatMessage(templateTransform ? templateTransform(template) : template, coreLocale(), params);
}

/** Yalnızca katalogdan bakar (dinamik kimlikli veri tabloları için); yoksa `undefined`. */
export function catalogMessage(id: string, params?: MessageParams): string | undefined {
  if (language === 'tr') return undefined;
  const template = catalogs.get(language)?.get(id) ?? catalogs.get(FALLBACK_LANGUAGE)?.get(id);
  return template === undefined
    ? undefined
    : formatMessage(templateTransform ? templateTransform(template) : template, coreLocale(), params);
}
