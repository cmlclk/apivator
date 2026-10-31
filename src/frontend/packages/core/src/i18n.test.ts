import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { messageArguments } from './icu';
import { catalogMessage, msg, registerCoreMessages, setCoreLanguage, type CoreLanguage } from './i18n';

afterEach(() => setCoreLanguage('tr'));

/** Üçüncü dil (henüz klasörü yok) için sahte katalog: eksik metin önce İngilizce, sonra Türkçe. */
const THIRD = 'de' as unknown as CoreLanguage;

describe('msg', () => {
  it('Türkçede koddaki metin, diğer dilde katalog; katalogda yoksa Türkçe', () => {
    registerCoreMessages('en', { test: { hello: 'Hello {name}' } });
    expect(msg('test.hello', 'Merhaba {name}', { name: 'Ayşe' })).toBe('Merhaba Ayşe');
    expect(catalogMessage('test.hello', { name: 'A' })).toBeUndefined();
    setCoreLanguage('en');
    expect(msg('test.hello', 'Merhaba {name}', { name: 'Ann' })).toBe('Hello Ann');
    expect(msg('test.missing', 'Yok {n}', { n: 1500 })).toBe('Yok 1,500');
    expect(catalogMessage('test.hello', { name: 'A' })).toBe('Hello A');
  });
});

describe('msg yedek dilleri', () => {
  it('üçüncü dilde eksik metin İngilizce, o da yoksa Türkçe gösterilir', () => {
    registerCoreMessages('en', { fallback: { both: 'English both', onlyEn: 'English only' } });
    registerCoreMessages(THIRD, { fallback: { both: 'Deutsch both' } });
    setCoreLanguage(THIRD);
    expect(msg('fallback.both', 'Türkçe both')).toBe('Deutsch both');
    expect(msg('fallback.onlyEn', 'Türkçe onlyEn')).toBe('English only');
    expect(msg('fallback.none', 'Türkçe none')).toBe('Türkçe none');
  });
});

/**
 * Katalog bütünlüğü: koddaki her `msg('kimlik', 'Türkçe', …)` çağrısının her dil kataloğunda karşılığı var,
 * değişkenleri aynı, kimlik katalog dosyasının adıyla başlıyor ve aynı kimlik farklı Türkçe metinle kullanılmıyor.
 */
const root = import.meta.dirname;
const localesDir = join(root, 'locales');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'locales' ? [] : sources(path);
    // i18n.ts belgesindeki örnek çağrı sayılmaz.
    return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) && path !== join(root, 'i18n.ts') ? [path] : [];
  });
}

const CALL = /\bmsg\(\s*'([^']+)',\s*(['"])((?:\\.|(?!\2)[^\\])*)\2/g;
const unescape = (text: string) => text.replace(/\\(.)/g, (_, c: string) => (c === 'n' ? '\n' : c));

const used = new Map<string, string>();
const duplicates: string[] = [];
for (const file of sources(root)) {
  for (const m of readFileSync(file, 'utf8').matchAll(CALL)) {
    const text = unescape(m[3]!);
    const previous = used.get(m[1]!);
    if (previous !== undefined && previous !== text) duplicates.push(m[1]!);
    used.set(m[1]!, text);
  }
}

function catalog(language: string) {
  const result = new Map<string, string>();
  const files = readdirSync(join(localesDir, language)).filter((f) => f.endsWith('.json'));
  for (const file of files) {
    const prefix = file.slice(0, -5);
    const walk = (source: Record<string, unknown>, path: string) => {
      for (const [key, value] of Object.entries(source)) {
        const id = path ? `${path}.${key}` : key;
        if (typeof value === 'string') result.set(id, value);
        else walk(value as Record<string, unknown>, id);
      }
    };
    walk(JSON.parse(readFileSync(join(localesDir, language, file), 'utf8')), prefix);
  }
  return result;
}

/** Kataloğu eksik olması hata sayılan dil; denetlenen diller `locales/` klasörlerinden bulunur. */
const REQUIRED_LANGUAGE = 'en';

describe.each(readdirSync(localesDir))('%s core kataloğu', (language) => {
  const messages = catalog(language);

  it('aynı kimlik tek Türkçe metinle kullanılır', () => expect(duplicates).toEqual([]));

  it('her metin geçerli ICU', () => {
    for (const [id, text] of messages) {
      expect(() => messageArguments(text), `${language}/${id}`).not.toThrow();
    }
  });

  it('koddaki her metnin karşılığı var ve değişkenleri aynı', () => {
    const missing = [...used.keys()].filter((id) => !messages.has(id));
    // İngilizce zorunlu; başka dilde eksik metin yalnızca uyarıdır (çalışma anında İngilizce/Türkçe gösterilir).
    if (language !== REQUIRED_LANGUAGE && missing.length > 0) {
      console.warn(
        `UYARI core ${language}: ${missing.length} eksik kimlik: ${missing.slice(0, 20).join(', ')}`,
      );
    } else {
      expect(missing).toEqual([]);
    }
    for (const [id, tr] of used) {
      const translated = messages.get(id);
      if (translated === undefined) continue;
      expect({ id, vars: [...messageArguments(translated)].sort() }).toEqual({
        id,
        vars: [...messageArguments(tr)].sort(),
      });
    }
  });
});
