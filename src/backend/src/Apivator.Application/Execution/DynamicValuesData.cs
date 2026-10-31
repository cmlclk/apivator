namespace Apivator.Application.Execution;

/// <summary>
/// Dinamik değişkenlerin Türkçe veri kümesi. İstemcideki packages/core/src/tools/fakeDataTr.ts ile aynıdır
/// (istemci dinamik değişkenleri her zaman Türkçe yerel ayarla üretir). Gerçek kişi/şirket listesi değildir.
/// </summary>
internal static class DynamicValuesData
{
    internal sealed record City(string Name, string PostalPrefix, string[] Districts);

    public static readonly string[] MaleNames =
    [
        "Ahmet", "Mehmet", "Mustafa", "Ali", "Hüseyin", "Hasan", "İbrahim", "İsmail", "Osman", "Yusuf",
        "Murat", "Ömer", "Ramazan", "Halil", "Süleyman", "Abdullah", "Mahmut", "Recep", "Kemal", "Emre",
        "Burak", "Can", "Cem", "Deniz", "Eren", "Kerem", "Barış", "Serkan", "Onur", "Tolga", "Volkan",
        "Oğuz", "Uğur", "Kaan", "Arda", "Efe", "Mert", "Berk", "Emir", "Yiğit", "Furkan", "Enes", "Selim",
        "Tarık", "Levent", "Sinan", "Gökhan", "Erkan", "Cengiz", "Orhan", "Batuhan", "Alper", "Koray",
    ];

    public static readonly string[] FemaleNames =
    [
        "Ayşe", "Fatma", "Emine", "Hatice", "Zeynep", "Elif", "Meryem", "Şerife", "Zehra", "Sultan",
        "Hanife", "Merve", "Esra", "Büşra", "Özlem", "Selin", "Ece", "Derya", "Gizem", "Pınar", "Seda",
        "Melike", "Burcu", "Ebru", "Aslı", "Gül", "Nur", "Defne", "Ela", "Duru", "Asya", "İrem", "Cansu",
        "Yasemin", "Sibel", "Tuğba", "Damla", "Gamze", "Nazlı", "Ceren", "Dilek", "Sevgi", "Aylin",
        "Neslihan", "Şeyma", "Hande", "Melis", "Buse", "İpek", "Beren", "Ezgi", "Çağla",
    ];

    public static readonly string[] LastNames =
    [
        "Yılmaz", "Kaya", "Demir", "Şahin", "Çelik", "Yıldız", "Yıldırım", "Öztürk", "Aydın", "Özdemir",
        "Arslan", "Doğan", "Kılıç", "Aslan", "Çetin", "Kara", "Koç", "Kurt", "Özkan", "Şimşek", "Polat",
        "Özcan", "Korkmaz", "Çakır", "Erdoğan", "Yavuz", "Can", "Acar", "Şen", "Aktaş", "Güler", "Yalçın",
        "Güneş", "Bozkurt", "Bulut", "Keskin", "Ünal", "Turan", "Gül", "Özer", "Işık", "Kaplan", "Avcı",
        "Sarı", "Tekin", "Taş", "Köse", "Yüksel", "Ateş", "Aksoy", "Uçar", "Karakaya", "Erdem", "Kocabaş",
        "Altun", "Duman", "Toprak", "Akın", "Tunç", "Uysal", "Bayram", "Karaca", "Sönmez", "Ekinci",
        "Coşkun", "Çiftçi", "Başaran", "Er", "Aydemir", "Güven",
    ];

