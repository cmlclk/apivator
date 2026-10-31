// HTTP başvuru verisi: durum kodları, başlıklar ve MIME türleri; Türkçe İ/ı duyarlı arama. Ağa çıkmaz.
import { catalogMessage, coreLanguage, coreLocale } from '../i18n';
import { HTTP_HEADER_DATA } from './httpHeaderData';
import { HTTP_STATUS_DATA } from './httpStatusData';
import { MIME_DATA } from './mimeData';

export type HttpStatusClass = '1xx' | '2xx' | '3xx' | '4xx' | '5xx';

export interface HttpStatusInfo {
  code: number;
  statusClass: HttpStatusClass;
  /** İngilizce standart ifade (reason phrase): `Not Found`. */
  phrase: string;
  /** Türkçe kısa ad. */
  name: string;
  description: string;
  usage: string;
  /** Kaynak metni (`RFC 9110 §15.5.5`); bağlantı değildir. */
  reference: string;
  /** Kullanımdan kalkma, ayrılmış kod gibi notlar. */
  note?: string;
}

export type HttpHeaderDirection = 'request' | 'response' | 'both';

export interface HttpHeaderInfo {
  name: string;
  direction: HttpHeaderDirection;
  group: string;
  description: string;
  example: string;
  reference: string;
}

export interface MimeTypeInfo {
  type: string;
  extensions: string[];
  description: string;
  /** Metin tabanlı (editörde okunabilir). */
  textLike: boolean;
  /** gzip/br ile sıkıştırmaya değer (zaten sıkıştırılmış biçimlerde false). */
  compressible: boolean;
}

const rows = (data: string) =>
  data
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => line.split('|').map((cell) => cell.trim()));

export const HTTP_STATUSES: readonly HttpStatusInfo[] = rows(HTTP_STATUS_DATA).map(
  ([code, phrase, name, description, usage, reference, note]) => ({
    code: Number(code),
    statusClass: `${code![0]}xx` as HttpStatusClass,
    phrase: phrase!,
    name: name!,
    description: description!,
    usage: usage!,
    reference: reference!,
    ...(note ? { note } : {}),
  }),
);

export const HTTP_HEADERS: readonly HttpHeaderInfo[] = rows(HTTP_HEADER_DATA).map(
  ([name, direction, group, description, example, reference]) => ({
    name: name!,
    direction: direction as HttpHeaderDirection,
    group: group!,
    description: description!,
    example: example!,
    reference: reference!,
  }),
);

export const MIME_TYPES: readonly MimeTypeInfo[] = rows(MIME_DATA).map(
  ([type, extensions, description, kind, compress]) => ({
    type: type!,
    extensions: extensions ? extensions.split(/\s+/) : [],
    description: description!,
    textLike: kind === 't',
    compressible: compress === 'c',
  }),
);

// Tablolar Türkçe kalır; etkin dil Türkçe değilse metin alanları katalogdan (`toolsNet.status.<kod>.<alan>`,
// `toolsNet.header.<ad>.<alan>`, `toolsNet.mime.<tür>.description`) okunur, yoksa Türkçesi gösterilir.

/** Tablo satırının metin alanlarını etkin dile çevirir; Türkçede satırın kendisi döner. */
function localize<T extends object>(item: T, prefix: string, fields: readonly (keyof T & string)[]): T {
  if (coreLanguage() === 'tr') return item;
  const result = { ...item };
  for (const field of fields) {
    const text = catalogMessage(`${prefix}.${field}`);
    if (text !== undefined) (result as Record<string, unknown>)[field] = text;
  }
  return result;
}

const HEADER_GROUP_KEYS: Record<string, string> = {
  'İçerik müzakeresi': 'negotiation',
  Aralık: 'range',
  CORS: 'cors',
  Önbellek: 'cache',
  Bilgi: 'info',
  Bağlantı: 'connection',
  'Kimlik doğrulama': 'auth',
  Güvenlik: 'security',
  İçerik: 'content',
  Çerez: 'cookie',
  Gizlilik: 'privacy',
  'Koşullu istek': 'conditional',
  Proxy: 'proxy',
  Yönlendirme: 'redirect',
};

