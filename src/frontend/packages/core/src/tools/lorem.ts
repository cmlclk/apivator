import { msg } from '../i18n';
import { ToolError } from './errors';
import { bufferedRandomInt } from './authHelpers';
import { seededRandom } from './jsonSchemaSample';

/** Yer tutucu metin üreteci: klasik Latince "Lorem ipsum" ya da gerçek Türkçe kelimeler. */

export type LoremUnit = 'words' | 'sentences' | 'paragraphs';
export type LoremLanguage = 'latin' | 'tr';

export interface LoremOptions {
  unit: LoremUnit;
  count: number;
  language?: LoremLanguage;
  /** "Lorem ipsum dolor sit amet…" ile başlar. */
  classicStart?: boolean;
  /** Paragraflar `<p>` içinde (birim kelime/cümle ise tek `<p>`). */
  html?: boolean;
  /** Verilirse aynı tohum aynı metni üretir; yoksa kriptografik rastgele. */
  seed?: number;
}

export const LOREM_MAX_COUNT: Record<LoremUnit, number> = { words: 10000, sentences: 2000, paragraphs: 500 };

const CLASSIC_START = 'lorem ipsum dolor sit amet consectetur adipiscing elit'.split(' ');

const LATIN = (
  'a ac accumsan ad aenean aliquam aliquet amet ante arcu at auctor augue bibendum blandit commodo ' +
  'condimentum congue consequat convallis cras curabitur cursus dapibus diam dictum dignissim donec dui duis ' +
  'efficitur egestas eget eleifend elementum enim erat eros est et etiam eu euismod ex facilisis fames ' +
  'faucibus felis fermentum feugiat finibus fringilla fusce gravida habitant hendrerit iaculis id imperdiet ' +
  'in integer interdum ipsum justo lacinia lacus laoreet lectus leo libero ligula lobortis lorem luctus ' +
  'maecenas magna malesuada massa mattis mauris maximus metus mi molestie mollis morbi nam nec neque netus ' +
  'nibh nisi nisl non nulla nullam nunc odio orci ornare pellentesque pharetra phasellus placerat porta ' +
  'porttitor posuere praesent pretium proin pulvinar purus quam quis quisque rhoncus risus rutrum sagittis ' +
  'sapien scelerisque sed sem semper senectus sit sodales sollicitudin suscipit suspendisse tellus tempor ' +
  'tempus tincidunt tortor tristique turpis ullamcorper ultrices ultricies urna ut varius vehicula vel velit ' +
  'venenatis vestibulum vitae vivamus viverra volutpat vulputate'
).split(' ');

/*
 * Gerçek Türkçe kelimeler. Cümle sözcüklerden kurulur ve çekimli bir fiille biter (Türkçede yüklem sondadır);
 * anlamlı değildir ama her kelime gerçek ve yazımı doğrudur.
 */
