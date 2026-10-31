import { msg } from '../i18n';
import { ToolError } from './errors';

/**
 * Bağımlılıksız User-Agent çözümleyici. UA metni güvenilir değildir (taklit edilebilir, Chromium
 * "azaltılmış UA" ile sürüm ve modeli gizler); sonuç bir tahmindir.
 */

export type UaDeviceType = 'mobile' | 'tablet' | 'desktop' | 'tv' | 'console' | 'bot' | 'unknown';

export interface UaPart {
  name: string;
  version: string | null;
}

export interface UserAgentInfo {
  browser: UaPart | null;
  engine: UaPart | null;
  os: UaPart | null;
  device: { type: UaDeviceType; vendor: string | null; model: string | null };
  /** Bot, tarayıcı olmayan HTTP istemcisi ya da Apivator'ın kendi istemcisi. */
  bot: { name: string; version: string | null; kind: 'crawler' | 'client' | 'apivator' } | null;
  /** Uygulama içi tarayıcı (Facebook, Instagram, Android WebView…). */
  webView: string | null;
  notes: string[];
}

/** Sıra önemli: özel olanlar genel kalıplardan önce. [kalıp, ad, tür] — kalıbın 1. grubu sürüm. */
const BOTS: [RegExp, string, 'crawler' | 'client' | 'apivator'][] = [
  [/\bApivator\/([\d.]+)/i, 'Apivator', 'apivator'],
  [/\bapivator-cli\/([\d.]+)/i, 'Apivator CLI', 'apivator'],
  [/\bapivator-agent(?:\/([\d.]+))?/i, 'Apivator Agent', 'apivator'],
  [/\bapivator-grpc\/([\d.]+)/i, 'Apivator gRPC', 'apivator'],
  [/Googlebot(?:-[A-Za-z]+)?\/([\d.]+)/, 'Googlebot', 'crawler'],
  [/Google-InspectionTool\/([\d.]+)/, 'Google Inspection Tool', 'crawler'],
  [/AdsBot-Google()/, 'Google AdsBot', 'crawler'],
  [/bingbot\/([\d.]+)/i, 'Bingbot', 'crawler'],
  [/YandexBot\/([\d.]+)/, 'YandexBot', 'crawler'],
  [/YandexMobileBot\/([\d.]+)/, 'YandexBot', 'crawler'],
  [/DuckDuckBot\/([\d.]+)/, 'DuckDuckBot', 'crawler'],
  [/Baiduspider(?:-render)?\/([\d.]+)/, 'Baiduspider', 'crawler'],
  [/Applebot\/([\d.]+)/, 'Applebot', 'crawler'],
  [/facebookexternalhit\/([\d.]+)/, 'Facebook önizleme', 'crawler'],
  [/Twitterbot\/([\d.]+)/, 'Twitterbot', 'crawler'],
  [/Slackbot(?:-LinkExpanding)? ([\d.]+)/, 'Slackbot', 'crawler'],
  [/LinkedInBot\/([\d.]+)/, 'LinkedInBot', 'crawler'],
  [/WhatsApp\/([\d.]+)/, 'WhatsApp önizleme', 'crawler'],
  [/TelegramBot()/, 'TelegramBot', 'crawler'],
  [/Discordbot\/([\d.]+)/, 'Discordbot', 'crawler'],
  [/AhrefsBot\/([\d.]+)/, 'AhrefsBot', 'crawler'],
  [/SemrushBot\/([\d.~a-z]+)/, 'SemrushBot', 'crawler'],
  [/GPTBot\/([\d.]+)/, 'GPTBot', 'crawler'],
  [/ClaudeBot\/([\d.]+)/, 'ClaudeBot', 'crawler'],
  [/PetalBot()/, 'PetalBot', 'crawler'],
  [/^curl\/([\d.]+)/, 'curl', 'client'],
  [/^Wget\/([\d.]+)/, 'Wget', 'client'],
  [/PostmanRuntime\/([\d.]+)/, 'Postman', 'client'],
  [/^insomnia\/([\d.]+)/, 'Insomnia', 'client'],
  [/^HTTPie\/([\d.]+)/, 'HTTPie', 'client'],
  [/python-requests\/([\d.]+)/, 'python-requests', 'client'],
  [/python-httpx\/([\d.]+)/, 'HTTPX (Python)', 'client'],
  [/Python-urllib\/([\d.]+)/, 'urllib (Python)', 'client'],
  [/aiohttp\/([\d.]+)/, 'aiohttp (Python)', 'client'],
  [/^okhttp\/([\d.]+)/, 'OkHttp', 'client'],
  [/^Go-http-client\/([\d.]+)/, 'Go net/http', 'client'],
  [/^axios\/([\d.]+)/, 'axios', 'client'],
  [/^node-fetch(?:\/([\d.]+))?/, 'node-fetch', 'client'],
  [/^undici()/, 'undici (Node.js fetch)', 'client'],
  [/^Java-http-client\/([\d.]+)/, 'Java HttpClient', 'client'],
  [/^Apache-HttpClient\/([\d.]+)/, 'Apache HttpClient', 'client'],
  [/^Dart\/([\d.]+)/, 'Dart', 'client'],
  [/WindowsPowerShell\/([\d.]+)/, 'PowerShell', 'client'],
  [/^Mozilla\/5\.0 \(compatible; ([A-Za-z]+(?:bot|crawler|spider))/i, '', 'crawler'],
];

/** Tablodaki Türkçe adların etkin dildeki karşılığı; diğer adlar olduğu gibi gösterilir. */
const LOCAL_NAMES: Record<string, () => string> = {
  'Facebook önizleme': () => msg('toolsNet.ua.name.facebookPreview', 'Facebook önizleme'),
  'WhatsApp önizleme': () => msg('toolsNet.ua.name.whatsappPreview', 'WhatsApp önizleme'),
  'Google uygulaması': () => msg('toolsNet.ua.name.googleApp', 'Google uygulaması'),
  'Edge (eski, EdgeHTML)': () => msg('toolsNet.ua.name.legacyEdge', 'Edge (eski, EdgeHTML)'),
};
const displayName = (name: string) => LOCAL_NAMES[name]?.() ?? name;

/** Bundan uzun metnin yalnızca başı çözümlenir. */
const MAX_UA_LENGTH = 4096;

const GENERIC_BOT = /bot\b|crawler|spider|crawling|slurp|headless|lighthouse|pingdom|uptimerobot/i;

/** Uygulama içi tarayıcılar: [kalıp, ad]. */
const WEBVIEWS: [RegExp, string][] = [
  [/FBAN|FBAV|FB_IAB/, 'Facebook'],
  [/Instagram/, 'Instagram'],
  [/musical_ly|BytedanceWebview|TikTok/, 'TikTok'],
  [/\bLine\//, 'LINE'],
  [/Snapchat/, 'Snapchat'],
  [/Pinterest/, 'Pinterest'],
  [/MicroMessenger/, 'WeChat'],
  [/LinkedInApp/, 'LinkedIn'],
  [/GSA\/[\d.]+/, 'Google uygulaması'],
];

/** Tarayıcılar: [kalıp, ad] — sıra önemli (Edge/Opera/Samsung/Yandex Chrome'u taklit eder). */
const BROWSERS: [RegExp, string][] = [
  [/\bEdge\/([\d.]+)/, 'Edge (eski, EdgeHTML)'],
  [/\bEdg(?:A|iOS)?\/([\d.]+)/, 'Microsoft Edge'],
  [/\bOPR\/([\d.]+)/, 'Opera'],
  [/\bOPT\/([\d.]+)/, 'Opera Touch'],
  [/Opera Mini\/([\d.]+)/, 'Opera Mini'],
  [/^Opera\/.*Version\/([\d.]+)/, 'Opera'],
  [/YaBrowser\/([\d.]+)/, 'Yandex Browser'],
  [/SamsungBrowser\/([\d.]+)/, 'Samsung Internet'],
  [/Vivaldi\/([\d.]+)/, 'Vivaldi'],
  [/UCBrowser\/([\d.]+)/, 'UC Browser'],
  [/HuaweiBrowser\/([\d.]+)/, 'Huawei Browser'],
  [/MiuiBrowser\/([\d.]+)/, 'MIUI Browser'],
  [/DuckDuckGo\/([\d.]+)/, 'DuckDuckGo'],
  [/Silk\/([\d.]+)/, 'Amazon Silk'],
  [/FxiOS\/([\d.]+)/, 'Firefox (iOS)'],
  [/Firefox\/([\d.]+)/, 'Firefox'],
  [/CriOS\/([\d.]+)/, 'Chrome (iOS)'],
  [/HeadlessChrome\/([\d.]+)/, 'Headless Chrome'],
  [/Chrome\/([\d.]+)/, 'Chrome'],
  [/MSIE ([\d.]+)/, 'Internet Explorer'],
  [/Trident\/7\.0.*rv:([\d.]+)/, 'Internet Explorer'],
  [/Version\/([\d.]+).*Safari\//, 'Safari'],
];

const WINDOWS: Record<string, string> = {
  '10.0': '10 / 11',
  '6.3': '8.1',
  '6.2': '8',
  '6.1': '7',
  '6.0': 'Vista',
  '5.2': 'XP x64',
  '5.1': 'XP',
};

const first = (pattern: RegExp, ua: string) => pattern.exec(ua)?.[1] ?? null;
const dots = (version: string | null) => version?.replace(/_/g, '.') ?? null;

function detectOs(ua: string, notes: string[]): UaPart | null {
  if (/Windows Phone/.test(ua))
    return { name: 'Windows Phone', version: first(/Windows Phone (?:OS )?([\d.]+)/, ua) };
  const nt = first(/Windows NT ([\d.]+)/, ua);
  if (nt) {
    if (nt === '10.0') {
      notes.push(
        msg(
          'toolsNet.ua.note.windows11',
          'Windows 10 ve 11 aynı "Windows NT 10.0" değerini gönderir; UA ile ayırt edilemez. Sec-CH-UA-Platform-Version başlığı 13 ve üstüyse Windows 11’dir.',
        ),
      );
    }
    return { name: 'Windows', version: WINDOWS[nt] ?? `NT ${nt}` };
  }
  if (/Xbox/.test(ua)) return { name: 'Xbox OS', version: null };
  const ios = first(/(?:iPhone|CPU) OS (\d+[_\d]*)/, ua);
  if (/iPad/.test(ua)) return { name: 'iPadOS', version: dots(ios) };
  if (/iPhone|iPod/.test(ua)) return { name: 'iOS', version: dots(ios) };
  if (/CrOS/.test(ua)) return { name: 'ChromeOS', version: first(/CrOS \S+ ([\d.]+)/, ua) };
  if (/HarmonyOS/.test(ua)) return { name: 'HarmonyOS', version: first(/HarmonyOS[ /]?([\d.]+)?/, ua) };
  const android = /Android(?: ([\d.]+))?/.exec(ua);
  if (android) {
    if (/Android 10; K\)/.test(ua)) {
      notes.push(
        msg(
          'toolsNet.ua.note.androidReduced',
          'Azaltılmış UA: Chrome Android sürümünü "10" ve modeli "K" olarak sabitler; gerçek değerler Sec-CH-UA-Model / Platform-Version başlıklarındadır.',
        ),
      );
    }
    return { name: 'Android', version: android[1] ?? null };
  }
  if (/KAIOS/i.test(ua)) return { name: 'KaiOS', version: first(/KAIOS\/([\d.]+)/i, ua) };
  if (/Tizen/.test(ua)) return { name: 'Tizen', version: first(/Tizen ([\d.]+)/, ua) };
  if (/Web0S|webOS/.test(ua)) return { name: 'webOS', version: null };
  if (/PlayStation/.test(ua)) return { name: 'PlayStation', version: first(/PlayStation \w+ ([\d.]+)/, ua) };
  if (/Nintendo/.test(ua)) return { name: 'Nintendo', version: null };
  const mac = first(/Mac OS X (\d+[_.\d]*)/, ua);
  if (/Macintosh|Mac OS X/.test(ua)) {
    if (mac && /^10[_.]15[_.]7$/.test(mac)) {
      notes.push(
        msg(
          'toolsNet.ua.note.macFrozen',
          'macOS sürümü tarayıcılarca 10.15.7’de dondurulmuştur; gerçek sürüm daha yeni olabilir.',
        ),
      );
    }
    notes.push(
      msg(
        'toolsNet.ua.note.ipadMac',
        'iPadOS 13+ masaüstü sitesi isterken de "Macintosh" gönderir; UA ile ayırt edilemez.',
      ),
    );
    return { name: 'macOS', version: dots(mac) };
  }
  if (/FreeBSD/.test(ua)) return { name: 'FreeBSD', version: null };
  if (/Ubuntu/.test(ua)) return { name: 'Ubuntu (Linux)', version: null };
  if (/Fedora/.test(ua)) return { name: 'Fedora (Linux)', version: null };
  if (/Linux|X11/.test(ua)) return { name: 'Linux', version: null };
  return null;
}

function detectEngine(ua: string, os: UaPart | null): UaPart | null {
  if (/Trident\/([\d.]+)/.test(ua) || /MSIE/.test(ua))
    return { name: 'Trident', version: first(/Trident\/([\d.]+)/, ua) };
  if (/\bEdge\/([\d.]+)/.test(ua)) return { name: 'EdgeHTML', version: first(/\bEdge\/([\d.]+)/, ua) };
  if (/Presto\/([\d.]+)/.test(ua)) return { name: 'Presto', version: first(/Presto\/([\d.]+)/, ua) };
  const webkit = first(/AppleWebKit\/([\d.]+)/, ua);
  // iOS ve iPadOS'ta tüm tarayıcılar (Chrome, Firefox dahil) WebKit kullanır.
  if (os && /^(iOS|iPadOS)$/.test(os.name) && webkit) return { name: 'WebKit', version: webkit };
  if (/Gecko\/[\d.]+/.test(ua) && /Firefox|rv:/.test(ua) && !/like Gecko/.test(ua)) {
    return { name: 'Gecko', version: first(/rv:([\d.]+)/, ua) };
  }
  const chrome = first(/Chrome\/([\d.]+)/, ua);
  if (chrome && Number.parseInt(chrome, 10) >= 28) return { name: 'Blink', version: chrome };
  return webkit ? { name: 'WebKit', version: webkit } : null;
}

function detectDevice(ua: string, os: UaPart | null): UserAgentInfo['device'] {
  const result = (type: UaDeviceType, vendor: string | null = null, model: string | null = null) => ({
    type,
    vendor,
    model,
  });
  if (
    /SmartTV|SMART-TV|Web0S|webOS.*TV|Tizen.*TV|HbbTV|BRAVIA|GoogleTV|Android TV|AppleTV|CrKey|\bAFT[A-Z]/i.test(
      ua,
    )
  ) {
    return result(
      'tv',
      /AFT/.test(ua)
        ? 'Amazon'
        : /AppleTV/.test(ua)
          ? 'Apple'
          : /SAMSUNG|Tizen/i.test(ua)
            ? 'Samsung'
            : /LG|Web0S/i.test(ua)
              ? 'LG'
              : null,
    );
  }
  if (/PlayStation|Xbox|Nintendo/.test(ua)) {
    return result('console', /PlayStation/.test(ua) ? 'Sony' : /Xbox/.test(ua) ? 'Microsoft' : 'Nintendo');
  }
  if (/iPad/.test(ua)) return result('tablet', 'Apple', 'iPad');
  if (/iPhone/.test(ua)) return result('mobile', 'Apple', 'iPhone');
  if (/iPod/.test(ua)) return result('mobile', 'Apple', 'iPod');
  if (os?.name === 'Android' || os?.name === 'HarmonyOS') {
    const model = first(/Android[^;)]*;(?: [a-z]{2}[-_][a-zA-Z]{2};)? ([^;)]+)/, ua)?.replace(
      /\s*Build\/.*$/,
      '',
    );
    const cleanModel = model && !/^(K|wv|Mobile|Tablet|rv:.*)$/.test(model.trim()) ? model.trim() : null;
    const vendor = cleanModel ? vendorOf(cleanModel) : null;
    const tablet = /Tablet|Kindle|Silk|SM-T\d|SM-X\d|Tab/.test(ua) || !/Mobile/.test(ua);
    return result(tablet ? 'tablet' : 'mobile', vendor, cleanModel);
  }
  if (/Mobi|Windows Phone|Opera Mini|KAIOS/i.test(ua)) return result('mobile');
  if (os) return result('desktop', os.name === 'macOS' ? 'Apple' : null);
  return result('unknown');
}

