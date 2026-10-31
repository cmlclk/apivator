import { msg } from '../i18n';
import { ToolError } from './errors';
import { CSS_COLOR_BY_HEX, CSS_COLOR_NAMES } from './colorNames';

export { CSS_COLOR_NAMES } from './colorNames';

/** sRGB renk: kanallar 0–255 (yuvarlanmamış), alfa 0–1. */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
/** En çok `digits` ondalıkla, sondaki sıfırlar atılmış sayı (`-0` → `0`). */
const num = (v: number, digits: number) => String(Number(v.toFixed(digits)) || 0);

// ---------------------------------------------------------------- Ayrıştırma

const NUMBER = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%|deg|rad|grad|turn)?$/i;

interface Token {
  value: number;
  unit: string;
}

type Channel = 'hue' | 'saturation' | 'lightness' | 'whiteness' | 'blackness' | 'chroma' | 'alpha' | 'rgb';

const CHANNEL_NAMES: Record<Channel, () => string> = {
  hue: () => msg('toolsMisc.color.hue', 'ton (hue)'),
  saturation: () => msg('toolsMisc.color.saturation', 'doygunluk'),
  lightness: () => msg('toolsMisc.color.lightness', 'açıklık'),
  whiteness: () => msg('toolsMisc.color.whiteness', 'beyazlık'),
  blackness: () => msg('toolsMisc.color.blackness', 'siyahlık'),
  chroma: () => msg('toolsMisc.color.chroma', 'kroma'),
  alpha: () => msg('toolsMisc.color.alpha', 'alfa'),
  rgb: () => msg('toolsMisc.color.rgbChannel', 'RGB kanalı'),
};

const invalidChannel = (what: Channel, text: string) =>
  new ToolError(
    msg('toolsMisc.color.invalidChannel', 'Geçersiz {channel}: "{text}".', {
      channel: CHANNEL_NAMES[what](),
      text,
    }),
  );

function token(text: string, what: Channel): Token {
  if (text.toLowerCase() === 'none') return { value: 0, unit: '' };
  const match = NUMBER.exec(text);
  // `1e400` Infinity olur; ton ve kroma hesabında NaN üretmesin.
  if (!match || !Number.isFinite(Number(match[1]))) throw invalidChannel(what, text);
  return { value: Number(match[1]), unit: (match[2] ?? '').toLowerCase() };
}

function hue(text: string): number {
  const { value, unit } = token(text, 'hue');
  const deg =
    unit === 'rad'
      ? (value * 180) / Math.PI
      : unit === 'grad'
        ? value * 0.9
        : unit === 'turn'
          ? value * 360
          : unit === '%'
            ? NaN
            : value;
  if (Number.isNaN(deg)) throw invalidChannel('hue', text);
  return ((deg % 360) + 360) % 360;
}

/** Yüzde ya da yalın sayı; 0–100 aralığında yüzde değeri döner. */
function percent(text: string, what: Channel): number {
  const { value, unit } = token(text, what);
  if (unit && unit !== '%') throw invalidChannel(what, text);
  return clamp(value, 0, 100);
}

function alpha(text: string | undefined): number {
  if (text === undefined) return 1;
  const { value, unit } = token(text, 'alpha');
  if (unit && unit !== '%') throw invalidChannel('alpha', text);
  return clamp(unit === '%' ? value / 100 : value, 0, 1);
}

function rgbChannel(text: string): number {
  const { value, unit } = token(text, 'rgb');
  if (unit && unit !== '%') throw invalidChannel('rgb', text);
  return clamp(unit === '%' ? (value * 255) / 100 : value, 0, 255);
}

function parseHex(hex: string): Rgba | null {
  if (!/^[0-9a-f]+$/i.test(hex) || ![3, 4, 6, 8].includes(hex.length)) return null;
  const full = hex.length <= 4 ? [...hex].map((c) => c + c).join('') : hex;
  const byte = (i: number) => parseInt(full.slice(i * 2, i * 2 + 2), 16);
  return { r: byte(0), g: byte(1), b: byte(2), a: full.length === 8 ? byte(3) / 255 : 1 };
}

/** Virgüllü (`rgb(1, 2, 3)`) ya da boşluklu (`rgb(1 2 3 / 50%)`) argümanlar. */
function splitArgs(body: string, fn: string): string[] {
  const args = body.includes(',')
    ? body.split(',').map((s) => s.trim())
    : (() => {
        const [main = '', a, extra] = body.split('/');
        if (extra !== undefined)
          throw new ToolError(msg('toolsMisc.color.extraSlash', '{fn}(): fazla "/".', { fn }));
        const parts = main.trim().split(/\s+/);
        return a === undefined ? parts : [...parts, a.trim()];
      })();
  if (args.length < 3 || args.length > 4 || args.some((a) => !a)) {
    throw new ToolError(
      msg('toolsMisc.color.argCount', '{fn}(): 3 değer ve isteğe bağlı alfa beklenir.', { fn }),
    );
  }
  return args;
}

