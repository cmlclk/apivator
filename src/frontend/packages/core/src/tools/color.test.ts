import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import en from '../locales/en/toolsMisc.json';
import { registerCoreMessages, setCoreLanguage } from '../i18n';
import { ToolError } from './errors';
import {
  CSS_COLOR_NAMES,
  colorPalette,
  colorToHex,
  contrastRatio,
  formatColor,
  mixColors,
  parseColor,
  rgbToOklch,
} from './color';

const hex = (text: string) => colorToHex(parseColor(text));

describe('parseColor', () => {
  it('HEX: kısa, alfalı, uzun, # olmadan', () => {
    expect(parseColor('#f00')).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseColor('#F008')).toEqual({ r: 255, g: 0, b: 0, a: 0x88 / 255 });
    expect(parseColor('#00ff7f')).toEqual({ r: 0, g: 255, b: 127, a: 1 });
    expect(parseColor('#00000080').a).toBeCloseTo(0.502, 3);
    expect(hex('abc')).toBe('#aabbcc');
    expect(hex('  #ABCDEF  ')).toBe('#abcdef');
  });

  it('CSS adları (148) ve transparent', () => {
    expect(CSS_COLOR_NAMES.size).toBe(148);
    expect(hex('rebeccapurple')).toBe('#663399');
    expect(hex('RED')).toBe('#ff0000');
    expect(hex('lightgoldenrodyellow')).toBe('#fafad2');
    expect(parseColor('transparent')).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it('rgb/rgba: virgüllü, boşluklu, yüzde', () => {
    expect(parseColor('rgb(255, 0, 0)')).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseColor('rgba(255,0,0,.5)').a).toBe(0.5);
    expect(parseColor('rgb(255 0 0 / 50%)').a).toBe(0.5);
    expect(parseColor('rgb(100% 50% 0%)')).toEqual({ r: 255, g: 127.5, b: 0, a: 1 });
    expect(parseColor('rgb(300 -5 0)')).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseColor('rgba(0 0 0 / 1.5)').a).toBe(1);
  });

  it('hsl/hsla ve ton birimleri', () => {
    expect(hex('hsl(0, 100%, 50%)')).toBe('#ff0000');
    expect(hex('hsl(120 100% 25%)')).toBe('#008000');
    expect(hex('hsl(240deg 100% 50%)')).toBe('#0000ff');
    expect(hex('hsl(0.5turn 100% 50%)')).toBe('#00ffff');
    expect(hex('hsl(3.14159rad 100% 50%)')).toBe('#00ffff');
    expect(hex('hsl(200grad 100% 50%)')).toBe('#00ffff');
    expect(hex('hsl(-120 100% 50%)')).toBe('#0000ff');
    expect(parseColor('hsla(0, 0%, 0%, 25%)').a).toBe(0.25);
  });

  it('hwb ve oklch', () => {
    expect(hex('hwb(0 0% 0%)')).toBe('#ff0000');
    expect(hex('hwb(120 20% 30%)')).toBe('#33b333');
    expect(hex('hwb(0 60% 60%)')).toBe('#808080');
    expect(hex('oklch(62.8% 0.2577 29.23)')).toBe('#ff0000');
    expect(hex('oklch(1 0 0)')).toBe('#ffffff');
    expect(hex('oklch(0% 0 0)')).toBe('#000000');
  });

  it('hatalar ToolError', () => {
    expect(() => parseColor('')).toThrow('Renk girilmedi.');
    expect(() => parseColor('#12345')).toThrow(/Geçersiz HEX/);
    expect(() => parseColor('#ggg')).toThrow(ToolError);
    expect(() => parseColor('notacolor')).toThrow(/tanınmadı/);
    expect(() => parseColor('rgb(1, 2)')).toThrow(/3 değer/);
    expect(() => parseColor('rgb(1 2 3 / 4 / 5)')).toThrow(/fazla/);
    expect(() => parseColor('rgb(a, b, c)')).toThrow(/Geçersiz RGB kanalı/);
    expect(() => parseColor('hsl(10%, 50%, 50%)')).toThrow(/ton/);
    expect(() => parseColor('hsl(10, 50deg, 50%)')).toThrow(/doygunluk/);
  });
});

