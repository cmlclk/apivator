import { describe, expect, it } from 'vitest';
import { compressBytes, decompressBytes, detectCompressFormat, type CompressFormat } from './compress';
import { base64Decode, utf8Encode } from './encoding';
import { ToolError } from './errors';

const FORMATS: CompressFormat[] = ['gzip', 'deflate', 'deflate-raw'];
const text = (value: Uint8Array) => new TextDecoder().decode(value);

describe('sıkıştırma', () => {
  it('her biçimde gidiş-dönüş korunur ve tekrarlı veri küçülür', async () => {
    const plain = utf8Encode('Merhaba dünya! '.repeat(200));
    for (const format of FORMATS) {
      const packed = await compressBytes(plain, format);
      expect(packed.length, format).toBeLessThan(plain.length / 10);
      expect(text(await decompressBytes(packed, format)), format).toBe(text(plain));
    }
  });

  it('başlıktan biçimi tanır', async () => {
    const data = utf8Encode('abc');
    expect(detectCompressFormat(await compressBytes(data, 'gzip'))).toBe('gzip');
    expect(detectCompressFormat(await compressBytes(data, 'deflate'))).toBe('deflate');
    expect(detectCompressFormat(utf8Encode('hello'))).toBeNull();
  });

  it('başka araçla üretilmiş gzip verisini açar', async () => {
    // printf 'hello' | gzip -n | base64
    const gzip = base64Decode('H4sIAAAAAAAAA8tIzcnJBwCGphA2BQAAAA==');
    expect(text(await decompressBytes(gzip, 'gzip'))).toBe('hello');
  });

  it('bozuk ya da yanlış biçimdeki veride anlaşılır hata', async () => {
    await expect(decompressBytes(utf8Encode('bu sıkıştırılmış değil'), 'gzip')).rejects.toThrow(ToolError);
    const deflated = await compressBytes(utf8Encode('abc'), 'deflate');
    await expect(decompressBytes(deflated, 'gzip')).rejects.toThrow(/gzip/);
    const gzip = await compressBytes(utf8Encode('abc'.repeat(100)), 'gzip');
    await expect(decompressBytes(gzip.subarray(0, gzip.length - 6), 'gzip')).rejects.toThrow(ToolError);
    await expect(decompressBytes(new Uint8Array(), 'gzip')).rejects.toThrow(/boş/);
  });

  it('sınırı aşan çıktıda durur (sıkıştırma bombası)', async () => {
    const packed = await compressBytes(new Uint8Array(2 * 1024 * 1024), 'gzip');
    expect(packed.length).toBeLessThan(10_000);
    await expect(decompressBytes(packed, 'gzip', 1024 * 1024)).rejects.toThrow(/sınırını aşıyor/);
    expect((await decompressBytes(packed, 'gzip')).length).toBe(2 * 1024 * 1024);
  });
});
