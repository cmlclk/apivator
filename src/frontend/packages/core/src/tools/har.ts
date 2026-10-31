import { emptyAuth, emptyBody } from '../http';
import type { KeyValueItem, RawLanguage, RequestDefinition } from '../types';
import { base64Decode, utf8Decode } from './encoding';
import { msg } from '../i18n';
import { ToolError } from './errors';

/** Tarayıcıda açılacak en büyük HAR dosyası; daha büyüğü JSON çözümlemede sekmeyi dondurur. */
export const MAX_HAR_BYTES = 50 * 1024 * 1024;

export interface HarPair {
  name: string;
  value: string;
}

export interface HarPostParam {
  name: string;
  value: string;
  fileName?: string;
  contentType?: string;
}

export interface HarTiming {
  /** HAR alanı: blocked, dns, connect, ssl, send, wait, receive. */
  phase: string;
  label: string;
  ms: number;
}

/** Arayüzde gösterilmeye hazır, eksik alanları doldurulmuş HAR kaydı. */
export interface HarEntry {
  /** Dosyadaki sıra (0'dan). */
  index: number;
  method: string;
  url: string;
  host: string;
  /** Yol ve sorgu: /v1/users?page=2 */
  path: string;
  httpVersion: string;
  /** 0: yanıt alınamadı (iptal, CORS, ağ hatası). */
  status: number;
  statusText: string;
  /** Parametresiz ve küçük harf: application/json */
  mimeType: string;
  /** Yanıt boyutu (bayt); bilinmiyorsa -1. */
  size: number;
  /** Toplam süre (ms). */
  time: number;
  startedDateTime: string;
  /** Başlangıç (epoch ms); tarih okunamazsa null. */
  startMs: number | null;
  serverIPAddress: string;
  request: {
    headers: HarPair[];
    queryString: HarPair[];
    cookies: HarPair[];
    postData: { mimeType: string; text: string; params: HarPostParam[] } | null;
    bodySize: number;
  };
  response: {
    headers: HarPair[];
    cookies: HarPair[];
    content: { mimeType: string; size: number; text: string; encoding: string };
    redirectURL: string;
  };
  timings: HarTiming[];
}

export interface HarLog {
  version: string;
  /** Kaydı oluşturan araç: "Chrome 120" gibi. */
  creator: string;
  entries: HarEntry[];
}

const timingLabels = (): [string, string][] => [
  ['blocked', msg('toolsNet.har.timing.blocked', 'Kuyrukta bekleme')],
  ['dns', msg('toolsNet.har.timing.dns', 'DNS çözümleme')],
  ['connect', msg('toolsNet.har.timing.connect', 'Bağlantı')],
  ['ssl', msg('toolsNet.har.timing.ssl', 'TLS el sıkışma')],
  ['send', msg('toolsNet.har.timing.send', 'Gönderme')],
  ['wait', msg('toolsNet.har.timing.wait', 'Bekleme (TTFB)')],
  ['receive', msg('toolsNet.har.timing.receive', 'İndirme')],
];

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown): string =>
  typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
const num = (value: unknown, fallback = -1): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

function pairs(value: unknown): HarPair[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isObject).map((p) => ({ name: str(p.name), value: str(p.value) }));
}

/** "application/json; charset=utf-8" → "application/json" */
export function baseMimeType(mimeType: string): string {
  return mimeType.split(';')[0]!.trim().toLowerCase();
}

function splitUrl(url: string): { host: string; path: string } {
  try {
    const parsed = new URL(url);
    return { host: parsed.host, path: parsed.pathname + parsed.search };
  } catch {
    return { host: '', path: url };
  }
}