    /// <summary>81 il, plaka sırasıyla; posta kodunun ilk iki hanesi plaka kodudur. İlçeler yalnızca bir alt kümedir.</summary>
    public static readonly City[] Cities =
    [
        new("Adana", "01", ["Seyhan", "Çukurova", "Yüreğir", "Ceyhan", "Kozan"]),
        new("Adıyaman", "02", ["Merkez", "Kahta", "Besni"]),
        new("Afyonkarahisar", "03", ["Merkez", "Sandıklı", "Dinar"]),
        new("Ağrı", "04", ["Merkez", "Patnos", "Doğubayazıt"]),
        new("Amasya", "05", ["Merkez", "Merzifon", "Suluova"]),
        new("Ankara", "06", ["Çankaya", "Keçiören", "Yenimahalle", "Mamak", "Etimesgut", "Sincan"]),
        new("Antalya", "07", ["Muratpaşa", "Konyaaltı", "Kepez", "Alanya", "Manavgat"]),
        new("Artvin", "08", ["Merkez", "Hopa", "Arhavi"]),
        new("Aydın", "09", ["Efeler", "Nazilli", "Söke", "Kuşadası"]),
        new("Balıkesir", "10", ["Altıeylül", "Karesi", "Bandırma", "Edremit"]),
        new("Bilecik", "11", ["Merkez", "Bozüyük", "Osmaneli"]),
        new("Bingöl", "12", ["Merkez", "Genç", "Solhan"]),
        new("Bitlis", "13", ["Merkez", "Tatvan", "Ahlat"]),
        new("Bolu", "14", ["Merkez", "Gerede", "Mudurnu"]),
        new("Burdur", "15", ["Merkez", "Bucak", "Gölhisar"]),
        new("Bursa", "16", ["Osmangazi", "Nilüfer", "Yıldırım", "İnegöl", "Mudanya"]),
        new("Çanakkale", "17", ["Merkez", "Biga", "Çan", "Gelibolu"]),
        new("Çankırı", "18", ["Merkez", "Çerkeş", "Ilgaz"]),
        new("Çorum", "19", ["Merkez", "Sungurlu", "Osmancık"]),
        new("Denizli", "20", ["Merkezefendi", "Pamukkale", "Çivril"]),
        new("Diyarbakır", "21", ["Bağlar", "Kayapınar", "Yenişehir", "Sur"]),
        new("Edirne", "22", ["Merkez", "Keşan", "Uzunköprü"]),
        new("Elazığ", "23", ["Merkez", "Kovancılar", "Karakoçan"]),
        new("Erzincan", "24", ["Merkez", "Tercan", "Üzümlü"]),
        new("Erzurum", "25", ["Yakutiye", "Palandöken", "Aziziye"]),
        new("Eskişehir", "26", ["Odunpazarı", "Tepebaşı", "Sivrihisar"]),
        new("Gaziantep", "27", ["Şahinbey", "Şehitkamil", "Nizip"]),
        new("Giresun", "28", ["Merkez", "Bulancak", "Espiye"]),
        new("Gümüşhane", "29", ["Merkez", "Kelkit", "Şiran"]),
        new("Hakkari", "30", ["Merkez", "Yüksekova", "Şemdinli"]),
        new("Hatay", "31", ["Antakya", "İskenderun", "Defne", "Dörtyol"]),
        new("Isparta", "32", ["Merkez", "Eğirdir", "Yalvaç"]),
        new("Mersin", "33", ["Yenişehir", "Mezitli", "Toroslar", "Akdeniz", "Tarsus"]),
        new("İstanbul", "34", ["Kadıköy", "Beşiktaş", "Üsküdar", "Şişli", "Bakırköy", "Ataşehir", "Beylikdüzü", "Fatih"]),
        new("İzmir", "35", ["Konak", "Karşıyaka", "Bornova", "Buca", "Çiğli"]),
        new("Kars", "36", ["Merkez", "Sarıkamış", "Kağızman"]),
        new("Kastamonu", "37", ["Merkez", "Tosya", "Taşköprü"]),
        new("Kayseri", "38", ["Melikgazi", "Kocasinan", "Talas"]),
        new("Kırklareli", "39", ["Merkez", "Lüleburgaz", "Babaeski"]),
        new("Kırşehir", "40", ["Merkez", "Kaman", "Mucur"]),
        new("Kocaeli", "41", ["İzmit", "Gebze", "Gölcük", "Derince"]),
        new("Konya", "42", ["Selçuklu", "Meram", "Karatay", "Ereğli"]),
        new("Kütahya", "43", ["Merkez", "Tavşanlı", "Simav"]),
        new("Malatya", "44", ["Battalgazi", "Yeşilyurt", "Darende"]),
        new("Manisa", "45", ["Şehzadeler", "Yunusemre", "Akhisar", "Turgutlu"]),
        new("Kahramanmaraş", "46", ["Onikişubat", "Dulkadiroğlu", "Elbistan"]),
        new("Mardin", "47", ["Artuklu", "Kızıltepe", "Midyat"]),
        new("Muğla", "48", ["Menteşe", "Bodrum", "Fethiye", "Marmaris"]),
        new("Muş", "49", ["Merkez", "Bulanık", "Malazgirt"]),
        new("Nevşehir", "50", ["Merkez", "Ürgüp", "Avanos"]),
        new("Niğde", "51", ["Merkez", "Bor", "Ulukışla"]),
        new("Ordu", "52", ["Altınordu", "Ünye", "Fatsa"]),
        new("Rize", "53", ["Merkez", "Çayeli", "Ardeşen"]),
        new("Sakarya", "54", ["Adapazarı", "Serdivan", "Erenler", "Hendek"]),
        new("Samsun", "55", ["İlkadım", "Atakum", "Canik", "Bafra"]),
        new("Siirt", "56", ["Merkez", "Kurtalan", "Pervari"]),
        new("Sinop", "57", ["Merkez", "Boyabat", "Gerze"]),
        new("Sivas", "58", ["Merkez", "Şarkışla", "Zara"]),
        new("Tekirdağ", "59", ["Süleymanpaşa", "Çorlu", "Çerkezköy"]),
        new("Tokat", "60", ["Merkez", "Erbaa", "Turhal", "Niksar"]),
        new("Trabzon", "61", ["Ortahisar", "Akçaabat", "Of", "Yomra"]),
        new("Tunceli", "62", ["Merkez", "Pertek", "Ovacık"]),
        new("Şanlıurfa", "63", ["Haliliye", "Eyyübiye", "Karaköprü", "Siverek"]),
        new("Uşak", "64", ["Merkez", "Banaz", "Eşme"]),
        new("Van", "65", ["İpekyolu", "Tuşba", "Edremit", "Erciş"]),
        new("Yozgat", "66", ["Merkez", "Sorgun", "Yerköy"]),
        new("Zonguldak", "67", ["Merkez", "Ereğli", "Çaycuma"]),
        new("Aksaray", "68", ["Merkez", "Ortaköy", "Eskil"]),
        new("Bayburt", "69", ["Merkez", "Demirözü", "Aydıntepe"]),
        new("Karaman", "70", ["Merkez", "Ermenek", "Ayrancı"]),
        new("Kırıkkale", "71", ["Merkez", "Yahşihan", "Keskin"]),
        new("Batman", "72", ["Merkez", "Kozluk", "Sason"]),
        new("Şırnak", "73", ["Merkez", "Cizre", "Silopi"]),
        new("Bartın", "74", ["Merkez", "Amasra", "Ulus"]),
        new("Ardahan", "75", ["Merkez", "Göle", "Posof"]),
        new("Iğdır", "76", ["Merkez", "Tuzluca", "Aralık"]),
        new("Yalova", "77", ["Merkez", "Çınarcık", "Altınova"]),
        new("Karabük", "78", ["Merkez", "Safranbolu", "Eskipazar"]),
        new("Kilis", "79", ["Merkez", "Elbeyli", "Musabeyli"]),
        new("Osmaniye", "80", ["Merkez", "Kadirli", "Düziçi"]),
        new("Düzce", "81", ["Merkez", "Akçakoca", "Kaynaşlı"]),
    ];

