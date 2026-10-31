# Apivator CLI

`apivator`, Apivator collection'larını komut satırında ve CI'da çalıştırır. Web ve masaüstüyle aynı motoru
kullanır: script'ler (`pm.*`), değişkenler, yetkilendirme mirası, veri dosyaları ve `setNextRequest` aynı davranır.
Postman'den geçen ekipler için seçenek adları newman'a yakındır.

## Kurulum

.NET 10 SDK gerekir.

```bash
dotnet tool install -g Apivator.Cli          # NuGet'ten (yayınlandıktan sonra)
apivator --version
```

Paket henüz yayınlanmadıysa depodan:

```bash
dotnet pack src/backend/src/Apivator.Cli -c Release -o artifacts
dotnet tool install -g Apivator.Cli --add-source artifacts
```

## Sunucudaki bir collection'ı çalıştırma

1. Apivator'da **Hesap menüsü › API anahtarları (CLI)** bölümünden bir anahtar oluşturun.
   Anahtarla yalnızca okuma ve çalıştırma raporu gönderme yapılabilir.
2. Çalıştırın:

```bash
export APIVATOR_SERVER=https://apivator.sirket.com
export APIVATOR_API_KEY=apv_...
apivator list                                   # erişebildiğiniz workspace ve collection'lar
apivator run "Ödeme API" -e "Test" -r cli,junit
```

Collection ve environment adla ya da kimlikle verilebilir. Aynı ad birden fazla workspace'te varsa
`--workspace` ekleyin. Workspace'in globals'ı kendiliğinden kullanılır. Sonuç Apivator'da runner geçmişine
"CLI'dan" etiketiyle kaydedilir; kaydetmemek için `--no-report` verin.

## Dosyadan çalıştırma

Postman v2.1 ya da Apivator'dan dışa aktarılmış collection, environment ve globals dosyaları:

```bash
apivator run odeme.postman_collection.json -e test.postman_environment.json -d kullanicilar.csv
```

## Seçenekler

| Seçenek | Açıklama |
| --- | --- |
| `-e, --environment <dosya\|ad\|id>` | Environment |
| `-g, --globals <dosya>` | Globals dosyası |
| `-d, --iteration-data <dosya>` | CSV ya da JSON veri dosyası; her satır bir iterasyon |
| `-n, --iteration-count <sayı>` | İterasyon sayısı |
| `--folder <ad>` | Yalnızca bu klasör |
| `--delay-request <ms>` | İstekler arası bekleme |
| `--bail` | İlk başarısız istek ya da testte dur |
| `--env-var anahtar=değer` | Environment değişkeni ekle/ez (tekrarlanabilir; gizli değerler için CI değişkeni kullanın) |
| `--global-var anahtar=değer` | Global değişken ekle/ez |
| `--timeout-request <ms>` | İstek başına zaman aşımı (varsayılan 30000) |
| `-k, --insecure` | SSL sertifikasını doğrulama |
| `--ca-cert <dosya>` | Şirket CA sertifikası (PEM/CRT/DER) |
| `-r, --reporters cli,junit,json,html` | Raporlayıcılar (varsayılan `cli`) |
| `--reporter-junit-export <yol>` | JUnit XML (varsayılan `apivator-report.xml`) |
| `--reporter-json-export <yol>` | JSON (varsayılan `apivator-report.json`) |
| `--reporter-html-export <yol>` | HTML (varsayılan `apivator-report.html`) |
| `--server <url>`, `--api-key <anahtar>` | Sunucu (yerine `APIVATOR_SERVER`, `APIVATOR_API_KEY`) |
| `-w, --workspace <ad\|id>` | Collection'ı bu workspace'te ara |
| `--no-report` | Sonucu sunucuya kaydetme |
| `--suppress-exit-code` | Testler kalsa da 0 ile çık |
| `--verbose` | Script'lerin `console.log` çıktısını da yaz |
| `--lang <tr|en>` | Arayüz dili: yardım, mesajlar ve HTML rapor (varsayılan `APIVATOR_LANG`, o da yoksa işletim sistemi dili, desteklenmiyorsa Türkçe). JSON rapor ve çıkış kodları dilden bağımsızdır |
| `--no-color` | Renksiz çıktı (`NO_COLOR` da geçerli) |

**Çıkış kodları:** `0` başarılı, `1` kalan test, istek hatası (bağlantı, zaman aşımı, script hatası) ya da yarıda
kalan çalıştırma, `2` kullanım, dosya ya da sunucu bağlantısı hatası. 4xx/5xx yanıtlar tek başına başarısızlık
sayılmaz; bunu testleriniz belirler (newman'daki gibi).

İstekler bu makineden gider; CI ajanının erişebildiği iç ağ adresleri de çağrılabilir. Sistem proxy'si
(`HTTPS_PROXY`, `NO_PROXY`) kullanılır.

## CI örnekleri

- GitHub Actions: [`docs/ci/github-actions.yml`](../../../../docs/ci/github-actions.yml)
- Azure DevOps: [`docs/ci/azure-pipelines.yml`](../../../../docs/ci/azure-pipelines.yml)
