import { msg } from '../i18n';
import { ToolError } from './errors';

/** `gzip` (RFC 1952), `deflate` (zlib sarmalı, RFC 1950), `deflate-raw` (yalın, RFC 1951). */
export type CompressFormat = 'gzip' | 'deflate' | 'deflate-raw';

/** Açılan veri bu sınırı aşarsa durulur (sıkıştırma bombasına karşı). */
export const MAX_DECOMPRESSED_BYTES = 50 * 1024 * 1024;

function requireStreams(): void {
  if (typeof CompressionStream === 'undefined' || typeof DecompressionStream === 'undefined')
    throw new ToolError(
      msg(
        'toolsSecurity.compress.unsupported',
        'Bu ortam sıkıştırmayı desteklemiyor (CompressionStream yok).',
      ),
    );
}

/** Veriyi akıştan geçirir; çıktı `maxBytes`'ı aşarsa akış iptal edilip ToolError fırlatılır. */
async function pipe(
  transform: CompressionStream | DecompressionStream,
  data: Uint8Array,
  maxBytes: number,
): Promise<Uint8Array> {
  const writer = transform.writable.getWriter();
  const reader = transform.readable.getReader();
  // Yazma ile okuma eşzamanlı: akış geri basıncı yazmayı okuma bitene dek bekletebilir.
  const writing = writer.write(data as Uint8Array<ArrayBuffer>).then(() => writer.close());
  // Yazma hatası okuma tarafında da görünür; işlenmemiş ret uyarısı oluşmasın.
  writing.catch(() => undefined);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new ToolError(
        msg('toolsSecurity.compress.tooLarge', 'Açılan veri {mb} MB sınırını aşıyor; işlem durduruldu.', {
          mb: Math.round(maxBytes / 1024 / 1024),
        }),
      );
    }
    chunks.push(value);
  }
  await writing;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export async function compressBytes(data: Uint8Array, format: CompressFormat): Promise<Uint8Array> {
  requireStreams();
  return pipe(new CompressionStream(format), data, Number.POSITIVE_INFINITY);
}

/** Bozuk ya da farklı biçimdeki veride anlaşılır bir ToolError fırlatır. */
export async function decompressBytes(
  data: Uint8Array,
  format: CompressFormat,
  maxBytes = MAX_DECOMPRESSED_BYTES,
): Promise<Uint8Array> {
  requireStreams();
  if (!data.length) throw new ToolError(msg('toolsSecurity.compress.empty', 'Açılacak veri boş.'));
  try {
    return await pipe(new DecompressionStream(format), data, maxBytes);
  } catch (error) {
    if (error instanceof ToolError) throw error;
    throw new ToolError(
      msg(
        'toolsSecurity.compress.failed',
        'Veri açılamadı: bozuk ya da {format} biçiminde sıkıştırılmamış.',
        { format },
      ),
    );
  }
}

/** Başlığından biçimi tahmin eder: gzip sihirli baytı ya da zlib başlığı; tanınmazsa null. */
export function detectCompressFormat(bytes: Uint8Array): CompressFormat | null {
  if (bytes.length < 2) return null;
  const [b0, b1] = [bytes[0]!, bytes[1]!];
  if (b0 === 0x1f && b1 === 0x8b) return 'gzip';
  // zlib: CM = 8 (deflate), CINFO ≤ 7 ve iki bayt 31'in katı.
  if ((b0 & 0x0f) === 8 && b0 >> 4 <= 7 && ((b0 << 8) | b1) % 31 === 0) return 'deflate';
  return null;
}