const localizeStatus = (s: HttpStatusInfo) =>
  localize(s, `toolsNet.status.${s.code}`, ['name', 'description', 'usage', 'note']);

function localizeHeader(h: HttpHeaderInfo): HttpHeaderInfo {
  const result = localize(h, `toolsNet.header.${h.name}`, ['description', 'example']);
  const groupKey = HEADER_GROUP_KEYS[h.group];
  const group = groupKey ? catalogMessage(`toolsNet.headerGroup.${groupKey}`) : undefined;
  return group === undefined ? result : { ...result, group };
}

const localizeMime = (m: MimeTypeInfo) =>
  localize(m, `toolsNet.mime.${m.type.replace(/\./g, '_')}`, ['description']);

/** Kodun kayıttaki bilgisi; kayıtlı değilse `undefined`. */
export function httpStatusInfo(code: number): HttpStatusInfo | undefined {
  const status = HTTP_STATUSES.find((s) => s.code === code);
  return status && localizeStatus(status);
}

/** Başlık adına göre (büyük/küçük harf duyarsız). */
export function httpHeaderInfo(name: string): HttpHeaderInfo | undefined {
  const lower = name.trim().toLowerCase();
  const header = HTTP_HEADERS.find((h) => h.name.toLowerCase() === lower);
  return header && localizeHeader(header);
}

/** Türe (parametreler atılır) ya da uzantıya (`.json`, `json`) göre. */
export function mimeTypeInfo(typeOrExtension: string): MimeTypeInfo | undefined {
  const query = typeOrExtension.trim().toLowerCase().split(';')[0]!.trim();
  const mime = query.includes('/')
    ? MIME_TYPES.find((m) => m.type === query)
    : MIME_TYPES.find((m) => m.extensions.includes(query.replace(/^\./, '')));
  return mime && localizeMime(mime);
}

/** Etkin dilin büyük/küçük harf kuralıyla (Türkçede İ/ı) aksan duyarsız karşılaştırma için sadeleştirir. */
function fold(text: string): string {
  return text
    .toLocaleLowerCase(coreLocale())
    .replace(/ı/g, 'i')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

/** Tüm kelimeler metinde geçiyorsa eşleşir; boş sorguda hepsi. */
function filterByTerms<T>(items: readonly T[], query: string, text: (item: T) => string[]): T[] {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return [...items];
  return items.filter((item) => {
    const haystack = fold(text(item).join(' '));
    return terms.every((term) => haystack.includes(term));
  });
}

/** Kod, İngilizce ifade, Türkçe ad, açıklama ve kullanımda arar; `statusClass` verilirse o sınıfla sınırlar. */
export function searchHttpStatuses(query: string, statusClass?: HttpStatusClass): HttpStatusInfo[] {
  const pool = statusClass ? HTTP_STATUSES.filter((s) => s.statusClass === statusClass) : HTTP_STATUSES;
  return filterByTerms(pool.map(localizeStatus), query, (s) => [
    String(s.code),
    s.phrase,
    s.name,
    s.description,
    s.usage,
    s.reference,
    s.note ?? '',
  ]);
}

/** Ad, grup, açıklama ve örnekte arar; `direction` verilirse o yöne (ve iki yönlülere) sınırlar. */
export function searchHttpHeaders(
  query: string,
  direction?: Exclude<HttpHeaderDirection, 'both'>,
): HttpHeaderInfo[] {
  const pool = direction
    ? HTTP_HEADERS.filter((h) => h.direction === direction || h.direction === 'both')
    : HTTP_HEADERS;
  return filterByTerms(pool.map(localizeHeader), query, (h) => [
    h.name,
    h.group,
    h.description,
    h.example,
    h.reference,
  ]);
}

/** Tür, uzantı ve açıklamada arar (`.png` gibi noktalı uzantı da olur). */
export function searchMimeTypes(query: string): MimeTypeInfo[] {
  return filterByTerms(MIME_TYPES.map(localizeMime), query.replace(/(^|\s)\./g, '$1'), (m) => [
    m.type,
    m.extensions.join(' '),
    m.description,
  ]);
}
