// Sahte veri üretecinin Türkçe veri kümesi (fakeData.ts). Gerçek kişi/şirket listesi değildir; yaygın adlar ve kalıplar.
import type { FakeCity, FakeLocaleData } from './fakeData';

const MALE = `Ahmet Mehmet Mustafa Ali Hüseyin Hasan İbrahim İsmail Osman Yusuf Murat Ömer Ramazan Halil Süleyman
Abdullah Mahmut Recep Kemal Emre Burak Can Cem Deniz Eren Kerem Barış Serkan Onur Tolga Volkan Oğuz Uğur Kaan Arda
Efe Mert Berk Emir Yiğit Furkan Enes Selim Tarık Levent Sinan Gökhan Erkan Cengiz Orhan Batuhan Alper Koray`;

const FEMALE = `Ayşe Fatma Emine Hatice Zeynep Elif Meryem Şerife Zehra Sultan Hanife Merve Esra Büşra Özlem Selin Ece
Derya Gizem Pınar Seda Melike Burcu Ebru Aslı Gül Nur Defne Ela Duru Asya İrem Cansu Yasemin Sibel Tuğba Damla Gamze
Nazlı Ceren Dilek Sevgi Aylin Neslihan Şeyma Hande Melis Buse İpek Beren Ezgi Çağla`;

const SURNAMES = `Yılmaz Kaya Demir Şahin Çelik Yıldız Yıldırım Öztürk Aydın Özdemir Arslan Doğan Kılıç Aslan Çetin Kara
Koç Kurt Özkan Şimşek Polat Özcan Korkmaz Çakır Erdoğan Yavuz Can Acar Şen Aktaş Güler Yalçın Güneş Bozkurt Bulut
Keskin Ünal Turan Gül Özer Işık Kaplan Avcı Sarı Tekin Taş Köse Yüksel Ateş Aksoy Uçar Karakaya Erdem Kocabaş Altun
Duman Toprak Akın Tunç Uysal Bayram Karaca Sönmez Ekinci Coşkun Çiftçi Başaran Er Aydemir Güven`;

/** 81 il, plaka sırasıyla; posta kodunun ilk iki hanesi plaka kodudur. İlçeler yalnızca bir alt kümedir. */
const CITIES = `Adana:Seyhan,Çukurova,Yüreğir,Ceyhan,Kozan
Adıyaman:Merkez,Kahta,Besni
Afyonkarahisar:Merkez,Sandıklı,Dinar
Ağrı:Merkez,Patnos,Doğubayazıt
Amasya:Merkez,Merzifon,Suluova
Ankara:Çankaya,Keçiören,Yenimahalle,Mamak,Etimesgut,Sincan
Antalya:Muratpaşa,Konyaaltı,Kepez,Alanya,Manavgat
Artvin:Merkez,Hopa,Arhavi
Aydın:Efeler,Nazilli,Söke,Kuşadası
Balıkesir:Altıeylül,Karesi,Bandırma,Edremit
Bilecik:Merkez,Bozüyük,Osmaneli
Bingöl:Merkez,Genç,Solhan
Bitlis:Merkez,Tatvan,Ahlat
Bolu:Merkez,Gerede,Mudurnu
Burdur:Merkez,Bucak,Gölhisar
Bursa:Osmangazi,Nilüfer,Yıldırım,İnegöl,Mudanya
Çanakkale:Merkez,Biga,Çan,Gelibolu
Çankırı:Merkez,Çerkeş,Ilgaz
Çorum:Merkez,Sungurlu,Osmancık
Denizli:Merkezefendi,Pamukkale,Çivril
Diyarbakır:Bağlar,Kayapınar,Yenişehir,Sur
Edirne:Merkez,Keşan,Uzunköprü
Elazığ:Merkez,Kovancılar,Karakoçan
Erzincan:Merkez,Tercan,Üzümlü
Erzurum:Yakutiye,Palandöken,Aziziye
Eskişehir:Odunpazarı,Tepebaşı,Sivrihisar
Gaziantep:Şahinbey,Şehitkamil,Nizip
Giresun:Merkez,Bulancak,Espiye
Gümüşhane:Merkez,Kelkit,Şiran
Hakkari:Merkez,Yüksekova,Şemdinli
Hatay:Antakya,İskenderun,Defne,Dörtyol
Isparta:Merkez,Eğirdir,Yalvaç
Mersin:Yenişehir,Mezitli,Toroslar,Akdeniz,Tarsus
İstanbul:Kadıköy,Beşiktaş,Üsküdar,Şişli,Bakırköy,Ataşehir,Beylikdüzü,Fatih
İzmir:Konak,Karşıyaka,Bornova,Buca,Çiğli
Kars:Merkez,Sarıkamış,Kağızman
Kastamonu:Merkez,Tosya,Taşköprü
Kayseri:Melikgazi,Kocasinan,Talas
Kırklareli:Merkez,Lüleburgaz,Babaeski
Kırşehir:Merkez,Kaman,Mucur
Kocaeli:İzmit,Gebze,Gölcük,Derince
Konya:Selçuklu,Meram,Karatay,Ereğli
Kütahya:Merkez,Tavşanlı,Simav
Malatya:Battalgazi,Yeşilyurt,Darende
Manisa:Şehzadeler,Yunusemre,Akhisar,Turgutlu
Kahramanmaraş:Onikişubat,Dulkadiroğlu,Elbistan
Mardin:Artuklu,Kızıltepe,Midyat
Muğla:Menteşe,Bodrum,Fethiye,Marmaris
Muş:Merkez,Bulanık,Malazgirt
Nevşehir:Merkez,Ürgüp,Avanos
Niğde:Merkez,Bor,Ulukışla
Ordu:Altınordu,Ünye,Fatsa
Rize:Merkez,Çayeli,Ardeşen
Sakarya:Adapazarı,Serdivan,Erenler,Hendek
Samsun:İlkadım,Atakum,Canik,Bafra
Siirt:Merkez,Kurtalan,Pervari
Sinop:Merkez,Boyabat,Gerze
Sivas:Merkez,Şarkışla,Zara
Tekirdağ:Süleymanpaşa,Çorlu,Çerkezköy
Tokat:Merkez,Erbaa,Turhal,Niksar
Trabzon:Ortahisar,Akçaabat,Of,Yomra
Tunceli:Merkez,Pertek,Ovacık
Şanlıurfa:Haliliye,Eyyübiye,Karaköprü,Siverek
Uşak:Merkez,Banaz,Eşme
Van:İpekyolu,Tuşba,Edremit,Erciş
Yozgat:Merkez,Sorgun,Yerköy
Zonguldak:Merkez,Ereğli,Çaycuma
Aksaray:Merkez,Ortaköy,Eskil
Bayburt:Merkez,Demirözü,Aydıntepe
Karaman:Merkez,Ermenek,Ayrancı
Kırıkkale:Merkez,Yahşihan,Keskin
Batman:Merkez,Kozluk,Sason
Şırnak:Merkez,Cizre,Silopi
Bartın:Merkez,Amasra,Ulus
Ardahan:Merkez,Göle,Posof
Iğdır:Merkez,Tuzluca,Aralık
Yalova:Merkez,Çınarcık,Altınova
Karabük:Merkez,Safranbolu,Eskipazar
Kilis:Merkez,Elbeyli,Musabeyli
Osmaniye:Merkez,Kadirli,Düziçi
Düzce:Merkez,Akçakoca,Kaynaşlı`;

