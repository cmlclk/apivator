import { describe, expect, it } from 'vitest';
import {
  FAKE_DYNAMIC_VARIABLES,
  FAKE_GENERATORS,
  FAKE_SEEDED_NOW,
  asciiFold,
  createFakeContext,
  fakeDynamicValue,
  fakeRecord,
  fakeValue,
  seededRng,
  type FakeField,
} from './fakeData';
import {
  TEST_CARD_PREFIXES,
  fakeCardNumber,
  fakeTckn,
  fakeTrIban,
  ibanCheckDigits,
  ibanValid,
  luhnValid,
  tcknValid,
} from './fakeDataChecks';
import { TR_CITIES } from './fakeDataTr';

const SAFE_EMAIL = /^[a-z0-9.]+@(example\.(com|net|org)|[a-z]+\.test)$/;

describe('doğrulayıcılar', () => {
  it('TCKN algoritması', () => {
    expect(tcknValid('10000000146')).toBe(true);
    expect(tcknValid('10000000147')).toBe(false);
    expect(tcknValid('01234567890')).toBe(false);
    expect(tcknValid('1234')).toBe(false);
    // Elle hesaplanan: 10. hane negatif farkta da mod 10 (1·7 − 36 = −29 → 1).
    expect(tcknValid('12345678950')).toBe(true);
    expect(tcknValid('19090909018')).toBe(true);
    expect(tcknValid('19090909028')).toBe(false);
  });

  it('Luhn', () => {
    expect(luhnValid('4111 1111 1111 1111')).toBe(true);
    expect(luhnValid('5555-5555-5555-4444')).toBe(true);
    expect(luhnValid('4111111111111112')).toBe(false);
    expect(luhnValid('abc')).toBe(false);
  });

  it('IBAN mod-97 ve ülke uzunluğu', () => {
    expect(ibanValid('GB82 WEST 1234 5698 7654 32')).toBe(true);
    expect(ibanValid('de89370400440532013000')).toBe(true);
    expect(ibanValid('GB82WEST12345698765433')).toBe(false);
    expect(ibanValid('TR330006100519786457841326')).toBe(true);
    expect(ibanValid('tr33 0006 1005 1978 6457 8413 26')).toBe(true);
    expect(ibanValid('TR340006100519786457841326')).toBe(false);
    expect(ibanValid('TR33000610051978645784132')).toBe(false); // 25 hane
    expect(ibanCheckDigits('GB', 'WEST12345698765432')).toBe('82');
  });
});

describe('test numarası üreteçleri', () => {
  const rng = seededRng('algoritma');

  it('1000 TCKN, IBAN ve kart numarasının hepsi geçerli', () => {
    for (let i = 0; i < 1000; i++) {
      const tckn = fakeTckn(rng);
      expect(tckn, tckn).toMatch(/^[1-9]\d{10}$/);
      expect(tcknValid(tckn), tckn).toBe(true);

      const iban = fakeTrIban(rng);
      expect(iban, iban).toMatch(/^TR\d{2}999\d{2}0\d{16}$/);
      expect(ibanValid(iban), iban).toBe(true);

      const card = fakeCardNumber(rng);
      expect(card).toHaveLength(16);
      expect(
        TEST_CARD_PREFIXES.some((p) => card.startsWith(p)),
        card,
      ).toBe(true);
      expect(luhnValid(card), card).toBe(true);
    }
  });

  it('güvenli rastgele modda da geçerli', () => {
    const ctx = createFakeContext();
    for (let i = 0; i < 200; i++) {
      expect(tcknValid(String(fakeValue('tckn', ctx)))).toBe(true);
      expect(ibanValid(String(fakeValue('iban', ctx)))).toBe(true);
      expect(luhnValid(String(fakeValue('creditCard', ctx)))).toBe(true);
    }
  });
});

