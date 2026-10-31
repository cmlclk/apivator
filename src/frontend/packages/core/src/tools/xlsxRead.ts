import { ToolError } from './errors';
import { msg } from '../i18n';

export interface ReadSheet {
  name: string;
  /** İlk satır başlık sayılmaz; ham hücre değerleri (sayı, metin, mantıksal, boş için null). */
  rows: (string | number | boolean | null)[][];
}

type Cell = string | number | boolean | null;

const notXlsx = () => msg('toolsData.xlsx.notXlsx', 'Geçerli bir .xlsx dosyası değil.');
const tooBig = () => msg('toolsData.xlsx.tooBig', 'Sayfa çok büyük; daha küçük bir dosya ya da CSV deneyin.');
/** Excel sınırları (0 tabanlı): XFD kolonu ve 1.048.576. satır. */
const MAX_COL = 16_383;
const MAX_ROW = 1_048_575;
/** Bir sayfanın tablo halindeki (satır × kolon) en fazla hücresi. */
const MAX_CELLS = 5_000_000;
/** Açılmış içerik sınırları: sıkıştırma bombası belleği tüketmesin. */
const MAX_ENTRY_BYTES = 100 * 1024 * 1024;
const MAX_TOTAL_BYTES = 300 * 1024 * 1024;

/** Akışı sınırla okur; aşılırsa iptal edip ToolError fırlatır. */
async function readLimited(stream: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel().catch(() => undefined);
      throw new ToolError(tooBig());
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/** ZIP merkez dizininden dosya adı → içerik (açılmış). */
async function unzip(data: Uint8Array): Promise<Map<string, () => Promise<Uint8Array>>> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  // Merkez dizin sonu kaydı dosyanın sonundadır (en fazla 64 KB yorumla).
  let eocd = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 65_557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ToolError(notXlsx());
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  if (offset === 0xffffffff)
    throw new ToolError(msg('toolsData.xlsx.zip64', 'ZIP64 biçimindeki .xlsx dosyaları desteklenmiyor.'));

  const files = new Map<string, () => Promise<Uint8Array>>();
  const decoder = new TextDecoder();
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (offset + 46 > data.length || view.getUint32(offset, true) !== 0x02014b50)
      throw new ToolError(notXlsx());
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const declaredSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    const name = decoder.decode(data.subarray(offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;

    files.set(name, async () => {
      if (local + 30 > data.length || view.getUint32(local, true) !== 0x04034b50)
        throw new ToolError(notXlsx());
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      const raw = data.subarray(start, start + compressedSize);
      if (method === 0) return raw;
      if (method !== 8)
        throw new ToolError(
          msg('toolsData.xlsx.compression', 'Desteklenmeyen sıkıştırma yöntemi ({method}): {name}', {
            method: String(method),
            name,
          }),
        );
      if (typeof DecompressionStream === 'undefined')
        throw new ToolError(
          msg(
            'toolsData.xlsx.noDecompression',
            'Bu ortam sıkıştırılmış dosyaları açamıyor (DecompressionStream yok).',
          ),
        );
      // Bildirilen boyut yalan olabilir; asıl sınır okurken denetlenir.
      const limit = Math.min(MAX_ENTRY_BYTES, MAX_TOTAL_BYTES - total);
      if (declaredSize > limit) throw new ToolError(tooBig());
      const stream = new Blob([raw as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      const inflated = await readLimited(stream, limit);
      total += inflated.length;
      return inflated;
    });
  }
  return files;
}

function decodeXml(text: string): string {
  return text
    .replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (entity, body: string) => {
      if (body[0] === '#')
        return String.fromCodePoint(body[1] === 'x' ? parseInt(body.slice(2), 16) : Number(body.slice(1)));
      return { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[body] ?? entity;
    })
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

function attributes(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const m of text.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))
    result[m[1]!] = decodeXml(m[2] ?? m[3] ?? '');
  return result;
}

/** `<ad ...>içerik</ad>` ya da `<ad .../>` öğeleri (ad alanı öneki olabilir). */
function elements(xml: string, tag: string): { attrs: Record<string, string>; body: string }[] {
  const re = new RegExp(`<(?:[\\w.-]+:)?${tag}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</(?:[\\w.-]+:)?${tag}>)`, 'g');
  return Array.from(xml.matchAll(re), (m) => ({ attrs: attributes(m[1]!), body: m[2] ?? '' }));
}

/** Zengin metin parçaları dahil tüm `<t>` metinleri; fonetik (rPh) okunuşlar atlanır. */
function richText(xml: string): string {
  const cleaned = xml.replace(/<(?:[\w.-]+:)?rPh\b[\s\S]*?<\/(?:[\w.-]+:)?rPh>/g, '');
  return elements(cleaned, 't')
    .map((t) => decodeXml(t.body))
    .join('');
}

const BUILTIN_DATE_FORMATS = new Set([
  14, 15, 16, 17, 22, 27, 28, 29, 30, 31, 34, 35, 36, 50, 51, 52, 53, 54, 57, 58,
]);
const BUILTIN_TIME_FORMATS = new Set([18, 19, 20, 21, 32, 33, 45, 46, 47, 55, 56]);

type DateKind = 'date' | 'datetime' | 'time';

/** Biçim kodundan tarih türü: tırnaklı metin, [renk] ve kaçışlar dışında y/m/d/h/s geçiyorsa. */
function dateKindOf(code: string): DateKind | null {
  const cleaned = code
    .replace(/"[^"]*"/g, '')
    .replace(/\\./g, '')
    .replace(/\[(?!h\]|m\]|s\])[^\]]*\]/gi, '')
    .split(';')[0]!
    .toLowerCase();
  const hasTime = /[hs]/.test(cleaned);
  // Saat/saniye yoksa "m" ay demektir; varsa dakika.
  const hasDate = /[yd]/.test(cleaned) || (!hasTime && /m/.test(cleaned));
  if (!hasDate && !hasTime) return null;
  if (hasDate && hasTime) return 'datetime';
  return hasDate ? 'date' : 'time';
}

