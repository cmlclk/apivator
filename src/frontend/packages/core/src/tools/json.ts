import { ToolError } from './errors';
import { msg } from '../i18n';

export type JsonParseResult =
  | { ok: true; value: unknown }
  /** `line` ve `column` 1'den başlar; `offset` 0'dan. */
  | { ok: false; message: string; line: number; column: number; offset: number };

class ScanError extends Error {
  constructor(
    message: string,
    readonly offset: number,
  ) {
    super(message);
  }
}

function describe(ch: string | undefined): string {
  if (ch === undefined) return msg('toolsData.json.unexpectedEnd', 'Beklenmeyen son: JSON yarıda kalmış.');
  if (ch === '\n' || ch === '\r') return msg('toolsData.json.unexpectedNewline', 'Beklenmeyen satır sonu.');
  return msg('toolsData.json.unexpectedChar', 'Beklenmeyen karakter: "{ch}".', { ch });
}

/**
 * JSON.parse başarısız olduğunda hatanın yerini bulan doğrulayıcı tarama (değer üretmez).
 * Motorların hata mesajı farklı olduğundan konum burada hesaplanır.
 */
function scan(text: string): void {
  let i = 0;
  const ws = () => {
    while (i < text.length && ' \t\n\r'.includes(text[i]!)) i++;
  };
  const fail = (message?: string): never => {
    throw new ScanError(message ?? describe(text[i]), i);
  };
  const literal = (word: string) => {
    for (let k = 0; k < word.length; k++, i++) if (text[i] !== word[k]) fail();
  };
  const string = () => {
    const start = i;
    i++;
    while (i < text.length) {
      const ch = text[i]!;
      if (ch === '"') {
        i++;
        return;
      }
      if (ch === '\\') {
        const next = text[i + 1];
        if (next === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) {
            i += 2;
            fail(
              msg('toolsData.json.badUnicodeEscape', 'Geçersiz \\u kaçışı: dört onaltılık rakam bekleniyor.'),
            );
          }
          i += 6;
        } else if (next !== undefined && '"\\/bfnrt'.includes(next)) i += 2;
        else {
          i++;
          fail(
            next === undefined
              ? undefined
              : msg('toolsData.json.badEscape', 'Geçersiz kaçış: "\\{next}".', { next }),
          );
        }
        continue;
      }
      if (ch.charCodeAt(0) < 0x20)
        fail(msg('toolsData.json.controlChar', 'Metin içinde kaçışsız kontrol karakteri ya da satır sonu.'));
      i++;
    }
    throw new ScanError(msg('toolsData.json.unterminatedString', 'Kapanmamış metin: " bekleniyor.'), start);
  };
  const number = () => {
    if (text[i] === '-') i++;
    if (text[i] === '0') i++;
    else if (/[1-9]/.test(text[i] ?? '')) while (/[0-9]/.test(text[i] ?? '')) i++;
    else fail();
    if (text[i] === '.') {
      i++;
      if (!/[0-9]/.test(text[i] ?? ''))
        fail(msg('toolsData.json.digitAfterPoint', 'Ondalık noktadan sonra rakam bekleniyor.'));
      while (/[0-9]/.test(text[i] ?? '')) i++;
    }
    if (text[i] === 'e' || text[i] === 'E') {
      i++;
      if (text[i] === '+' || text[i] === '-') i++;
      if (!/[0-9]/.test(text[i] ?? ''))
        fail(msg('toolsData.json.digitInExponent', 'Üs için rakam bekleniyor.'));
      while (/[0-9]/.test(text[i] ?? '')) i++;
    }
  };
  const value = (): void => {
    ws();
    const ch = text[i];
    if (ch === '{') {
      i++;
      ws();
      if (text[i] === '}') {
        i++;
        return;
      }
      for (;;) {
        ws();
        if (text[i] !== '"')
          fail(
            text[i] === '}'
              ? msg('toolsData.json.trailingComma', 'Son elemandan sonra virgül olamaz.')
              : msg('toolsData.json.expectedKey', 'Anahtar (" ile) bekleniyor.'),
          );
        string();
        ws();
        if (text[i] !== ':') fail(msg('toolsData.json.expectedColon', '":" bekleniyor.'));
        i++;
        value();
        ws();
        if (text[i] === ',') {
          i++;
          continue;
        }
        if (text[i] === '}') {
          i++;
          return;
        }
        fail(
          text[i] === undefined
            ? undefined
            : msg('toolsData.json.expectedCommaOrBrace', '"," ya da "\'}\'" bekleniyor.'),
        );
      }
    }
    if (ch === '[') {
      i++;
      ws();
      if (text[i] === ']') {
        i++;
        return;
      }
      for (;;) {
        ws();
        if (text[i] === ']') fail(msg('toolsData.json.trailingComma', 'Son elemandan sonra virgül olamaz.'));
        value();
        ws();
        if (text[i] === ',') {
          i++;
          continue;
        }
        if (text[i] === ']') {
          i++;
          return;
        }
        fail(
          text[i] === undefined
            ? undefined
            : msg('toolsData.json.expectedCommaOrBracket', '"," ya da "]" bekleniyor.'),
        );
      }
    }
    if (ch === '"') return string();
    if (ch === 't') return literal('true');
    if (ch === 'f') return literal('false');
    if (ch === 'n') return literal('null');
    if (ch === '-' || /[0-9]/.test(ch ?? '')) return number();
    if (ch === "'") fail(msg('toolsData.json.doubleQuotes', 'Metinler çift tırnakla (") yazılmalı.'));
    fail();
  };

  ws();
  if (i >= text.length) fail(msg('toolsData.json.emptyInput', 'Boş girdi: JSON değeri bekleniyor.'));
  value();
  ws();
  if (i < text.length)
    fail(msg('toolsData.json.extraContent', 'Değerden sonra fazladan içerik: "{ch}".', { ch: text[i] }));
}

