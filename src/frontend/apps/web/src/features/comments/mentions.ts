/** Gövdedeki bahsetme biçimi: `@[Ayşe Yılmaz](kullanıcı-id)` (sunucu da aynı kalıbı tanır). */
const MENTION = /@\[([^\]\r\n]{1,100})\]\(([0-9a-fA-F-]{36})\)/g;

export type CommentPart = { kind: 'text'; text: string } | { kind: 'mention'; name: string; userId: string };

export function parseComment(body: string): CommentPart[] {
  const parts: CommentPart[] = [];
  let last = 0;
  for (const match of body.matchAll(MENTION)) {
    if (match.index > last) parts.push({ kind: 'text', text: body.slice(last, match.index) });
    parts.push({ kind: 'mention', name: match[1]!, userId: match[2]! });
    last = match.index + match[0].length;
  }
  if (last < body.length) parts.push({ kind: 'text', text: body.slice(last) });
  return parts;
}

export const mentionToken = (name: string, userId: string) =>
  `@[${name.replace(/[\]\r\n]/g, '')}](${userId})`;

/**
 * İmlecin hemen solunda yazılmakta olan "@ad" sorgusu (bahsetme önerileri için).
 * Boşluk ya da satır başından sonra gelen @ sayılır; e-posta adresleri tetiklemez.
 */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const match = /(^|\s)@([^\s@[\]()]{0,40})$/.exec(before);
  if (!match) return null;
  return { start: caret - match[2]!.length - 1, query: match[2]! };
}

/** Saklanan gövdeyi düzenlenebilir metne çevirir: bahsetmeler "@Ad" olarak görünür. */
export function toEditable(body: string) {
  const mentions = new Map<string, string>();
  const text = parseComment(body)
    .map((p) => {
      if (p.kind === 'text') return p.text;
      mentions.set(p.name, p.userId);
      return `@${p.name}`;
    })
    .join('');
  return { text, mentions };
}

/** "@Ad" geçen yerleri saklanacak biçime çevirir (uzun adlar önce, "Ayşe" ile "Ayşe Yılmaz" karışmasın). */
export function toStored(text: string, mentions: Map<string, string>) {
  let result = text;
  const names = [...mentions.keys()].sort((a, b) => b.length - a.length);
  for (const name of names) {
    result = result.split(`@${name}`).join(mentionToken(name, mentions.get(name)!));
  }
  return result;
}
