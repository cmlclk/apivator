/**
 * Sahte (test) veri üreteci: ad, e-posta, telefon, adres, şirket, TCKN, IBAN, kart numarası…
 * Script'lerdeki dinamik değişkenler ({{$randomEmail}} vb., variables.ts) de bu üreteci kullanır.
 *
 * Güvenlik: e-posta yalnızca ayrılmış alan adlarına (example.com/.net/.org, .test — RFC 2606), IP adresleri
 * belgeleme bloklarına (RFC 5737 / RFC 3849) gider. Kart numaraları test BIN'leriyle, IBAN'lar atanmamış banka
 * koduyla (99xxx) üretilir. TCKN için ayrılmış bir test aralığı yoktur: algoritmaya uyan bir numara gerçek bir
 * kişiye ait olabilir, yalnızca test ortamında kullanılmalıdır.
 */
import { msg } from '../i18n';
import { bufferedRandomInt } from './authHelpers';
import { ToolError } from './errors';
import { fakeCardNumber, fakeTckn, fakeTrIban } from './fakeDataChecks';
import { FAKE_DATA_EN } from './fakeDataEn';
import { FAKE_DATA_TR } from './fakeDataTr';

export type FakeLocale = 'tr' | 'en';

export interface FakeCity {
  name: string;
  /** Türkçede ilçeler; İngilizcede eyalet kısaltması. */
  districts: readonly string[];
  /** Posta kodunun başı (il plaka kodu / ZIP ön eki). */
  postalPrefix: string;
}

export interface FakeLocaleData {
  maleNames: readonly string[];
  femaleNames: readonly string[];
  lastNames: readonly string[];
  cities: readonly FakeCity[];
  neighborhoods: readonly string[];
  streets: readonly string[];
  streetTypes: readonly string[];
  companyWords: readonly string[];
  companySectors: readonly string[];
  companySuffixes: readonly string[];
  jobTitles: readonly string[];
  colorNames: readonly string[];
  words: readonly string[];
}

const LOCALES: Record<FakeLocale, FakeLocaleData> = { tr: FAKE_DATA_TR, en: FAKE_DATA_EN };

/* ---------------------------------------------------------------- rastgelelik */

/** [0, max) aralığında tamsayı veren kaynak. */
export interface FakeRng {
  int(max: number): number;
}

/** Kriptografik, yansız (reddetmeli örnekleme; rastgele sözcükler toplu alınır). */
export const secureRng: FakeRng = { int: bufferedRandomInt() };

