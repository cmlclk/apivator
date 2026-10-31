import { msg } from './i18n';
import { emptyAuth, emptyBody, emptyScripts } from './http';
import type { KeyValueItem, RequestAuth, RequestBody, RequestDefinition } from './types';

export interface CurlParseResult {
  definition: RequestDefinition;
  /** Komutta yetkilendirme (-u ya da Authorization: Bearer) var mı? Yoksa mevcut yetkilendirme korunabilir. */
  hasAuth: boolean;
  /** Karşılığı olmadığı için atlanan seçenekler. */
  warnings: string[];
}

export class CurlParseError extends Error {}

/** Metin bir cURL komutuna benziyor mu? (URL alanına yapıştırmayı yakalamak için) */
export function looksLikeCurl(text: string): boolean {
  return /^\s*curl(\.exe)?\s/i.test(text);
}

const IGNORED_FLAGS = new Set([
  '--compressed',
  '-k',
  '--insecure',
  '-L',
  '--location',
  '-s',
  '--silent',
  '-S',
  '--show-error',
  '-v',
  '--verbose',
  '-i',
  '--include',
  '-f',
  '--fail',
  '-#',
  '--progress-bar',
  '-N',
  '--no-buffer',
  '--http1.0',
  '--http1.1',
  '--http2',
  '--http2-prior-knowledge',
  '--http3',
  '-g',
  '--globoff',
  '--location-trusted',
  '-O',
  '--remote-name',
  '-J',
  '--remote-header-name',
  '--fail-with-body',
]);

const IGNORED_WITH_VALUE = new Set([
  '-o',
  '--output',
  '-m',
  '--max-time',
  '--connect-timeout',
  '--retry',
  '--retry-delay',
  '--retry-max-time',
  '-w',
  '--write-out',
  '--cacert',
  '--capath',
  '--cert',
  '-E',
  '--key',
  '--resolve',
  '--max-redirs',
  '-c',
  '--cookie-jar',
  '--limit-rate',
  '-r',
  '--range',
  '-z',
  '--time-cond',
  '--interface',
]);

/** Kısa seçenekler: değer alanlar. */
const SHORT_WITH_VALUE = new Set('XHdFuAbeoxmwcrzTE'.split(''));

/** bash ($'..', '..', "..", \ satır devamı) ve Windows cmd (^ kaçışları) yazımlarını parçalara ayırır. */
export function tokenizeShell(input: string): string[] {
  let text = input.replace(/\r\n/g, '\n');
  // Windows cmd ("Copy as cURL (cmd)"): ^ kaçış karakteri ve satır devamı.
  if (/\^"|\^\n/.test(text)) {
    text = text.replace(/\^\n/g, ' ').replace(/\^(.)/g, '$1');
  }
  // PowerShell satır devamı
  text = text.replace(/`\n/g, ' ');

  const tokens: string[] = [];
  let current = '';
  let inToken = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '\\' && text[i + 1] === '\n') {
      i += 2;
      continue;
    }
    if (/\s/.test(ch)) {
      if (inToken) {
        tokens.push(current);
        current = '';
        inToken = false;
      }
      i++;
      continue;
    }
    inToken = true;
    if (ch === '$' && text[i + 1] === "'") {
      const end = findClosingAnsi(text, i + 2);
      current += decodeAnsi(text.slice(i + 2, end));
      i = end + 1;
    } else if (ch === "'") {
      const end = text.indexOf("'", i + 1);
      if (end < 0)
        throw new CurlParseError(msg('core.curl.unterminatedSingleQuote', 'Kapanmamış tek tırnak.'));
      current += text.slice(i + 1, end);
      i = end + 1;
    } else if (ch === '"') {
      i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\' && i + 1 < text.length && '"\\$`\n'.includes(text[i + 1]!)) {
          if (text[i + 1] !== '\n') current += text[i + 1];
          i += 2;
        } else {
          current += text[i];
          i++;
        }
      }
      if (i >= text.length)
        throw new CurlParseError(msg('core.curl.unterminatedDoubleQuote', 'Kapanmamış çift tırnak.'));
      i++;
    } else if (ch === '\\' && i + 1 < text.length) {
      current += text[i + 1];
      i += 2;
    } else {
      current += ch;
      i++;
    }
  }
  if (inToken) tokens.push(current);
  return tokens;
}

