import { parseSetCookie, type ResponseCookie } from '../cookies';
import { msg } from '../i18n';
import { ToolError } from './errors';

/**
 * Cookie / Set-Cookie ayrıştırıcı ve Set-Cookie oluşturucu (RFC 6265 ve 6265bis taslağı).
 * Temel ayrıştırma `cookies.ts` içindeki parseSetCookie'dendir; burada tarih, önek, boyut ve
 * SameSite gibi denetimler eklenir.
 */

export type CookieWarningLevel = 'error' | 'warning' | 'info';

export interface CookieWarning {
  level: CookieWarningLevel;
  message: string;
}

export type CookieExpiry =
  | { kind: 'session' }
  | { kind: 'date'; date: Date; source: 'max-age' | 'expires'; expired: boolean; capped: boolean };

export interface SetCookieInfo extends ResponseCookie {
  /** Satırın kendisi (`Set-Cookie:` öneki atılmış). */
  raw: string;
  partitioned: boolean;
  priority: string | null;
  /** Domain özniteliği yoksa çerez yalnızca onu koyan ana makineye gider. */
  hostOnly: boolean;
  /** Expires metninden çözülen tarih; yoksa ya da çözülemezse null. */
  expiresDate: Date | null;
  expiry: CookieExpiry;
  /** Bilinmeyen öznitelik adları. */
  unknownAttributes: string[];
  /** Ad + değer bayt sayısı (UTF-8). */
  size: number;
  /** Değer yüzde kodluysa çözülmüş hali; aynıysa null. */
  decodedValue: string | null;
  /** Değer JWT gibi görünüyorsa (tırnaksız) JWT. */
  jwt: string | null;
  warnings: CookieWarning[];
}

export interface RequestCookie {
  name: string;
  value: string;
  /** Değer çift tırnak içindeyse true (tırnaklar değere dahildir, RFC 6265). */
  quoted: boolean;
  decodedValue: string | null;
  jwt: string | null;
  /** Aynı ad daha önce geçtiyse true. */
  duplicate: boolean;
  size: number;
}

export interface CookieHeaderInfo {
  cookies: RequestCookie[];
  /** Başlığın toplam bayt sayısı. */
  size: number;
  warnings: CookieWarning[];
}

/** Tarayıcıların ad + değer için uyguladığı sınır (RFC 6265bis §5.6). */
export const COOKIE_MAX_BYTES = 4096;
/** Tek öznitelik değeri için sınır. */
const ATTRIBUTE_MAX_BYTES = 1024;
/** Expires / Max-Age en fazla 400 güne kısaltılır (RFC 6265bis §5.6.1). */
const MAX_LIFETIME_MS = 400 * 24 * 3600 * 1000;
const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
/** cookie-octet: boşluk, çift tırnak, virgül, noktalı virgül, ters bölü ve kontrol karakterleri dışı ASCII. */
const COOKIE_OCTETS = /^[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]*$/;
const JWT = /^eyJ[\w-]+\.[\w-]+\.[\w-]*$/;
const KNOWN_ATTRIBUTES = new Set([
  'expires',
  'max-age',
  'domain',
  'path',
  'secure',
  'httponly',
  'samesite',
  'partitioned',
  'priority',
]);

const byteLength = (text: string) => new TextEncoder().encode(text).length;
const unquote = (value: string) =>
  value.length >= 2 && value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;

function decodeValue(value: string): string | null {
  if (!/%[0-9a-f]{2}/i.test(value)) return null;
  try {
    const decoded = decodeURIComponent(unquote(value));
    return decoded === value ? null : decoded;
  } catch {
    return null;
  }
}