/** cyrb128: metin tohumdan dört 32 bit durum. */
function hashSeed(seed: string): [number, number, number, number] {
  let h1 = 1779033703,
    h2 = 3144134277,
    h3 = 1013904242,
    h4 = 2773480762;
  for (let i = 0; i < seed.length; i++) {
    const k = seed.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}

/** Tohumlu, deterministik kaynak (sfc32): aynı tohum her zaman aynı diziyi verir. Kriptografik değildir. */
export function seededRng(seed: string): FakeRng {
  let [a, b, c, d] = hashSeed(seed);
  const next = () => {
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  return {
    int(max) {
      if (!Number.isInteger(max) || max < 1 || max > 2 ** 32)
        throw new ToolError(msg('toolsSecurity.auth.randomRange', 'Geçersiz rastgele aralık.'));
      return Math.floor(next() * max);
    },
  };
}

export interface FakeContext {
  rng: FakeRng;
  locale: FakeLocale;
  /** Tarihlerin göreli olduğu an (ms); tohumlu modda sabittir ki çıktı günden güne değişmesin. */
  now: number;
}

/** Tohumlu modda tarihlerin dayanağı. */
export const FAKE_SEEDED_NOW = Date.UTC(2026, 0, 1);

export function createFakeContext(
  options: { locale?: FakeLocale; seed?: string; now?: number } = {},
): FakeContext {
  const seeded = options.seed !== undefined && options.seed !== '';
  return {
    rng: seeded ? seededRng(options.seed!) : secureRng,
    locale: options.locale ?? 'tr',
    now: options.now ?? (seeded ? FAKE_SEEDED_NOW : Date.now()),
  };
}

const pick = <T>(rng: FakeRng, items: readonly T[]): T => items[rng.int(items.length)]!;
const digits = (rng: FakeRng, count: number) => Array.from({ length: count }, () => rng.int(10)).join('');
const between = (rng: FakeRng, min: number, max: number) => min + rng.int(max - min + 1);

/* ---------------------------------------------------------------- üreteçler */

/** Arayüzdeki sıra; etiketleri arayüz kimliğe göre çevirir. */
export const FAKE_GENERATORS = [
  { id: 'firstName' },
  { id: 'lastName' },
  { id: 'fullName' },
  { id: 'gender' },
  { id: 'email' },
  { id: 'userName' },
  { id: 'phone' },
  { id: 'tckn' },
  { id: 'birthDate' },
  { id: 'address' },
  { id: 'street' },
  { id: 'district' },
  { id: 'city' },
  { id: 'postalCode' },
  { id: 'company' },
  { id: 'jobTitle' },
  { id: 'iban' },
  { id: 'creditCard' },
  { id: 'uuid' },
  { id: 'password' },
  { id: 'date' },
  { id: 'dateFuture' },
  { id: 'number' },
  { id: 'price' },
  { id: 'boolean' },
  { id: 'color' },
  { id: 'colorName' },
  { id: 'ipv4' },
  { id: 'ipv6' },
  { id: 'url' },
  { id: 'word' },
  { id: 'words' },
  { id: 'alphaNumeric' },
] as const satisfies readonly { id: string }[];

export type FakeGenerator = (typeof FAKE_GENERATORS)[number]['id'];

const GENERATOR_IDS = new Set<string>(FAKE_GENERATORS.map((g) => g.id));

export function isFakeGenerator(value: string): value is FakeGenerator {
  return GENERATOR_IDS.has(value);
}

/** E-posta alan adları: yalnızca RFC 2606 ile ayrılmış olanlar. */
export const SAFE_EMAIL_DOMAINS: Record<FakeLocale, readonly string[]> = {
  tr: ['example.com', 'example.net', 'example.org', 'ornek.test'],
  en: ['example.com', 'example.net', 'example.org', 'mail.test'],
};

const FOLD: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' };

/** Türkçe harfleri ASCII'ye indirger, harf/rakam dışını atar ("Şükrü O'Neil" → "sukruoneil"). */
export function asciiFold(text: string): string {
  return text
    .toLocaleLowerCase('tr')
    .replace(/[çğıöşü]/g, (ch) => FOLD[ch]!)
    .normalize('NFD')
    .replace(/[^a-z0-9]/g, '');
}

export type FakeValue = string | number | boolean;

interface Person {
  firstName: string;
  lastName: string;
  gender: 'female' | 'male';
}

interface Place {
  city: FakeCity;
  district: string;
  postalCode: string;
  street: string;
}

/** Bir satırın ortak kişi ve yeri: ad, e-posta, kullanıcı adı ve adres alanları birbiriyle tutarlı olur. */
interface RowState {
  person?: Person;
  place?: Place;
}

const SYMBOLS = '!@#$%&*?-_';
const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const UPPER = LOWER.toUpperCase();
const ALNUM = LOWER + '0123456789';
const DAY = 86_400_000;
const YEAR_SECONDS = 365 * 86_400;

function person(ctx: FakeContext, row: RowState): Person {
  if (!row.person) {
    const data = LOCALES[ctx.locale];
    const gender = ctx.rng.int(2) === 0 ? 'female' : 'male';
    row.person = {
      gender,
      firstName: pick(ctx.rng, gender === 'female' ? data.femaleNames : data.maleNames),
      lastName: pick(ctx.rng, data.lastNames),
    };
  }
  return row.person;
}

function place(ctx: FakeContext, row: RowState): Place {
  if (!row.place) {
    const { rng } = ctx;
    const data = LOCALES[ctx.locale];
    const city = pick(rng, data.cities);
    const name = pick(rng, data.streets);
    const type = pick(rng, data.streetTypes);
    row.place = {
      city,
      district: pick(rng, city.districts),
      postalCode: city.postalPrefix + digits(rng, 5 - city.postalPrefix.length),
      street:
        ctx.locale === 'tr'
          ? `${pick(rng, data.neighborhoods)} Mah. ${name} ${type} No: ${between(rng, 1, 180)}`
          : `${between(rng, 1, 9899)} ${name} ${type}`,
    };
  }
  return row.place;
}

function phone(ctx: FakeContext): string {
  const { rng } = ctx;
  if (ctx.locale === 'en') {
    // 555-0100 … 555-0199: NANP'de kurgu için ayrılmış numaralar.
    return `+1 (${pick(rng, ['202', '206', '212', '303', '312', '415', '512', '617'])}) 555-01${digits(rng, 2)}`;
  }
  // Yalnızca biçim (+90 5xx); Türkiye'de kurgu için ayrılmış bir mobil aralık yoktur.
  return `+90 5${pick(rng, ['0', '3', '4', '5'])}${digits(rng, 1)} ${digits(rng, 3)} ${digits(rng, 2)} ${digits(rng, 2)}`;
}

function password(rng: FakeRng): string {
  const chars = [
    pick(rng, [...UPPER]),
    pick(rng, [...LOWER]),
    pick(rng, [...'0123456789']),
    pick(rng, [...SYMBOLS]),
  ];
  const pool = UPPER + LOWER + '0123456789' + SYMBOLS;
  while (chars.length < 14) chars.push(pool[rng.int(pool.length)]!);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join('');
}

function uuid(rng: FakeRng): string {
  const bytes = Array.from({ length: 16 }, () => rng.int(256));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function generate(generator: FakeGenerator, ctx: FakeContext, row: RowState): FakeValue {
  const { rng, locale } = ctx;
  const data = LOCALES[locale];
  switch (generator) {
    case 'firstName':
      return person(ctx, row).firstName;
    case 'lastName':
      return person(ctx, row).lastName;
    case 'fullName': {
      const p = person(ctx, row);
      return `${p.firstName} ${p.lastName}`;
    }
    case 'gender': {
      const female = person(ctx, row).gender === 'female';
      return locale === 'tr' ? (female ? 'Kadın' : 'Erkek') : female ? 'Female' : 'Male';
    }
    case 'email': {
      const p = person(ctx, row);
      const local = `${asciiFold(p.firstName)}.${asciiFold(p.lastName)}${rng.int(1000)}`;
      return `${local}@${pick(rng, SAFE_EMAIL_DOMAINS[locale])}`;
    }
    case 'userName': {
      const p = person(ctx, row);
      return `${asciiFold(p.firstName)}.${asciiFold(p.lastName)}${rng.int(100)}`;
    }
    case 'phone':
      return phone(ctx);
    case 'tckn':
      return fakeTckn(rng);
    case 'birthDate': {
      // 18–80 yaş.
      const days = between(rng, 18 * 365, 80 * 365);
      return new Date(ctx.now - days * DAY).toISOString().slice(0, 10);
    }
    case 'address': {
      const p = place(ctx, row);
      return locale === 'tr'
        ? `${p.street}, ${p.postalCode} ${p.district}/${p.city.name}`
        : `${p.street}, ${p.city.name}, ${p.district} ${p.postalCode}`;
    }
    case 'street':
      return place(ctx, row).street;
    case 'district':
      return place(ctx, row).district;
    case 'city':
      return place(ctx, row).city.name;
    case 'postalCode':
      return place(ctx, row).postalCode;
    case 'company': {
      const head = rng.int(2) === 0 ? person(ctx, {}).lastName : pick(rng, data.companyWords);
      return `${head} ${pick(rng, data.companySectors)} ${pick(rng, data.companySuffixes)}`;
    }
    case 'jobTitle':
      return pick(rng, data.jobTitles);
    case 'iban':
      return fakeTrIban(rng);
    case 'creditCard':
      return fakeCardNumber(rng);
    case 'uuid':
      return uuid(rng);
    case 'password':
      return password(rng);
    case 'date':
      return new Date(ctx.now - rng.int(YEAR_SECONDS) * 1000).toISOString();
    case 'dateFuture':
      return new Date(ctx.now + (1 + rng.int(YEAR_SECONDS)) * 1000).toISOString();
    case 'number':
      return rng.int(1001);
    case 'price':
      return rng.int(100_000) / 100;
    case 'boolean':
      return rng.int(2) === 1;
    case 'color':
      return '#' + rng.int(0x1000000).toString(16).padStart(6, '0');
    case 'colorName':
      return pick(rng, data.colorNames);
    case 'ipv4':
      // RFC 5737 belgeleme blokları (TEST-NET-1/2/3).
      return `${pick(rng, ['192.0.2', '198.51.100', '203.0.113'])}.${between(rng, 1, 254)}`;
    case 'ipv6': {
      // RFC 3849 belgeleme öneki 2001:db8::/32.
      const groups = Array.from({ length: 6 }, () => rng.int(0x10000).toString(16));
      return `2001:db8:${groups.join(':')}`;
    }
    case 'url':
      return `https://${asciiFold(pick(rng, data.words))}.example.com/${asciiFold(pick(rng, data.words))}`;
    case 'word':
      return pick(rng, data.words);
    case 'words':
      return Array.from({ length: 3 }, () => pick(rng, data.words)).join(' ');
    case 'alphaNumeric':
      return ALNUM[rng.int(ALNUM.length)]!;
  }
}

export interface FakeField {
  /** Çıktıdaki sütun / anahtar adı. */
  name: string;
  generator: FakeGenerator;
}

/** Tek kayıt; aynı satırdaki ad, e-posta ve adres alanları aynı kişi ve yere aittir. */
export function fakeRecord(fields: readonly FakeField[], ctx: FakeContext): Record<string, FakeValue> {
  const row: RowState = {};
  const record: Record<string, FakeValue> = {};
  for (const field of fields) {
    // `__proto__` gibi adlar prototipi değiştirmesin.
    Object.defineProperty(record, field.name, {
      value: generate(field.generator, ctx, row),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return record;
}

export function fakeValue(generator: FakeGenerator, ctx: FakeContext = createFakeContext()): FakeValue {
  return generate(generator, ctx, {});
}

/* ---------------------------------------------------------------- dinamik değişkenler */

/** {{$…}} dinamik değişkenlerinden fakeData üretecine karşılık gelenler (Postman adları + Türkçe ekler). */
export const FAKE_DYNAMIC_VARIABLES: Readonly<Record<string, FakeGenerator>> = {
  $guid: 'uuid',
  $randomUUID: 'uuid',
  $randomInt: 'number',
  $randomBoolean: 'boolean',
  $randomAlphaNumeric: 'alphaNumeric',
  $randomFirstName: 'firstName',
  $randomLastName: 'lastName',
  $randomFullName: 'fullName',
  $randomUserName: 'userName',
  $randomEmail: 'email',
  $randomExampleEmail: 'email',
  $randomPhoneNumber: 'phone',
  $randomWord: 'word',
  $randomWords: 'words',
  $randomCity: 'city',
  $randomStreetAddress: 'address',
  $randomColor: 'colorName',
  $randomHexColor: 'color',
  $randomUrl: 'url',
  $randomIP: 'ipv4',
  $randomIPV6: 'ipv6',
  $randomPrice: 'price',
  $randomDatePast: 'date',
  $randomDateFuture: 'dateFuture',
  $randomCompanyName: 'company',
  $randomJobTitle: 'jobTitle',
  $randomPassword: 'password',
  $randomTckn: 'tckn',
  $randomIban: 'iban',
  $randomBankAccountIban: 'iban',
  $randomCreditCardNumber: 'creditCard',
};

/** Dinamik değişkenin değeri (her çağrıda yeni, kriptografik rastgele); bilinmeyen adda undefined. */
export function fakeDynamicValue(name: string): string | undefined {
  const generator = Object.prototype.hasOwnProperty.call(FAKE_DYNAMIC_VARIABLES, name)
    ? FAKE_DYNAMIC_VARIABLES[name]
    : undefined;
  return generator && String(fakeValue(generator));
}