function findClosingAnsi(text: string, from: number): number {
  for (let i = from; i < text.length; i++) {
    if (text[i] === '\\') i++;
    else if (text[i] === "'") return i;
  }
  throw new CurlParseError(msg('core.curl.unterminatedDollarQuote', "Kapanmamış $'...' ifadesi."));
}

function decodeAnsi(value: string): string {
  const map: Record<string, string> = {
    n: '\n',
    t: '\t',
    r: '\r',
    '\\': '\\',
    "'": "'",
    '"': '"',
    '0': '\0',
  };
  return value.replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|.)/g, (_, esc: string) => {
    if (esc.length > 1) return String.fromCharCode(parseInt(esc.slice(1), 16));
    return map[esc] ?? '\\' + esc;
  });
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
}

function header(key: string, value: string): KeyValueItem {
  return { key, value, enabled: true };
}

/** Bir cURL komutunu istek tanımına çevirir. */
export function parseCurl(command: string): CurlParseResult {
  const tokens = tokenizeShell(command.trim());
  if (!tokens.length || !/^curl(\.exe)?$/i.test(tokens[0]!)) {
    throw new CurlParseError(msg('core.curl.mustStartWithCurl', 'Komut "curl" ile başlamalı.'));
  }

  const warnings: string[] = [];
  const headers: KeyValueItem[] = [];
  const data: string[] = [];
  const form: KeyValueItem[] = [];
  let method: string | null = null;
  let url: string | null = null;
  let useGet = false;
  let head = false;
  let jsonFlag = false;
  let auth: RequestAuth | null = null;
  let binaryFile: string | null = null;

  const args = tokens.slice(1);
  for (let i = 0; i < args.length; i++) {
    let arg = args[i]!;
    let value: string | undefined;

    if (arg.startsWith('--') && arg.includes('=')) {
      const eq = arg.indexOf('=');
      value = arg.slice(eq + 1);
      arg = arg.slice(0, eq);
    } else if (/^-[A-Za-z]/.test(arg) && arg.length > 2) {
      const letter = arg[1]!;
      if (SHORT_WITH_VALUE.has(letter)) {
        value = arg.slice(2);
        arg = '-' + letter;
      } else {
        // Birleşik bayraklar: -sSL, -sX POST gibi.
        const letters = arg.slice(1).split('');
        const expanded = letters.map((l) => '-' + l);
        args.splice(i, 1, ...expanded);
        i--;
        continue;
      }
    }

    const next = (): string => {
      if (value !== undefined) return value;
      if (i + 1 >= args.length)
        throw new CurlParseError(
          msg('core.curl.optionNeedsValue', '{option} seçeneği bir değer bekliyor.', { option: arg }),
        );
      return args[++i]!;
    };

    switch (arg) {
      case '-X':
      case '--request':
        method = next().toUpperCase();
        break;
      case '-H':
      case '--header': {
        const raw = next();
        const colon = raw.indexOf(':');
        if (colon > 0) {
          headers.push(header(raw.slice(0, colon).trim(), raw.slice(colon + 1).trim()));
        } else if (raw.endsWith(';')) {
          headers.push(header(raw.slice(0, -1).trim(), ''));
        }
        break;
      }
      case '-d':
      case '--data':
      case '--data-ascii':
      case '--data-binary':
      case '--data-raw': {
        const raw = next();
        if (raw.startsWith('@') && arg !== '--data-raw') {
          binaryFile = baseName(raw.slice(1));
          warnings.push(
            msg('core.curl.bodyFile', 'Gövde dosyası ({file}) göndermeden önce Body sekmesinden seçilmeli.', {
              file: binaryFile,
            }),
          );
        } else {
          data.push(
            arg === '-d' || arg === '--data' || arg === '--data-ascii' ? raw.replace(/[\r\n]/g, '') : raw,
          );
        }
        break;
      }
      case '--data-urlencode': {
        const raw = next();
        const eq = raw.indexOf('=');
        data.push(
          eq < 0 ? encodeURIComponent(raw) : `${raw.slice(0, eq)}=${encodeURIComponent(raw.slice(eq + 1))}`,
        );
        break;
      }
      case '--json':
        data.push(next());
        jsonFlag = true;
        break;
      case '-F':
      case '--form':
      case '--form-string': {
        const raw = next();
        const eq = raw.indexOf('=');
        const key = eq < 0 ? raw : raw.slice(0, eq);
        const val = eq < 0 ? '' : raw.slice(eq + 1);
        if (arg !== '--form-string' && val.startsWith('@')) {
          // curl: -F 'dosya=@yol/ad.pdf;type=application/pdf'
          const name = baseName(
            val
              .slice(1)
              .split(';')[0]!
              .replace(/^"(.*)"$/, '$1'),
          );
          form.push({ key, value: name, enabled: true, type: 'File' });
          warnings.push(
            msg('core.curl.fieldFile', "'{key}' alanının dosyası ({file}) göndermeden önce seçilmeli.", {
              key,
              file: name,
            }),
          );
        } else if (arg !== '--form-string' && val.startsWith('<')) {
          warnings.push(
            msg('core.curl.fieldFromFile', "'{key}' alanı dosyadan okunuyor ({value}); atlandı.", {
              key,
              value: val,
            }),
          );
        } else {
          form.push({ key, value: val.replace(/^"(.*)"$/, '$1'), enabled: true });
        }
        break;
      }
      case '-u':
      case '--user': {
        const raw = next();
        const colon = raw.indexOf(':');
        auth = {
          ...emptyAuth('Basic'),
          basicUsername: colon < 0 ? raw : raw.slice(0, colon),
          basicPassword: colon < 0 ? '' : raw.slice(colon + 1),
        };
        break;
      }
      case '--oauth2-bearer':
        auth = { ...emptyAuth('Bearer'), bearerToken: next() };
        break;
      case '--url':
        url = next();
        break;
      case '-G':
      case '--get':
        useGet = true;
        break;
      case '-I':
      case '--head':
        head = true;
        break;
      case '-A':
      case '--user-agent':
        headers.push(header('User-Agent', next()));
        break;
      case '-e':
      case '--referer':
        headers.push(header('Referer', next()));
        break;
      case '-b':
      case '--cookie': {
        const raw = next();
        if (raw.includes('=')) headers.push(header('Cookie', raw));
        else
          warnings.push(
            msg('core.curl.cookieFile', 'Çerez dosyası ({file}) okunamaz; atlandı.', { file: raw }),
          );
        break;
      }
      case '-x':
      case '--proxy':
        next();
        warnings.push(msg('core.curl.proxySkipped', 'Proxy ayarı atlandı.'));
        break;
      default:
        if (IGNORED_FLAGS.has(arg)) break;
        if (IGNORED_WITH_VALUE.has(arg)) {
          next();
          break;
        }
        if (arg.startsWith('-') && arg.length > 1) {
          warnings.push(
            msg('core.curl.unknownOption', 'Bilinmeyen seçenek atlandı: {option}', { option: arg }),
          );
          break;
        }
        if (url === null) url = arg;
        else
          warnings.push(
            msg('core.curl.extraArgument', 'Fazladan argüman atlandı: {argument}', { argument: arg }),
          );
    }
  }

  if (!url) throw new CurlParseError(msg('core.curl.noUrl', 'Komutta URL bulunamadı.'));

  // "Authorization: Bearer x" başlığını yetkilendirme sekmesine taşı.
  const authIndex = headers.findIndex(
    (h) => h.key.toLowerCase() === 'authorization' && /^bearer\s+/i.test(h.value),
  );
  if (authIndex >= 0 && !auth) {
    auth = { ...emptyAuth('Bearer'), bearerToken: headers[authIndex]!.value.replace(/^bearer\s+/i, '') };
    headers.splice(authIndex, 1);
  }

  if (jsonFlag) {
    if (!hasHeader(headers, 'content-type')) headers.push(header('Content-Type', 'application/json'));
    if (!hasHeader(headers, 'accept')) headers.push(header('Accept', 'application/json'));
  }

  let body: RequestBody = emptyBody();
  const joined = data.join('&');
  if (useGet && data.length) {
    url += (url.includes('?') ? '&' : '?') + joined;
  } else if (form.length) {
    body = { ...emptyBody(), mode: 'FormData', form };
    // Sınır (boundary) değeri her istekte yeniden üretilir; kopyalanan eski başlık isteği bozar.
    removeHeader(headers, 'content-type', (v) => v.toLowerCase().startsWith('multipart/form-data'));
  } else if (binaryFile && data.length === 0) {
    body = { ...emptyBody(), mode: 'Binary', fileName: binaryFile };
  } else if (data.length) {
    body = buildBody(joined, headerValue(headers, 'content-type'));
    if (body.mode === 'UrlEncoded') {
      removeHeader(headers, 'content-type', (v) =>
        v.toLowerCase().startsWith('application/x-www-form-urlencoded'),
      );
    }
  }

  const hasBody = body.mode !== 'None';
  const finalMethod = method ?? (head ? 'HEAD' : useGet ? 'GET' : hasBody ? 'POST' : 'GET');

  return {
    definition: {
      method: finalMethod,
      url,
      headers,
      body,
      auth: auth ?? emptyAuth('Inherit'),
      scripts: emptyScripts(),
    },
    hasAuth: auth !== null,
    warnings,
  };
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function hasHeader(headers: KeyValueItem[], name: string): boolean {
  return headers.some((h) => h.key.toLowerCase() === name);
}

function headerValue(headers: KeyValueItem[], name: string): string | undefined {
  return headers.find((h) => h.key.toLowerCase() === name)?.value;
}

function removeHeader(headers: KeyValueItem[], name: string, predicate: (value: string) => boolean) {
  const index = headers.findIndex((h) => h.key.toLowerCase() === name && predicate(h.value));
  if (index >= 0) headers.splice(index, 1);
}

function buildBody(data: string, contentType: string | undefined): RequestBody {
  const type = contentType?.toLowerCase() ?? '';
  const trimmed = data.trim();
  const looksJson = /^[[{]/.test(trimmed) && isJson(trimmed);

  if (type.includes('json') || (!type && looksJson)) {
    return {
      ...emptyBody(),
      mode: 'Raw',
      rawLanguage: 'Json',
      raw: looksJson ? JSON.stringify(JSON.parse(trimmed), null, 2) : data,
    };
  }

  const formLike = /^[^=&\s]+=[^&]*(&[^=&\s]+=[^&]*)*$/.test(trimmed);
  if (type.includes('x-www-form-urlencoded') || (!type && formLike)) {
    const form = trimmed
      .split('&')
      .filter(Boolean)
      .map((pair) => {
        const eq = pair.indexOf('=');
        return {
          key: safeDecode(eq < 0 ? pair : pair.slice(0, eq)),
          value: eq < 0 ? '' : safeDecode(pair.slice(eq + 1)),
          enabled: true,
        };
      });
    return { ...emptyBody(), mode: 'UrlEncoded', form };
  }

  const rawLanguage = type.includes('xml')
    ? 'Xml'
    : type.includes('html')
      ? 'Html'
      : type.includes('javascript')
        ? 'JavaScript'
        : 'Text';
  return { ...emptyBody(), mode: 'Raw', rawLanguage, raw: data };
}

function isJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

function quote(value: string): string {
  return /^[A-Za-z0-9_\-./:=@%+,]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * İsteği cURL komutu olarak yazar. Değişkenleri çözülmüş, yetkilendirmesi miras çözülmüş hâlini vermek gerekir.
 */
export function toCurl(
  request: Pick<RequestDefinition, 'method' | 'url' | 'headers' | 'body' | 'auth'>,
): string {
  const parts: string[] = ['curl'];
  const opt = (name: string, value: string) => parts.push(`${name} ${value}`);
  let url = request.url;
  const method = request.method.toUpperCase();
  const auth = request.auth;
  const headers = request.headers.filter((h) => h.enabled && h.key);
  const has = (name: string) => headers.some((h) => h.key.toLowerCase() === name.toLowerCase());

  if (auth.type === 'ApiKey' && auth.apiKeyName && auth.apiKeyIn === 'Query') {
    url += `${url.includes('?') ? '&' : '?'}${encodeURIComponent(auth.apiKeyName)}=${encodeURIComponent(auth.apiKeyValue)}`;
  }

  const body = request.body;
  const hasBody =
    body.mode !== 'None' &&
    !(body.mode === 'Raw' && !body.raw) &&
    !(body.mode === 'Binary' && !body.fileName);
  if (method !== 'GET' || hasBody) {
    if (!(method === 'POST' && hasBody)) opt('-X', method);
  }
  parts.push(quote(url));

  for (const h of headers) opt('-H', quote(`${h.key}: ${h.value}`));

  if (auth.type === 'Bearer' && auth.bearerToken && !has('Authorization')) {
    opt('-H', quote(`Authorization: Bearer ${auth.bearerToken}`));
  } else if (auth.type === 'Basic' && !has('Authorization')) {
    opt('-u', quote(`${auth.basicUsername}:${auth.basicPassword}`));
  } else if (auth.type === 'Digest' && !has('Authorization')) {
    parts.push('--digest');
    opt('-u', quote(`${auth.basicUsername}:${auth.basicPassword}`));
  } else if (auth.type === 'AwsSigV4' && !has('Authorization')) {
    opt('--aws-sigv4', quote(`aws:amz:${auth.awsRegion}:${auth.awsService}`));
    opt('-u', quote(`${auth.awsAccessKey}:${auth.awsSecretKey}`));
    if (auth.awsSessionToken) opt('-H', quote(`X-Amz-Security-Token: ${auth.awsSessionToken}`));
  } else if (auth.type === 'OAuth2' && !has('Authorization')) {
    const prefix = auth.oAuth2HeaderPrefix.trim();
    const token = auth.oAuth2AccessToken || '<access_token>';
    opt('-H', quote(`Authorization: ${prefix ? `${prefix} ${token}` : token}`));
  } else if (
    auth.type === 'ApiKey' &&
    auth.apiKeyName &&
    auth.apiKeyIn === 'Header' &&
    !has(auth.apiKeyName)
  ) {
    opt('-H', quote(`${auth.apiKeyName}: ${auth.apiKeyValue}`));
  }

  const fields = body.form.filter((f) => f.enabled && f.key);
  if (body.mode === 'Raw' && body.raw) {
    if (!has('Content-Type')) {
      const types: Record<string, string> = {
        Json: 'application/json',
        Xml: 'application/xml',
        Html: 'text/html',
        JavaScript: 'application/javascript',
        Text: 'text/plain',
      };
      opt('-H', quote(`Content-Type: ${types[body.rawLanguage] ?? 'text/plain'}`));
    }
    opt('--data-raw', quote(body.raw));
  } else if (body.mode === 'UrlEncoded') {
    for (const f of fields) opt('--data-urlencode', quote(`${f.key}=${f.value}`));
  } else if (body.mode === 'FormData') {
    for (const f of fields) {
      if (f.type === 'File') opt('-F', quote(`${f.key}=@${f.value}`));
      else opt('--form-string', quote(`${f.key}=${f.value}`));
    }
  } else if (body.mode === 'Binary' && body.fileName) {
    opt('--data-binary', quote(`@${body.fileName}`));
  } else if (body.mode === 'GraphQL') {
    if (!has('Content-Type')) opt('-H', quote('Content-Type: application/json'));
    let variables: unknown;
    try {
      variables = body.graphqlVariables?.trim() ? JSON.parse(body.graphqlVariables) : undefined;
    } catch {
      variables = undefined;
    }
    opt(
      '--data-raw',
      quote(JSON.stringify(variables === undefined ? { query: body.raw } : { query: body.raw, variables })),
    );
  }

  return parts.join(' \\\n  ');
}