function jwtOf(value: string): string | null {
  const bare = unquote(value);
  return JWT.test(bare) ? bare : null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * Çerez tarihini RFC 6265 §5.1.1 algoritmasıyla çözer: IMF-fixdate, RFC 850 (`Sunday, 06-Nov-94`),
 * asctime (`Sun Nov  6 08:49:37 1994`) ve tarayıcıların kabul ettiği diğer eski biçimler. Geçersizse null.
 */
export function parseCookieDate(text: string): Date | null {
  const tokens = text.split(/[\t\x20-\x2F\x3B-\x40\x5B-\x60\x7B-\x7E]+/).filter(Boolean);
  let time: [number, number, number] | null = null;
  let day: number | null = null;
  let month: number | null = null;
  let year: number | null = null;
  for (const token of tokens) {
    const t: RegExpExecArray | null = time ? null : /^(\d{1,2}):(\d{1,2}):(\d{1,2})(?:\D.*)?$/.exec(token);
    if (t) {
      time = [Number(t[1]), Number(t[2]), Number(t[3])];
      continue;
    }
    if (day === null && /^\d{1,2}(?:\D.*)?$/.test(token)) {
      day = Number.parseInt(token, 10);
      continue;
    }
    const m: number = month === null ? MONTHS.indexOf(token.slice(0, 3).toLowerCase()) : -1;
    if (m >= 0) {
      month = m;
      continue;
    }
    if (year === null && /^\d{2,4}(?:\D.*)?$/.test(token)) year = Number.parseInt(token, 10);
  }
  if (!time || day === null || month === null || year === null) return null;
  if (year >= 70 && year <= 99) year += 1900;
  else if (year >= 0 && year <= 69) year += 2000;
  const [h, min, s] = time;
  if (day < 1 || day > 31 || year < 1601 || h > 23 || min > 59 || s > 59) return null;
  const date = new Date(Date.UTC(year, month, day, h, min, s));
  // 31 Şubat gibi taşan günler geçersiz.
  return date.getUTCDate() === day ? date : null;
}

/** Süreyi "3 gün 4 saat" biçiminde yazar (en büyük iki birim). */
export function formatCookieDuration(ms: number): string {
  const units: [number, (n: number) => string][] = [
    [
      365 * 86_400_000,
      (n) => msg('toolsNet.cookie.unit.year', '{n, plural, other {{text} yıl}}', { n, text: String(n) }),
    ],
    [
      86_400_000,
      (n) => msg('toolsNet.cookie.unit.day', '{n, plural, other {{text} gün}}', { n, text: String(n) }),
    ],
    [
      3_600_000,
      (n) => msg('toolsNet.cookie.unit.hour', '{n, plural, other {{text} saat}}', { n, text: String(n) }),
    ],
    [
      60_000,
      (n) => msg('toolsNet.cookie.unit.minute', '{n, plural, other {{text} dakika}}', { n, text: String(n) }),
    ],
    [
      1000,
      (n) => msg('toolsNet.cookie.unit.second', '{n, plural, other {{text} saniye}}', { n, text: String(n) }),
    ],
  ];
  let rest = Math.abs(ms);
  const parts: string[] = [];
  for (const [size, label] of units) {
    if (rest >= size && parts.length < 2) {
      parts.push(label(Math.floor(rest / size)));
      rest %= size;
    } else if (parts.length) break;
  }
  return parts.join(' ') || msg('toolsNet.cookie.unit.zero', '0 saniye');
}

/** Son kullanma zamanının şu ana göre açıklaması: "2 gün sonra" / "süresi doldu (5 dakika önce)". */
export function describeCookieExpiry(expiry: CookieExpiry, now: Date = new Date()): string {
  if (expiry.kind === 'session')
    return msg('toolsNet.cookie.session', 'Oturum çerezi (tarayıcı kapanınca silinir)');
  if (expiry.expired && expiry.source === 'max-age')
    return msg('toolsNet.cookie.deletedNow', 'hemen silinir (Max-Age ≤ 0)');
  const diff = expiry.date.getTime() - now.getTime();
  return diff > 0
    ? msg('toolsNet.cookie.expiresIn', '{duration} sonra', { duration: formatCookieDuration(diff) })
    : msg('toolsNet.cookie.expiredAgo', 'süresi doldu ({duration} önce) — çerez silinir', {
        duration: formatCookieDuration(diff),
      });
}

function splitAttributes(line: string): { name: string; value: string }[] {
  return line
    .split(';')
    .slice(1)
    .map((part) => {
      const eq = part.indexOf('=');
      return eq < 0
        ? { name: part.trim(), value: '' }
        : { name: part.slice(0, eq).trim(), value: part.slice(eq + 1).trim() };
    })
    .filter((a) => a.name);
}

/** Tek bir Set-Cookie satırını ayrıntılı çözer. Ad=değer çifti hiç yoksa ToolError. */
export function analyzeSetCookie(line: string, now: Date = new Date()): SetCookieInfo {
  const raw = line.replace(/^\s*set-cookie\s*:/i, '').trim();
  if (!raw) throw new ToolError(msg('toolsNet.cookie.emptyLine', 'Set-Cookie satırı boş.'));
  const warnings: CookieWarning[] = [];
  const pair = raw.split(';')[0]!;
  let base = parseSetCookie(raw);
  if (!base) {
    if (!pair.trim())
      throw new ToolError(msg('toolsNet.cookie.noPair', 'Ad=değer çifti bulunamadı: {raw}', { raw }));
    // RFC 6265bis: "=" yoksa (ya da ad boşsa) çerezin adı boş, tüm metin değerdir.
    const value = pair.includes('=') ? pair.slice(pair.indexOf('=') + 1) : pair;
    base = { ...parseSetCookie(`x=${raw.slice(pair.length)}`)!, name: '', value: value.trim() };
    warnings.push({
      level: 'warning',
      message: msg(
        'toolsNet.cookie.warn.nameless',
        'Adsız çerez: tarayıcılar kabul eder ama birçok sunucu çatısı okuyamaz.',
      ),
    });
  }
  const attributes = splitAttributes(raw);
  const last = (name: string) => [...attributes].reverse().find((a) => a.name.toLowerCase() === name);
  const has = (name: string) => attributes.some((a) => a.name.toLowerCase() === name);

  const size = byteLength(base.name + base.value);
  if (size > COOKIE_MAX_BYTES) {
    warnings.push({
      level: 'error',
      message: msg(
        'toolsNet.cookie.warn.tooLarge',
        'Ad + değer {size} bayt: {max} baytı aşan çerezi tarayıcılar yok sayar.',
        { size: String(size), max: String(COOKIE_MAX_BYTES) },
      ),
    });
  }
  if (base.name && !TOKEN.test(base.name)) {
    warnings.push({
      level: 'warning',
      message: msg('toolsNet.cookie.warn.badName', 'Çerez adı geçersiz karakter içeriyor: {name}', {
        name: base.name,
      }),
    });
  }
  if (!COOKIE_OCTETS.test(unquote(base.value))) {
    warnings.push({
      level: 'info',
      message: msg(
        'toolsNet.cookie.warn.valueChars',
        'Değerde boşluk, virgül ya da ASCII dışı karakter var; yüzde kodlama önerilir.',
      ),
    });
  }
  for (const a of attributes) {
    if (byteLength(a.value) > ATTRIBUTE_MAX_BYTES) {
      warnings.push({
        level: 'warning',
        message: msg(
          'toolsNet.cookie.warn.attrTooLarge',
          '{name} değeri 1024 baytı aşıyor; tarayıcı yok sayar.',
          {
            name: a.name,
          },
        ),
      });
    }
  }
  const unknownAttributes = attributes
    .map((a) => a.name)
    .filter((name) => !KNOWN_ATTRIBUTES.has(name.toLowerCase()));
  for (const name of unknownAttributes) {
    warnings.push({
      level: 'info',
      message: msg('toolsNet.cookie.warn.unknownAttr', 'Bilinmeyen öznitelik yok sayılır: {name}', { name }),
    });
  }

  const expiresDate = base.expires ? parseCookieDate(base.expires) : null;
  if (base.expires && !expiresDate) {
    warnings.push({
      level: 'warning',
      message: msg('toolsNet.cookie.warn.badExpires', 'Expires tarihi çözülemedi, yok sayılır: {value}', {
        value: base.expires,
      }),
    });
  }
  const maxAgeRaw = last('max-age')?.value;
  const maxAgeValid = maxAgeRaw !== undefined && /^-?\d+$/.test(maxAgeRaw);
  if (maxAgeRaw !== undefined && !maxAgeValid) {
    warnings.push({
      level: 'warning',
      message: msg('toolsNet.cookie.warn.badMaxAge', 'Max-Age geçersiz, yok sayılır: {value}', {
        value: maxAgeRaw || msg('toolsNet.cookie.empty', '(boş)'),
      }),
    });
  }
  const maxAge = maxAgeValid ? Number(maxAgeRaw) : null;
  if (maxAge !== null && expiresDate) {
    warnings.push({
      level: 'info',
      message: msg('toolsNet.cookie.warn.maxAgeWins', 'Max-Age ve Expires birlikte: Max-Age önceliklidir.'),
    });
  }
  let expiry: CookieExpiry = { kind: 'session' };
  const nowMs = now.getTime();
  if (maxAge !== null || expiresDate) {
    const source = maxAge !== null ? 'max-age' : 'expires';
    let ms = maxAge !== null ? (maxAge <= 0 ? -1 : maxAge * 1000) : expiresDate!.getTime() - nowMs;
    const capped = ms > MAX_LIFETIME_MS;
    if (capped) {
      ms = MAX_LIFETIME_MS;
      warnings.push({
        level: 'info',
        message: msg('toolsNet.cookie.warn.capped', 'Ömür 400 günü aşıyor; tarayıcılar 400 güne kısaltır.'),
      });
    }
    expiry = { kind: 'date', date: new Date(nowMs + ms), source, expired: ms <= 0, capped };
  }

  const domainRaw = last('domain')?.value ?? '';
  if (domainRaw.startsWith('.')) {
    warnings.push({
      level: 'info',
      message: msg(
        'toolsNet.cookie.warn.domainDot',
        'Domain başındaki nokta yok sayılır; alt alan adları zaten dahildir.',
      ),
    });
  }
  const pathRaw = last('path')?.value;
  if (pathRaw !== undefined && !pathRaw.startsWith('/')) {
    warnings.push({
      level: 'info',
      message: msg('toolsNet.cookie.warn.pathSlash', 'Path "/" ile başlamıyor; varsayılan yol kullanılır.'),
    });
  }

  const sameSite = base.sameSite;
  if (sameSite && !/^(strict|lax|none)$/i.test(sameSite)) {
    warnings.push({
      level: 'warning',
      message: msg(
        'toolsNet.cookie.warn.badSameSite',
        'SameSite değeri geçersiz ({value}); varsayılan Lax uygulanır.',
        {
          value: sameSite,
        },
      ),
    });
  } else if (sameSite?.toLowerCase() === 'none' && !base.secure) {
    warnings.push({
      level: 'error',
      message: msg(
        'toolsNet.cookie.warn.noneNeedsSecure',
        'SameSite=None için Secure zorunlu; tarayıcılar bu çerezi reddeder.',
      ),
    });
  } else if (!sameSite) {
    warnings.push({
      level: 'info',
      message: msg(
        'toolsNet.cookie.warn.noSameSite',
        'SameSite yok: Chromium tabanlı tarayıcılar Lax varsayar.',
      ),
    });
  }

  const partitioned = has('partitioned');
  if (partitioned && !base.secure) {
    warnings.push({
      level: 'error',
      message: msg(
        'toolsNet.cookie.warn.partitionedNeedsSecure',
        'Partitioned (CHIPS) için Secure zorunlu; çerez reddedilir.',
      ),
    });
  }
  const priority = last('priority')?.value || null;
  if (priority && !/^(low|medium|high)$/i.test(priority)) {
    warnings.push({
      level: 'warning',
      message: msg('toolsNet.cookie.warn.badPriority', 'Priority Low, Medium ya da High olmalı: {value}', {
        value: priority,
      }),
    });
  }

  // Önekler 6265bis'te büyük/küçük harf duyarsızdır.
  const lowerName = base.name.toLowerCase();
  if (lowerName.startsWith('__secure-') && !base.secure) {
    warnings.push({
      level: 'error',
      message: msg('toolsNet.cookie.warn.securePrefix', '__Secure- önekli çerez Secure olmadan reddedilir.'),
    });
  }
  if (lowerName.startsWith('__host-')) {
    const problems = [
      !base.secure && msg('toolsNet.cookie.hostProblem.secure', 'Secure eksik'),
      base.domain && msg('toolsNet.cookie.hostProblem.domain', 'Domain olmamalı'),
      base.path !== '/' && msg('toolsNet.cookie.hostProblem.path', 'Path=/ olmalı'),
    ].filter(Boolean);
    if (problems.length) {
      warnings.push({
        level: 'error',
        message: msg(
          'toolsNet.cookie.warn.hostPrefix',
          '__Host- öneki kuralı ihlal: {problems}; çerez reddedilir.',
          {
            problems: problems.join(', '),
          },
        ),
      });
    }
  }
  if (!base.httpOnly && /sess|token|auth|sid/i.test(base.name)) {
    warnings.push({
      level: 'info',
      message: msg(
        'toolsNet.cookie.warn.sessionNotHttpOnly',
        'Oturum çerezi gibi görünüyor ama HttpOnly değil; JavaScript okuyabilir.',
      ),
    });
  }

  return {
    ...base,
    maxAge,
    raw,
    partitioned,
    priority,
    hostOnly: !base.domain,
    expiresDate,
    expiry,
    unknownAttributes,
    size,
    decodedValue: decodeValue(base.value),
    jwt: jwtOf(base.value),
    warnings,
  };
}

/**
 * Bir ya da daha çok Set-Cookie satırını çözer. Satırlar `Set-Cookie:` önekli olabilir; yapıştırılan
 * yanıt başlıklarındaki diğer başlıklar (Content-Type: …) atlanır.
 */
export function parseSetCookieLines(text: string, now: Date = new Date()): SetCookieInfo[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^HTTP\/\d/i.test(l))
    .filter((l) => {
      const header = /^([A-Za-z0-9-]+)\s*:/.exec(l);
      return !header || header[1]!.toLowerCase() === 'set-cookie';
    });
  if (!lines.length) throw new ToolError(msg('toolsNet.cookie.noLines', 'Set-Cookie satırı bulunamadı.'));
  return lines.map((line) => analyzeSetCookie(line, now));
}

