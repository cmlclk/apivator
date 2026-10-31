/**
 * JSON Schema `format` denetimleri (doğrulayıcı için). Biçimler varsayılan olarak yalnızca açıklamadır; doğrulayıcı
 * istenirse bunları da hata sayar. Bilinmeyen biçimler her zaman geçerli kabul edilir.
 */

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[zZ]|([+-])(\d{2}):(\d{2}))$/;
const EMAIL =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
const HOST_LABEL = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;
const URI = /^[a-zA-Z][a-zA-Z0-9+.-]*:[^\s"<>\\^`{|}]*$/;
const URI_REFERENCE = /^[^\s"<>\\^`{|}]*$/;
const DURATION = /^P(?!$)((\d+W)|(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+S)?)?)$/;
const JSON_POINTER = /^(?:\/(?:[^~/]|~[01])*)*$/;

function isLeapYear(year: number) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function isDate(text: string): boolean {
  const m = DATE.exec(text);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const days = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]!;
}

/** RFC 3339 full-time: saat dilimi zorunlu; artık saniye (60) yalnızca 23:59 UTC'ye denk geliyorsa. */
function isTime(text: string): boolean {
  const m = TIME.exec(text);
  if (!m) return false;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  const second = Number(m[3]);
  const offHour = m[5] ? Number(m[5]) : 0;
  const offMinute = m[6] ? Number(m[6]) : 0;
  if (hour > 23 || minute > 59 || second > 60 || offHour > 23 || offMinute > 59) return false;
  if (second < 60) return true;
  const sign = m[4] === '-' ? 1 : -1;
  const utcMinutes = (((hour * 60 + minute + sign * (offHour * 60 + offMinute)) % 1440) + 1440) % 1440;
  return utcMinutes === 23 * 60 + 59;
}

function isDateTime(text: string): boolean {
  const parts = text.split(/[tT]/);
  return parts.length === 2 && isDate(parts[0]!) && isTime(parts[1]!);
}

function isHostname(text: string): boolean {
  const host = text.endsWith('.') ? text.slice(0, -1) : text;
  if (!host || host.length > 253) return false;
  return host.split('.').every((label) => HOST_LABEL.test(label));
}

function isIpv6(text: string): boolean {
  let address = text;
  // Sonda gömülü IPv4 (::ffff:192.0.2.1) iki 16 bitlik grup sayılır.
  const lastColon = address.lastIndexOf(':');
  let extra = 0;
  if (lastColon >= 0 && address.slice(lastColon + 1).includes('.')) {
    if (!IPV4.test(address.slice(lastColon + 1))) return false;
    address = `${address.slice(0, lastColon + 1)}0`;
    extra = 1;
  }
  const halves = address.split('::');
  if (halves.length > 2) return false;
  const groups = (part: string) => (part === '' ? [] : part.split(':'));
  const head = groups(halves[0]!);
  const tail = halves.length === 2 ? groups(halves[1]!) : [];
  if (![...head, ...tail].every((g) => /^[0-9a-fA-F]{1,4}$/.test(g))) return false;
  const count = head.length + tail.length + extra;
  return halves.length === 2 ? count <= 7 : count === 8;
}

function isRegex(text: string): boolean {
  try {
    new RegExp(text, 'u');
    return true;
  } catch {
    return false;
  }
}

const CHECKS: Record<string, (text: string) => boolean> = {
  'date-time': isDateTime,
  date: isDate,
  time: isTime,
  email: (t) => EMAIL.test(t),
  'idn-email': (t) => /^[^\s@]+@[^\s@]+$/.test(t),
  uri: (t) => URI.test(t),
  iri: (t) => /^[a-zA-Z][a-zA-Z0-9+.-]*:\S*$/.test(t),
  'uri-reference': (t) => URI_REFERENCE.test(t),
  uuid: (t) => UUID.test(t),
  ipv4: (t) => IPV4.test(t),
  ipv6: isIpv6,
  hostname: isHostname,
  regex: isRegex,
  duration: (t) => DURATION.test(t),
  'json-pointer': (t) => JSON_POINTER.test(t),
};

/** Biçim denetlenebiliyor ve metin uymuyorsa false; bilinmeyen biçimler için true. */
export function checkFormat(format: string, text: string): boolean {
  const check = CHECKS[format];
  return check ? check(text) : true;
}

/** Doğrulayıcının denetleyebildiği biçimler. */
export const KNOWN_FORMATS = Object.keys(CHECKS);