describe('formatColor', () => {
  it('tüm biçimler', () => {
    expect(formatColor(parseColor('#ff0000'))).toEqual({
      hex: '#ff0000',
      rgb: 'rgb(255, 0, 0)',
      hsl: 'hsl(0, 100%, 50%)',
      hwb: 'hwb(0 0% 0%)',
      oklch: 'oklch(62.8% 0.2577 29.23)',
      name: 'red',
    });
  });

  it('alfa ve büyük harf HEX', () => {
    const f = formatColor(parseColor('rgba(51, 102, 153, 0.5)'), true);
    expect(f).toMatchObject({
      hex: '#33669980',
      rgb: 'rgba(51, 102, 153, 0.5)',
      hsl: 'hsla(210, 50%, 40%, 0.5)',
      hwb: 'hwb(210 20% 40% / 0.5)',
      name: null,
    });
    expect(f.oklch).toMatch(/^oklch\([\d.]+% [\d.]+ [\d.]+ \/ 0\.5\)$/);
  });

  it('HSL bir ondalığa yuvarlanır; gri tonun hue değeri 0', () => {
    expect(formatColor(parseColor('#123456')).hsl).toBe('hsl(210, 65.4%, 20.4%)');
    expect(formatColor(parseColor('#777')).hsl).toBe('hsl(0, 0%, 46.7%)');
    expect(formatColor(parseColor('#777')).oklch).toMatch(/^oklch\([\d.]+% 0 0\)$/);
  });

  it('eş adlarda alfabetik ilk; transparent', () => {
    expect(formatColor(parseColor('#0ff')).name).toBe('aqua');
    expect(formatColor(parseColor('#808080')).name).toBe('gray');
    expect(formatColor(parseColor('transparent')).name).toBe('transparent');
  });

  it('gidiş-dönüş: her biçim aynı HEX değerine çözülür', () => {
    for (const color of ['#ff0000', '#663399', '#123456', '#fafad2', '#000000', '#ffffff', '#33669980']) {
      const f = formatColor(parseColor(color));
      for (const text of [f.hex, f.rgb, f.hsl, f.hwb, f.oklch]) expect(hex(text)).toBe(color);
    }
  });
});

describe('WCAG karşıtlık', () => {
  const white = parseColor('white');
  const black = parseColor('black');

  it('bilinen değerler', () => {
    expect(contrastRatio(black, white).ratio).toBeCloseTo(21, 5);
    expect(contrastRatio(white, white).ratio).toBe(1);
    expect(contrastRatio(parseColor('#777'), white).ratio).toBeCloseTo(4.48, 2);
    expect(contrastRatio(parseColor('#767676'), white).ratio).toBeCloseTo(4.54, 2);
    // Sıra önemsiz.
    expect(contrastRatio(white, parseColor('#777')).ratio).toBeCloseTo(4.48, 2);
  });

  it('AA / AAA eşikleri', () => {
    expect(contrastRatio(parseColor('#777'), white)).toMatchObject({
      aa: false,
      aaLarge: true,
      aaa: false,
      aaaLarge: false,
    });
    expect(contrastRatio(parseColor('#767676'), white)).toMatchObject({
      aa: true,
      aaLarge: true,
      aaa: false,
      aaaLarge: true,
    });
    expect(contrastRatio(black, white)).toMatchObject({ aa: true, aaa: true });
  });

  it('saydam ön plan arka plana bindirilir', () => {
    expect(contrastRatio(parseColor('rgba(0, 0, 0, 0)'), white).ratio).toBe(1);
    expect(contrastRatio(parseColor('rgba(0, 0, 0, 0.5)'), white).ratio).toBeCloseTo(
      contrastRatio(parseColor('rgb(127.5, 127.5, 127.5)'), white).ratio,
      6,
    );
  });
});

describe('palet', () => {
  it('karışım ve açık/koyu tonlar', () => {
    expect(colorToHex(mixColors(parseColor('#000'), parseColor('#fff'), 0.5))).toBe('#808080');
    const { tints, shades } = colorPalette(parseColor('#ff0000'), 4);
    expect(tints.map((c) => colorToHex(c))).toEqual(['#ff3333', '#ff6666', '#ff9999', '#ffcccc']);
    expect(shades.map((c) => colorToHex(c))).toEqual(['#cc0000', '#990000', '#660000', '#330000']);
  });

  it('oklch beyaz', () => {
    const w = rgbToOklch({ r: 255, g: 255, b: 255 });
    expect(w.l).toBeCloseTo(1, 4);
    expect(w.c).toBeLessThan(1e-4);
  });

  it('sonsuz sayı (1e400) NaN üretmez, ToolError verir', () => {
    expect(() => parseColor('hsl(1e400 50% 50%)')).toThrow(ToolError);
    expect(() => parseColor('oklch(0.5 1e400 30)')).toThrow(ToolError);
  });
});

describe('İngilizce iletiler', () => {
  beforeAll(() => registerCoreMessages('en', { toolsMisc: en }));
  beforeEach(() => setCoreLanguage('en'));
  afterEach(() => setCoreLanguage('tr'));

  it('hata iletileri İngilizce', () => {
    expect(() => parseColor('')).toThrow('No color entered.');
    expect(() => parseColor('hsl(abc, 50%, 50%)')).toThrow('Invalid hue: "abc".');
    expect(() => parseColor('#12')).toThrow('Invalid HEX color: "#12" (3, 4, 6 or 8 digits).');
  });
});
