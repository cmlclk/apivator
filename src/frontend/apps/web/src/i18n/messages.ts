import { createElement, Fragment, use, useMemo, type ReactNode } from 'react';
import { registerCoreMessages, setCoreLanguage, setCoreTemplateTransform } from '@apivator/core';
import { formatMessage, type MessageParams } from './icu';
import {
  browserLanguage,
  currentLanguage,
  currentLocale,
  DEFAULT_LANGUAGE,
  readStoredLanguage,
  storeLanguage,
  useLocale,
  type Language,
} from './locale';
import type { Namespace, Resources } from './resources';

/** Nokta ile ayrılmış anahtar yolları (`{ a: { b: '' } }` → `"a.b"`); yanlış anahtar derlemede hata verir. */
type Leaves<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];

export type MessageKey<N extends Namespace> = Leaves<Resources[N]>;

/** Metin içindeki etiketlerin (`<b>…</b>`, `<link>…</link>`, `<br/>`) yerine konacak öğeler. */
export type RichComponents = Record<string, (children: ReactNode) => ReactNode>;

export interface TFunction<N extends Namespace> {
  (key: MessageKey<N>, params?: MessageParams): string;
  rich(key: MessageKey<N>, components: RichComponents, params?: MessageParams): ReactNode;
}

type Messages = Map<string, string>;

/**
 * Dil dosyaları ayrı parçalarda ve yalnızca seçilen dil yüklenir. `tools*` ad alanları (Faz 7 araçları, en büyük
 * metinler) araçlar açılınca ayrıca yüklenir; geri kalanlar dil başına tek parçadadır (`locales/<dil>/index.ts`).
 */
const LAZY_NAMESPACES: ReadonlySet<Namespace> = new Set<Namespace>([
  'tools',
  'toolsData',
  'toolsSecurity',
  'toolsMisc',
]);

const bundleLoaders = import.meta.glob<{ default: Record<string, unknown> }>('./locales/*/index.ts');
const lazyLoaders = import.meta.glob<Record<string, unknown>>('./locales/*/tools*.json', {
  import: 'default',
});

/**
 * Core'un kendi metinlerinin (araç hataları, cron açıklaması…) Türkçe dışındaki katalogları. Türkçe kodda olduğundan
 * yüklenecek bir şey yoktur; `tools*.json` katalogları araçlarla birlikte, diğerleri dil parçasıyla yüklenir.
 */
const coreLoaders = import.meta.glob<Record<string, unknown>>(
  '../../../../packages/core/src/locales/*/*.json',
  {
    import: 'default',
  },
);

function loadCoreCatalogs(language: Language, tools: boolean): Promise<void> {
  const id = `core:${language}:${tools ? 'tools' : 'app'}`;
  let promise = pending.get(id);
  if (!promise) {
    const files = Object.entries(coreLoaders).flatMap(([path, load]) => {
      const [, lang, name] = /\/locales\/([^/]+)\/([^/]+)\.json$/.exec(path) ?? [];
      return lang === language && name!.startsWith('tools') === tools ? [{ name: name!, load }] : [];
    });
    promise = Promise.all(
      files.map(async ({ name, load }) => {
        registerCoreMessages(language, { [name]: await load() });
      }),
    ).then(() => undefined);
    promise.catch(() => pending.delete(id));
    pending.set(id, promise);
  }
  return promise;
}

const loaded = new Map<string, Messages>();

/** Etkin dilde bulunmayan metin için sırayla bakılan diller (sonra `ns:anahtar` döner). */
const FALLBACK_LANGUAGES: readonly Language[] = ['en', 'tr'];

/** Türkçe ve İngilizce eksiksiz tutulur (CI); başka dil eksik bırakabilir, bu yüzden onun için İngilizce de yüklenir. */
const needsFallback = (language: Language) => !FALLBACK_LANGUAGES.includes(language);

const pending = new Map<string, Promise<void>>();
const slot = (language: string, ns: Namespace) => `${language}:${ns}`;

function flatten(source: Record<string, unknown>, prefix = '', into: Messages = new Map()): Messages {
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'string') into.set(prefix + key, value);
    else if (value && typeof value === 'object')
      flatten(value as Record<string, unknown>, `${prefix}${key}.`, into);
  }
  return into;
}

