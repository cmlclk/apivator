import { msg } from '../i18n';

export interface Detection {
  /** Araç kimliği (registry ile aynı): jwt, base64, timestamp, json-format, url, uuid, curl-code, har, compress… */
  toolId: string;
  /** Kullanıcıya gösterilecek açıklama: "JWT gibi görünüyor". */
  reason: string;
}

const JWT = /^eyJ[\w-]+\.[\w-]+\.[\w-]*$/;
const UUID = /^\{?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}?$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;
const HTTP_URL = /^https?:\/\/\S+$/i;
const PERCENT = /%[0-9a-f]{2}/i;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const BASE64_URL = /^[A-Za-z0-9_-]+={0,2}$/;
const UNICODE_ESCAPES = /\\u(?:[0-9a-fA-F]{4}|\{[0-9a-fA-F]{1,6}\})/g;
/** Tarayıcı geliştirici araçlarının kaydettiği HAR: {"log": {"version" … "entries": [ */
const HAR = /^\{\s*"log"\s*:\s*\{[\s\S]*"entries"\s*:\s*\[/;
const CIDR_V4 = /^(?:\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
const CIDR_V6 = /^[0-9a-f:]+(?:\d{1,3}(?:\.\d{1,3}){3})?\/\d{1,3}$/i;
const HTML_ENTITIES = /&(?:#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,7});/g;

/** Makul Unix zaman damgası aralığı: 1973-03 … 2100-01 (saniye). */
const MIN_SECONDS = 1e8;
const MAX_SECONDS = 4_102_444_800;

/**
 * Yapıştırılan metni tanır ve olasılık sırasıyla uygun araçları önerir (yanlış pozitiften kaçın:
 * kısa düz kelimeler Base64 sayılmaz). Boş ya da tanınmayan içerikte boş dizi.
 */
export function detectContent(text: string): Detection[] {
  const value = text.trim();
  if (!value) return [];

  // `curl` bir araç değil: akıllı yapıştırma komutu yeni istek sekmesinde açar.
  if (/^curl\s/i.test(value)) {
    return [
      { toolId: 'curl-code', reason: msg('toolsNet.detect.curlLike', 'cURL komutu gibi görünüyor') },
      { toolId: 'curl', reason: msg('toolsNet.detect.curl', 'cURL komutu') },
    ];
  }

  const network = detectNetwork(value);
  if (network) return [network];

  const pem = /-----BEGIN ([A-Z0-9 ]+)-----/.exec(value);
  if (pem) {
    const label = pem[1]!;
    if (label.includes('CERTIFICATE')) {
      return [
        { toolId: 'certificate', reason: msg('toolsNet.detect.pemCert', 'PEM sertifika gibi görünüyor') },
      ];
    }
    if (label.includes('KEY'))
      return [{ toolId: 'certificate', reason: msg('toolsNet.detect.pemKey', 'PEM anahtar gibi görünüyor') }];
  }

  const basic = /^(?:authorization\s*:\s*)?basic\s+([A-Za-z0-9+/]+={0,2})$/i.exec(value);
  if (basic && isBasicCredentials(basic[1]!)) {
    return [
      {
        toolId: 'basic-auth',
        reason: msg('toolsNet.detect.basicAuth', 'HTTP Basic kimlik başlığı gibi görünüyor'),
      },
    ];
  }

  const token = value.replace(/^bearer\s+/i, '');
  if (JWT.test(token) && isJwtHeader(token.split('.')[0]!)) {
    return [{ toolId: 'jwt', reason: msg('toolsNet.detect.jwt', 'JWT gibi görünüyor') }];
  }

  if (UUID.test(value))
    return [{ toolId: 'uuid', reason: msg('toolsNet.detect.uuid', 'UUID gibi görünüyor') }];

  const timestamp = detectTimestamp(value);
  if (timestamp) return [{ toolId: 'timestamp', reason: timestamp }];

  if (/^[[{]/.test(value)) {
    try {
      JSON.parse(value);
      if (HAR.test(value)) {
        return [
          { toolId: 'har', reason: msg('toolsNet.detect.har', 'HAR (HTTP Archive) gibi görünüyor') },
          { toolId: 'json-format', reason: msg('toolsNet.detect.harAsJson', 'JSON olarak biçimlendirin') },
        ];
      }
      return [
        { toolId: 'json-format', reason: msg('toolsNet.detect.json', 'JSON gibi görünüyor') },
        { toolId: 'jsonpath', reason: msg('toolsNet.detect.jsonpath', 'JSON içinde sorgu çalıştırın') },
        {
          toolId: 'json-convert',
          reason: msg('toolsNet.detect.jsonConvert', "JSON'u CSV, Excel, YAML ya da XML'e dönüştürün"),
        },
        {
          toolId: 'json-model',
          reason: msg('toolsNet.detect.jsonModel', 'JSON yapısından model sınıfı üretin'),
        },
      ];
    } catch {
      // JSON değil; diğer biçimlere bak.
    }
  }

  if (HTTP_URL.test(value)) {
    return [
      {
        toolId: 'url',
        reason: PERCENT.test(value)
          ? msg('toolsNet.detect.encodedUrl', 'URL kodlu adres gibi görünüyor')
          : msg('toolsNet.detect.url', 'Adres (URL) gibi görünüyor'),
      },
    ];
  }
  if (!/\s/.test(value) && PERCENT.test(value) && canDecodeUri(value)) {
    return [{ toolId: 'url', reason: msg('toolsNet.detect.encodedText', 'URL kodlu metin gibi görünüyor') }];
  }

  // gzip verisinin Base64'ü her zaman "H4sI" ile başlar (1f 8b 08).
  if (value.startsWith('H4sI') && detectBase64(value)) {
    return [
      {
        toolId: 'compress',
        reason: msg('toolsNet.detect.gzipBase64', 'gzip ile sıkıştırılmış Base64 gibi görünüyor'),
      },
      { toolId: 'base64', reason: msg('toolsNet.detect.base64AsBinary', 'Base64 (ikili veri) olarak çözün') },
    ];
  }

  const escapes = detectEscapes(value);
  if (escapes) return [escapes];

  const base64 = detectBase64(value);
  if (base64) return [{ toolId: 'base64', reason: base64 }];

  return [];
}

/** Cookie / Set-Cookie başlığı, tarayıcı User-Agent'ı ya da CIDR bloğu. */
function detectNetwork(value: string): Detection | null {
  if (/^set-cookie\s*:\s*[^=\s;]*=/im.test(value)) {
    return {
      toolId: 'cookie',
      reason: msg('toolsNet.detect.setCookieHeader', 'Set-Cookie başlığı gibi görünüyor'),
    };
  }
  if (/^cookie\s*:\s*[^=\s;]*=/i.test(value))
    return { toolId: 'cookie', reason: msg('toolsNet.detect.cookieHeader', 'Cookie başlığı gibi görünüyor') };
  // Ad RFC 6265 token'ı: `{"a":"b; path=/"}` ya da `https://…?a=b; path=/` çerez sayılmaz.
  if (
    /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+=[^;\s]*;\s*(path|domain|expires|max-age|samesite)=/i.test(value) &&
    !/\n/.test(value)
  ) {
    return {
      toolId: 'cookie',
      reason: msg('toolsNet.detect.setCookieValue', 'Set-Cookie değeri gibi görünüyor'),
    };
  }
  if (/^(?:user-agent\s*:\s*)?Mozilla\/5\.0 \(/i.test(value) && !/\n/.test(value)) {
    return {
      toolId: 'user-agent',
      reason: msg('toolsNet.detect.userAgent', 'Tarayıcı User-Agent metni gibi görünüyor'),
    };
  }
  if (
    CIDR_V4.test(value) ||
    (CIDR_V6.test(value) && (value.includes('::') || value.split(':').length === 8))
  ) {
    return { toolId: 'cidr', reason: msg('toolsNet.detect.cidr', 'IP / CIDR bloğu gibi görünüyor') };
  }
  return null;
}

/** Çoğunluğu kaçış dizisi olan metin ya da birden çok kaçış: `\uXXXX` → unicode, `&amp;` → html-entity. */
function detectEscapes(value: string): Detection | null {
  const significant = (matches: string[]) =>
    matches.length >= 2 || (matches.length === 1 && matches[0]!.length * 2 >= value.length);
  if (significant(value.match(UNICODE_ESCAPES) ?? [])) {
    return {
      toolId: 'unicode',
      reason: msg('toolsNet.detect.unicodeEscapes', 'Unicode kaçışlı metin (\\uXXXX) gibi görünüyor'),
    };
  }
  if (significant(value.match(HTML_ENTITIES) ?? [])) {
    return {
      toolId: 'html-entity',
      reason: msg('toolsNet.detect.htmlEntities', 'HTML varlıkları (&amp; gibi) içeren metin gibi görünüyor'),
    };
  }
  return null;
}

function detectTimestamp(value: string): string | null {
  if (ISO_DATE.test(value) && !Number.isNaN(Date.parse(value.replace(' ', 'T')))) {
    return msg('toolsNet.detect.isoDate', 'Tarih (ISO 8601) gibi görünüyor');
  }
  const match = /^(\d{9,16})(\.\d+)?$/.exec(value);
  if (!match) return null;
  const digits = match[1]!.length;
  const number = Number(value);
  // Ondalık yalnızca saniyede anlamlı.
  if (digits <= 10 && inRange(number))
    return msg('toolsNet.detect.unixSeconds', 'Unix zaman damgası (saniye) gibi görünüyor');
  if (match[2]) return null;
  if (digits >= 12 && digits <= 13 && inRange(number / 1e3))
    return msg('toolsNet.detect.unixMillis', 'Unix zaman damgası (milisaniye) gibi görünüyor');
  if (digits >= 15 && inRange(number / 1e6))
    return msg('toolsNet.detect.unixMicros', 'Unix zaman damgası (mikrosaniye) gibi görünüyor');
  return null;
}

function inRange(seconds: number): boolean {
  return seconds >= MIN_SECONDS && seconds <= MAX_SECONDS;
}

function canDecodeUri(value: string): boolean {
  try {
    return decodeURIComponent(value) !== value;
  } catch {
    return false;
  }
}

function isJwtHeader(segment: string): boolean {
  const decoded = decodeBase64(segment);
  if (!decoded) return false;
  try {
    const header: unknown = JSON.parse(new TextDecoder().decode(decoded));
    return typeof header === 'object' && header !== null && 'alg' in header;
  } catch {
    return false;
  }
}

/** Base64'ü "kullanıcı:parola" biçiminde okunur metne çözülüyor mu ("Basic authentication" gibi cümleler değil). */
function isBasicCredentials(encoded: string): boolean {
  const bytes = decodeBase64(encoded);
  return Boolean(bytes && isReadableText(bytes) && new TextDecoder().decode(bytes).includes(':'));
}

function detectBase64(value: string): string | null {
  const compact = value.replace(/\s+/g, '');
  // Kısa ya da düz kelime/sayı/hex dizileri Base64 sayılmaz.
  if (compact.length < 8 || /^\d+$/.test(compact) || /^[0-9a-f]+$/i.test(compact)) return null;
  if (!BASE64.test(compact) && !BASE64_URL.test(compact)) return null;
  const unpadded = compact.replace(/=+$/, '');
  if (unpadded.length % 4 === 1) return null;
  if (compact.includes('=') && compact.length % 4 !== 0) return null;
  const hasSignal = /[0-9+/=_-]/.test(compact);
  const mixedCase = /[a-z]/.test(compact) && /[A-Z]/.test(compact);
  if (!hasSignal && !(mixedCase && compact.length >= 16)) return null;
  const bytes = decodeBase64(compact);
  if (!bytes) return null;
  if (isReadableText(bytes)) return msg('toolsNet.detect.base64Text', 'Base64 (metin) gibi görünüyor');
  // Okunamayan içerik yalnızca yeterince uzun ve düzgün dolguluysa (ikili dosya) önerilir.
  if (compact.length >= 24 && compact.length % 4 === 0)
    return msg('toolsNet.detect.base64Binary', 'Base64 (ikili veri) gibi görünüyor');
  return null;
}

/** Standart ya da URL-safe Base64 (dolgulu/dolgusuz) çözer; geçersizse null. */
function decodeBase64(text: string): Uint8Array | null {
  const normalized = text.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  try {
    const binary = atob(normalized + '='.repeat((4 - (normalized.length % 4)) % 4));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

function isReadableText(bytes: Uint8Array): boolean {
  if (!bytes.length) return false;
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return false;
  }
  // Sekme ve satır sonu dışındaki kontrol karakterleri ikili veriye işaret eder.
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if ((code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) || code === 0x7f) return false;
  }
  return true;
}
