/**
 * Büyük dosyalarda hash ve Base64 işi. Yüzlerce MB'lık dosya arayüzü dondurmasın diye Worker'da çalışır;
 * Worker yoksa (test ortamı) aynı fonksiyonlar ana iş parçacığında çağrılır.
 */
import {
  base64Decode,
  base64Encode,
  digest,
  hasWebCrypto,
  hmac,
  toHex,
  type HashAlgorithm,
} from '@apivator/core/tools';

export const HASH_ALGORITHMS: HashAlgorithm[] = ['MD5', 'SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'];

export interface HashRow {
  algorithm: HashAlgorithm;
  hex?: string;
  base64?: string;
  error?: string;
}

/** Dosya Blob olarak gönderilir: kopyalanmaz, Worker kendisi okur. */
export type BytesJob =
  | { op: 'hash'; file: Blob; /** null ise düz hash, değilse HMAC anahtarı. */ hmacKey: Uint8Array | null }
  | { op: 'base64-encode'; file: Blob; urlSafe: boolean; lineLength: number }
  | { op: 'base64-decode'; file: Blob };

export type BytesRequest = BytesJob & { id: number };

export type BytesResponse =
  | { id: number; type: 'progress'; done: number; total: number }
  | { id: number; type: 'hash'; rows: HashRow[] }
  /** Base64 metni ASCII bayt olarak döner; dize olarak kopyalanmak yerine aktarılır (transfer). */
  | { id: number; type: 'base64-encode'; ascii: Uint8Array }
  | { id: number; type: 'base64-decode'; bytes: Uint8Array; declaredMime: string | null }
  | { id: number; type: 'error'; error: string };

/**
 * Worker'da çeviri yüklü değildir: hata metni kodlu gelir (`\u0001kod` ya da `\u0001kod\u0001ayrıntı`) ve ana
 * iş parçacığında çevrilir (`localizeBytesError`, useBytesWorker).
 */
const CODE = '\u0001';
const UNREADABLE = `${CODE}unreadable`;

export function parseBytesErrorCode(text: string): { code: string; detail: string } | null {
  if (!text.startsWith(CODE)) return null;
  const [code = '', detail = ''] = text.slice(1).split(CODE);
  return { code, detail };
}

function errorText(e: unknown): string {
  if (e instanceof RangeError) return `${CODE}memory${CODE}${e.message}`;
  return e instanceof Error ? e.message : String(e);
}

/** `data:image/png;base64,...` önekini ayırır. */
export function splitDataUri(text: string): { body: string; mime: string | null } {
  const dataUri = /^data:([^;,]*)(?:;[^,]*)?;base64,/i.exec(text);
  return dataUri
    ? { body: text.slice(dataUri[0].length), mime: dataUri[1] || null }
    : { body: text, mime: null };
}

/** SHA ailesi doğrudan Web Crypto ile: çekirdekteki sürüm veriyi kopyalar, büyük dosyada bellek iki katına çıkar. */
async function digestLarge(algorithm: HashAlgorithm, bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  if (algorithm === 'MD5' || !hasWebCrypto()) return digest(algorithm, bytes);
  return new Uint8Array(await crypto.subtle.digest(algorithm, bytes));
}

async function hmacLarge(algorithm: HashAlgorithm, key: Uint8Array, bytes: Uint8Array<ArrayBuffer>) {
  if (algorithm === 'MD5' || !hasWebCrypto()) return hmac(algorithm, key, bytes);
  // Web Crypto boş anahtarı reddeder; RFC 2104'e göre blok boyunda sıfırlarla aynı sonucu verir.
  const raw = key.length
    ? key.slice()
    : new Uint8Array(algorithm === 'SHA-384' || algorithm === 'SHA-512' ? 128 : 64);
  const cryptoKey = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: algorithm }, false, [
    'sign',
  ]);
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, bytes));
}

/** Tüm algoritmaları sırayla hesaplar; her biri bitince ilerleme bildirir. */
export async function hashRows(
  data: Uint8Array,
  hmacKey: Uint8Array | null,
  onProgress?: (done: number, total: number) => void,
): Promise<HashRow[]> {
  // Paylaşılan bellek (SharedArrayBuffer) kullanılmıyor; Web Crypto için tür daraltması.
  const bytes = data as Uint8Array<ArrayBuffer>;
  const rows: HashRow[] = [];
  for (const algorithm of HASH_ALGORITHMS) {
    try {
      const result = hmacKey
        ? await hmacLarge(algorithm, hmacKey, bytes)
        : await digestLarge(algorithm, bytes);
      rows.push({ algorithm, hex: toHex(result), base64: base64Encode(result) });
    } catch (e) {
      rows.push({ algorithm, error: errorText(e) });
    }
    onProgress?.(rows.length, HASH_ALGORITHMS.length);
  }
  return rows;
}