export function isNamespaceLoaded(language: Language, ns: Namespace): boolean {
  return loaded.has(slot(language, ns));
}

function loadBundle(language: Language): Promise<void> {
  const id = `${language}:*`;
  let promise = pending.get(id);
  if (!promise) {
    const loader = bundleLoaders[`./locales/${language}/index.ts`];
    if (!loader) return Promise.reject(new Error(`Dil dosyası yok: ${language}`));
    promise = Promise.all([
      loader(),
      loadCoreCatalogs(language, false),
      needsFallback(language) ? loadBundle(FALLBACK_LANGUAGES[0]!) : undefined,
    ]).then(([{ default: bundle }]) => {
      for (const [ns, messages] of Object.entries(bundle)) {
        loaded.set(slot(language, ns as Namespace), flatten(messages as Record<string, unknown>));
      }
    });
    promise.catch(() => pending.delete(id));
    pending.set(id, promise);
  }
  return promise;
}

export function loadNamespace(language: Language, ns: Namespace): Promise<void> {
  if (!LAZY_NAMESPACES.has(ns)) return loadBundle(language);
  const id = slot(language, ns);
  let promise = pending.get(id);
  if (!promise) {
    const loader = lazyLoaders[`./locales/${language}/${ns}.json`];
    if (!loader) return Promise.reject(new Error(`Dil dosyası yok: ${id}`));
    promise = Promise.all([
      loader(),
      loadCoreCatalogs(language, true),
      needsFallback(language) ? loadNamespace(FALLBACK_LANGUAGES[0]!, ns) : undefined,
    ]).then(([messages]) => void loaded.set(id, flatten(messages)));
    promise.catch(() => pending.delete(id));
    pending.set(id, promise);
  }
  return promise;
}

/**
 * Sözde dil (yalnızca geliştirme/test; `i18n/pseudo.ts`): çeviri şablonlarına uygulanan dönüşüm. Gerçek bir dil
 * seçilince kapanır. Üretim paketi `pseudo.ts`yi hiç içermez; burada yalnızca boş bir kanca durur.
 */
let templateTransform: ((template: string) => string) | null = null;

/** Dil yüklendikten sonra: arayüz, core metinleri ve `<html lang>` birlikte geçer. */
function applyLanguage(language: Language, explicit: boolean) {
  templateTransform = null;
  setCoreTemplateTransform(null);
  setCoreLanguage(language);
  useLocale.setState({ language, explicit, pseudo: false });
  if (typeof document !== 'undefined') document.documentElement.lang = language;
}

/** Sözde dili açar (İngilizce yüklüyken çağrılır): web ve core şablonları `transform`dan geçer. */
export function applyPseudoTransform(transform: (template: string) => string): void {
  templateTransform = transform;
  setCoreTemplateTransform(transform);
  useLocale.setState({ pseudo: true });
  if (typeof document !== 'undefined') document.documentElement.lang = 'en-XA';
}

/**
 * Dili değiştirir: önce yeni dilin dosyaları (ve şu an açık olan tembel ad alanları) yüklenir, sonra tüm
 * arayüz sayfa yenilenmeden yeni dille çizilir. `explicit`: kullanıcının seçimi (bu cihazda hatırlanır).
 */
export async function setLanguage(language: Language, { explicit = true } = {}): Promise<void> {
  const previous = currentLanguage();
  const lazyOpen = [...LAZY_NAMESPACES].filter((ns) => isNamespaceLoaded(previous, ns));
  await Promise.all([loadBundle(language), ...lazyOpen.map((ns) => loadNamespace(language, ns))]);
  if (explicit) storeLanguage(language);
  applyLanguage(language, explicit || useLocale.getState().explicit);
}

/**
 * Açılışta dil seçimi: bu cihazdaki son seçim (sunucudaki tercih de buraya yazılır) → tarayıcı dili → Türkçe.
 * Arayüz bu söz bitmeden çizilmez. Testler `initI18n('tr')` ile sabit dil kullanır.
 */
