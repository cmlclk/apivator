import { describe, expect, it } from 'vitest';
import { cookiesFromHeaders, parseSetCookie } from '../cookies';
import { ToolError } from './errors';
import {
  analyzeSetCookie,
  buildSetCookie,
  describeCookieExpiry,
  guessCookieKind,
  parseCookieDate,
  parseCookieHeader,
  parseSetCookieLines,
} from './cookieParse';

const NOW = new Date('2026-10-30T12:00:00Z');
const JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
const levels = (line: string) => analyzeSetCookie(line, NOW).warnings.map((w) => `${w.level}:${w.message}`);

describe('parseCookieDate (RFC 6265 §5.1.1)', () => {
  it('IMF-fixdate, RFC 850 ve asctime', () => {
    const expected = Date.UTC(1994, 10, 6, 8, 49, 37);
    expect(parseCookieDate('Sun, 06 Nov 1994 08:49:37 GMT')?.getTime()).toBe(expected);
    expect(parseCookieDate('Sunday, 06-Nov-94 08:49:37 GMT')?.getTime()).toBe(expected);
    expect(parseCookieDate('Sun Nov  6 08:49:37 1994')?.getTime()).toBe(expected);
  });

  it('eski biçimler: iki haneli yıl, tireli tarih, sırasız alanlar', () => {
    expect(parseCookieDate('Wed, 09-Jun-21 10:18:14 GMT')?.toISOString()).toBe('2021-06-09T10:18:14.000Z');
    expect(parseCookieDate('Thu, 01 Jan 1970 00:00:00 GMT')?.getTime()).toBe(0);
    expect(parseCookieDate('2026 Dec 01 23:59:59')?.toISOString()).toBe('2026-12-01T23:59:59.000Z');
  });

  it('geçersiz tarihler null', () => {
    expect(parseCookieDate('yarın')).toBeNull();
    expect(parseCookieDate('Mon, 31 Feb 2026 10:00:00 GMT')).toBeNull();
    expect(parseCookieDate('Mon, 10 Feb 2026 25:00:00 GMT')).toBeNull();
    expect(parseCookieDate('Mon, 10 Feb 1500 10:00:00 GMT')).toBeNull();
  });
});

