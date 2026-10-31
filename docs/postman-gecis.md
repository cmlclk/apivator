# Postman'den Apivator'a geçiş rehberi

Bu rehber bir ekibin Postman'deki collection, environment ve CI işlerini Apivator'a taşımasını adım adım
anlatır. Küçük bir ekip için geçiş genellikle yarım günde biter. Önerilen yol: önce bir kişi taşır ve dener,
sonra ekip bir hafta iki aracı birlikte kullanır, en son Postman bırakılır.

## 1. Hazırlık (yönetici, 15 dakika)

1. Apivator'da kayıt olun ve **Hesap menüsü › Ekip ve organizasyonlar** ekranından ekibiniz için bir
   organizasyon oluşturun. Organizasyon "Genel" adlı bir workspace ile gelir.
2. Postman'deki her takım workspace'i için Apivator'da bir workspace açın (ör. "Ödeme", "Mobil"). Rol
   karşılıkları:

   | Postman | Apivator |
   | --- | --- |
   | Admin | Yönetici |
   | Editor | Düzenleyici |
   | Viewer | Görüntüleyici (istek gönderebilir ve yorum yazabilir, değiştiremez) |

   Aynı ekipte çalışanları **Takımlar** sekmesinde bir takımda toplayıp takımı workspace'e eklemek, kişileri
   tek tek eklemekten kolaydır. Takıma katılan biri o workspace'lere kendiliğinden erişir.
3. Ekibi **Üyeler › Kişi davet et** ile e-postayla davet edin. Davet 7 gün geçerlidir ve istenirse doğrudan
   bir workspace'e bağlanabilir.

## 2. Postman'den dışa aktarma

**Hepsi birden (önerilen):** Postman'de **Settings › Data › Export Data** ile collection'ları ve
environment'ları seçin. Postman bir ZIP dosyası hazırlayıp e-postayla gönderir. ZIP'i açın; içinde her
collection ve environment için ayrı JSON dosyaları vardır.

**Tek tek:** Collection'da **⋯ › Export › Collection v2.1**, environment'ta **⋯ › Export**.

Globals için: **Environments › Globals › ⋯ › Export**.

## 3. Apivator'a içe aktarma

Collections panelindeki **içe aktar** düğmesine (↑) basın ve JSON dosyalarını seçin. Birden fazla dosya
birlikte seçilebilir; collection ve environment dosyaları kendiliğinden ayırt edilir. OpenAPI 3 (YAML/JSON)
dosyaları ve tarayıcıdan kaydedilen HAR dosyaları da collection'a dönüştürülür.

Postman'deki WebSocket ve Socket istekleri v2.1 dışa aktarımına girmez; bunları Apivator'da istek türü
**WebSocket** seçerek yeniden oluşturun (URL, header'lar, alt protokoller ve kayıtlı mesajlar). Server-Sent Events
uçları için tür **SSE** seçilir; olaylar geldikçe listelenir.

Neler aktarılır:

- Klasör yapısı, sırası, açıklamalar (Markdown)
- İstekler: method, URL, query ve path parametreleri, header'lar, body (raw, form-data, x-www-form-urlencoded,
  binary, GraphQL)
- Yetkilendirme: API Key, Bearer, Basic, Digest, OAuth 2.0 (authorization code + PKCE, client credentials,
  password), AWS Signature v4, "Inherit auth from parent"
- Pre-request ve test script'leri (collection, klasör ve istek düzeyinde)
- Collection değişkenleri, environment'lar, globals
- Kayıtlı örnek yanıtlar (Examples)

İçe aktarma bitince gösterilen **uyarıları okuyun**. Karşılığı olmayan özellikler atlanır, listede
yazar. En sık görülenler:

| Uyarı | Ne yapmalı |
| --- | --- |
| Dosya alanları yeniden seçilmeli | Postman de dosyanın kendisini dışa aktarmaz. form-data/binary dosyalarını göndermeden önce bir kez seçin. |
| OAuth 2.0 implicit | Authorization code (PKCE) olarak alınır. Çoğu sağlayıcı bunu destekler; sağlayıcıda Apivator'ın yönlendirme adresini tanımlayın. |
| OAuth 1.0, Hawk, NTLM, Akamai EdgeGrid | Henüz desteklenmiyor. İstek yetkilendirmesiz alınır; gerekiyorsa header'ı pre-request script'inde kurun. |

### Gizli değerler

Postman dışa aktarırken environment'ların **başlangıç (initial) değerlerini** yazar. Kendi bilgisayarınızdaki
güncel (current) değerler dosyaya girmez. Apivator'da da aynı ayrım vardır:

- **Başlangıç değeri** sunucuda saklanır ve ekiple paylaşılır.
- **Güncel değer** yalnızca sizin tarayıcınızda ya da masaüstü uygulamanızda durur. Script'lerin yazdığı
  token'lar buraya gider.