const PLUS = 43;
const SLASH = 47;
const EQUALS = 61;
const NEWLINE = 10;

/**
 * Çekirdekteki base64Encode ile aynı çıktıyı parça parça, doğrudan bayt dizisine üretir.
 * Tek dizede birleştirmek 100 MB'lık dosyada gigabaytlarca ara dize demektir.
 * `chunkBytes` 3'ün katı olmalı (dolgu yalnızca sonda oluşsun).
 */
export function base64EncodeBytes(
  bytes: Uint8Array,
  options: { urlSafe?: boolean; lineLength?: number },
  chunkBytes = 3 * 256 * 1024,
): Uint8Array<ArrayBuffer> {
  const urlSafe = options.urlSafe ?? false;
  const lineLength = options.lineLength ?? 0;
  const encodedLength = urlSafe ? Math.ceil((bytes.length * 4) / 3) : Math.ceil(bytes.length / 3) * 4;
  const breaks =
    lineLength > 0 && encodedLength > lineLength ? Math.floor((encodedLength - 1) / lineLength) : 0;
  const out = new Uint8Array(encodedLength + breaks);
  let pos = 0;
  let column = 0;
  for (let offset = 0; offset < bytes.length; offset += chunkBytes) {
    const text = base64Encode(bytes.subarray(offset, offset + chunkBytes));
    for (let i = 0; i < text.length; i++) {
      let code = text.charCodeAt(i);
      if (urlSafe) {
        if (code === EQUALS) continue;
        if (code === PLUS) code = 45;
        else if (code === SLASH) code = 95;
      }
      if (lineLength > 0 && column === lineLength) {
        out[pos++] = NEWLINE;
        column = 0;
      }
      out[pos++] = code;
      column++;
    }
  }
  return out;
}

/** Blob okuma; eski ortamlarda (jsdom) arrayBuffer/text yoksa FileReader'a düşer. */
function readBlob(blob: Blob, as: 'buffer'): Promise<ArrayBuffer>;
function readBlob(blob: Blob, as: 'text'): Promise<string>;
function readBlob(blob: Blob, as: 'buffer' | 'text'): Promise<ArrayBuffer | string> {
  if (as === 'buffer' && typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  if (as === 'text' && typeof blob.text === 'function') return blob.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer | string);
    reader.onerror = () => reject(reader.error ?? new Error(UNREADABLE));
    if (as === 'buffer') reader.readAsArrayBuffer(blob);
    else reader.readAsText(blob);
  });
}

/** İşi yapar; yanıtla birlikte aktarılacak (kopyalanmayacak) tamponları döner. Hiçbir zaman fırlatmaz. */
export async function runBytesJob(
  request: BytesRequest,
  onProgress: (response: BytesResponse) => void = () => {},
): Promise<{ response: BytesResponse; transfer: Transferable[] }> {
  const { id } = request;
  try {
    if (request.op === 'hash') {
      const bytes = new Uint8Array(await readBlob(request.file, 'buffer'));
      const rows = await hashRows(bytes, request.hmacKey, (done, total) =>
        onProgress({ id, type: 'progress', done, total }),
      );
      return { response: { id, type: 'hash', rows }, transfer: [] };
    }
    if (request.op === 'base64-encode') {
      const bytes = new Uint8Array(await readBlob(request.file, 'buffer'));
      const ascii = base64EncodeBytes(bytes, request);
      return { response: { id, type: 'base64-encode', ascii }, transfer: [ascii.buffer] };
    }
    const { body, mime } = splitDataUri((await readBlob(request.file, 'text')).trim());
    const bytes = base64Decode(body);
    return {
      response: { id, type: 'base64-decode', bytes, declaredMime: mime },
      transfer: [bytes.buffer],
    };
  } catch (e) {
    return { response: { id, type: 'error', error: errorText(e) }, transfer: [] };
  }
}

// Worker içinde çalışırken mesajları dinle (ana iş parçacığında içe aktarılınca bir şey yapmaz).
if (typeof window === 'undefined' && typeof self !== 'undefined' && 'postMessage' in self) {
  self.onmessage = (event: MessageEvent<BytesRequest>) => {
    void runBytesJob(event.data, (progress) => self.postMessage(progress)).then(({ response, transfer }) =>
      self.postMessage(response, { transfer }),
    );
  };
}