/** İstekteki `Cookie:` başlığını ad=değer listesine çevirir (önek isteğe bağlı, birden çok satır birleşir). */
export function parseCookieHeader(text: string): CookieHeaderInfo {
  const body = text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*cookie\s*:/i, '').trim())
    .filter(Boolean)
    .join('; ');
  if (!body) throw new ToolError(msg('toolsNet.cookie.emptyHeader', 'Cookie başlığı boş.'));
  const warnings: CookieWarning[] = [];
  const seen = new Set<string>();
  const cookies: RequestCookie[] = [];
  for (const part of body.split(';')) {
    const piece = part.trim();
    if (!piece) continue;
    const eq = piece.indexOf('=');
    const name = eq < 0 ? '' : piece.slice(0, eq).trim();
    const value = eq < 0 ? piece : piece.slice(eq + 1).trim();
    const duplicate = seen.has(name);
    seen.add(name);
    const size = byteLength(name + value);
    cookies.push({
      name,
      value,
      quoted: value.length >= 2 && value.startsWith('"') && value.endsWith('"'),
      decodedValue: decodeValue(value),
      jwt: jwtOf(value),
      duplicate,
      size,
    });
    if (size > COOKIE_MAX_BYTES) {
      warnings.push({
        level: 'error',
        message: msg('toolsNet.cookie.warn.over4096', '{name}: {size} bayt, 4096 sınırını aşıyor.', {
          name: name || msg('toolsNet.cookie.unnamed', '(adsız)'),
          size: String(size),
        }),
      });
    }
  }
  const duplicates = [
    ...new Set(
      cookies.filter((c) => c.duplicate).map((c) => c.name || msg('toolsNet.cookie.unnamed', '(adsız)')),
    ),
  ];
  if (duplicates.length) {
    warnings.push({
      level: 'warning',
      message: msg(
        'toolsNet.cookie.warn.duplicates',
        "Yinelenen ad: {names}. Tarayıcı daha uzun Path'li olanı önce gönderir; sunucular çoğunlukla ilkini okur.",
        { names: duplicates.join(', ') },
      ),
    });
  }
  if (cookies.some((c) => !c.name)) {
    warnings.push({
      level: 'info',
      message: msg('toolsNet.cookie.warn.noEquals', '"=" içermeyen parça adsız çerez olarak okundu.'),
    });
  }
  const size = byteLength(body);
  if (size > 8192) {
    warnings.push({
      level: 'warning',
      message: msg(
        'toolsNet.cookie.warn.headerLarge',
        'Başlık {size} bayt: çoğu sunucu 8 KB üstü başlıkları reddeder.',
        {
          size: String(size),
        },
      ),
    });
  }
  return { cookies, size, warnings };
}