function styleDateKinds(stylesXml: string | null): (DateKind | null)[] {
  if (!stylesXml) return [];
  const custom = new Map<number, string>();
  for (const f of elements(stylesXml, 'numFmt'))
    custom.set(Number(f.attrs.numFmtId), f.attrs.formatCode ?? '');
  const cellXfs = elements(stylesXml, 'cellXfs')[0]?.body ?? '';
  return elements(cellXfs, 'xf').map(({ attrs }) => {
    const id = Number(attrs.numFmtId ?? 0);
    if (custom.has(id)) return dateKindOf(custom.get(id)!);
    if (BUILTIN_DATE_FORMATS.has(id)) return id === 22 ? 'datetime' : 'date';
    if (BUILTIN_TIME_FORMATS.has(id)) return 'time';
    return null;
  });
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** Excel seri numarasından saat dilimsiz ISO metni (yazıcıdaki excelDate'in tersi). */
function serialToIso(serial: number, kind: DateKind, date1904: boolean): string {
  const ms = Math.round(((date1904 ? serial + 1462 : serial) - 25_569) * 86_400_000);
  const d = new Date(ms);
  const date = `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const millis = d.getUTCMilliseconds();
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}${millis ? `.${pad(millis, 3)}` : ''}`;
  if (kind === 'time' && serial < 1) return time;
  if (kind === 'date' && ms % 86_400_000 === 0) return date;
  return `${date}T${time}`;
}

/** Hücre başvurusundaki kolon harflerinden 0 tabanlı indeks: A1 → 0, AA3 → 26. */
function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/i.exec(ref)?.[0].toUpperCase() ?? '';
  let index = 0;
  for (const ch of letters) index = index * 26 + (ch.charCodeAt(0) - 64);
  return index - 1;
}

function resolveTarget(target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = ['xl'];
  for (const part of target.split('/')) {
    if (part === '..') parts.pop();
    else if (part !== '.') parts.push(part);
  }
  return parts.join('/');
}

/**
 * .xlsx dosyasını okur (dış kütüphanesiz: ZIP + DecompressionStream('deflate-raw') + XML).
 * Paylaşılan metinler, satır içi metin, sayı, mantıksal ve tarih biçimli hücreler (ISO tarih metnine çevrilir).
 */
export async function readXlsx(data: Uint8Array): Promise<ReadSheet[]> {
  if (data.length < 22 || data[0] !== 0x50 || data[1] !== 0x4b) throw new ToolError(notXlsx());
  const files = await unzip(data);
  const decoder = new TextDecoder();
  const read = async (name: string) => {
    const entry = files.get(name);
    return entry ? decoder.decode(await entry()) : null;
  };

  const workbook = await read('xl/workbook.xml');
  if (!workbook)
    throw new ToolError(
      msg('toolsData.xlsx.noWorkbook', '{notXlsx} (xl/workbook.xml bulunamadı)', { notXlsx: notXlsx() }),
    );
  const rels = (await read('xl/_rels/workbook.xml.rels')) ?? '';
  const targets = new Map(
    elements(rels, 'Relationship').map((r) => [r.attrs.Id, resolveTarget(r.attrs.Target ?? '')]),
  );
  const date1904 = /date1904\s*=\s*["'](1|true)["']/.test(workbook);
  const shared = elements((await read('xl/sharedStrings.xml')) ?? '', 'si').map((si) => richText(si.body));
  const dateKinds = styleDateKinds(await read('xl/styles.xml'));

  const sheets: ReadSheet[] = [];
  for (const [index, sheet] of elements(workbook, 'sheet').entries()) {
    const relId = sheet.attrs['r:id'] ?? Object.entries(sheet.attrs).find(([k]) => k.endsWith(':id'))?.[1];
    const path = (relId && targets.get(relId)) || `xl/worksheets/sheet${index + 1}.xml`;
    const xml = await read(path);
    if (xml === null) continue;
    const sheetData = elements(xml, 'sheetData')[0]?.body ?? '';
    const sparse: [number, [number, Cell][]][] = [];
    let width = 0;
    let height = 0;
    let nextRow = 0;
    for (const row of elements(sheetData, 'row')) {
      const rowIndex = row.attrs.r ? Number(row.attrs.r) - 1 : nextRow;
      nextRow = rowIndex + 1;
      const cells: [number, Cell][] = [];
      let nextCol = 0;
      for (const c of elements(row.body, 'c')) {
        const col = c.attrs.r ? columnIndex(c.attrs.r) : nextCol;
        nextCol = col + 1;
        const raw = /<(?:[\w.-]+:)?v\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?v>/.exec(c.body)?.[1];
        const v = raw === undefined ? undefined : decodeXml(raw);
        let value: Cell = null;
        switch (c.attrs.t) {
          case 's':
            value = v === undefined ? null : (shared[Number(v)] ?? null);
            break;
          case 'inlineStr':
            value = richText(c.body);
            break;
          case 'str':
          case 'e':
            value = v ?? null;
            break;
          case 'b':
            value = v === undefined ? null : v.trim() === '1' || v.trim() === 'true';
            break;
          case 'd':
            value = v ?? null;
            break;
          default: {
            if (v === undefined || v.trim() === '') break;
            const n = Number(v);
            const kind = dateKinds[Number(c.attrs.s ?? 0)];
            value = Number.isFinite(n) && kind ? serialToIso(n, kind, date1904) : Number.isFinite(n) ? n : v;
          }
        }
        // Boş (yalnızca biçimli) hücreler yerleşmez: tüm satıra/kolona biçim verilmiş dosyalar şişmesin.
        if (value === null || col < 0 || col > MAX_COL || rowIndex < 0 || rowIndex > MAX_ROW) continue;
        cells.push([col, value]);
        width = Math.max(width, col + 1);
      }
      if (!cells.length) continue;
      sparse.push([rowIndex, cells]);
      height = Math.max(height, rowIndex + 1);
      if (height * width > MAX_CELLS) throw new ToolError(tooBig());
    }
    // Satırlar gerçek veri genişliğine tamamlanır; boş hücreler null olur.
    const rows: Cell[][] = Array.from({ length: height }, () => new Array<Cell>(width).fill(null));
    for (const [r, cells] of sparse) for (const [c, value] of cells) rows[r]![c] = value;
    sheets.push({ name: sheet.attrs.name ?? `Sayfa${index + 1}`, rows });
  }
  if (!sheets.length) throw new ToolError(msg('toolsData.xlsx.noSheets', 'Dosyada okunabilir sayfa yok.'));
  return sheets;
}
