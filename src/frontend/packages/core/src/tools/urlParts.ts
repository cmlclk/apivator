// URL ayrıştırıcı: mutlak ya da göreli adresi parçalara ayırır, düzenlenen parçalardan yeniden kurar.
// {{değişken}} ifadeleri her yerde olduğu gibi korunur (kodlanmaz, çözülmez).
import { msg } from '../i18n';
import { ToolError } from './errors';
import { domainToAscii, domainToUnicode } from './punycode';

/**
 * `absolute`: `https://host/…`; `network`: `//host/…`; `host`: şemasız `api.ornek.com/…`;
 * `opaque`: `mailto:…`, `urn:…`; `variable`: `{{baseUrl}}/…`; `relative`: `/yol`, `yol?q=1`.
 */
export type UrlKind = 'absolute' | 'network' | 'host' | 'opaque' | 'variable' | 'relative';
export type UrlHostType = 'domain' | 'ipv4' | 'ipv6' | 'variable' | 'none';

export interface UrlQueryParam {
  /** Çözülmüş görünüm (`+` boşluktur); yapıyı bozacak karakterler (`&`, `=`, `+`, `#`) kodlu kalır. */
  key: string;
  value: string;
  /** `=` yazılmış mı (`a=` ile `a` farkı). */
  hasValue: boolean;
  /** Kapalı parametre yeniden kurulan adrese yazılmaz. */
  enabled: boolean;
  /** Adreste yazıldığı hâl; görünüm değişmediyse yeniden kurarken bu kullanılır. */
  rawKey: string;
  rawValue: string;
}

export interface UrlParts {
  kind: UrlKind;
  scheme: string;
  /** `variable` türünde adresin başındaki değişkenli kök (`{{baseUrl}}`); olduğu gibi yazılır. */
  base: string;
  username: string;
  password: string;
  /** Köşeli parantezsiz (IPv6 için `::1`); Unicode ya da punycode yazıldığı gibi. */
  host: string;
  port: string;
  /** Çözülmüş yol; parça içindeki `/` (`%2F`), `?` ve `#` kodlu kalır. */
  path: string;
  query: UrlQueryParam[];
  /** `null`: adreste `#` yok. */
  fragment: string | null;
  /** Adreste yazıldıkları hâl; görünüm değişmediyse yeniden kurarken bunlar kullanılır. */
  raw: { username: string; password: string; path: string; fragment: string };
}

export interface ParsedUrl {
  parts: UrlParts;
  warnings: string[];
}

export interface UrlDetails {
  hostType: UrlHostType;
  /** Alan adının ASCII (punycode, `xn--`) ve Unicode biçimleri; alan adı değilse host'un kendisi. */
  hostAscii: string;
  hostUnicode: string;
  /** Şemanın varsayılan portu (http 80, https 443…); bilinmiyorsa `null`. */
  defaultPort: number | null;
  /** Port yazılmamış ya da varsayılanla aynı. */
  portIsDefault: boolean;
  /** Tamamen çözülmüş yol parçaları (`%2F` → `/`). */
  segments: string[];
}

export interface BuildUrlOptions {
  /** Unicode alan adı punycode (`xn--`) olarak yazılır. */
  asciiHost?: boolean;
}

const DEFAULT_PORTS: Record<string, number> = { http: 80, https: 443, ws: 80, wss: 443, ftp: 21 };

const VARIABLE = /\{\{[^{}]+\}\}/g;
const PLACEHOLDER = /(\d+)/g;
const PERCENT_SIGN = '';

// RFC 3986 karakter kümeleri (harf, rakam ve `-._~` her yerde serbesttir).
const SUB_DELIMS = "!$&'()*+,;=";
const ALLOWED = {
  username: SUB_DELIMS,
  password: SUB_DELIMS + ':',
  path: SUB_DELIMS + ':@/',
  key: "!$'()*,;:@/?",
  value: "!$'()*,;:@/?=",
  rawKey: "!$'()*,;:@/?+",
  rawValue: "!$'()*,;:@/?+=",
  fragment: SUB_DELIMS + ':@/?',
  host: SUB_DELIMS,
};
// Çözülmüş görünümde kodlu kalan, yapıyı bozacak karakterler.
const KEEP = { username: ':@/?#', password: '@/?#', path: '/?#', key: '&=#+', value: '&#+', fragment: '' };

/** Metnin değişken olmayan kısımlarına `fn` uygular; `{{…}}` dokunulmadan kalır. */
function mapText(text: string, fn: (part: string) => string): string {
  let out = '';
  let last = 0;
  for (const match of text.matchAll(VARIABLE)) {
    out += fn(text.slice(last, match.index)) + match[0];
    last = match.index + match[0].length;
  }
  return out + fn(text.slice(last));
}

