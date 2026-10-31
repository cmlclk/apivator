// CSV → SQL INSERT aracının girdi tarafı: ayırıcı tahmini ve ondalık ayırıcının seçimi.
import type { CsvDelimiter } from '../convert';

export type DelimiterChoice = 'auto' | CsvDelimiter;
export type DecimalChoice = 'auto' | ',' | '.';

const CANDIDATES: CsvDelimiter[] = [';', ',', '\t'];

/** İlk dolu satırdaki (tırnaklı alanlar hariç) en sık ayırıcıyı seçer; eşitlik ya da hiç yoksa `;`. */
export function detectDelimiter(text: string): CsvDelimiter {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const line = body.split(/\r?\n/).find((l) => l.trim() !== '') ?? '';
  const plain = line.replace(/"(?:[^"]|"")*"/g, '');
  let best: CsvDelimiter = ';';
  let bestCount = 0;
  for (const delimiter of CANDIDATES) {
    const count = plain.split(delimiter).length - 1;
    if (count > bestCount) {
      best = delimiter;
      bestCount = count;
    }
  }
  return best;
}

export function resolveDelimiter(choice: string, text: string): CsvDelimiter {
  return choice === ';' || choice === ',' || choice === '\t' ? choice : detectDelimiter(text);
}

/** Türkçe Excel `;` ile `,` ondalık kullanır; ayırıcı virgülse ondalık nokta olmak zorundadır. */
export function resolveDecimal(choice: string, delimiter: CsvDelimiter): ',' | '.' {
  if (choice === ',' || choice === '.') return choice;
  return delimiter === ',' ? '.' : ',';
}
