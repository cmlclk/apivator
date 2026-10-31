import { applyPseudoTransform, setLanguage } from './messages';

/**
 * Sözde dil (Faz 8.4): İngilizce metinleri `[!! Ţëšţ !!]` biçimine çevirir. Harfler aksanlı benzerleriyle değişir
 * (düz ASCII harf kalmışsa o metin çevrilmemiş/gömülü demektir), metin ~%35 uzar (taşma görünsün) ve `[!! … !!]`
 * ile sarılır. ICU yapısı bozulmaz: `{x}` değişkenleri, `plural`/`select` adları ve seçicileri, `#`, `<b>`/`<link>`
 * etiketleri ve kesme işaretiyle kaçışlar olduğu gibi kalır.
 *
 * Yalnızca geliştirme modunda ve testlerde kullanılır (`components/LanguageSelect.tsx` `import.meta.env.DEV`
 * arkasında yükler); bu modül üretim paketine girmez. Türkçeye özgü harfler (ç ğ ı ö ş ü) bilerek eşlemede
 * yoktur: çıktıda görünürlerse Türkçe metin sızmıştır.
 */

const LOWER: Record<string, string> = Object.fromEntries(
  [...'abcdefghijklmnopqrstuvwxyz'].map((c, i) => [c, [...'àƀćđéƒĝĥíĵķĺɱńóƥʠŕśţúṽŵẋýź'][i]!]),
);
const UPPER: Record<string, string> = Object.fromEntries(
  [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map((c, i) => [c, [...'ÀƁĆĐÉƑĜĤÍĴĶĹṀŃÓƤǪŔŚŢÚṼŴẊÝŹ'][i]!]),
);
const VOWELS = new Set([...'àéíóúÀÉÍÓÚýÝ']);
const EXTRA = 0.35;

/** Çevrilmemiş sayılacak harfler: düz ASCII harfler ve Türkçeye özgü harfler. */
export const UNTRANSLATED_LETTER = /[A-Za-zıİğĞşŞçÇöÖüÜ]/;

/** Düz metin parçasını sözde harflere çevirir ve ~%35 uzatır (ünlüleri sırayla ikileyerek, kelimeler bölünmez). */
function styleText(text: string): string {
  const mapped = [...text].map((c) => LOWER[c] ?? UPPER[c] ?? c);
  const letters = mapped.filter((c) => VOWELS.has(c) || /\p{L}/u.test(c)).length;
  let extra = letters >= 3 ? Math.ceil(letters * EXTRA) : 0;
  let out = '';
  for (const c of mapped) {
    out += c;
    if (extra > 0 && VOWELS.has(c)) {
      out += c;
      extra--;
    }
  }
  // Ünlüsü az metinlerde kalan uzatma sona eklenir.
  return out + 'ˑ'.repeat(extra);
}

const TAG = /<\/?[a-zA-Z][\w-]*\s*\/?>/y;

/** Bir ICU şablonunu sözde dile çevirir (`[!! … !!]` ile sarılı). */
export function pseudoMessage(message: string): string {
  let i = 0;

  /** `inPlural` iken `#` olduğu gibi kalır. Kapanış `}` görülünce durur (tüketmez). */
  function run(inPlural: boolean): string {
    let out = '';
    let text = '';
    const flush = () => {
      if (text) out += styleText(text);
      text = '';
    };
    while (i < message.length) {
      const ch = message[i]!;
      if (ch === '}') break;
      if (ch === '{') {
        flush();
        out += argument(inPlural);
        continue;
      }
      if (ch === '#' && inPlural) {
        flush();
        out += '#';
        i++;
        continue;
      }
      if (ch === "'") {
        const next = message[i + 1];
        if (next === "'") {
          flush();
          out += "''";
          i += 2;
          continue;
        }
        if (next === '{' || next === '}' || (next === '#' && inPlural)) {
          const end = message.indexOf("'", i + 1);
          if (end >= 0) {
            flush();
            out += message.slice(i, end + 1);
            i = end + 1;
            continue;
          }
        }
      }
      if (ch === '<') {
        TAG.lastIndex = i;
        const tag = TAG.exec(message);
        if (tag) {
          flush();
          out += tag[0];
          i += tag[0].length;
          continue;
        }
      }
      text += ch;
      i++;
    }
    flush();
    return out;
  }

  /** `{ad}`, `{n, number}` olduğu gibi; `plural`/`select` başlığı ve seçici adları olduğu gibi, seçenek gövdeleri çevrilir. */
  function argument(inPlural: boolean): string {
    let out = '{';
    i++;
    while (i < message.length) {
      const ch = message[i]!;
      i++;
      out += ch;
      if (ch === '}') return out;
      if (ch === '{') {
        out += run(inPlural || /,\s*plural\s*,/.test(out));
        if (message[i] === '}') {
          out += '}';
          i++;
        }
      }
    }
    return out;
  }

  return `[!! ${run(false)} !!]`;
}

const memo = new Map<string, string>();

/** `formatMessage` ayrıştırma önbelleğini şişirmemek için şablon başına bir kez dönüştürülür. */
function memoizedPseudo(message: string): string {
  let result = memo.get(message);
  if (result === undefined) memo.set(message, (result = pseudoMessage(message)));
  return result;
}

/** Sözde dile geçer: İngilizce yüklenir, sonra web ve core şablonları dönüşümden geçer (sunucuya hiçbir şey yazılmaz). */
export async function setPseudoLanguage(): Promise<void> {
  await setLanguage('en', { explicit: false });
  applyPseudoTransform(memoizedPseudo);
}
