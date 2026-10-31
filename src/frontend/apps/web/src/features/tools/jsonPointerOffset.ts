/** JSON metninde bir JSON pointer'ın gösterdiği değerin konumu (hata satırına gitmek için). */

const WS = /[ \t\r\n]/;

function skipWs(text: string, pos: number): number {
  while (pos < text.length && WS.test(text[pos]!)) pos++;
  return pos;
}

/** `pos`'taki metin değerinin (tırnaklar dahil) bittiği yer. */
function stringEnd(text: string, pos: number): number {
  let i = pos + 1;
  while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
  return Math.min(i + 1, text.length);
}

/** `pos`'taki herhangi bir değerin bittiği yer. */
function valueEnd(text: string, pos: number): number {
  if (text[pos] === '"') return stringEnd(text, pos);
  if (text[pos] !== '{' && text[pos] !== '[') {
    let i = pos;
    while (i < text.length && !/[,\]}\s]/.test(text[i]!)) i++;
    return i;
  }
  let depth = 0;
  let i = pos;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '"') {
      i = stringEnd(text, i);
      continue;
    }
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  return text.length;
}

/** Pointer'ın gösterdiği değerin [from, to) aralığı; bulunamazsa ya da metin bozuksa null. */
export function jsonPointerOffset(text: string, pointer: string): { from: number; to: number } | null {
  const tokens = pointer
    ? pointer
        .slice(1)
        .split('/')
        .map((t) => t.replace(/~1/g, '/').replace(/~0/g, '~'))
    : [];
  let pos = skipWs(text, 0);
  for (const token of tokens) {
    const open = text[pos];
    if (open !== '{' && open !== '[') return null;
    pos = skipWs(text, pos + 1);
    let index = 0;
    let found = false;
    while (pos < text.length && text[pos] !== '}' && text[pos] !== ']') {
      let match: boolean;
      if (open === '{') {
        const end = stringEnd(text, pos);
        let key: unknown;
        try {
          key = JSON.parse(text.slice(pos, end));
        } catch {
          return null;
        }
        pos = skipWs(text, end);
        if (text[pos] !== ':') return null;
        pos = skipWs(text, pos + 1);
        match = key === token;
      } else match = String(index++) === token;
      if (match) {
        found = true;
        break;
      }
      pos = skipWs(text, valueEnd(text, pos));
      if (text[pos] === ',') pos = skipWs(text, pos + 1);
    }
    if (!found) return null;
  }
  if (pos >= text.length) return null;
  return { from: pos, to: valueEnd(text, pos) };
}