function vendorOf(model: string): string | null {
  const vendors: [RegExp, string][] = [
    [/^SM-|^GT-|Galaxy|SAMSUNG/i, 'Samsung'],
    [/^Pixel|^Nexus/, 'Google'],
    [/Redmi|^Mi |^M2\d|POCO|Xiaomi/i, 'Xiaomi'],
    [/HUAWEI|^[A-Z]{3}-L\d/i, 'Huawei'],
    [/^ONEPLUS|^[A-Z]{2}\d{4}$/i, 'OnePlus'],
    [/^moto|Motorola/i, 'Motorola'],
    [/^CPH\d|OPPO/i, 'OPPO'],
    [/^RMX\d|realme/i, 'realme'],
    [/^V\d{4}|vivo/i, 'vivo'],
    [/^KF[A-Z]{2}|Kindle/, 'Amazon'],
  ];
  return vendors.find(([pattern]) => pattern.test(model))?.[1] ?? null;
}

/** UA metnini çözer. Boş metinde ToolError. `User-Agent:` öneki atılır. */
export function parseUserAgent(text: string): UserAgentInfo {
  let ua = text
    .trim()
    .replace(/^user-agent\s*:\s*/i, '')
    .trim();
  if (!ua) throw new ToolError(msg('toolsNet.ua.empty', 'User-Agent metni boş.'));
  const notes: string[] = [];
  if (ua.length > MAX_UA_LENGTH) {
    // Gerçek UA'lar birkaç yüz karakterdir; uzun metinde bazı kalıplar karesel zamana düşer.
    notes.push(
      msg(
        'toolsNet.ua.note.truncated',
        'Metin {max} karakterden uzun; yalnızca ilk {max} karakter çözümlendi.',
        { max: String(MAX_UA_LENGTH) },
      ),
    );
    ua = ua.slice(0, MAX_UA_LENGTH);
  }

  let bot: UserAgentInfo['bot'] = null;
  for (const [pattern, name, kind] of BOTS) {
    const match = pattern.exec(ua);
    if (match) {
      bot = name
        ? { name: displayName(name), version: match[1] || null, kind }
        : { name: match[1]!, version: null, kind };
      break;
    }
  }
  if (!bot && GENERIC_BOT.test(ua) && !/HeadlessChrome/.test(ua)) {
    const name =
      /([A-Za-z][\w-]*(?:bot|crawler|spider))/i.exec(ua)?.[1] ??
      msg('toolsNet.ua.unknownBot', 'Tanımsız bot');
    bot = { name, version: first(new RegExp(`${name}/([\\d.]+)`), ua), kind: 'crawler' };
  }

  const os = detectOs(ua, notes);
  let browser: UaPart | null = null;
  if (!bot || bot.kind === 'crawler') {
    for (const [pattern, name] of BROWSERS) {
      const version = first(pattern, ua);
      if (version) {
        browser = { name: displayName(name), version };
        break;
      }
    }
  }
  let webView = displayName(WEBVIEWS.find(([pattern]) => pattern.test(ua))?.[1] ?? '') || null;
  if (!webView && os?.name === 'Android' && /; wv\)/.test(ua)) webView = 'Android WebView';
  if (!webView && os && /^(iOS|iPadOS)$/.test(os.name) && /AppleWebKit/.test(ua) && !/Safari\//.test(ua)) {
    webView = 'iOS WKWebView';
  }
  if (webView && browser?.name === 'Safari' && !/Version\//.test(ua)) browser = null;

  const engine = bot?.kind === 'client' || bot?.kind === 'apivator' ? null : detectEngine(ua, os);
  const device = bot ? { type: 'bot' as const, vendor: null, model: null } : detectDevice(ua, os);

  if (bot?.kind === 'crawler') {
    notes.push(
      msg(
        'toolsNet.ua.note.botSpoof',
        'Bot UA kolayca taklit edilir; gerçek tarayıcı botunu ters DNS (ör. *.googlebot.com) ile doğrulayın.',
      ),
    );
  }
  if (engine?.name === 'Blink' && !bot) {
    notes.push(
      msg(
        'toolsNet.ua.note.chromiumReduced',
        'Chromium tabanlı tarayıcılar UA’yı azaltır (küçük sürüm 0.0.0, sabit platform). Tam sürüm, model ve platform sürümü için sunucu Accept-CH ile Sec-CH-UA-Full-Version-List, Sec-CH-UA-Model, Sec-CH-UA-Platform-Version ipuçlarını istemelidir.',
      ),
    );
    if (/\.0\.0\.0/.test(ua))
      notes.push(
        msg(
          'toolsNet.ua.note.zeroVersion',
          'Sürüm "x.0.0.0" biçiminde: azaltılmış UA; yalnızca ana sürüm güvenilir.',
        ),
      );
  }
  if (browser?.name === 'Internet Explorer')
    notes.push(msg('toolsNet.ua.note.ie', 'Internet Explorer desteği 2022’de sona erdi.'));
  if (!bot && !browser && !os)
    notes.push(msg('toolsNet.ua.note.unrecognized', 'Tanınan tarayıcı, işletim sistemi ya da istemci yok.'));

  return { browser, engine, os, device, bot, webView, notes };
}

/** Cihaz türünün etkin dildeki adı. */
export function uaDeviceLabel(type: UaDeviceType): string {
  return {
    mobile: () => msg('toolsNet.ua.device.mobile', 'Mobil'),
    tablet: () => msg('toolsNet.ua.device.tablet', 'Tablet'),
    desktop: () => msg('toolsNet.ua.device.desktop', 'Masaüstü'),
    tv: () => msg('toolsNet.ua.device.tv', 'Televizyon'),
    console: () => msg('toolsNet.ua.device.console', 'Oyun konsolu'),
    bot: () => msg('toolsNet.ua.device.bot', 'Bot / istemci'),
    unknown: () => msg('toolsNet.ua.device.unknown', 'Bilinmiyor'),
  }[type]();
}