export const TR_WORDS = (
  've ile ama için gibi kadar daha çok az her bu şu bir iki üç yeni eski büyük küçük uzun kısa güzel hızlı ' +
  'yavaş kolay zor önemli genel özel temel ilk son açık kapalı sessiz sıcak soğuk derin geniş sade doğru ' +
  'farklı aynı yakın uzak bugün yarın şimdi sonra önce artık hâlâ yine bazen sık sık birlikte ayrıca ' +
  'özellikle gerçekten belki elbette kısaca sabah akşam gece hafta ay yıl zaman gün saat dakika dünya ülke ' +
  'şehir köy ev oda kapı pencere masa kitap defter kalem sayfa mektup haber dergi gazete resim müzik şarkı ' +
  'film oyun deniz göl nehir dağ orman ağaç çiçek yaprak bahçe yol köprü sokak cadde meydan pazar çarşı ' +
  'okul öğrenci öğretmen ders sınav soru cevap konu fikir düşünce bilgi deneme çalışma proje plan karar ' +
  'sonuç neden amaç yöntem örnek ayrıntı bölüm parça bütün grup ekip arkadaş aile çocuk insan kişi halk ' +
  'toplum kültür tarih sanat bilim teknik dil kelime cümle metin hikâye anı yolculuk tatil hava güneş ' +
  'yağmur rüzgâr bulut kar ışık renk ses koku tat su ekmek çay kahve sofra yemek başarı umut sevgi dostluk ' +
  'merak sabır emek değer güven huzur özgürlük mutluluk sorumluluk içinde üzerinde yanında karşısında ' +
  'arasında boyunca sırasında sayesinde rağmen göre doğru kendi bütün birçok bazı hiçbir böyle şöyle'
).split(' ');
export const TR_VERBS = (
  'geliyor gidiyor başlıyor bitiyor görünüyor değişiyor büyüyor ilerliyor yaklaşıyor bekliyor anlatıyor ' +
  'düşünüyor biliyor seviyor arıyor buluyor yazıyor okuyor çalışıyor hazırlanıyor kalıyor dönüyor geçiyor ' +
  'oluyor yapılıyor söyleniyor geldi gitti başladı bitti değişti kaldı buldu yazdı okudu yaptı gördü ' +
  'anlattı tamamlandı açıldı kapandı yenilendi gelecek gidecek başlayacak sürecek kalacak olacak ' +
  'yapılacak gerekiyor yeterli mümkün önemli güzeldir doğrudur vardır yoktur'
).split(' ');

type Pick = (n: number) => number;

function picker(seed: number | undefined): Pick {
  if (seed === undefined) return bufferedRandomInt();
  const next = seededRandom(seed);
  return (n) => Math.floor(next() * n);
}

/** [min, max] aralığında tamsayı. */
const between = (pick: Pick, min: number, max: number) => min + pick(max - min + 1);

function capitalize(text: string, language: LoremLanguage): string {
  return text.charAt(0).toLocaleUpperCase(language === 'tr' ? 'tr-TR' : 'en-US') + text.slice(1);
}

/** Yer tutucu metin üretir. */
export function generateLorem(options: LoremOptions): string {
  const { unit, count, language = 'latin', classicStart = false, html = false, seed } = options;
  if (!Number.isInteger(count) || count < 1 || count > LOREM_MAX_COUNT[unit]) {
    throw new ToolError(
      msg('toolsMisc.lorem.count', 'Adet 1–{max} arasında olmalı.', { max: String(LOREM_MAX_COUNT[unit]) }),
    );
  }
  const pick = picker(seed);
  const start = classicStart ? [...CLASSIC_START] : [];
  const word = () =>
    start.shift() ?? (language === 'tr' ? TR_WORDS[pick(TR_WORDS.length)]! : LATIN[pick(LATIN.length)]!);
  // Türkçe cümle yüklemle biter.
  const last = () => (language === 'tr' && !start.length ? TR_VERBS[pick(TR_VERBS.length)]! : word());

  const sentence = () => {
    const length = between(pick, 5, 14);
    // Bu cümleye düşen klasik başlangıç kelimeleri; virgül "Lorem ipsum dolor sit amet" kalıbını bozmaz.
    const fixed = Math.max(0, Math.min(start.length, length) - 1);
    const words = [...Array.from({ length: length - 1 }, word), last()];
    // Uzun cümlelerin ortasına bazen virgül.
    if (length > 7 && pick(2) === 0) {
      const at = between(pick, 2, length - 3);
      if (at >= fixed) words[at] += ',';
    }
    return `${capitalize(words.join(' '), language)}.`;
  };
  const paragraph = () => Array.from({ length: between(pick, 3, 7) }, sentence).join(' ');

  let paragraphs: string[];
  if (unit === 'words') paragraphs = [capitalize(Array.from({ length: count }, word).join(' '), language)];
  else if (unit === 'sentences') paragraphs = [Array.from({ length: count }, sentence).join(' ')];
  else paragraphs = Array.from({ length: count }, paragraph);

  // Metin yalnızca yukarıdaki sabit harflerden oluşur; HTML'de kaçırılacak karakter yoktur.
  return html ? paragraphs.map((p) => `<p>${p}</p>`).join('\n') : paragraphs.join('\n\n');
}
