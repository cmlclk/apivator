import { describe, expect, it } from 'vitest';
import { CATEGORY_LABELS, TOOLS, findTool, searchTools } from './registry';

const ids = (query: string) => searchTools(query).map((t) => t.id);

describe('araç kaydı', () => {
  it('kimlikler benzersiz, kategoriler tanımlı', () => {
    expect(new Set(TOOLS.map((t) => t.id)).size).toBe(TOOLS.length);
    for (const tool of TOOLS) {
      expect(CATEGORY_LABELS[tool.category]).toBeTruthy();
      expect(tool.id).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it('findTool', () => {
    expect(findTool('base64')?.name).toBe('Base64');
    expect(findTool('yok')).toBeUndefined();
    expect(findTool(undefined)).toBeUndefined();
  });
});

describe('searchTools', () => {
  it('boş sorguda tüm araçlar', () => {
    expect(searchTools('')).toEqual(TOOLS);
    expect(searchTools('   ')).toEqual(TOOLS);
  });

  it('ad, açıklama ve anahtar kelimede arar', () => {
    expect(ids('base64')).toContain('base64');
    expect(ids('md5')).toEqual(['hash']);
    expect(ids('epoch')).toEqual(['timestamp']);
    expect(ids('guid')).toEqual(['uuid']);
    expect(ids('yaml')).toEqual(['json-convert', 'yaml-format']);
  });

  it('büyük/küçük harf ve Türkçe İ/ı katlaması', () => {
    expect(ids('JWT')).toContain('jwt');
    expect(ids('İMZA')).toContain('jwt');
    expect(ids('imza')).toContain('jwt');
    // "karşılaştır" → ı ve ş katlanır
    expect(ids('KARŞILAŞTIR')).toContain('diff');
    expect(ids('karsilastir')).toContain('diff');
    expect(ids('DÖNÜŞTÜR')).toContain('json-convert');
    expect(ids('donustur')).toContain('json-convert');
  });

  it('kodlama araçları kendi anahtar kelimeleriyle bulunur', () => {
    expect(ids('gzip')).toEqual(['compress']);
    expect(ids('totp')).toEqual(['base32']);
    expect(ids('entity')).toEqual(['html-entity']);
    expect(ids('surrogate')).toEqual(['unicode']);
    expect(ids('onaltılık')).toEqual(['hex']);
    expect(ids('verbatim')).toEqual(['string-escape']);
    expect(ids('sıkıştır')).toContain('compress');
    for (const id of ['html-entity', 'unicode', 'hex', 'base32', 'string-escape', 'compress'])
      expect(findTool(id)?.category).toBe('encoding');
  });

  it('SQL INSERT aracı kendi anahtar kelimeleriyle bulunur', () => {
    expect(ids('mssql')).toEqual(['sql-insert']);
    expect(ids('veritabanı insert')).toEqual(['sql-insert']);
    expect(findTool('sql-insert')?.category).toBe('convert');
  });

  it('birden çok terimin hepsi eşleşmeli', () => {
    expect(ids('json toml')).toEqual(['json-convert']);
    expect(ids('json zzz')).toEqual([]);
  });

  it('eşleşme yoksa boş', () => {
    expect(ids('kahve makinesi')).toEqual([]);
  });
});
