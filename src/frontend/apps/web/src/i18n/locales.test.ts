import { describe, expect, it, vi } from 'vitest';
import notes from './locales/notes.json';
import { formatMessage, messageArguments } from './icu';

/**
 * Dil dosyalarının bütünlüğü (CI'da eksik/fazla anahtar kontrolü). Denetlenen diller `locales/` klasörlerinden
 * bulunur (yeni dil klasörü eklenince otomatik denetlenir). Her dil Türkçe ile aynı ad alanlarını ve anahtarları
 * taşır, her metin geçerli ICU'dur ve Türkçedeki değişkenleri kullanır. Eksik anahtar `REQUIRED` dillerde hata,
 * diğerlerinde yalnızca uyarıdır (çalışma anında İngilizceye, o da yoksa Türkçeye düşer); fazla anahtar,
 * değişken uyuşmazlığı ve geçersiz ICU her dilde hata.
 */
const REQUIRED = ['en'];

const files = import.meta.glob<Record<string, unknown>>('./locales/*/*.json', {
  eager: true,
  import: 'default',
});

function leaves(source: Record<string, unknown>, prefix = '', into = new Map<string, string>()) {
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'string') into.set(prefix + key, value);
    else leaves(value as Record<string, unknown>, `${prefix}${key}.`, into);
  }
  return into;
}

function byLanguage(language: string) {
  const result = new Map<string, Map<string, string>>();
  for (const [path, messages] of Object.entries(files)) {
    const [, lang, ns] = /\.\/locales\/([^/]+)\/(.+)\.json$/.exec(path)!;
    if (lang === language) result.set(ns!, leaves(messages));
  }
  return result;
}

const variables = (message: string) => messageArguments(message);

const source = byLanguage('tr');
const languages = [...new Set(Object.keys(files).map((p) => /^\.\/locales\/([^/]+)\//.exec(p)![1]!))].sort();

/** Eksik anahtarlar: zorunlu dillerde hata, diğerlerinde görünür uyarı. */
export function reportMissing(language: string, missing: string[], required = REQUIRED.includes(language)) {
  if (missing.length === 0) return [];
  if (required) return missing;
  console.warn(
    `UYARI ${language}: ${missing.length} eksik anahtar (İngilizce/Türkçe gösterilir): ${missing.slice(0, 20).join(', ')}`,
  );
  return [];
}

describe('dil klasörleri', () => {
  it('Türkçe ve İngilizce her zaman vardır', () =>
    expect(languages).toEqual(expect.arrayContaining(['tr', 'en'])));
});

describe.each(languages.filter((l) => l !== 'tr'))('%s dil dosyaları', (language) => {
  const target = byLanguage(language);

  it('Türkçe ile aynı ad alanları ve anahtarlar (eksik: yalnızca zorunlu dillerde hata)', () => {
    const missing: string[] = [];
    const extra: string[] = [];
    for (const ns of target.keys()) if (!source.has(ns)) extra.push(`${ns} (ad alanı)`);
    for (const [ns, messages] of source) {
      if (!target.has(ns)) missing.push(`${ns} (ad alanı)`);
      for (const k of messages.keys()) if (!target.get(ns)?.has(k)) missing.push(`${ns}:${k}`);
      for (const k of target.get(ns)?.keys() ?? []) if (!messages.has(k)) extra.push(`${ns}:${k}`);
    }
    expect({ missing: reportMissing(language, missing), extra }).toEqual({ missing: [], extra: [] });
  });

  it('Türkçedeki değişkenler korunur', () => {
    for (const [ns, messages] of source) {
      for (const [key, message] of messages) {
        const translated = target.get(ns)?.get(key);
        if (translated === undefined) continue;
        expect({ key: `${ns}:${key}`, vars: [...variables(translated)].sort() }).toEqual({
          key: `${ns}:${key}`,
          vars: [...variables(message)].sort(),
        });
      }
    }
  });
});

describe('eksik anahtar politikası', () => {
  it('zorunlu dilde hata, diğer dilde uyarı', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(reportMissing('en', ['a:b'])).toEqual(['a:b']);
    expect(reportMissing('de', ['a:b'])).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain('de');
    warn.mockRestore();
  });
});

describe('çevirmen notları (docs/terimler.md)', () => {
  it('her not var olan bir anahtara aittir', () => {
    const unknown = Object.keys(notes).filter((id) => {
      const [ns, key] = id.split(':');
      return !source.get(ns!)?.has(key!);
    });
    expect(unknown).toEqual([]);
  });
});

describe('tüm metinler geçerli ICU', () => {
  it.each(languages)('%s', (language) => {
    for (const [ns, messages] of byLanguage(language)) {
      for (const [key, message] of messages) {
        expect(() => formatMessage(message, 'en-US', {}), `${language}/${ns}:${key}`).not.toThrow();
      }
    }
  });
});