const words = (text: string) => text.split(/\s+/).filter(Boolean);
const list = (text: string) =>
  text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export const TR_CITIES: readonly FakeCity[] = CITIES.split('\n').map((line, index) => {
  const [name, districts] = line.split(':');
  return { name: name!, districts: list(districts!), postalPrefix: String(index + 1).padStart(2, '0') };
});

export const FAKE_DATA_TR: FakeLocaleData = {
  maleNames: words(MALE),
  femaleNames: words(FEMALE),
  lastNames: words(SURNAMES),
  cities: TR_CITIES,
  neighborhoods: list(
    'Atatürk, Cumhuriyet, Yeni, Fatih, Bahçelievler, Gazi, Yıldız, Hürriyet, Mimar Sinan, Barbaros, İstiklal, ' +
      'Kültür, Esentepe, Güzelyalı, Çamlık, Yenidoğan, Merkez, Zafer, Karşıyaka, Pınarbaşı, Mevlana, Yunus Emre',
  ),
  streets: list(
    'Lale, Gül, Menekşe, Çınar, Papatya, İnönü, Akasya, Zambak, Ihlamur, Söğüt, Defne, Nergis, Begonya, ' +
      'Manolya, Karanfil, Sümbül, Kardelen, Çiğdem, Ladin, Meşe, Güneş, Bahar, Gökkuşağı, Yasemin',
  ),
  streetTypes: ['Sk.', 'Sk.', 'Sk.', 'Cad.', 'Bulvarı'],
  companyWords: list(
    'Anadolu, Ege, Marmara, Akdeniz, Karadeniz, Yıldız, Güneş, Atlas, Doruk, Kuzey, Pınar, Zirve, Umut, Başak, ' +
      'Ufuk, Mavi, Yeşil, Delta, Nova, Kartal, Çınar, Toros',
  ),
  companySectors: list(
    'Gıda, Lojistik, Yazılım, Bilişim, İnşaat, Tekstil, Otomotiv, Enerji, Turizm, Danışmanlık, Mobilya, Kimya, ' +
      'Elektronik, Medikal, Tarım, Ambalaj, Reklam',
  ),
  companySuffixes: ['A.Ş.', 'Ltd. Şti.', 'San. ve Tic. A.Ş.', 'San. ve Tic. Ltd. Şti.'],
  jobTitles: list(
    'Yazılım Geliştirici, Kıdemli Yazılım Mühendisi, Proje Yöneticisi, Muhasebe Uzmanı, İnsan Kaynakları Uzmanı, ' +
      'Satış Temsilcisi, Pazarlama Müdürü, Veri Analisti, Sistem Yöneticisi, Grafik Tasarımcı, Müşteri Temsilcisi, ' +
      'Finans Müdürü, Ürün Yöneticisi, Test Uzmanı, Lojistik Sorumlusu, Avukat, Mimar, Elektrik Mühendisi, ' +
      'Makine Mühendisi, Öğretmen, Hemşire, Eczacı, Satın Alma Uzmanı, Teknik Destek Uzmanı',
  ),
  colorNames: list(
    'kırmızı, yeşil, mavi, sarı, mor, turuncu, siyah, beyaz, pembe, gri, lacivert, kahverengi',
  ),
  words: list(
    'kalem, defter, sepet, kargo, portal, masa, kitap, bulut, deniz, köprü, yaprak, rüzgar, fener, liman, ' +
      'kahve, çay, simit, pusula, anahtar, kapı',
  ),
};
