import { describe, expect, it } from 'vitest';
import { ToolError } from './errors';
import { parseUserAgent, uaDeviceLabel, type UaDeviceType } from './userAgent';

/** [UA, tarayıcı, motor, işletim sistemi, cihaz türü] — gerçek dünyadan örnekler. */
const BROWSERS: [string, string | null, string | null, string | null, UaDeviceType][] = [
  [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    'Chrome 130.0.0.0',
    'Blink',
    'Windows 10 / 11',
    'desktop',
  ],
  [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
    'Microsoft Edge 130.0.0.0',
    'Blink',
    'Windows 10 / 11',
    'desktop',
  ],
  [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0',
    'Firefox 132.0',
    'Gecko',
    'Windows 10 / 11',
    'desktop',
  ],
  [
    'Mozilla/5.0 (Windows NT 6.1; WOW64; Trident/7.0; rv:11.0) like Gecko',
    'Internet Explorer 11.0',
    'Trident',
    'Windows 7',
    'desktop',
  ],
  [
    'Mozilla/4.0 (compatible; MSIE 8.0; Windows NT 5.1; Trident/4.0)',
    'Internet Explorer 8.0',
    'Trident',
    'Windows XP',
    'desktop',
  ],
  [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/42.0.2311.135 Safari/537.36 Edge/12.10136',
    'Edge (eski, EdgeHTML) 12.10136',
    'EdgeHTML',
    'Windows 10 / 11',
    'desktop',
  ],
  [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 OPR/115.0.0.0',
    'Opera 115.0.0.0',
    'Blink',
    'Windows 10 / 11',
    'desktop',
  ],
  [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 YaBrowser/24.10.0.0 Safari/537.36',
    'Yandex Browser 24.10.0.0',
    'Blink',
    'Windows 10 / 11',
    'desktop',
  ],
  [
    'Mozilla/5.0 (Windows NT 6.3; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36 Vivaldi/5.6.2867.62',
    'Vivaldi 5.6.2867.62',
    'Blink',
    'Windows 8.1',
    'desktop',
  ],
  [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
    'Safari 18.1',
    'WebKit',
    'macOS 10.15.7',
    'desktop',
  ],
  [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    'Chrome 130.0.0.0',
    'Blink',
    'macOS 10.15.7',
    'desktop',
  ],
  [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.7; rv:132.0) Gecko/20100101 Firefox/132.0',
    'Firefox 132.0',
    'Gecko',
    'macOS 14.7',
    'desktop',
  ],
  [
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    'Chrome 130.0.0.0',
    'Blink',
    'Linux',
    'desktop',
  ],
  [
    'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0',
    'Firefox 131.0',
    'Gecko',
    'Ubuntu (Linux)',
    'desktop',
  ],
  [
    'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    'Chrome 130.0.0.0',
    'Blink',
    'ChromeOS 14541.0.0',
    'desktop',
  ],
  [
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
    'Safari 18.1',
    'WebKit',
    'iOS 18.1',
    'mobile',
  ],
  [
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1',
    'Chrome (iOS) 130.0.6723.90',
    'WebKit',
    'iOS 17.6',
    'mobile',
  ],
  [
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/132.0 Mobile/15E148 Safari/605.1.15',
    'Firefox (iOS) 132.0',
    'WebKit',
    'iOS 18.0',
    'mobile',
  ],
  [
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 EdgiOS/130.2849.80 Mobile/15E148 Safari/605.1.15',
    'Microsoft Edge 130.2849.80',
    'WebKit',
    'iOS 17.5',
    'mobile',
  ],
  [
    'Mozilla/5.0 (iPad; CPU OS 17_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.7 Mobile/15E148 Safari/604.1',
    'Safari 17.7',
    'WebKit',
    'iPadOS 17.7',
    'tablet',
  ],
  [
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
    'Chrome 130.0.0.0',
    'Blink',
    'Android 10',
    'mobile',
  ],
  [
    'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36',
    'Samsung Internet 26.0',
    'Blink',
    'Android 14',
    'mobile',
  ],
  [
    'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36 EdgA/116.0.1938.79',
    'Microsoft Edge 116.0.1938.79',
    'Blink',
    'Android 13',
    'mobile',
  ],
  [
    'Mozilla/5.0 (Android 14; Mobile; rv:132.0) Gecko/132.0 Firefox/132.0',
    'Firefox 132.0',
    'Gecko',
    'Android 14',
    'mobile',
  ],
  [
    'Mozilla/5.0 (Linux; Android 12; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
    'Chrome 129.0.0.0',
    'Blink',
    'Android 12',
    'tablet',
  ],
  [
    'Mozilla/5.0 (Linux; Android 11; KFTRWI) AppleWebKit/537.36 (KHTML, like Gecko) Silk/128.3.1 like Chrome/128.0.6613.187 Safari/537.36',
    'Amazon Silk 128.3.1',
    'Blink',
    'Android 11',
    'tablet',
  ],
  [
    'Mozilla/5.0 (Linux; Android 13; 2201117TG) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.6668.100 YaBrowser/24.10.1.100 Mobile Safari/537.36',
    'Yandex Browser 24.10.1.100',
    'Blink',
    'Android 13',
    'mobile',
  ],
  [
    'Mozilla/5.0 (Linux; Android 14; CPH2581 Build/UKQ1.230924.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.6723.86 Mobile Safari/537.36',
    'Chrome 130.0.6723.86',
    'Blink',
    'Android 14',
    'mobile',
  ],
  [
    'Mozilla/5.0 (SMART-TV; LINUX; Tizen 6.0) AppleWebKit/537.36 (KHTML, like Gecko) 76.0.3809.146/6.0 TV Safari/537.36',
    null,
    'WebKit',
    'Tizen 6.0',
    'tv',
  ],
  [
    'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.79 Safari/537.36 WebAppManager',
    'Chrome 79.0.3945.79',
    'Blink',
    'webOS',
    'tv',
  ],
  [
    'Mozilla/5.0 (PlayStation; PlayStation 5/2.26) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0 Safari/605.1.15',
    'Safari 13.0',
    'WebKit',
    'PlayStation',
    'console',
  ],
];