const hexEscape = (char: string) => '%' + char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0');

/**
 * Yüzde kodlarını çözer; `keep` içindeki karakterler, `{`/`}` ve ardından iki onaltılık rakam gelen `%`
 * kodlu kalır (yeniden kodlandığında anlam değişmesin). Geçersiz UTF-8 dizileri olduğu gibi bırakılır.
 */
function decodeView(raw: string, keep: string, plusSpace = false, invalid?: string[]): string {
  const decoded = mapText(raw, (text) => {
    const source = plusSpace ? text.replace(/\+/g, ' ') : text;
    return source.replace(/(?:%[0-9a-fA-F]{2})+/g, (run) => {
      let chars: string;
      try {
        chars = decodeURIComponent(run);
      } catch {
        invalid?.push(run);
        return run;
      }
      return Array.from(chars, (c) =>
        c === '%' ? PERCENT_SIGN : keep.includes(c) || c === '{' || c === '}' ? hexEscape(c) : c,
      ).join('');
    });
  });
  return decoded.replace(/(?=[0-9a-fA-F]{2})/g, '%25').replace(//g, '%');
}

/** Tüm yüzde kodlarını çözer (salt görüntüleme için); geçersiz diziler kalır. */
function fullDecode(text: string): string {
  return mapText(text, (part) =>
    part.replace(/(?:%[0-9a-fA-F]{2})+/g, (run) => {
      try {
        return decodeURIComponent(run);
      } catch {
        return run;
      }
    }),
  );
}

/**
 * Bileşende serbest olmayan karakterleri kodlar; geçerli `%XX` dizileri ve değişkenler korunur.
 * `rawPercent`: adreste yazıldığı hâl kodlanıyor; geçersiz `%` dizileri (`%zz`) de olduğu gibi kalır.
 */
function encodeView(text: string, allowed: string, unicode = false, rawPercent = false): string {
  return mapText(text, (part) => {
    let out = '';
    const chars = Array.from(part);
    chars.forEach((c, i) => {
      if (c === '%') {
        const valid = /^[0-9a-fA-F]{2}$/.test((chars[i + 1] ?? '') + (chars[i + 2] ?? ''));
        out += valid || rawPercent ? '%' : '%25';
      } else if (/[A-Za-z0-9\-._~]/.test(c) || allowed.includes(c) || (unicode && c.codePointAt(0)! > 0x7f)) {
        out += c;
      } else {
        try {
          out += encodeURIComponent(c);
        } catch {
          out += '%EF%BF%BD'; // eşi olmayan vekil karakter
        }
      }
    });
    return out;
  });
}

/** Görünüm değişmediyse adresteki hâli (gerekirse kodlanarak), değiştiyse yeni değerin kodlanmış hâli. */
function pick(
  edited: string,
  raw: string,
  keep: string,
  allowed: string,
  allowedRaw = allowed,
  plusSpace = false,
): string {
  return decodeView(raw, keep, plusSpace) === edited
    ? encodeView(raw, allowedRaw, false, true)
    : encodeView(edited, allowed);
}

function validatePort(port: string) {
  if (!port || port.includes('{{')) return;
  if (!/^\d+$/.test(port) || Number(port) > 65535)
    throw new ToolError(
      msg('toolsNet.url.badPort', 'Geçersiz port: "{port}". Port 0–65535 arasında bir sayı olmalı.', {
        port,
      }),
    );
}

function validateIpv6(host: string) {
  const address = host.replace(/%25.+$/, '');
  if (host.includes('{{')) return;
  if (!/^[0-9a-fA-F:.]+$/.test(address) || !address.includes(':') || address.split('::').length > 2)
    throw new ToolError(msg('toolsNet.url.badIpv6', 'Geçersiz IPv6 adresi: "[{host}]".', { host }));
}

/** Şemasız adresin başı host'a benziyor mu (`api.ornek.com`, `localhost:8080`, `[::1]`)? */
const HOST_LIKE =
  /^(?:[^/?#@\s]*@)?(?:\[[^\]]*\]|[^/?#:@\s.][^/?#:@\s]*\.[^/?#:@\s]+|localhost|[^/?#:@\s]+:\d+)(?::\d*)?(?=\/|$)/i;

/** Adresi parçalara ayırır. Boş girdi, geçersiz port ya da IPv6 adresi ToolError fırlatır. */
export function parseUrl(text: string): ParsedUrl {
  const input = text.trim();
  if (!input)
    throw new ToolError(
      msg('toolsNet.url.empty', 'Ayrıştırılacak bir adres girin: https://ornek.com/yol?q=1'),
    );
  if (/[\r\n]/.test(input)) throw new ToolError(msg('toolsNet.url.singleLine', 'Adres tek satır olmalı.'));
  const warnings: string[] = [];
  if (/\s/.test(input))
    warnings.push(
      msg('toolsNet.url.warn.space', 'Adreste boşluk var; yeniden kurulan adreste %20 olarak kodlanır.'),
    );

  // Değişkenler maskelenir: içlerindeki `/`, `?`, `#`, `:` ayrıştırmayı bozmasın.
  const variables: string[] = [];
  const masked = input.replace(VARIABLE, (v) => `${variables.push(v) - 1}`);
  const restore = (s: string) => s.replace(PLACEHOLDER, (_, i: string) => variables[Number(i)]!);

  let rest = masked;
  let fragment: string | null = null;
  const hash = rest.indexOf('#');
  if (hash >= 0) {
    fragment = restore(rest.slice(hash + 1));
    rest = rest.slice(0, hash);
  }
  let query: string | null = null;
  const question = rest.indexOf('?');
  if (question >= 0) {
    query = rest.slice(question + 1);
    rest = rest.slice(0, question);
  }

  let kind: UrlKind;
  let scheme = '';
  let base = '';
  let authority: string | null = null;
  let path = rest;
  const schemeMatch = /^([a-z][a-z\d+.-]*):/i.exec(rest);
  const afterScheme = schemeMatch ? rest.slice(schemeMatch[0].length) : '';
  const splitAuthority = (s: string) => {
    const slash = s.indexOf('/');
    authority = slash >= 0 ? s.slice(0, slash) : s;
    path = slash >= 0 ? s.slice(slash) : '';
  };
  if (schemeMatch && afterScheme.startsWith('//')) {
    kind = 'absolute';
    scheme = schemeMatch[1]!;
    splitAuthority(afterScheme.slice(2));
  } else if (schemeMatch && !/^\d*(?:\/|$)/.test(afterScheme)) {
    kind = 'opaque';
    scheme = schemeMatch[1]!;
    path = afterScheme;
  } else if (rest.startsWith('//')) {
    kind = 'network';
    splitAuthority(rest.slice(2));
  } else if (rest.startsWith('')) {
    kind = 'variable';
    base = /^(?:[^/]*:\/\/)?[^/]*/.exec(rest)![0];
    path = rest.slice(base.length);
    base = restore(base);
  } else if (HOST_LIKE.test(rest)) {
    kind = 'host';
    splitAuthority(rest);
    warnings.push(msg('toolsNet.url.warn.noScheme', 'Şema yok; adresin başı host olarak yorumlandı.'));
  } else {
    kind = 'relative';
  }

  let username = '';
  let password = '';
  let host = '';
  let port = '';
  if (authority !== null) {
    const auth: string = authority;
    const at = auth.lastIndexOf('@');
    if (at >= 0) {
      const userinfo = auth.slice(0, at);
      const colon = userinfo.indexOf(':');
      username = restore(colon >= 0 ? userinfo.slice(0, colon) : userinfo);
      password = restore(colon >= 0 ? userinfo.slice(colon + 1) : '');
    }
    const hostPort = auth.slice(at + 1);
    if (hostPort.startsWith('[')) {
      const close = hostPort.indexOf(']');
      if (close < 0)
        throw new ToolError(
          msg('toolsNet.url.ipv6Close', 'IPv6 adresinde kapanış köşeli parantezi (]) eksik.'),
        );
      host = restore(hostPort.slice(1, close));
      const after = hostPort.slice(close + 1);
      if (after && !after.startsWith(':'))
        throw new ToolError(msg('toolsNet.url.ipv6After', 'IPv6 adresinden sonra yalnızca :port gelebilir.'));
      port = restore(after.slice(1));
      validateIpv6(host);
    } else {
      const colon = hostPort.lastIndexOf(':');
      host = restore(colon >= 0 ? hostPort.slice(0, colon) : hostPort);
      port = restore(colon >= 0 ? hostPort.slice(colon + 1) : '');
    }
    validatePort(port);
    if (/%[0-9a-fA-F]{2}/.test(host) && !host.includes(':')) host = fullDecode(host);
    if (!host && kind !== 'network') warnings.push(msg('toolsNet.url.warn.emptyHost', 'Host boş.'));
  }

  const invalid: string[] = [];
  const rawPath = restore(path);
  const rawFragment = fragment ?? '';
  const parts: UrlParts = {
    kind,
    scheme,
    base,
    username: decodeView(username, KEEP.username, false, invalid),
    password: decodeView(password, KEEP.password, false, invalid),
    host,
    port,
    path: decodeView(rawPath, KEEP.path, false, invalid),
    query: [],
    fragment: fragment === null ? null : decodeView(rawFragment, KEEP.fragment, false, invalid),
    raw: { username, password, path: rawPath, fragment: rawFragment },
  };
  for (const pair of query === null ? [] : query.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const rawKey = restore(eq >= 0 ? pair.slice(0, eq) : pair);
    const rawValue = restore(eq >= 0 ? pair.slice(eq + 1) : '');
    parts.query.push({
      key: decodeView(rawKey, KEEP.key, true, invalid),
      value: decodeView(rawValue, KEEP.value, true, invalid),
      hasValue: eq >= 0,
      enabled: true,
      rawKey,
      rawValue,
    });
  }
  if (invalid.length)
    warnings.push(
      msg('toolsNet.url.warn.badPercent', 'Geçersiz yüzde kodlaması olduğu gibi bırakıldı: {list}', {
        list: [...new Set(invalid)].join(', '),
      }),
    );
  return { parts, warnings };
}

function hostType(host: string): UrlHostType {
  if (!host) return 'none';
  if (host.includes('{{')) return 'variable';
  if (host.includes(':')) return 'ipv6';
  if (/^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/.test(host)) return 'ipv4';
  return 'domain';
}

/** Host biçimleri, varsayılan port ve çözülmüş yol parçaları. */
export function describeUrl(parts: UrlParts): UrlDetails {
  const type = hostType(parts.host);
  let hostAscii = parts.host;
  let hostUnicode = parts.host;
  if (type === 'domain') {
    try {
      hostAscii = domainToAscii(parts.host);
      hostUnicode = domainToUnicode(hostAscii);
    } catch {
      // Geçersiz punycode etiketi: host yazıldığı gibi gösterilir.
    }
  }
  const defaultPort = DEFAULT_PORTS[parts.scheme.toLowerCase()] ?? null;
  const segments = parts.path
    ? parts.path
        .split('/')
        .slice(parts.path.startsWith('/') ? 1 : 0)
        .filter((s, i, all) => s !== '' || i < all.length - 1)
        .map(fullDecode)
    : [];
  return {
    hostType: type,
    hostAscii,
    hostUnicode,
    defaultPort,
    portIsDefault: !parts.port || (defaultPort !== null && Number(parts.port) === defaultPort),
    segments,
  };
}

function buildHost(parts: UrlParts, options: BuildUrlOptions): string {
  const type = hostType(parts.host);
  if (type === 'ipv6') return `[${parts.host}]`;
  if (type === 'domain' && options.asciiHost) return domainToAscii(parts.host);
  return encodeView(parts.host, ALLOWED.host, true);
}

/** Parçalardan adresi kurar: her bileşen kendi kurallarıyla kodlanır, değişkenler olduğu gibi kalır. */
export function buildUrl(parts: UrlParts, options: BuildUrlOptions = {}): string {
  const { raw } = parts;
  const authority = () => {
    const user = pick(parts.username, raw.username, KEEP.username, ALLOWED.username);
    const password = pick(parts.password, raw.password, KEEP.password, ALLOWED.password);
    const userinfo = user || password ? `${user}${password ? `:${password}` : ''}@` : '';
    validatePort(parts.port);
    return `${userinfo}${buildHost(parts, options)}${parts.port ? `:${parts.port}` : ''}`;
  };
  let out: string;
  switch (parts.kind) {
    case 'absolute':
      out = `${parts.scheme}://${authority()}`;
      break;
    case 'network':
      out = `//${authority()}`;
      break;
    case 'host':
      out = authority();
      break;
    case 'opaque':
      out = `${parts.scheme}:`;
      break;
    case 'variable':
      out = parts.base;
      break;
    default:
      out = '';
  }
  let path = pick(parts.path, raw.path, KEEP.path, ALLOWED.path);
  if (path && !path.startsWith('/') && ['absolute', 'network', 'host'].includes(parts.kind))
    path = `/${path}`;
  out += path;
  const pairs = parts.query
    .filter((p) => p.enabled && (p.key !== '' || p.value !== ''))
    .map((p) => {
      const key = pick(p.key, p.rawKey, KEEP.key, ALLOWED.key, ALLOWED.rawKey, true);
      const value = pick(p.value, p.rawValue, KEEP.value, ALLOWED.value, ALLOWED.rawValue, true);
      return p.hasValue || value ? `${key}=${value}` : key;
    });
  if (pairs.length) out += `?${pairs.join('&')}`;
  if (parts.fragment !== null)
    out += `#${pick(parts.fragment, raw.fragment, KEEP.fragment, ALLOWED.fragment)}`;
  return out;
}