export async function initI18n(forced?: Language): Promise<void> {
  const stored = forced ? null : readStoredLanguage();
  const language = forced ?? stored ?? browserLanguage() ?? DEFAULT_LANGUAGE;
  try {
    await loadBundle(language);
  } catch {
    // Dil parçası indirilemezse (ör. çevrimdışı ve önbellekte yok) varsayılan dille açılır.
    if (language === DEFAULT_LANGUAGE) throw new Error('Dil dosyası yüklenemedi.');
    return initI18n(DEFAULT_LANGUAGE);
  }
  applyLanguage(language, stored !== null);
}

/** Metni etkin dilde, yoksa yedek dillerde (İngilizce → Türkçe) arar; hiçbirinde yoksa `undefined`. */
export function lookupMessage(
  store: ReadonlyMap<string, ReadonlyMap<string, string>>,
  language: string,
  ns: Namespace,
  key: string,
): string | undefined {
  for (const candidate of [language, ...FALLBACK_LANGUAGES]) {
    const message = store.get(slot(candidate, ns))?.get(key);
    if (message !== undefined) return message;
  }
  return undefined;
}

/** Bileşen dışında (store, yardımcı fonksiyon) çeviri. Ad alanı yüklü olmalı (tembel olanlar hariç hep yüklüdür). */
export function translate<N extends Namespace>(ns: N, key: MessageKey<N>, params?: MessageParams): string {
  const message = lookupMessage(loaded, currentLanguage(), ns, key);
  if (message === undefined) {
    if (import.meta.env.DEV) console.warn(`Çeviri anahtarı yok: ${ns}:${key}`);
    return `${ns}:${key}`;
  }
  return formatMessage(templateTransform ? templateTransform(message) : message, currentLocale(), params);
}

/** Kullanıcı verisindeki `<` etiket sanılmasın diye parametrelerde geçici olarak başka karaktere çevrilir. */
const LT = '';

export function translateRich<N extends Namespace>(
  ns: N,
  key: MessageKey<N>,
  components: RichComponents,
  params?: MessageParams,
): ReactNode {
  const safe: MessageParams = {};
  for (const [name, value] of Object.entries(params ?? {})) {
    safe[name] = typeof value === 'string' ? value.replaceAll('<', LT) : value;
  }
  return renderTags(translate(ns, key, safe), components);
}

const TAG = /<([a-zA-Z][\w-]*)\s*(\/)?>/;

function renderTags(text: string, components: RichComponents): ReactNode {
  const parts: ReactNode[] = [];
  let rest = text;
  for (;;) {
    const match = TAG.exec(rest);
    if (!match) break;
    const [open, name, selfClosing] = match;
    const before = rest.slice(0, match.index);
    if (before) parts.push(before.replaceAll(LT, '<'));
    const render = components[name!];
    rest = rest.slice(match.index + open.length);
    let inner: ReactNode = null;
    if (!selfClosing) {
      const close = `</${name}>`;
      const end = rest.indexOf(close);
      const body = end < 0 ? rest : rest.slice(0, end);
      inner = renderTags(body, components);
      rest = end < 0 ? '' : rest.slice(end + close.length);
    }
    parts.push(createElement(Fragment, { key: parts.length }, render ? render(inner) : inner));
  }
  if (rest) parts.push(rest.replaceAll(LT, '<'));
  return parts.length === 1 && typeof parts[0] === 'string'
    ? parts[0]
    : createElement(Fragment, null, ...parts);
}

/**
 * Bileşende çeviri: `const t = useT('requests'); t('send')`, `t('items', { count })`,
 * `t.rich('hint', { b: (c) => <strong>{c}</strong> })`. Dil değişince bileşen yeniden çizilir.
 * Tembel ad alanı henüz yüklenmediyse en yakın `Suspense` sınırı beklenir.
 */
export function useT<N extends Namespace>(ns: N): TFunction<N> {
  const language = useLocale((s) => s.language);
  const pseudo = useLocale((s) => s.pseudo);
  if (!isNamespaceLoaded(language, ns)) use(loadNamespace(language, ns));
  // Dil değişince yeni fonksiyon döner; t'ye bağlı memo ve efektler tazelenir.
  return useMemo(
    () =>
      Object.assign((key: MessageKey<N>, params?: MessageParams) => translate(ns, key, params), {
        rich: (key: MessageKey<N>, components: RichComponents, params?: MessageParams) =>
          translateRich(ns, key, components, params),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- translate etkin dili okur; language yalnızca tetikleyici
    [ns, language, pseudo],
  );
}