const label = (part: { name: string; version: string | null } | null) =>
  part ? [part.name, part.version].filter(Boolean).join(' ') : null;

describe('parseUserAgent: tarayıcılar', () => {
  it.each(BROWSERS)('%s', (ua, browser, engine, os, device) => {
    const info = parseUserAgent(ua);
    expect(label(info.browser)).toBe(browser);
    expect(info.engine?.name ?? null).toBe(engine);
    expect(label(info.os)).toBe(os);
    expect(info.device.type).toBe(device);
    expect(info.bot).toBeNull();
  });
});

/** [UA, bot adı, sürüm, tür] */
const BOTS: [string, string, string | null, 'crawler' | 'client' | 'apivator'][] = [
  ['Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'Googlebot', '2.1', 'crawler'],
  [
    'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.69 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Googlebot',
    '2.1',
    'crawler',
  ],
  ['Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)', 'Bingbot', '2.0', 'crawler'],
  ['Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)', 'YandexBot', '3.0', 'crawler'],
  [
    'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
    'Facebook önizleme',
    '1.1',
    'crawler',
  ],
  [
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)',
    'GPTBot',
    '1.2',
    'crawler',
  ],
  [
    'Mozilla/5.0 (compatible; SeznamBot/4.0; +https://o-seznam.cz/napoveda/vyhledavani/en/seznambot-crawler/)',
    'SeznamBot',
    null,
    'crawler',
  ],
  ['curl/8.10.1', 'curl', '8.10.1', 'client'],
  ['PostmanRuntime/7.42.0', 'Postman', '7.42.0', 'client'],
  ['python-requests/2.32.3', 'python-requests', '2.32.3', 'client'],
  ['okhttp/4.12.0', 'OkHttp', '4.12.0', 'client'],
  ['Go-http-client/2.0', 'Go net/http', '2.0', 'client'],
  ['Wget/1.21.4', 'Wget', '1.21.4', 'client'],
  ['axios/1.7.7', 'axios', '1.7.7', 'client'],
  [
    'Mozilla/5.0 (Windows NT 10.0; Microsoft Windows 10.0.22631; tr-TR) WindowsPowerShell/5.1.22621.4391',
    'PowerShell',
    '5.1.22621.4391',
    'client',
  ],
  ['Apivator/0.1', 'Apivator', '0.1', 'apivator'],
  ['apivator-cli/1.2.0', 'Apivator CLI', '1.2.0', 'apivator'],
];