function position(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  for (let k = 0; k < offset && k < text.length; k++) {
    if (text[k] === '\n') {
      line++;
      lineStart = k + 1;
    }
  }
  return { line, column: offset - lineStart + 1 };
}

/** JSON.parse ve hatanın satır/sütunu (motor mesajına güvenmeden, kendi taramasıyla bulunur). */
export function parseJsonDetailed(text: string): JsonParseResult {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (parseError) {
    let message = parseError instanceof Error ? parseError.message : String(parseError);
    let offset = 0;
    try {
      scan(text);
    } catch (error) {
      if (error instanceof ScanError) {
        message = error.message;
        offset = error.offset;
      } else message = msg('toolsData.json.tooDeep', 'JSON çok derin iç içe.');
    }
    return { ok: false, message, offset, ...position(text, offset) };
  }
}

/**
 * Metinde 15'ten fazla anlamlı basamaklı sayı var mı (int64 kimlikler gibi)? JSON.parse bunları yuvarlar;
 * arayüz uyarı göstersin diye. Metinlerin içi atlanır.
 */
export function hasPrecisionLoss(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '"') {
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === '\\') i++;
      continue;
    }
    if (ch === '-' || (ch >= '0' && ch <= '9')) {
      const match = /^-?(\d+)(?:\.(\d+))?/.exec(text.slice(i, i + 400));
      if (!match) continue;
      const digits = (match[1]! + (match[2] ?? '')).replace(/^0+/, '').replace(/0+$/, '');
      if (digits.length > 15 && String(Number(match[0])) !== match[0]) return true;
      i += match[0].length - 1;
    }
  }
  return false;
}

/** Anahtarları alfabetik (iç içe tüm nesnelerde) sıralanmış kopya; diziler sırasını korur. */
export function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (typeof value === 'object' && value !== null) {
    const keys = Object.keys(value).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(keys.map((k) => [k, sortKeysDeep((value as Record<string, unknown>)[k])]));
  }
  return value;
}

export interface FormatJsonOptions {
  /** Boşluk sayısı ya da sekme; 0 küçültür. Varsayılan 2. */
  indent?: number | '\t';
  sortKeys?: boolean;
}

/** Biçimlendirir; geçersizse satır/sütunlu ToolError ("3. satır, 5. sütun: ..."). */
export function formatJson(text: string, options: FormatJsonOptions = {}): string {
  const parsed = parseJsonDetailed(text);
  if (!parsed.ok)
    throw new ToolError(
      msg('toolsData.lineColumn', '{line}. satır, {column}. sütun: {reason}', {
        line: String(parsed.line),
        column: String(parsed.column),
        reason: parsed.message,
      }),
    );
  const value = options.sortKeys ? sortKeysDeep(parsed.value) : parsed.value;
  const indent = options.indent ?? 2;
  return indent === 0 ? JSON.stringify(value) : JSON.stringify(value, null, indent);
}