describe('sahte kayıt', () => {
  const fields: FakeField[] = FAKE_GENERATORS.map((g) => ({ name: g.id, generator: g.id }));

  it('aynı tohum aynı çıktıyı verir, farklı tohum farklı', () => {
    const make = (seed: string) => {
      const ctx = createFakeContext({ seed, locale: 'tr' });
      return Array.from({ length: 20 }, () => fakeRecord(fields, ctx));
    };
    expect(make('abc')).toEqual(make('abc'));
    expect(make('abc')).not.toEqual(make('abd'));
    expect(createFakeContext({ seed: 'x' }).now).toBe(FAKE_SEEDED_NOW);
  });

  it('tüm üreteçler her iki dilde değer üretir', () => {
    for (const locale of ['tr', 'en'] as const) {
      const record = fakeRecord(fields, createFakeContext({ seed: locale, locale }));
      for (const field of fields) expect(record[field.name], `${locale}:${field.name}`).not.toBe('');
    }
  });

  it('e-posta yalnızca ayrılmış alan adlarına; IP belgeleme bloklarına', () => {
    for (const locale of ['tr', 'en'] as const) {
      const ctx = createFakeContext({ locale });
      for (let i = 0; i < 500; i++) {
        expect(fakeValue('email', ctx)).toMatch(SAFE_EMAIL);
        expect(fakeValue('ipv4', ctx)).toMatch(/^(192\.0\.2|198\.51\.100|203\.0\.113)\.\d{1,3}$/);
        expect(fakeValue('ipv6', ctx)).toMatch(/^2001:db8:/);
        expect(fakeValue('url', ctx)).toMatch(/^https:\/\/[a-z0-9]+\.example\.com\//);
      }
    }
  });

  it('satır içinde kişi ve yer tutarlı', () => {
    const ctx = createFakeContext({ seed: 'tutarlı', locale: 'tr' });
    for (let i = 0; i < 100; i++) {
      const r = fakeRecord(
        [
          { name: 'ad', generator: 'firstName' },
          { name: 'soyad', generator: 'lastName' },
          { name: 'eposta', generator: 'email' },
          { name: 'il', generator: 'city' },
          { name: 'pk', generator: 'postalCode' },
          { name: 'adres', generator: 'address' },
        ],
        ctx,
      );
      expect(String(r.eposta).startsWith(`${asciiFold(String(r.ad))}.${asciiFold(String(r.soyad))}`)).toBe(
        true,
      );
      const city = TR_CITIES.find((c) => c.name === r.il)!;
      expect(String(r.pk)).toMatch(new RegExp(`^${city.postalPrefix}\\d{3}$`));
      expect(String(r.adres).endsWith(`/${String(r.il)}`)).toBe(true);
      expect(String(r.adres)).toContain(String(r.pk));
    }
  });

  it('telefon biçimleri', () => {
    expect(fakeValue('phone', createFakeContext({ locale: 'tr' }))).toMatch(
      /^\+90 5\d{2} \d{3} \d{2} \d{2}$/,
    );
    expect(fakeValue('phone', createFakeContext({ locale: 'en' }))).toMatch(/^\+1 \(\d{3}\) 555-01\d{2}$/);
  });

  it('81 il, plaka kodu sırasıyla', () => {
    expect(TR_CITIES).toHaveLength(81);
    expect(TR_CITIES[5]).toMatchObject({ name: 'Ankara', postalPrefix: '06' });
    expect(TR_CITIES[33]).toMatchObject({ name: 'İstanbul', postalPrefix: '34' });
    expect(TR_CITIES[80]).toMatchObject({ name: 'Düzce', postalPrefix: '81' });
  });

  it('asciiFold', () => {
    expect(asciiFold("Şükrü Çağlar O'Neil")).toBe('sukrucaglaroneil');
    expect(asciiFold('İrem Işık')).toBe('iremisik');
  });

  it('alan adı __proto__ prototipi değiştirmez', () => {
    const r = fakeRecord([{ name: '__proto__', generator: 'word' }], createFakeContext({ seed: 's' }));
    expect(Object.keys(r)).toEqual(['__proto__']);
    expect(Object.getPrototypeOf(r)).toBe(Object.prototype);
  });

  it('tarih ve doğum tarihi tohumlu modda sabit dayanağa göre', () => {
    const ctx = createFakeContext({ seed: 't' });
    for (let i = 0; i < 100; i++) {
      const birth = Date.parse(String(fakeValue('birthDate', ctx)));
      expect(FAKE_SEEDED_NOW - birth).toBeGreaterThanOrEqual(18 * 365 * 86_400_000 - 86_400_000);
      expect(Date.parse(String(fakeValue('date', ctx)))).toBeLessThanOrEqual(FAKE_SEEDED_NOW);
      expect(Date.parse(String(fakeValue('dateFuture', ctx)))).toBeGreaterThan(FAKE_SEEDED_NOW);
    }
  });
});

describe('dinamik değişkenler', () => {
  it('her ad bir üretece bağlı ve değer üretir', () => {
    for (const name of Object.keys(FAKE_DYNAMIC_VARIABLES)) expect(fakeDynamicValue(name), name).toBeTruthy();
    expect(fakeDynamicValue('$yok')).toBeUndefined();
    expect(fakeDynamicValue('toString')).toBeUndefined();
  });
});
