import type { HttpHeader } from './types';

export interface ResponseCookie {
  name: string;
  value: string;
  domain: string | null;
  path: string | null;
  expires: string | null;
  maxAge: number | null;
  httpOnly: boolean;
  secure: boolean;
  sameSite: string | null;
}

/** Tek bir Set-Cookie başlığını ayrıştırır (RFC 6265, toleranslı). */
export function parseSetCookie(header: string): ResponseCookie | null {
  const [pair, ...attributes] = header.split(';');
  const eq = pair?.indexOf('=') ?? -1;
  if (!pair || eq <= 0) return null;

  const cookie: ResponseCookie = {
    name: pair.slice(0, eq).trim(),
    value: pair.slice(eq + 1).trim(),
    domain: null,
    path: null,
    expires: null,
    maxAge: null,
    httpOnly: false,
    secure: false,
    sameSite: null,
  };

  for (const attribute of attributes) {
    const [rawKey, ...rest] = attribute.split('=');
    const key = rawKey?.trim().toLowerCase();
    const value = rest.join('=').trim();
    switch (key) {
      case 'domain':
        cookie.domain = value.replace(/^\./, '') || null;
        break;
      case 'path':
        cookie.path = value || null;
        break;
      case 'expires':
        cookie.expires = value || null;
        break;
      case 'max-age': {
        const n = Number.parseInt(value, 10);
        cookie.maxAge = Number.isNaN(n) ? null : n;
        break;
      }
      case 'httponly':
        cookie.httpOnly = true;
        break;
      case 'secure':
        cookie.secure = true;
        break;
      case 'samesite':
        cookie.sameSite = value || null;
        break;
    }
  }
  return cookie;
}

/** Yanıt başlıklarındaki tüm Set-Cookie değerlerini çerez listesine çevirir. */
export function cookiesFromHeaders(headers: HttpHeader[]): ResponseCookie[] {
  return headers
    .filter((h) => h.key.toLowerCase() === 'set-cookie')
    .map((h) => parseSetCookie(h.value))
    .filter((c): c is ResponseCookie => c !== null);
}

const extensions: [RegExp, string][] = [
  [/json/, 'json'],
  [/html/, 'html'],
  [/xml/, 'xml'],
  [/javascript/, 'js'],
  [/css/, 'css'],
  [/csv/, 'csv'],
  [/pdf/, 'pdf'],
  [/zip/, 'zip'],
  [/png/, 'png'],
  [/jpe?g/, 'jpg'],
  [/gif/, 'gif'],
  [/svg/, 'svg'],
  [/webp/, 'webp'],
  [/^text\//, 'txt'],
];

/** Yanıtı kaydederken dosya adı: önce Content-Disposition, sonra içerik türüne göre uzantı. */
export function responseFileName(headers: HttpHeader[], fallbackBase = 'yanit'): string {
  const disposition = headers.find((h) => h.key.toLowerCase() === 'content-disposition')?.value;
  const fromHeader = disposition && /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition)?.[1];
  if (fromHeader) {
    try {
      return decodeURIComponent(fromHeader.trim());
    } catch {
      return fromHeader.trim();
    }
  }
  const type = headers.find((h) => h.key.toLowerCase() === 'content-type')?.value.toLowerCase() ?? '';
  const ext = extensions.find(([pattern]) => pattern.test(type))?.[1] ?? 'bin';
  return `${fallbackBase}.${ext}`;
}
