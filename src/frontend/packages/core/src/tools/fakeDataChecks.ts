/**
 * Test kimlik ve hesap numaraları: TCKN, Luhn (kart), IBAN — doğrulayıcılar ve algoritmaya uygun üreteçler.
 * Kart numaraları yalnızca test önekleriyle, IBAN'lar atanmamış banka koduyla üretilir (ayrıntı aşağıda).
 */
import type { FakeRng } from './fakeData';

const digits = (rng: FakeRng, count: number) => Array.from({ length: count }, () => rng.int(10)).join('');

/** TCKN: 11 hane, ilk hane 0 değil; 10. hane = (tek sıralar×7 − çift sıralar) mod 10, 11. hane = ilk 10'un toplamı mod 10. */
export function tcknValid(value: string): boolean {
  const s = value.trim();
  if (!/^[1-9]\d{10}$/.test(s)) return false;
  const d = [...s].map(Number);
  const odd = d[0]! + d[2]! + d[4]! + d[6]! + d[8]!;
  const even = d[1]! + d[3]! + d[5]! + d[7]!;
  const tenth = (((odd * 7 - even) % 10) + 10) % 10;
  const eleventh = d.slice(0, 10).reduce((a, b) => a + b, 0) % 10;
  return d[9] === tenth && d[10] === eleventh;
}

export function fakeTckn(rng: FakeRng): string {
  const d = [1 + rng.int(9), ...Array.from({ length: 8 }, () => rng.int(10))];
  const odd = d[0]! + d[2]! + d[4]! + d[6]! + d[8]!;
  const even = d[1]! + d[3]! + d[5]! + d[7]!;
  d.push((((odd * 7 - even) % 10) + 10) % 10);
  d.push(d.reduce((a, b) => a + b, 0) % 10);
  return d.join('');
}

/** Luhn (mod 10) kontrol hanesi: `payload` sonuna eklenecek hane. */
export function luhnCheckDigit(payload: string): number {
  let sum = 0;
  for (let i = 0; i < payload.length; i++) {
    let n = Number(payload[payload.length - 1 - i]);
    if (i % 2 === 0) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return (10 - (sum % 10)) % 10;
}

/** Boşluk ve tireler yok sayılır. */
export function luhnValid(value: string): boolean {
  const s = value.replace(/[\s-]/g, '');
  if (!/^\d{2,}$/.test(s)) return false;
  return luhnCheckDigit(s.slice(0, -1)) === Number(s.slice(-1));
}

/**
 * Kart numaraları yalnızca yaygın test önekleriyle üretilir: 411111 (Visa test), 555555 (Mastercard test),
 * 999999 (ISO 7812'de kart ağlarına ait olmayan "9" sektörü). Rastgele gerçekçi BIN üretilmez.
 */
export const TEST_CARD_PREFIXES = ['411111', '555555', '999999'] as const;

export function fakeCardNumber(
  rng: FakeRng,
  prefix: string = TEST_CARD_PREFIXES[rng.int(TEST_CARD_PREFIXES.length)]!,
): string {
  const payload = prefix + digits(rng, 15 - prefix.length);
  return payload + luhnCheckDigit(payload);
}

/** Ülkeye göre IBAN uzunlukları (sık kullanılanlar); listede olmayan ülkede yalnızca mod-97 denetlenir. */
const IBAN_LENGTHS: Record<string, number> = {
  TR: 26,
  DE: 22,
  GB: 22,
  FR: 27,
  NL: 18,
  IT: 27,
  ES: 24,
  BE: 16,
  AT: 20,
  CH: 21,
  PL: 28,
  SE: 24,
};

function mod97(text: string): number {
  let rest = 0;
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    const part = code >= 65 ? String(code - 55) : ch; // A=10 … Z=35
    for (const digit of part) rest = (rest * 10 + Number(digit)) % 97;
  }
  return rest;
}

/** ISO 13616 kontrol haneleri (BBAN + ülke + "00" → 98 − mod 97). */
export function ibanCheckDigits(country: string, bban: string): string {
  return String(98 - mod97(bban + country + '00')).padStart(2, '0');
}

/** Boşluklar yok sayılır; büyük/küçük harf duyarsız. */
export function ibanValid(value: string): boolean {
  const s = value.replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
  const length = IBAN_LENGTHS[s.slice(0, 2)];
  if (length !== undefined && s.length !== length) return false;
  if (s.startsWith('TR') && !/^TR\d{8}[A-Z0-9]{16}$/.test(s)) return false;
  return mod97(s.slice(4) + s.slice(0, 4)) === 1;
}

/**
 * TR IBAN: TR + 2 kontrol + 5 banka kodu + 1 rezerv (0) + 16 hesap. Banka kodu 99900–99999: TCMB'nin atadığı
 * EFT kodları bu aralıkta değildir, numara gerçek bir hesaba karşılık gelmez.
 */
export function fakeTrIban(rng: FakeRng): string {
  const bban = '999' + digits(rng, 2) + '0' + digits(rng, 16);
  return 'TR' + ibanCheckDigits('TR', bban) + bban;
}
