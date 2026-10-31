import { describe, expect, it } from 'vitest';
import { cookiesFromHeaders, parseSetCookie, responseFileName } from './cookies';

describe('cookies', () => {
  it('parses attributes', () => {
    expect(
      parseSetCookie('sid=abc=1; Domain=.ornek.com; Path=/; Max-Age=3600; HttpOnly; Secure; SameSite=Lax'),
    ).toEqual({
      name: 'sid',
      value: 'abc=1',
      domain: 'ornek.com',
      path: '/',
      expires: null,
      maxAge: 3600,
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    });
    expect(parseSetCookie('bozuk')).toBeNull();
  });

  it('collects only Set-Cookie headers', () => {
    const cookies = cookiesFromHeaders([
      { key: 'Set-Cookie', value: 'a=1' },
      { key: 'content-type', value: 'text/plain' },
      { key: 'set-cookie', value: 'b=2; Expires=Wed, 21 Oct 2026 07:28:00 GMT' },
    ]);
    expect(cookies.map((c) => [c.name, c.expires])).toEqual([
      ['a', null],
      ['b', 'Wed, 21 Oct 2026 07:28:00 GMT'],
    ]);
  });

  it('chooses a file name', () => {
    expect(
      responseFileName([{ key: 'Content-Disposition', value: 'attachment; filename="rapor.pdf"' }]),
    ).toBe('rapor.pdf');
    expect(responseFileName([{ key: 'Content-Type', value: 'application/json; charset=utf-8' }])).toBe(
      'yanit.json',
    );
    expect(responseFileName([])).toBe('yanit.bin');
  });
});