Token ve parola gibi değerleri environment'ta **gizli** olarak işaretleyin ve her kişi kendi güncel değerini
girsin. Gizli değerler ekranda maskelenir.

## 4. Script uyumluluğu

Script'ler çoğu zaman olduğu gibi çalışır. Desteklenenler:

- `pm.test`, `pm.expect` (Chai)
- `pm.response`: `code`, `status`, `json()`, `text()`, `size()`, `reason()`, `headers`, `cookies`, `responseTime`
  ve `to.have.status/header/body/jsonBody/jsonSchema`, `to.be.ok/success/json/accepted/notFound/...`
- `pm.request` (URL, query, method, header ve body değiştirme)
- `pm.environment`, `pm.collectionVariables`, `pm.globals`, `pm.variables`, `pm.iterationData`, `pm.info`,
  `pm.cookies`. Script'in koyduğu sayı/boolean/nesne aynı çalıştırmada tipiyle okunur (`set(7)` → `get() === 7`);
  saklanırken metne çevrilir.
- `pm.sendRequest` (callback, promise ya da `await`; bir script aşamasında en fazla 10 istek)
- `pm.execution.setNextRequest` ve `skipRequest`
- `console.log/info/warn/error`, `setTimeout`
- Eski API: `postman.*`, `tests["..."] = ...`, `responseBody` (ve `responseBody.has(...)`), `responseCode`,
  `responseHeaders`, `responseTime`, `environment`, `globals`, `data`, `iteration`, `request`, `xml2Json`