function normalizeEntry(raw: unknown, index: number): HarEntry {
  if (!isObject(raw) || !isObject(raw.request)) {
    throw new ToolError(
      msg('toolsNet.har.badEntry', 'HAR kaydı #{number} geçersiz: "request" alanı yok.', {
        number: String(index + 1),
      }),
    );
  }
  const request = raw.request;
  const response = isObject(raw.response) ? raw.response : {};
  const content = isObject(response.content) ? response.content : {};
  const postData = isObject(request.postData) ? request.postData : null;
  const timings = isObject(raw.timings) ? raw.timings : {};
  const url = str(request.url);
  const startedDateTime = str(raw.startedDateTime);
  const startMs = startedDateTime ? Date.parse(startedDateTime) : NaN;
  const contentMime = str(content.mimeType);
  const bodySize = num(response.bodySize);
  const contentSize = num(content.size);

  return {
    index,
    method: (str(request.method) || 'GET').toUpperCase(),
    url,
    ...splitUrl(url),
    httpVersion: str(request.httpVersion) || str(response.httpVersion),
    status: num(response.status, 0),
    statusText: str(response.statusText),
    mimeType: baseMimeType(contentMime),
    // Aktarılan boyut (sıkıştırılmış) yoksa içerik boyutu.
    size: bodySize > 0 ? bodySize : contentSize,
    time: Math.max(0, num(raw.time, 0)),
    startedDateTime,
    startMs: Number.isNaN(startMs) ? null : startMs,
    serverIPAddress: str(raw.serverIPAddress),
    request: {
      headers: pairs(request.headers),
      queryString: pairs(request.queryString),
      cookies: pairs(request.cookies),
      postData: postData
        ? {
            mimeType: str(postData.mimeType),
            text: str(postData.text),
            params: Array.isArray(postData.params)
              ? postData.params.filter(isObject).map((p) => ({
                  name: str(p.name),
                  value: str(p.value),
                  ...(p.fileName !== undefined && { fileName: str(p.fileName) }),
                  ...(p.contentType !== undefined && { contentType: str(p.contentType) }),
                }))
              : [],
          }
        : null,
      bodySize: num(request.bodySize),
    },
    response: {
      headers: pairs(response.headers),
      cookies: pairs(response.cookies),
      content: {
        mimeType: contentMime,
        size: contentSize,
        text: str(content.text),
        encoding: str(content.encoding),
      },
      redirectURL: str(response.redirectURL),
    },
    // HAR'da -1 "uygulanamaz" demek; gösterilmez.
    timings: timingLabels()
      .map(([phase, label]) => ({ phase, label, ms: num(timings[phase]) }))
      .filter((t) => t.ms >= 0),
  };
}

/** HAR (HTTP Archive 1.2) metnini çözer; geçersizse ToolError. */
export function parseHar(text: string): HarLog {
  const trimmed = text.trim();
  if (!trimmed) throw new ToolError(msg('toolsNet.har.empty', 'HAR içeriği boş.'));
  if (trimmed.length > MAX_HAR_BYTES) {
    throw new ToolError(
      msg('toolsNet.har.tooLarge', 'HAR çok büyük: en fazla {mb} MB açılabilir.', {
        mb: String(MAX_HAR_BYTES / 1024 / 1024),
      }),
    );
  }
  let data: unknown;
  try {
    data = JSON.parse(trimmed);
  } catch (error) {
    const detail = error instanceof Error ? `: ${error.message}` : '';
    throw new ToolError(msg('toolsNet.har.notJson', 'HAR geçerli bir JSON değil{detail}', { detail }));
  }
  if (!isObject(data) || !isObject(data.log)) {
    throw new ToolError(msg('toolsNet.har.noLog', 'HAR biçimi tanınmadı: en üstte "log" nesnesi olmalı.'));
  }
  const log = data.log;
  if (!Array.isArray(log.entries))
    throw new ToolError(msg('toolsNet.har.noEntries', 'HAR biçimi tanınmadı: "log.entries" dizisi yok.'));
  const creator = isObject(log.creator)
    ? [str(log.creator.name), str(log.creator.version)].filter(Boolean).join(' ')
    : '';
  return {
    version: str(log.version),
    creator,
    entries: log.entries.map((entry, i) => normalizeEntry(entry, i)),
  };
}

export interface HarBody {
  /** Gösterilecek metin; ikili içerikte boş. */
  text: string;
  /** Base64 olarak kaydedilmiş içerik çözüldü mü? */
  decoded: boolean;
  /** İçerik metin değil (görsel, font…). */
  binary: boolean;
  /** İkili içeriğin bayt sayısı. */
  bytes: number;
}

/** Yanıt gövdesini okunur hâle getirir: Base64 çözülür, JSON biçimlendirilir. */
export function harResponseBody(entry: HarEntry): HarBody {
  const { text, encoding, mimeType } = entry.response.content;
  if (encoding.toLowerCase() === 'base64' && text) {
    let bytes: Uint8Array;
    try {
      bytes = base64Decode(text);
    } catch {
      return { text, decoded: false, binary: false, bytes: 0 };
    }
    try {
      return {
        text: prettyBody(utf8Decode(bytes, true), mimeType),
        decoded: true,
        binary: false,
        bytes: bytes.length,
      };
    } catch {
      return { text: '', decoded: true, binary: true, bytes: bytes.length };
    }
  }
  return { text: prettyBody(text, mimeType), decoded: false, binary: false, bytes: 0 };
}