describe('parseUserAgent: botlar ve HTTP istemcileri', () => {
  it.each(BOTS)('%s', (ua, name, version, kind) => {
    const info = parseUserAgent(ua);
    expect(info.bot).toEqual({ name, version, kind });
    expect(info.device.type).toBe('bot');
  });

  it('istemcilerde tarayıcı ve motor yok; tarayıcı botunda Chrome görünür', () => {
    expect(parseUserAgent('curl/8.10.1')).toMatchObject({ browser: null, engine: null });
    const mobileBot = parseUserAgent(BOTS[1]![0]);
    expect(mobileBot.browser?.name).toBe('Chrome');
    expect(mobileBot.notes.join()).toMatch(/ters DNS/);
  });
});

describe('parseUserAgent: uygulama içi tarayıcılar ve notlar', () => {
  it('Instagram, Facebook, Android WebView, iOS WKWebView', () => {
    expect(
      parseUserAgent(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 352.0.0.29.103 (iPhone14,5; iOS 17_6; tr_TR; tr; scale=3.00; 1170x2532; 650377154)',
      ).webView,
    ).toBe('Instagram');
    expect(
      parseUserAgent(
        'Mozilla/5.0 (Linux; Android 14; SM-A546B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.6723.86 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/487.0.0.42.110;]',
      ).webView,
    ).toBe('Facebook');
    const wv = parseUserAgent(BROWSERS[27]![0]);
    expect(wv.webView).toBe('Android WebView');
    expect(wv.device).toMatchObject({ vendor: 'OPPO', model: 'CPH2581' });
    expect(
      parseUserAgent(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
      ).webView,
    ).toBe('iOS WKWebView');
  });

  it('Windows 10/11, macOS dondurulmuş sürüm, azaltılmış Android UA ve Client Hints notları', () => {
    expect(parseUserAgent(BROWSERS[0]![0]).notes.join()).toMatch(/Windows 10 ve 11.*ayırt edilemez/);
    expect(parseUserAgent(BROWSERS[0]![0]).notes.join()).toMatch(/Sec-CH-UA/);
    expect(parseUserAgent(BROWSERS[9]![0]).notes.join()).toMatch(/10\.15\.7’de dondurulmuştur/);
    const reduced = parseUserAgent(BROWSERS[20]![0]);
    expect(reduced.notes.join()).toMatch(/Azaltılmış UA/);
    expect(reduced.device.model).toBeNull();
    expect(parseUserAgent(BROWSERS[21]![0]).device).toMatchObject({ vendor: 'Samsung', model: 'SM-S918B' });
    expect(parseUserAgent(BROWSERS[23]![0]).device.model).toBeNull();
  });

  it('User-Agent: öneki atılır; boş metin ToolError; bilinmeyen metin', () => {
    expect(parseUserAgent(`User-Agent: ${BROWSERS[2]![0]}`).browser?.name).toBe('Firefox');
    expect(() => parseUserAgent('  ')).toThrow(ToolError);
    const unknown = parseUserAgent('benim-istemcim');
    expect(unknown.device.type).toBe('unknown');
    expect(unknown.notes.join()).toMatch(/Tanınan/);
  });

  it('çok uzun metinde karesel zamana düşmez (yalnızca baş çözümlenir)', () => {
    const start = Date.now();
    const info = parseUserAgent(`${'a'.repeat(100_000)} bot`);
    parseUserAgent('Version/1'.repeat(12_000));
    parseUserAgent('Android'.repeat(14_000));
    expect(Date.now() - start).toBeLessThan(1000);
    expect(info.notes.join()).toMatch(/4096 karakter/);
  });

  it('cihaz türü etiketleri', () => {
    expect(uaDeviceLabel('tablet')).toBe('Tablet');
    expect(uaDeviceLabel('bot')).toBe('Bot / istemci');
  });
});