- Kütüphaneler: chai, lodash (`_`), crypto-js (`CryptoJS`), moment, tv4, uuid, `atob`, `btoa`
- Dinamik değişkenler: `{{$guid}}`, `{{$timestamp}}`, `{{$isoTimestamp}}`, `{{$randomInt}}`, `{{$randomEmail}}`,
  `{{$randomFirstName}}`, `{{$randomFullName}}` ve benzerleri (tam liste `compat/README.md`'de)

Henüz olmayanlar ve yerine yapılacaklar:

| Postman | Apivator'da |
| --- | --- |
| `pm.cookies.jar()` (cookie kavanozu) | Yanıt cookie'leri `pm.cookies` / `pm.response.cookies` ile okunur; sonraki isteğe header olarak verin. |
| `pm.vault` | Gizli işaretli environment değişkenleri kullanın. |
| `pm.visualizer` | Yok. Yanıtlar yanıt panelinde ve konsolda görüntülenir. |
| `require('cheerio' / 'ajv' / 'xml2js' / 'csv-parse')` | Yok. XML için `xml2Json`, şema için `pm.response.to.have.jsonSchema` (draft-04) kullanın. |
| `setInterval` | Yok; `setTimeout` var. |

**Kendi collection'larınızı taratın:** Postman'den dışa aktardığınız collection'ları depodaki `compat/collections/`
klasörüne koyup uyumluluk testlerini çalıştırın. Her script çalıştırılır; söz dizimi hatası ya da desteklenmeyen
bir API kullanan script'ler istek yoluyla listelenir. Ayrıntılar ve vaka ekleme: `compat/README.md`.

Bir script hata verirse yanıt panelindeki **Konsol** hatanın satırını gösterir.

## 5. Collection runner

Runner (collection'da **⋯ › Çalıştır**) Postman'deki gibi çalışır: iterasyon, istekler arası gecikme, CSV/JSON
veri dosyası, `setNextRequest` ve sonuç raporu. Raporlar workspace'te saklanır ve ekip görür.

Web arayüzünden çalıştırılan runner istekleri sunucudan atar. `localhost` ya da şirket içi adreslere gidecek
çalıştırmalar için masaüstü uygulamasını kullanın. Masaüstünde runner sizin bilgisayarınızda çalışır ve rapor
yine sunucuya kaydedilir.

## 6. Newman'dan `apivator` CLI'a

CI'daki newman adımları `apivator run` ile değiştirilir. Seçenekler bilerek newman'a benzetildi:

| newman | apivator |
| --- | --- |
| `newman run koleksiyon.json` | `apivator run koleksiyon.json` (dosyadan) ya da `apivator run "Ödeme API"` (sunucudan, aşağıya bakın) |
| `-e env.json` | `-e env.json` ya da `-e "Test"` (sunucudaki environment adı) |
| `-g globals.json` | `-g globals.json` (sunucudan çalıştırırken workspace globals'ı kendiliğinden kullanılır) |
| `-d veri.csv`, `-n 5` | `-d veri.csv`, `-n 5` |
| `--folder "Ad"` | `--folder "Ad"` |
| `--delay-request 200` | `--delay-request 200` |
| `--bail` | `--bail` |
| `--env-var "k=v"`, `--global-var "k=v"` | aynı |
| `--timeout-request 5000` | aynı |
| `-k`, `--insecure` | aynı; şirket CA'sı için ayrıca `--ca-cert sirket-ca.pem` |
| `-r cli,junit --reporter-junit-export out.xml` | aynı; ayrıca `json` ve `html` |
| `--suppress-exit-code` | aynı |

En önemli fark: collection'ı repoda JSON olarak tutmak zorunda değilsiniz. Kişisel API anahtarıyla
doğrudan Apivator'daki güncel hâli çalıştırılır ve sonuç runner geçmişine "CLI'dan" etiketiyle düşer:

```bash
export APIVATOR_SERVER=https://apivator.sirket.com
export APIVATOR_API_KEY=apv_...      # Hesap menüsü › API anahtarları (CLI)
apivator run "Ödeme API" -e "Test" -r cli,junit --reporter-junit-export reports/api.xml
```

Hazır örnekler: [`docs/ci/github-actions.yml`](ci/github-actions.yml),
[`docs/ci/azure-pipelines.yml`](ci/azure-pipelines.yml). Kurulum ve tüm seçenekler:
[`src/backend/src/Apivator.Cli/README.md`](../src/backend/src/Apivator.Cli/README.md).

## 7. Ekipçe çalışma alışkanlıkları

Postman'deki karşılıkları:

- **Değişiklik geçmişi:** İstekte **Sürümler** kim, ne zaman, neyi değiştirdi gösterir; tek tıkla eski sürüme
  dönülür. Workspace'teki tüm değişiklikler kenar çubuğundaki **Aktivite** bölümünde listelenir; silinen bir
  istek oradan geri getirilir.
- **Yorumlar:** İstek ve collection üzerinde yorum yazılır, `@` ile kişi etiketlenir. Etiketlenen kişiye
  bildirim ve e-posta gider.
- **Canlı çalışma:** Ekip arkadaşınızın kaydettiği değişiklik sayfayı yenilemeden size gelir. Aynı isteği
  ikiniz birden düzenliyorsanız Apivator farkı gösterir ve hangisinin kalacağını size sorar; kimsenin işi
  sessizce ezilmez.
- **Mock server:** Kenar çubuğundaki **Mock'lar** bölümünden (ya da collection menüsünden **Mock oluştur**)
  collection'ın örnek yanıtlarını bir adreste sunun. Eşleştirme Postman'deki gibidir; `x-mock-response-code`,
  `x-mock-response-name`, `x-mock-response-id`, `x-mock-match-request-body` ve `x-mock-match-request-headers`
  header'ları aynı şekilde çalışır. Gizli mock'ta Postman'deki gibi `x-api-key` header'ı kullanılır (anahtar
  Apivator API anahtarıdır). Uygulamanızdaki mock adresini Apivator'daki yeni adresle değiştirmeniz yeterlidir.
- **Monitör:** Kenar çubuğundaki **Monitörler** bölümünden (ya da collection menüsünden **Monitör oluştur**)
  collection'ı zamanlanmış olarak çalıştırın (hazır sıklıklar ya da cron, saat dilimiyle). Bir test kalınca ya da
  istek yanıt alamayınca e-posta, Slack, Teams ya da kendi webhook'unuza bildirim gider; düzelince de haber
  verilir. Postman'deki gibi environment'ın paylaşılan (başlangıç) değerleri kullanılır: monitörün ihtiyaç duyduğu
  token'ları environment'ta başlangıç değeri olarak tanımlayın ya da pre-request script'inde alın.
- **Fork ve merge:** Collection menüsünden **Fork'la**; fork'un yanındaki simgeden (ya da **Kaynakla karşılaştır**)
  kaynaktaki değişiklikleri çekin ve **Merge isteği aç** ile önerin. İstekler kenar çubuğundaki **Merge'ler**
  bölümünde yorumlanır, onaylanır ve birleştirilir. Postman'deki gibi çakışmalarda fork'u güncelleyip hangi hâlin
  kalacağını siz seçersiniz.
- **API tanımı:** Postman'deki "collection'dan API şeması üretme" yerine collection menüsünden **Dışa aktar (OpenAPI
  JSON / YAML)** kullanılır; çıktı Swagger UI, kod üreticiler ve API ağ geçitleriyle kullanılabilir.

## Geçiş kontrol listesi

- [ ] Organizasyon, workspace'ler ve takımlar kuruldu; ekip davet edildi
- [ ] Tüm collection'lar ve environment'lar içe aktarıldı, uyarılar gözden geçirildi
- [ ] Gizli değerler gizli olarak işaretlendi; her kişi kendi güncel değerlerini girdi
- [ ] Her collection runner'da bir kez çalıştırıldı, sonuçlar Postman'deki sonuçlarla karşılaştırıldı
- [ ] localhost/iç ağ kullananlar masaüstü uygulamasını kurdu
- [ ] CI'daki newman adımları `apivator run` ile değiştirildi; her iş için ayrı API anahtarı oluşturuldu
- [ ] Ekip bir hafta yalnızca Apivator'la çalıştı; eksik görülenler not edildi
- [ ] Postman workspace'leri arşivlendi (silmeden önce son bir dışa aktarma alındı)
