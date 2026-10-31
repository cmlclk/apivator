/** Regex aracının eşleştirme işi. Felaket geri izlemeli ifadeler sekmeyi dondurmasın diye Worker'da çalışır. */

export interface RegexRequest {
  id: number;
  pattern: string;
  flags: string;
  text: string;
  replacement: string;
  /** Bu sayıdan sonraki eşleşmeler listelenmez. */
  limit: number;
}

export interface RegexMatch {
  index: number;
  end: number;
  text: string;
  /** Numaralı gruplar ($1, $2…); eşleşmeyen grup null. */
  groups: (string | null)[];
  /** Adlandırılmış gruplar ($<ad>). */
  named: Record<string, string | null>;
}

export interface RegexResult {
  id: number;
  matches: RegexMatch[];
  /** Sınıra ulaşıldı; daha fazla eşleşme olabilir. */
  truncated: boolean;
  replaced: string;
  error: string | null;
}

export function runRegex({ id, pattern, flags, text, replacement, limit }: RegexRequest): RegexResult {
  let re: RegExp;
  try {
    re = new RegExp(pattern, flags);
  } catch (e) {
    return {
      id,
      matches: [],
      truncated: false,
      replaced: '',
      error: e instanceof Error ? e.message : String(e),
    };
  }
  // exec/replace da fırlatabilir (ör. çok uzun sonuç: RangeError); Worker hiçbir zaman hata fırlatmasın.
  try {
    return { id, error: null, ...matchAll(re, text, replacement, limit) };
  } catch (e) {
    return {
      id,
      matches: [],
      truncated: false,
      replaced: '',
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

function matchAll(re: RegExp, text: string, replacement: string, limit: number) {
  const matches: RegexMatch[] = [];
  let truncated = false;
  const global = re.global || re.sticky;
  const unicode = re.unicode;
  for (let m = re.exec(text); m; m = global ? re.exec(text) : null) {
    if (matches.length >= limit) {
      truncated = true;
      break;
    }
    matches.push({
      index: m.index,
      end: m.index + m[0].length,
      text: m[0],
      groups: m.slice(1).map((g) => g ?? null),
      named: Object.fromEntries(Object.entries(m.groups ?? {}).map(([k, v]) => [k, v ?? null])),
    });
    // Boş eşleşmede sonsuz döngüye girmemek için bir karakter (unicode'da bir kod noktası) ilerle.
    if (global && m[0] === '') {
      const code = text.codePointAt(re.lastIndex);
      re.lastIndex += unicode && code !== undefined && code > 0xffff ? 2 : 1;
    }
  }
  re.lastIndex = 0;
  return { matches, truncated, replaced: text.replace(re, replacement) };
}

// Worker içinde çalışırken mesajları dinle (ana iş parçacığında içe aktarılınca bir şey yapmaz).
if (typeof window === 'undefined' && typeof self !== 'undefined' && 'postMessage' in self) {
  self.onmessage = (event: MessageEvent<RegexRequest>) => {
    self.postMessage(runRegex(event.data));
  };
}