describe('analyzeSetCookie', () => {
  it('RFC 6265 örneği: SID, Path, Domain, Secure, HttpOnly', () => {
    const c = analyzeSetCookie(
      'Set-Cookie: SID=31d4d96e407aad42; Path=/; Domain=example.com; Secure; HttpOnly',
      NOW,
    );
    expect(c).toMatchObject({
      name: 'SID',
      value: '31d4d96e407aad42',
      path: '/',
      domain: 'example.com',
      secure: true,
      httpOnly: true,
      hostOnly: false,
    });
    expect(c.expiry).toEqual({ kind: 'session' });
  });

  it('Expires çözülür ve şu ana göre süre hesaplanır', () => {
    const c = analyzeSetCookie('lang=en-US; Expires=Wed, 09 Jun 2027 10:18:14 GMT', NOW);
    expect(c.expiresDate?.toISOString()).toBe('2027-06-09T10:18:14.000Z');
    expect(c.expiry).toMatchObject({ kind: 'date', source: 'expires', expired: false, capped: false });
    expect(describeCookieExpiry(c.expiry, NOW)).toMatch(/^221 gün 22 saat sonra$/);
  });

  it('geçmiş Expires: çerez silinir (RFC 6265 lang örneği)', () => {
    const c = analyzeSetCookie('lang=; Expires=Sun, 06 Nov 1994 08:49:37 GMT', NOW);
    expect(c.expiry).toMatchObject({ expired: true });
    expect(describeCookieExpiry(c.expiry, NOW)).toMatch(/süresi doldu/);
  });

  it("Max-Age, Expires'tan önceliklidir; ≤ 0 hemen siler", () => {
    const c = analyzeSetCookie('a=b; Expires=Sun, 06 Nov 1994 08:49:37 GMT; Max-Age=3600', NOW);
    expect(c.maxAge).toBe(3600);
    expect(c.expiry).toMatchObject({ source: 'max-age', expired: false });
    expect((c.expiry as { date: Date }).date.toISOString()).toBe('2026-10-30T13:00:00.000Z');
    expect(levels('a=b; Expires=Sun, 06 Nov 1994 08:49:37 GMT; Max-Age=3600').join()).toMatch(
      /Max-Age önceliklidir/,
    );
    const gone = analyzeSetCookie('a=b; Max-Age=0', NOW);
    expect(describeCookieExpiry(gone.expiry, NOW)).toBe('hemen silinir (Max-Age ≤ 0)');
  });

  it('400 günü aşan ömür kısaltılır; geçersiz Max-Age yok sayılır', () => {
    const c = analyzeSetCookie('a=b; Max-Age=999999999', NOW);
    expect(c.expiry).toMatchObject({ capped: true });
    expect(levels('a=b; Max-Age=12abc').join()).toMatch(/Max-Age geçersiz/);
    expect(analyzeSetCookie('a=b; Max-Age=12abc', NOW).expiry).toEqual({ kind: 'session' });
    expect(levels('a=b; Expires=yarın').join()).toMatch(/Expires tarihi çözülemedi/);
  });

  it('SameSite=None Secure olmadan hata; geçersiz değer uyarı; yoksa bilgi', () => {
    expect(levels('a=b; SameSite=None')).toContainEqual(expect.stringMatching(/^error:SameSite=None/));
    expect(levels('a=b; SameSite=None; Secure').join()).not.toMatch(/SameSite=None için/);
    expect(levels('a=b; SameSite=Bazen')).toContainEqual(
      expect.stringMatching(/^warning:SameSite değeri geçersiz/),
    );
    expect(levels('a=b')).toContainEqual(expect.stringMatching(/^info:SameSite yok/));
  });

  it('Partitioned ve Priority', () => {
    const c = analyzeSetCookie(
      '__Host-chips=1; Secure; Path=/; SameSite=None; Partitioned; Priority=High',
      NOW,
    );
    expect(c.partitioned).toBe(true);
    expect(c.priority).toBe('High');
    expect(c.warnings.filter((w) => w.level === 'error')).toEqual([]);
    expect(levels('a=b; Partitioned')).toContainEqual(expect.stringMatching(/^error:Partitioned/));
    expect(levels('a=b; Priority=Urgent').join()).toMatch(/Priority Low/);
  });

  it('__Secure- ve __Host- önek kuralları (büyük/küçük harf duyarsız)', () => {
    expect(levels('__Secure-id=1')).toContainEqual(expect.stringMatching(/^error:__Secure-/));
    expect(levels('__Secure-id=1; Secure').join()).not.toMatch(/__Secure-/);
    const host = levels('__host-id=1; Secure; Domain=example.com; Path=/app').join();
    expect(host).toMatch(/__Host- öneki kuralı ihlal: Domain olmamalı, Path=\/ olmalı/);
    expect(levels('__Host-id=1; Secure; Path=/').join()).not.toMatch(/__Host-/);
  });

  it('boyut, Domain noktası, Path, bilinmeyen öznitelik uyarıları', () => {
    expect(levels(`big=${'x'.repeat(4100)}`)).toContainEqual(
      expect.stringMatching(/^error:Ad \+ değer 4103 bayt/),
    );
    const c = analyzeSetCookie('a=b; Domain=.example.com; Path=app; Foo=bar', NOW);
    expect(c.domain).toBe('example.com');
    expect(c.unknownAttributes).toEqual(['Foo']);
    const text = c.warnings.map((w) => w.message).join();
    expect(text).toMatch(/başındaki nokta/);
    expect(text).toMatch(/Path "\/" ile başlamıyor/);
    expect(text).toMatch(/Bilinmeyen öznitelik yok sayılır: Foo/);
  });

  it('adsız çerez (6265bis), JWT ve yüzde kodlu değer', () => {
    const nameless = analyzeSetCookie('justavalue; Path=/', NOW);
    expect(nameless).toMatchObject({ name: '', value: 'justavalue', path: '/' });
    expect(nameless.warnings[0]?.message).toMatch(/Adsız çerez/);
    expect(analyzeSetCookie(`token="${JWT}"; HttpOnly`, NOW).jwt).toBe(JWT);
    expect(analyzeSetCookie('q=%C3%A7a%C4%9Fr%C4%B1', NOW).decodedValue).toBe('çağrı');
    expect(levels('session_id=abc').join()).toMatch(/HttpOnly değil/);
  });

  it('boş satır ToolError', () => {
    expect(() => analyzeSetCookie('Set-Cookie:   ', NOW)).toThrow(ToolError);
    expect(() => analyzeSetCookie('; Path=/', NOW)).toThrow(/Ad=değer/);
  });
});

