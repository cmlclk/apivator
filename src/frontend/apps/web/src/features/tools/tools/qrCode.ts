import qrcode from 'qrcode-generator';
import { ToolError, utf8Encode } from '@apivator/core/tools';
import { translate } from '../../../i18n';

/** QR kod matrisi ve SVG/PNG çıktısı; kodlama `qrcode-generator` (MIT) ile, metin UTF-8 bayt kipinde. */

export type QrLevel = 'L' | 'M' | 'Q' | 'H';

/** Sürüm 40'ta bayt kipinde sığan en fazla bayt (ISO/IEC 18004 tablo 7). */
export const QR_MAX_BYTES: Record<QrLevel, number> = { L: 2953, M: 2331, Q: 1663, H: 1273 };

export interface QrMatrix {
  /** Kenar başına modül sayısı (sürüm × 4 + 17). */
  size: number;
  version: number;
  bytes: number;
  dark: boolean[][];
}

export function makeQrMatrix(text: string, level: QrLevel): QrMatrix {
  const bytes = utf8Encode(text);
  if (!bytes.length) throw new ToolError(translate('toolsSecurity', 'qr.errors.empty'));
  const max = QR_MAX_BYTES[level];
  const tooLong = () =>
    new ToolError(
      translate('toolsSecurity', 'qr.errors.tooLong', {
        bytes: String(bytes.length),
        level,
        max: String(max),
      }),
    );
  if (bytes.length > max) throw tooLong();
  // Kütüphane her karakterin alt 8 bitini bayt olarak alır: UTF-8 baytları tek tek karaktere çevrilir.
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  const qr = qrcode(0, level);
  qr.addData(binary, 'Byte');
  try {
    qr.make();
  } catch {
    throw tooLong();
  }
  const size = qr.getModuleCount();
  const dark = Array.from({ length: size }, (_, r) =>
    Array.from({ length: size }, (_, c) => qr.isDark(r, c)),
  );
  return { size, version: (size - 17) / 4, bytes: bytes.length, dark };
}

/** Koyu modüller için SVG yol verisi; satırdaki ardışık modüller tek dikdörtgende birleşir. */
export function qrPathData(matrix: QrMatrix, margin: number): string {
  const parts: string[] = [];
  matrix.dark.forEach((row, r) => {
    for (let c = 0; c < row.length;) {
      if (!row[c]) {
        c++;
        continue;
      }
      let run = 1;
      while (row[c + run]) run++;
      parts.push(`M${c + margin} ${r + margin}h${run}v1h-${run}z`);
      c += run;
    }
  });
  return parts.join('');
}

const COLOR_RE = /^#[0-9a-f]{6}$/i;

/** Yalnızca `#rrggbb`; başka her şey (SVG'ye enjeksiyon dahil) varsayılana düşer. */
export function safeColor(value: string, fallback: string): string {
  return COLOR_RE.test(value) ? value : fallback;
}

export interface QrStyle {
  /** Piksel cinsinden kenar. */
  pixels: number;
  /** Modül cinsinden sessiz bölge. */
  margin: number;
  foreground: string;
  background: string;
}

/** İndirilecek SVG metni: yalnızca matris, sayılar ve doğrulanmış renklerden kurulur. */
export function qrSvgString(matrix: QrMatrix, style: QrStyle): string {
  const total = matrix.size + style.margin * 2;
  const fg = safeColor(style.foreground, '#000000');
  const bg = safeColor(style.background, '#ffffff');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${style.pixels}" height="${style.pixels}" ` +
    `viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges">` +
    `<rect width="${total}" height="${total}" fill="${bg}"/>` +
    `<path d="${qrPathData(matrix, style.margin)}" fill="${fg}"/></svg>\n`
  );
}

/** PNG: modül başına tam sayı piksel (bulanıklık olmasın); kenar `pixels`a en yakın alttaki kat. */
export function qrPngBlob(matrix: QrMatrix, style: QrStyle): Promise<Blob> {
  const total = matrix.size + style.margin * 2;
  const cell = Math.max(1, Math.floor(style.pixels / total));
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = cell * total;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new ToolError(translate('toolsSecurity', 'qr.errors.noCanvas')));
  ctx.fillStyle = safeColor(style.background, '#ffffff');
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = safeColor(style.foreground, '#000000');
  matrix.dark.forEach((row, r) =>
    row.forEach((on, c) => {
      if (on) ctx.fillRect((c + style.margin) * cell, (r + style.margin) * cell, cell, cell);
    }),
  );
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new ToolError(translate('toolsSecurity', 'qr.errors.pngFailed'))),
      'image/png',
    ),
  );
}