export type CookieTextKind = 'set-cookie' | 'cookie';

/** Metnin istek (`Cookie:`) mi yanıt (`Set-Cookie:`) başlığı mı olduğunu tahmin eder. */
export function guessCookieKind(text: string): CookieTextKind {
  const value = text.trim();
  if (/^set-cookie\s*:/im.test(value)) return 'set-cookie';
  if (/^cookie\s*:/i.test(value)) return 'cookie';
  return /;\s*(expires|max-age|domain|path|secure|httponly|samesite|partitioned|priority)\b/i.test(value)
    ? 'set-cookie'
    : 'cookie';
}

export interface SetCookieFields {
  name: string;
  value: string;
  /** Değeri yüzde kodla (boşluk, ; ve ASCII dışı karakterler için). */
  encodeValue?: boolean;
  expires?: Date | null;
  maxAge?: number | null;
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None' | '';
  partitioned?: boolean;
  priority?: 'Low' | 'Medium' | 'High' | '';
}

/** Alanlardan Set-Cookie değeri üretir (`Set-Cookie:` öneki olmadan). Geçersiz ad/değerde ToolError. */
export function buildSetCookie(fields: SetCookieFields): string {
  const name = fields.name.trim();
  if (!name) throw new ToolError(msg('toolsNet.cookie.build.nameRequired', 'Çerez adı gerekli.'));
  if (!TOKEN.test(name))
    throw new ToolError(
      msg('toolsNet.cookie.warn.badName', 'Çerez adı geçersiz karakter içeriyor: {name}', { name }),
    );
  const value = fields.encodeValue ? encodeURIComponent(fields.value) : fields.value;
  if (!COOKIE_OCTETS.test(unquote(value))) {
    throw new ToolError(
      msg(
        'toolsNet.cookie.build.valueChars',
        'Değerde boşluk, ";", "," ya da ASCII dışı karakter var; "Yüzde kodla" seçeneğini açın.',
      ),
    );
  }
  const parts = [`${name}=${value}`];
  if (fields.expires) {
    if (Number.isNaN(fields.expires.getTime()))
      throw new ToolError(msg('toolsNet.cookie.build.badExpires', 'Expires tarihi geçersiz.'));
    parts.push(`Expires=${fields.expires.toUTCString()}`);
  }
  if (fields.maxAge !== undefined && fields.maxAge !== null) {
    if (!Number.isInteger(fields.maxAge))
      throw new ToolError(msg('toolsNet.cookie.build.badMaxAge', 'Max-Age tam sayı (saniye) olmalı.'));
    parts.push(`Max-Age=${fields.maxAge}`);
  }
  const domain = fields.domain?.trim();
  if (domain) {
    if (/[\s;,]/.test(domain))
      throw new ToolError(msg('toolsNet.cookie.build.badDomain', 'Domain geçersiz: {domain}', { domain }));
    parts.push(`Domain=${domain}`);
  }
  const path = fields.path?.trim();
  if (path) {
    if (path.includes(';') || [...path].some((c) => c.charCodeAt(0) < 0x20))
      throw new ToolError(msg('toolsNet.cookie.build.badPath', 'Path geçersiz: {path}', { path }));
    parts.push(`Path=${path}`);
  }
  if (fields.secure) parts.push('Secure');
  if (fields.httpOnly) parts.push('HttpOnly');
  if (fields.sameSite) parts.push(`SameSite=${fields.sameSite}`);
  if (fields.partitioned) parts.push('Partitioned');
  if (fields.priority) parts.push(`Priority=${fields.priority}`);
  return parts.join('; ');
}