describe('parseSetCookieLines', () => {
  it('birden çok satır; yanıt başlıklarındaki diğer başlıklar atlanır', () => {
    const text = [
      'HTTP/1.1 200 OK',
      'Content-Type: text/html',
      'Set-Cookie: SID=31d4d96e407aad42; Path=/; Secure; HttpOnly',
      'set-cookie: lang=en-US; Path=/; Domain=example.com',
      'theme=dark; Max-Age=60',
    ].join('\r\n');
    expect(parseSetCookieLines(text, NOW).map((c) => c.name)).toEqual(['SID', 'lang', 'theme']);
    expect(() => parseSetCookieLines('Content-Type: text/html', NOW)).toThrow(/bulunamadı/);
  });
});

describe('parseCookieHeader', () => {
  it('ad=değer listesi, yinelenen ad, tırnaklı ve yüzde kodlu değer', () => {
    const info = parseCookieHeader('Cookie: SID=31d4d96e407aad42; lang=en-US; lang=tr; q="a%20b"; flag');
    expect(info.cookies.map((c) => [c.name, c.value, c.duplicate])).toEqual([
      ['SID', '31d4d96e407aad42', false],
      ['lang', 'en-US', false],
      ['lang', 'tr', true],
      ['q', '"a%20b"', false],
      ['', 'flag', false],
    ]);
    expect(info.cookies[3]).toMatchObject({ quoted: true, decodedValue: 'a b' });
    const text = info.warnings.map((w) => w.message).join();
    expect(text).toMatch(/Yinelenen ad: lang/);
    expect(text).toMatch(/adsız çerez/);
  });

  it('JWT değeri ve boş başlık', () => {
    expect(parseCookieHeader(`auth=${JWT}`).cookies[0]?.jwt).toBe(JWT);
    expect(() => parseCookieHeader('Cookie: ')).toThrow(ToolError);
  });
});

describe('guessCookieKind', () => {
  it('öneke ya da özniteliklere göre tahmin', () => {
    expect(guessCookieKind('Set-Cookie: a=b')).toBe('set-cookie');
    expect(guessCookieKind('Cookie: a=b; c=d')).toBe('cookie');
    expect(guessCookieKind('a=b; Path=/; HttpOnly')).toBe('set-cookie');
    expect(guessCookieKind('a=b; c=d')).toBe('cookie');
  });
});

describe('buildSetCookie', () => {
  it('tüm alanlar; çıktı geri çözülebilir', () => {
    const line = buildSetCookie({
      name: '__Host-sid',
      value: 'abc123',
      expires: new Date('2027-01-01T00:00:00Z'),
      maxAge: 3600,
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'Lax',
      partitioned: true,
      priority: 'High',
    });
    expect(line).toBe(
      '__Host-sid=abc123; Expires=Fri, 01 Jan 2027 00:00:00 GMT; Max-Age=3600; Path=/; Secure; HttpOnly; SameSite=Lax; Partitioned; Priority=High',
    );
    const parsed = analyzeSetCookie(line, NOW);
    expect(parsed.warnings.filter((w) => w.level === 'error')).toEqual([]);
  });

  it('geçersiz ad/değer ToolError; yüzde kodlama seçeneği', () => {
    expect(() => buildSetCookie({ name: '', value: 'x' })).toThrow(/adı gerekli/);
    expect(() => buildSetCookie({ name: 'a b', value: 'x' })).toThrow(/geçersiz karakter/);
    expect(() => buildSetCookie({ name: 'a', value: 'x;y' })).toThrow(/Yüzde kodla/);
    expect(buildSetCookie({ name: 'a', value: 'çağrı; x', encodeValue: true })).toBe(
      'a=%C3%A7a%C4%9Fr%C4%B1%3B%20x',
    );
    expect(() => buildSetCookie({ name: 'a', value: 'b', maxAge: 1.5 })).toThrow(/tam sayı/);
  });
});

describe('cookies.ts davranışı korunur', () => {
  it('parseSetCookie ve cookiesFromHeaders', () => {
    expect(parseSetCookie('a=b; Max-Age=12abc')?.maxAge).toBe(12);
    expect(cookiesFromHeaders([{ key: 'Set-Cookie', value: 'x=1', enabled: true }] as never)).toHaveLength(1);
  });
});
