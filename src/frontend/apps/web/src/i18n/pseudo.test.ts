import { describe, expect, it } from 'vitest';
import { formatMessage, messageArguments } from './icu';
import { pseudoMessage, UNTRANSLATED_LETTER } from './pseudo';

/** Sözde dil dönüşümü: ICU yapısı korunur, metin işaretlenir ve uzar, düz harf kalmaz. */
const messages = import.meta.glob<Record<string, unknown>>('./locales/en/*.json', {
  eager: true,
  import: 'default',
});

function leaves(source: Record<string, unknown>, into: string[] = []): string[] {
  for (const value of Object.values(source)) {
    if (typeof value === 'string') into.push(value);
    else leaves(value as Record<string, unknown>, into);
  }
  return into;
}

const tags = (message: string) => [...message.matchAll(/<\/?[a-zA-Z][\w-]*\s*\/?>/g)].map((m) => m[0]);

describe('pseudoMessage', () => {
  it('düz metni işaretler, harfleri çevirir ve uzatır', () => {
    const out = pseudoMessage('Test');
    expect(out.startsWith('[!! ')).toBe(true);
    expect(out.endsWith(' !!]')).toBe(true);
    expect(out).toContain('Ţ');
    expect(out).not.toMatch(UNTRANSLATED_LETTER);
    expect(out.length).toBeGreaterThan('[!!  !!]'.length + 'Test'.length);
  });

  it('değişkenleri, plural/select yapısını, # ve etiketleri korur', () => {
    const message =
      'Hi {name}, you have {count, plural, =0 {no items} one {# item <b>left</b>} other {# items}} ' +
      "in {kind, select, team {the team} other {your space}} <link>open</link><br/> '{' not a var '}' don''t";
    const out = pseudoMessage(message);
    expect(messageArguments(out)).toEqual(messageArguments(message));
    expect(tags(out)).toEqual(tags(message));
    expect(out).toContain('{name}');
    expect(out).toContain('plural, =0 {');
    expect(out).toContain('one {#');
    expect(out).toContain("'{'");
    expect(out).toContain("''");
    const text = formatMessage(out, 'en-US', { name: 'Ada', count: 3, kind: 'team' });
    expect(text.startsWith('[!! ')).toBe(true);
    expect(text.replace(/<\/?[\w-]+\s*\/?>|Ada/g, '')).not.toMatch(UNTRANSLATED_LETTER);
    expect(text).toContain('Ada');
    expect(text).toContain('3 ');
  });

  it('her İngilizce metin geçerli ICU kalır; değişkenler ve etiketler aynıdır', () => {
    const all = Object.values(messages).flatMap((m) => leaves(m));
    expect(all.length).toBeGreaterThan(1000);
    for (const message of all) {
      const out = pseudoMessage(message);
      expect(() => formatMessage(out, 'en-US', {}), message).not.toThrow();
      expect([...messageArguments(out)].sort(), message).toEqual([...messageArguments(message)].sort());
      expect(tags(out), message).toEqual(tags(message));
      // Seçilen dalda (parametresiz: `other`) düz harf kalmaz; etiket adları yapıdır, sayılmaz.
      const shown = formatMessage(out, 'en-US', {}).replace(/<\/?[\w-]+\s*\/?>/g, '');
      // İngilizce kaynakta bilerek geçen Türkçe sütun adları (ör. “#satır”) sayılmaz.
      expect(shown, message).not.toMatch(/[A-Za-z]/);
    }
  });
});