/**
 * HEX (`#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `#` olmadan da), `rgb()`/`rgba()`, `hsl()`/`hsla()`,
 * `hwb()`, `oklch()`, CSS renk adları ve `transparent`. Tanınmazsa ToolError.
 */
export function parseColor(input: string): Rgba {
  const text = input.trim().toLowerCase();
  if (!text) throw new ToolError(msg('toolsMisc.color.empty', 'Renk girilmedi.'));
  if (text === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  const named = CSS_COLOR_NAMES.get(text);
  if (named) return parseHex(named)!;
  const hex = parseHex(text.startsWith('#') ? text.slice(1) : text);
  if (hex) return hex;
  if (text.startsWith('#'))
    throw new ToolError(
      msg('toolsMisc.color.invalidHex', 'Geçersiz HEX renk: "{text}" (3, 4, 6 ya da 8 hane).', {
        text: input.trim(),
      }),
    );
  const fn = /^(rgba?|hsla?|hwb|oklch)\((.*)\)$/s.exec(text);
  if (!fn)
    throw new ToolError(msg('toolsMisc.color.unknown', 'Renk tanınmadı: "{text}".', { text: input.trim() }));
  const name = fn[1]!;
  const [x = '', y = '', z = '', a] = splitArgs(fn[2]!, name);
  if (name.startsWith('rgb')) return { r: rgbChannel(x), g: rgbChannel(y), b: rgbChannel(z), a: alpha(a) };
  if (name.startsWith('hsl')) {
    return { ...hslToRgb(hue(x), percent(y, 'saturation'), percent(z, 'lightness')), a: alpha(a) };
  }
  if (name === 'hwb')
    return { ...hwbToRgb(hue(x), percent(y, 'whiteness'), percent(z, 'blackness')), a: alpha(a) };
  const l = token(x, 'lightness');
  const c = token(y, 'chroma');
  const lightness = clamp(l.unit === '%' ? l.value / 100 : l.value, 0, 1);
  const chroma = Math.max(0, c.unit === '%' ? (c.value * 0.4) / 100 : c.value);
  return { ...oklchToRgb(lightness, chroma, hue(z)), a: alpha(a) };
}

// ---------------------------------------------------------------- Uzay dönüşümleri

type Rgb = Omit<Rgba, 'a'>;

/** h 0–360, s ve l 0–100. */
export function hslToRgb(h: number, s: number, l: number): Rgb {
  const sat = s / 100;
  const light = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const f = (n: number) =>
    light - sat * Math.min(light, 1 - light) * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return { r: f(0) * 255, g: f(8) * 255, b: f(4) * 255 };
}

/** h 0–360, w ve b 0–100; w + b ≥ 100 ise gri. */
export function hwbToRgb(h: number, w: number, b: number): Rgb {
  if (w + b >= 100) {
    const gray = (w / (w + b)) * 255;
    return { r: gray, g: gray, b: gray };
  }
  const base = hslToRgb(h, 100, 50);
  const scale = (v: number) => v * (1 - w / 100 - b / 100) + (w / 100) * 255;
  return { r: scale(base.r), g: scale(base.g), b: scale(base.b) };
}

export function rgbToHsl({ r, g, b }: Rgb): { h: number; s: number; l: number } {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l: l * 100 };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === rn ? ((gn - bn) / d) % 6 : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
  return { h: (h * 60 + 360) % 360, s: s * 100, l: l * 100 };
}