    public static readonly string[] Neighborhoods =
    [
        "Atatürk", "Cumhuriyet", "Yeni", "Fatih", "Bahçelievler", "Gazi", "Yıldız", "Hürriyet",
        "Mimar Sinan", "Barbaros", "İstiklal", "Kültür", "Esentepe", "Güzelyalı", "Çamlık", "Yenidoğan",
        "Merkez", "Zafer", "Karşıyaka", "Pınarbaşı", "Mevlana", "Yunus Emre",
    ];

    public static readonly string[] Streets =
    [
        "Lale", "Gül", "Menekşe", "Çınar", "Papatya", "İnönü", "Akasya", "Zambak", "Ihlamur", "Söğüt",
        "Defne", "Nergis", "Begonya", "Manolya", "Karanfil", "Sümbül", "Kardelen", "Çiğdem", "Ladin", "Meşe",
        "Güneş", "Bahar", "Gökkuşağı", "Yasemin",
    ];

    public static readonly string[] StreetTypes =
    [
        "Sk.", "Sk.", "Sk.", "Cad.", "Bulvarı",
    ];

    public static readonly string[] CompanyWords =
    [
        "Anadolu", "Ege", "Marmara", "Akdeniz", "Karadeniz", "Yıldız", "Güneş", "Atlas", "Doruk", "Kuzey",
        "Pınar", "Zirve", "Umut", "Başak", "Ufuk", "Mavi", "Yeşil", "Delta", "Nova", "Kartal", "Çınar",
        "Toros",
    ];

    public static readonly string[] CompanySectors =
    [
        "Gıda", "Lojistik", "Yazılım", "Bilişim", "İnşaat", "Tekstil", "Otomotiv", "Enerji", "Turizm",
        "Danışmanlık", "Mobilya", "Kimya", "Elektronik", "Medikal", "Tarım", "Ambalaj", "Reklam",
    ];

    public static readonly string[] CompanySuffixes =
    [
        "A.Ş.", "Ltd. Şti.", "San. ve Tic. A.Ş.", "San. ve Tic. Ltd. Şti.",
    ];

    public static readonly string[] JobTitles =
    [
        "Yazılım Geliştirici", "Kıdemli Yazılım Mühendisi", "Proje Yöneticisi", "Muhasebe Uzmanı",
        "İnsan Kaynakları Uzmanı", "Satış Temsilcisi", "Pazarlama Müdürü", "Veri Analisti",
        "Sistem Yöneticisi", "Grafik Tasarımcı", "Müşteri Temsilcisi", "Finans Müdürü", "Ürün Yöneticisi",
        "Test Uzmanı", "Lojistik Sorumlusu", "Avukat", "Mimar", "Elektrik Mühendisi", "Makine Mühendisi",
        "Öğretmen", "Hemşire", "Eczacı", "Satın Alma Uzmanı", "Teknik Destek Uzmanı",
    ];

    public static readonly string[] ColorNames =
    [
        "kırmızı", "yeşil", "mavi", "sarı", "mor", "turuncu", "siyah", "beyaz", "pembe", "gri", "lacivert",
        "kahverengi",
    ];

    public static readonly string[] Words =
    [
        "kalem", "defter", "sepet", "kargo", "portal", "masa", "kitap", "bulut", "deniz", "köprü", "yaprak",
        "rüzgar", "fener", "liman", "kahve", "çay", "simit", "pusula", "anahtar", "kapı",
    ];
}