/** JSON içeriği (tür JSON ise ya da metin JSON'a benziyorsa) girintili yazar; değilse olduğu gibi. */
export function prettyBody(text: string, mimeType = ''): string {
  const trimmed = text.trim();
  if (!trimmed || !(/json/i.test(mimeType) || /^[[{]/.test(trimmed))) return text;
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return text;
  }
}

export type HarMimeCategory =
  'json' | 'html' | 'xml' | 'script' | 'css' | 'image' | 'font' | 'text' | 'other';

export function harMimeCategories(): { id: HarMimeCategory; label: string }[] {
  return [
    { id: 'json', label: 'JSON' },
    { id: 'html', label: 'HTML' },
    { id: 'xml', label: 'XML' },
    { id: 'script', label: 'JavaScript' },
    { id: 'css', label: 'CSS' },
    { id: 'image', label: msg('toolsNet.har.mime.image', 'Görsel') },
    { id: 'font', label: msg('toolsNet.har.mime.font', 'Font') },
    { id: 'text', label: msg('toolsNet.har.mime.text', 'Metin') },
    { id: 'other', label: msg('toolsNet.har.mime.other', 'Diğer') },
  ];
}

export function harMimeCategory(mimeType: string): HarMimeCategory {
  const mime = baseMimeType(mimeType);
  if (/json/.test(mime)) return 'json';
  if (/html/.test(mime)) return 'html';
  if (/xml/.test(mime)) return 'xml';
  if (/javascript|ecmascript/.test(mime)) return 'script';
  if (mime === 'text/css') return 'css';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('font/') || /font/.test(mime)) return 'font';
  if (mime.startsWith('text/')) return 'text';
  return 'other';
}

/** 0 → "hata" (yanıt yok), 404 → "4xx". */
export function harStatusClass(status: number): string {
  return status >= 100 && status < 600 ? `${Math.floor(status / 100)}xx` : 'hata';
}

export interface HarFilter {
  /** URL'de aranır (büyük/küçük harf duyarsız). */
  text?: string;
  method?: string;
  /** "2xx", "4xx", "hata"… */
  statusClass?: string;
  mimeCategory?: HarMimeCategory | '';
}

export function filterHarEntries(entries: HarEntry[], filter: HarFilter): HarEntry[] {
  const text = filter.text?.trim().toLowerCase() ?? '';
  return entries.filter(
    (e) =>
      (!text || e.url.toLowerCase().includes(text)) &&
      (!filter.method || e.method === filter.method) &&
      (!filter.statusClass || harStatusClass(e.status) === filter.statusClass) &&
      (!filter.mimeCategory || harMimeCategory(e.mimeType) === filter.mimeCategory),
  );
}

export type HarSortKey = 'start' | 'method' | 'url' | 'status' | 'mimeType' | 'size' | 'time';

export function sortHarEntries(entries: HarEntry[], key: HarSortKey, descending = false): HarEntry[] {
  const value = (e: HarEntry): number | string => {
    switch (key) {
      case 'start':
        return e.startMs ?? Number.MAX_SAFE_INTEGER;
      case 'method':
        return e.method;
      case 'url':
        return e.url;
      case 'status':
        return e.status;
      case 'mimeType':
        return e.mimeType;
      case 'size':
        return e.size;
      case 'time':
        return e.time;
    }
  };
  const sign = descending ? -1 : 1;
  return [...entries].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    const order = typeof va === 'number' ? va - (vb as number) : va.localeCompare(vb as string);
    // Eşitlikte dosyadaki sıra korunur.
    return order === 0 ? a.index - b.index : order * sign;
  });
}

/** Tarayıcının eklediği ve yeniden gönderimde anlamsız ya da zararlı başlıklar. */
const SKIPPED_HEADERS = new Set(['content-length', 'host', 'connection']);

function rawLanguage(mimeType: string): RawLanguage {
  const category = harMimeCategory(mimeType);
  return category === 'json'
    ? 'Json'
    : category === 'xml'
      ? 'Xml'
      : category === 'html'
        ? 'Html'
        : category === 'script'
          ? 'JavaScript'
          : 'Text';
}

/** Kaydı yeniden gönderilebilir istek tanımına çevirir (cURL kopyalama ve "Yeni istekte aç" için). */
export function harEntryToRequest(
  entry: HarEntry,
): Pick<RequestDefinition, 'method' | 'url' | 'headers' | 'body' | 'auth'> {
  const headers: KeyValueItem[] = entry.request.headers
    // HTTP/2 sözde başlıkları (:authority, :path…) gerçek başlık değil.
    .filter((h) => h.name && !h.name.startsWith(':') && !SKIPPED_HEADERS.has(h.name.toLowerCase()))
    .map((h) => ({ key: h.name, value: h.value, enabled: true }));
  const post = entry.request.postData;
  let body = emptyBody();
  if (post?.text) {
    body = { ...emptyBody(), mode: 'Raw', rawLanguage: rawLanguage(post.mimeType), raw: post.text };
  } else if (post?.params.length) {
    const multipart = baseMimeType(post.mimeType).startsWith('multipart/');
    body = {
      ...emptyBody(),
      mode: multipart ? 'FormData' : 'UrlEncoded',
      form: post.params.map((p) => ({
        key: p.name,
        value: p.fileName ?? p.value,
        enabled: true,
        ...(multipart && p.fileName !== undefined && { type: 'File' as const }),
      })),
    };
  }
  if (body.mode === 'FormData') {
    // Sınır (boundary) değeri her istekte yeniden üretilir.
    const index = headers.findIndex((h) => h.key.toLowerCase() === 'content-type');
    if (index >= 0) headers.splice(index, 1);
  }
  return { method: entry.method, url: entry.url, headers, body, auth: emptyAuth('None') };
}