export function rgbToHwb(color: Rgb): { h: number; w: number; b: number } {
  const { r, g, b } = color;
  return {
    h: rgbToHsl(color).h,
    w: (Math.min(r, g, b) / 255) * 100,
    b: (1 - Math.max(r, g, b) / 255) * 100,
  };
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** OKLCH: l 0–1, c ≥ 0, h 0–360 (Björn Ottosson, OKLab). */
export function rgbToOklch(color: Rgb): { l: number; c: number; h: number } {
  const [r, g, b] = [color.r, color.g, color.b].map((v) => toLinear(v / 255)) as [number, number, number];
  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  const c = Math.hypot(A, B);
  return { l: L, c, h: c < 1e-4 ? 0 : ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 };
}

/** sRGB gamı dışındaki değerler kırpılır. */
export function oklchToRgb(l: number, c: number, h: number): Rgb {
  const rad = (h * Math.PI) / 180;
  const A = c * Math.cos(rad);
  const B = c * Math.sin(rad);
  const l3 = (l + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m3 = (l - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s3 = (l - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const out = (v: number) => clamp(fromLinear(v), 0, 1) * 255;
  return {
    r: out(4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3),
    g: out(-1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3),
    b: out(-0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3),
  };
}

// ---------------------------------------------------------------- Biçimler

const byteHex = (v: number) =>
  Math.round(clamp(v, 0, 255))
    .toString(16)
    .padStart(2, '0');

/** `#rrggbb`; alfa < 1 ise `#rrggbbaa`. */
export function colorToHex(color: Rgba, upper = false): string {
  const out = `#${byteHex(color.r)}${byteHex(color.g)}${byteHex(color.b)}${color.a < 1 ? byteHex(color.a * 255) : ''}`;
  return upper ? out.toUpperCase() : out;
}

const alphaText = (a: number) => num(a, 3);

export function colorToRgbString(color: Rgba): string {
  const channels = [color.r, color.g, color.b].map((v) => Math.round(clamp(v, 0, 255))).join(', ');
  return color.a < 1 ? `rgba(${channels}, ${alphaText(color.a)})` : `rgb(${channels})`;
}

export function colorToHslString(color: Rgba): string {
  const { h, s, l } = rgbToHsl(color);
  const body = `${num(h, 1)}, ${num(s, 1)}%, ${num(l, 1)}%`;
  return color.a < 1 ? `hsla(${body}, ${alphaText(color.a)})` : `hsl(${body})`;
}

export function colorToHwbString(color: Rgba): string {
  const { h, w, b } = rgbToHwb(color);
  const body = `${num(h, 1)} ${num(w, 1)}% ${num(b, 1)}%`;
  return color.a < 1 ? `hwb(${body} / ${alphaText(color.a)})` : `hwb(${body})`;
}

export function colorToOklchString(color: Rgba): string {
  const { l, c, h } = rgbToOklch(color);
  const body = `${num(l * 100, 2)}% ${num(c, 4)} ${num(h, 2)}`;
  return color.a < 1 ? `oklch(${body} / ${alphaText(color.a)})` : `oklch(${body})`;
}

/** Tam eşleşen CSS adı (opak renklerde; `transparent` dahil), yoksa null. */
export function colorName(color: Rgba): string | null {
  if (color.a === 0) return 'transparent';
  if (color.a < 1) return null;
  return CSS_COLOR_BY_HEX.get(colorToHex(color).slice(1)) ?? null;
}

export interface ColorFormats {
  hex: string;
  rgb: string;
  hsl: string;
  hwb: string;
  oklch: string;
  name: string | null;
}

export function formatColor(color: Rgba, upperHex = false): ColorFormats {
  return {
    hex: colorToHex(color, upperHex),
    rgb: colorToRgbString(color),
    hsl: colorToHslString(color),
    hwb: colorToHwbString(color),
    oklch: colorToOklchString(color),
    name: colorName(color),
  };
}

// ---------------------------------------------------------------- Karşıtlık ve palet

/** `top` rengini opak `bottom` üzerine alfa ile bindirir. */
export function blendOver(top: Rgba, bottom: Rgba): Rgba {
  const mix = (t: number, b: number) => t * top.a + b * (1 - top.a);
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a: 1 };
}

const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };

/** WCAG 2.x göreli parlaklık (0–1); alfa yok sayılır. */
export function relativeLuminance(color: Rgb): number {
  const [r, g, b] = [color.r, color.g, color.b].map((v) => toLinear(clamp(v, 0, 255) / 255)) as [
    number,
    number,
    number,
  ];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export interface ContrastResult {
  /** 1–21. */
  ratio: number;
  /** Normal metin AA (≥ 4,5). */
  aa: boolean;
  /** Büyük metin AA (≥ 3). */
  aaLarge: boolean;
  /** Normal metin AAA (≥ 7). */
  aaa: boolean;
  /** Büyük metin AAA (≥ 4,5). */
  aaaLarge: boolean;
}

/**
 * WCAG 2.x karşıtlık oranı. Saydam ön plan arka plan üzerine, saydam arka plan beyaz üzerine bindirilir.
 * Eşikler yuvarlanmamış oranla karşılaştırılır.
 */
export function contrastRatio(foreground: Rgba, background: Rgba): ContrastResult {
  const bg = background.a < 1 ? blendOver(background, WHITE) : background;
  const fg = foreground.a < 1 ? blendOver(foreground, bg) : foreground;
  const [hi, lo] = [relativeLuminance(fg), relativeLuminance(bg)].sort((x, y) => y - x) as [number, number];
  const ratio = (hi + 0.05) / (lo + 0.05);
  return { ratio, aa: ratio >= 4.5, aaLarge: ratio >= 3, aaa: ratio >= 7, aaaLarge: ratio >= 4.5 };
}

/** sRGB'de doğrusal karışım: t = 0 → a, t = 1 → b. */
export function mixColors(a: Rgba, b: Rgba, t: number): Rgba {
  const lerp = (x: number, y: number) => x + (y - x) * t;
  return { r: lerp(a.r, b.r), g: lerp(a.g, b.g), b: lerp(a.b, b.b), a: lerp(a.a, b.a) };
}

/** Beyazla karışan açık tonlar (tint) ve siyahla karışan koyu tonlar (shade), renge yakından uzağa. */
export function colorPalette(color: Rgba, steps = 5): { tints: Rgba[]; shades: Rgba[] } {
  const black: Rgba = { r: 0, g: 0, b: 0, a: color.a };
  const white: Rgba = { ...WHITE, a: color.a };
  const ts = Array.from({ length: steps }, (_, i) => (i + 1) / (steps + 1));
  return {
    tints: ts.map((t) => mixColors(color, white, t)),
    shades: ts.map((t) => mixColors(color, black, t)),
  };
}
