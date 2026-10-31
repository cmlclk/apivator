# Apivator

Ekip odaklı, kendi sunucunuzda çalışan bir API geliştirme ve test platformu (Postman alternatifi).
Proje planı ve fazlar: claude.ai'deki **Apivator — Proje Planı** dokümanı.

> **Durum:** Faz 3 tamamlandı. İstek editörü, environment'lar, script'ler (`pm.*`), collection runner, Postman/OpenAPI
> içe aktarma, masaüstü uygulaması (Tauri + yerel ajan), organizasyon/workspace/takım/roller, canlı ortak çalışma
> (SignalR), sürüm geçmişi ve yorumlar, API anahtarları ve `apivator` CLI çalışıyor. Faz 4 tamamlandı: mock server,
> monitörler, fork/merge, WebSocket ve Server-Sent Events istekleri, OpenAPI 3 dışa aktarma ve HAR içe aktarma.
> Ayrıca collection düzeyinde roller, çevrimdışı önbellek, Postman script uyumluluk seti ve masaüstünde şifreli
> güncel değerler geldi. Faz 5.1: gRPC istekleri (reflection ya da `.proto`, unary ve akışlı çağrılar) ve GraphQL
> şema keşfi (introspection, otomatik tamamlama, şema gezgini). Faz 5.2: collection'dan otomatik API dokümantasyonu
> ve organizasyon içi / herkese açık yayın bağlantısı. Faz 6.3: hesap ve profil (profil görseli, ad/e-posta/şifre
> değiştirme, oturumlar, cihazlar arası tercihler, verileri indirme ve hesap silme). Faz 6.1: yanıtı, runner
> sonuçlarını ve geçmişi Excel (.xlsx) ya da CSV olarak kaydetme. Faz 6.2: yanıttan, istek gövdesinden, şemadan
> ve gRPC mesajından C#, Java, Kotlin, TypeScript, Python, Go, Swift, Dart modeli ya da JSON Schema üretme. Faz 6.5:
> Swagger/OpenAPI adresinden (Swagger UI sayfası ya da yalnızca sunucu adresi de olur) içe aktarma, Swagger 2.0 desteği
> ve kaynaktan güncelleme (fark ekranı, otomatik kontrol ve bildirim). Faz 6.4: iki adımlı doğrulama (TOTP + yedek kodlar,
> organizasyonda zorunlu kılma), güvenlik geçmişi, yeni cihaz uyarısı ve yönetici işlemleri. Faz 6 tamamlandı.

| Belge | Ne için |
| --- | --- |
| [docs/kurulum.md](docs/kurulum.md) | Kendi sunucunuza üretim kurulumu (Docker Compose, HTTPS, yedekleme, güncelleme) |
| [docs/postman-gecis.md](docs/postman-gecis.md) | Ekibin Postman'den Apivator'a geçişi |
| [src/backend/src/Apivator.Cli/README.md](src/backend/src/Apivator.Cli/README.md) | `apivator` CLI (newman karşılığı) ve CI örnekleri ([docs/ci](docs/ci)) |
| [src/frontend/apps/desktop/README.md](src/frontend/apps/desktop/README.md) | Masaüstü uygulaması ve yerel ajan |
| [compat/README.md](compat/README.md) | Postman script uyumluluk seti; ekibin collection'larını tarama |
| [docs/fazlar.md](docs/fazlar.md), [docs/proje-plani.md](docs/proje-plani.md) | Proje planı ve fazlar |

Aşağıdakiler **geliştirme** içindir. Ekibiniz için sunucu kuruyorsanız [docs/kurulum.md](docs/kurulum.md)'yi izleyin.

## Hızlı başlangıç (Docker ile her şey)

Gereken: Docker Desktop.

```bash
cp .env.example .env          # Windows PowerShell: Copy-Item .env.example .env
docker compose up -d --build
```

| Adres | Ne |
| --- | --- |
| http://localhost:8080 | Web arayüzü |
| http://localhost:8025 | Mailpit: gönderilen e-postalar (doğrulama, şifre sıfırlama) |

Kayıt olun, Mailpit'teki doğrulama e-postasındaki bağlantıya tıklayın.

## Docker olmadan çalıştırma (Windows)

Docker gerekmez. Tek gereken sunucu PostgreSQL'dir (Redis yalnızca birden fazla API örneği çalıştırırken gerekir). Geliştirme modunda e-postalar
gönderilmez, API terminaline yazılır; doğrulama bağlantısını oradan kopyalarsınız.

**1. Araçları kurun** (PowerShell, bir kez):

```powershell
winget install Microsoft.DotNet.SDK.10
winget install OpenJS.NodeJS.LTS
winget install PostgreSQL.PostgreSQL.16 --interactive   # kurulumda "postgres" kullanıcısına bir şifre belirleyin
npm install -g pnpm
```

Kurulumdan sonra PowerShell'i kapatıp yeniden açın (PATH güncellensin).

**2. Veritabanını oluşturun** (bir kez; `postgres` şifresi sorulur):

```powershell
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -c "CREATE USER apivator WITH PASSWORD 'apivator' CREATEDB;" -c "CREATE DATABASE apivator OWNER apivator;"
```

**3. API'yi başlatın** (birinci terminal) → http://localhost:5080. Tabloları ilk açılışta kendisi oluşturur.

```powershell
cd C:\AI-Project\Apivator\src\backend
dotnet run --project src\Apivator.Api
```

**4. Web arayüzünü başlatın** (ikinci terminal) → http://localhost:5173

```powershell
cd C:\AI-Project\Apivator\src\frontend
pnpm install
pnpm dev
```

**5. Deneyin:** http://localhost:5173 adresinde kayıt olun. API terminalinde `===== E-POSTA` ile başlayan blokta
doğrulama bağlantısı görünür; tarayıcıya yapıştırın.

**Testler:** Entegrasyon testleri Docker yokken boş bir test veritabanıyla çalışır:

```powershell
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -c "CREATE DATABASE apivator_test OWNER apivator;"
cd C:\AI-Project\Apivator\src\backend
$env:APIVATOR_TEST_POSTGRES = "Host=localhost;Database=apivator_test;Username=apivator;Password=apivator"
dotnet test
```

Farklı bir PostgreSQL kullanıyorsanız (başka şifre, port ya da bulutta bir veritabanı) bağlantıyı ortam
değişkeniyle verin: `$env:ConnectionStrings__Postgres = "Host=...;Database=...;Username=...;Password=..."`

## Yerel geliştirme (Docker ile)

Gerekenler: [.NET 10 SDK](https://dotnet.microsoft.com/download), Node.js 22+, pnpm 10 (`corepack enable`), Docker.

```bash
# 1) Altyapı: PostgreSQL, Redis, Mailpit
docker compose up -d postgres redis mailpit

# 2) API  →  http://localhost:5080   (açılışta migration'ları kendisi uygular)
cd src/backend
dotnet run --project src/Apivator.Api

# 3) Web  →  http://localhost:5173   (/api isteklerini 5080'e yönlendirir)
cd src/frontend
pnpm install
pnpm dev
```

API uçlarını denemek için `src/backend/src/Apivator.Api/Apivator.Api.http` dosyası (VS Code REST Client / Rider / Visual Studio).
Geliştirme ortamında OpenAPI şeması: http://localhost:5080/openapi/v1.json

## Testler

```bash
# Backend: domain birim testleri + gerçek PostgreSQL ile entegrasyon testleri (Testcontainers, Docker gerekir)
cd src/backend && dotnet test

# Docker yoksa: boş bir PostgreSQL veritabanı verin (test başında sıfırlanır)
APIVATOR_TEST_POSTGRES="Host=localhost;Database=apivator_test;Username=apivator;Password=apivator" dotnet test

# Yalnızca Postman script uyumluluk seti (compat/)
dotnet test tests/Apivator.Api.IntegrationTests --filter "FullyQualifiedName~CompatibilityTests"

# Frontend: birim + bileşen testleri, lint, tip kontrolü (pnpm -s kullanmayın: alt paketin hatasını gizler)
cd src/frontend && pnpm test && pnpm lint && pnpm typecheck
```

## Proje yapısı

```
.github/workflows/ci.yml        CI: build, lint, test, Docker imajları (ghcr.io)
docker-compose.yml              Geliştirme: Postgres, Redis, Mailpit, API, Web
deploy/                         Üretim: Compose, Caddy (HTTPS), yedekleme/geri yükleme betikleri
docs/                           Kurulum, Postman geçişi, CI örnekleri, proje planı
src/backend/                    .NET 10, Clean Architecture
  src/Apivator.Domain/          Varlıklar (bağımlılıksız)
  src/Apivator.Application/     Kullanım senaryoları, içe aktarma, runner motoru, Result tipi
  src/Apivator.Infrastructure/  EF Core + PostgreSQL, Identity, JWT, SMTP, istek yürütme, script sandbox'ı
  src/Apivator.Api/             Minimal API uçları, SignalR hub'ı, kimlik doğrulama (JWT + API anahtarı)
  src/Apivator.Agent/           Masaüstü uygulamasının yerel ajanı (istekleri kullanıcının makinesinden atar)
  src/Apivator.Cli/             `apivator` komut satırı aracı (.NET tool)
  tests/                        Domain.Tests, Api.IntegrationTests
src/frontend/                   pnpm workspace, React 19 + Vite + Tailwind 4
  apps/web/                     Web uygulaması
  apps/desktop/                 Tauri masaüstü kabuğu (web uygulamasını sarar)
  packages/core/                API istemcisi ve tipler
  packages/ui/                  Ortak UI bileşenleri
```

## İstekler nasıl gönderilir

Web arayüzünden gönderilen istekler tarayıcıdan değil Apivator sunucusundan çıkar (`POST /api/execute`). Böylece
tarayıcının CORS kısıtına takılmazsınız. Güvenlik için sunucu, bağlantı anında hedef IP'yi kontrol eder:
localhost, iç ağ (10.x, 172.16–31.x, 192.168.x) ve bulut metadata adresleri (169.254.x) varsayılan olarak
engellidir. DNS ile yönlendirme hilesi de bu kontrolü aşamaz. Geliştirme ortamında (`appsettings.Development.json`)
bu engel kapalıdır, böylece kendi makinenizdeki API'leri test edebilirsiniz. Masaüstü uygulaması ve CLI
istekleri doğrudan sizin makinenizden atar.

ASCII dışı header değerleri (ör. `X-Kullanici: Ayşe`) Postman'deki gibi UTF-8 olarak gönderilir.

## WebSocket ve Server-Sent Events

İstek editöründe URL'nin solundaki tür seçicisinden **SSE** ya da **WebSocket** seçilir; kaydedilen istekler ağaçta
`SSE` / `WS` rozetiyle görünür.

- **SSE:** `POST /api/execute/stream` isteği normal istek gibi hazırlar (değişkenler, yetkilendirme, OAuth token'ı;
  script'ler çalışmaz) ve yanıtı NDJSON olarak akıtır: `open`, her olay için `event` (ad, veri, kimlik), sonda `done`
  ya da `error`. Yanıt olay akışı değilse gövde tek bir `body` olayıyla gelir. Akış en fazla
  `Proxy:StreamMaxMinutes` (30) dakika açık kalır.
- **WebSocket:** tarayıcı WebSocket'te header gönderemediği ve hedefe kendi ağından çıktığı için bağlantı köprü
  üzerinden kurulur: web'de `/hubs/ws-proxy?access_token=…` (sunucu), masaüstünde yerel ajanın `/ws-proxy` ucu.
  Köprü normal isteklerle aynı HTTP istemcisini kullanır; ağ koruması, proxy ve SSL ayarları burada da geçerlidir.
  Adres, header'lar ve yetkilendirme (Bearer, Basic, API key, OAuth 2.0) istemcide çözülüp köprüye verilir.
  İkili mesajlar base64 taşınır; mesaj en fazla `Proxy:WebSocketMaxMessageBytes` (1 MB), bağlantı en fazla
  `Proxy:WebSocketMaxMinutes` (60) dakika. Sık gönderilen mesajlar istekle birlikte kaydedilir (ekiple paylaşılır).
- Collection runner ve monitörler yalnızca HTTP isteklerini çalıştırır; WebSocket/SSE istekleri atlanır. Mock
  sunucuları WebSocket isteklerini yok sayar.
- Postman v2.1 formatında bu türlerin karşılığı yoktur; Apivator dışa aktarırken türü ve kayıtlı mesajları
  isteğin `x-apivator` alanında taşır (Postman yok sayar, Apivator geri okur).

## GraphQL

Body'de **GraphQL** seçilince şema, isteğin kendi adresi, header'ları ve yetkilendirmesiyle introspection sorgusu
gönderilerek alınır (normal istek yolundan; web'de sunucu, masaüstünde yerel ajan). Adres yazılmayı bitirince
(800 ms) otomatik istenir ve adres başına bir kez alınır; "Yenile" ile tekrar alınır. Şemalar tarayıcıda (IndexedDB)
saklanır, uygulama yeniden açılınca tekrar istenmez. Editörde alan/argüman/tip tamamlama, hata altı çizme ve
"Biçimlendir" var. "Şema" paneli kök işlemleri (Query/Mutation/Subscription), tipleri ve aramayı gösterir; bir alanın
yanındaki düğme zorunlu argümanları değişkene çeviren örnek bir işlem ekler ve değişkenleri doldurur. Sunucu
introspection'ı kapatmışsa bu açıkça söylenir; sorgu yine elle yazılıp gönderilebilir.

## gRPC

Tür seçicisinde **gRPC** seçilir; ağaçta `gRPC` rozetiyle görünür. Adres `host:port` (TLS'siz; 443 portu TLS),
`grpc://` / `http://` (TLS'siz) ya da `grpcs://` / `https://` (TLS) olabilir; adresteki yol ön ek olarak korunur.

- **Tanımlar:** "Server reflection" seçiliyse servisler sunucunun reflection servisinden (`grpc.reflection.v1`, yoksa
  `v1alpha`) alınır; isteğin metadata'sı ve yetkilendirmesi bu çağrıda da gönderilir. ".proto dosyaları" seçiliyse
  dosyalar yüklenir (import edilenler birlikte seçilir; `google/protobuf/*` gerekmez) ve istekle birlikte kaydedilir
  (en fazla 100 dosya, toplam 2 MB). Tanım hataları dosya ve satırla gösterilir. `POST /api/grpc/describe`
  servisleri, metotları, her metot için örnek mesajı ve çağrıda geri gönderilen tanım kümesini (FileDescriptorSet)
  döner.
- **Mesajlar** proto3 JSON eşlemesiyle yazılır ve gösterilir: alan adları lowerCamel (asıl ad da kabul edilir),
  64 bit sayılar metin, `bytes` base64, enum'lar adıyla; `Timestamp`, `Duration`, wrapper'lar, `Struct`/`Value`,
  `FieldMask`, `Empty` ve `Any` doğal biçimleriyle. Yanıtta varsayılan değerler de yazılır. Mesajdaki
  `{{değişken}}`'ler gönderirken çözülür. Metot seçilince mesaj, alanları varsayılanlarla dolduran örnekle gelir.
- **Çağrı** köprüden yapılır (tarayıcı HTTP/2 çerçevelerine ve trailer'lara erişemez): web'de
  `/hubs/grpc-proxy?access_token=…`, masaüstünde yerel ajanın `/grpc-proxy` ucu. Köprü normal isteklerle aynı HTTP
  istemcisini kullanır; ağ koruması, proxy ve SSL ayarları geçerlidir. Unary ve sunucu akışında mesaj gönderilip
  istek akışı kapanır; istemci ve çift yönlü akışta çağrı açık kalır, "Mesajı gönder" ile mesaj eklenir, "Akışı
  bitir" ile kapanır, "İptal" çağrıyı keser. Yanıt metadata'sı, gelen/giden mesajlar, durum kodu, mesajı ve
  trailer'lar zaman ve boyutla listelenir. İsteğe bağlı süre sınırı `grpc-timeout` olarak gönderilir; çağrı en fazla
  `Proxy:StreamMaxMinutes` (30) dakika sürer, tek mesaj en fazla `Proxy:WebSocketMaxMessageBytes` (1 MB) olabilir.
  gzip sıkıştırılmış yanıtlar açılır.
- Yetkilendirme (Bearer, Basic, API key, OAuth 2.0) metadata'ya çevrilir; Digest ve AWS imzası desteklenmez. Script'ler
  gRPC isteklerinde çalışmaz; runner, monitörler, mock sunucuları ve OpenAPI dışa aktarma gRPC isteklerini atlar.
  Postman dışa aktarımında ayarlar `x-apivator.grpc` alanında taşınır.

## API dokümantasyonu

Collection menüsündeki **Dokümantasyon** collection'ın doküman sayfasını açar. Sayfa collection'ın, klasörlerin ve
isteklerin Markdown açıklamalarından, isteklerden ve örnek yanıtlardan üretilir. Collection ve klasör açıklaması
menüdeki "Açıklama"dan, istek açıklaması editördeki **Açıklama** bölümünden yazılır.

- **İçerik:** solda gezinti ve arama. Her istek için method ve adres (değişkenler çözülmüş hâliyle), açıklama,
  yetkilendirme (türü ve nereden miras alındığı), query parametreleri, header'lar (açıklamalarıyla), gövde, örnek
  yanıtlar ve cURL, C#, JavaScript, Python, Go ya da PowerShell örnek kodu var. Değişkenler için environment
  seçilebilir; yalnızca paylaşılan başlangıç değerleri kullanılır.
- **Yayınlama:** sayfadaki **Yayınla** bir bağlantı üretir (`{App:PublicUrl}/docs/{kimlik}`). *Organizasyon içi*
  yayını organizasyonun üyeleri oturum açarak görür; workspace üyesi olmaları gerekmez. *Herkese açık* yayını
  bağlantıyı bilen herkes oturumsuz görür; bunu yalnızca workspace yöneticileri seçebilir. Yayın canlıdır:
  collection'da kaydedilen her değişiklik hemen görünür. "Yenile" yeni bağlantı üretir ve eskisini geçersiz kılar;
  yayından kaldırınca bağlantı çalışmaz. Collection'ı düzenleyebilen yayınlayabilir; görüntüleyiciler bağlantıyı
  görür.
- **Gizlilik:** gizli işaretli değişkenlerin değerleri, yetkilendirme bilgileri (yalnızca türü ve yeri, ör.
  `X-Api-Key: <anahtar> (header)`), script'ler ve hassas adlı header/parametre değerleri (`Authorization`, `Cookie`,
  `*token*`, `*secret*`, `*password*`, `api_key` vb.) yayınlanmaz; yalnızca `{{değişken}}` olan değerler (adı göründüğü
  için) kalır. Örnek yanıt gövdeleri sayfada 64 KB'de kesilir. Yayın uçları `no-store` ve `noindex` ile döner, IP başına
  dakikada `RateLimiting:DocsPermitPerMinute` (120) istekle sınırlıdır.
- API: `GET /api/collections/{id}/documentation?environmentId=`, `GET/PUT/DELETE /api/collections/{id}/publication`,
  `POST /api/collections/{id}/publication/regenerate`, `GET /api/docs/{kimlik}` (oturumsuz).
- Açıklamalar Postman (istek `request.description`, klasör `description`) ve OpenAPI (işlem `description`, etiket
  açıklaması) içe/dışa aktarmada taşınır.

## Swagger / OpenAPI adresinden içe aktarma

İçe aktarma penceresinin **Adres (Swagger)** sekmesine şunlardan biri yazılır:

- Belge adresi: `…/swagger/v1/swagger.json`, `…/openapi.yaml` (JSON ya da YAML; OpenAPI 3.x ve Swagger 2.0).
- Swagger UI, ReDoc ya da Scalar sayfası (`…/swagger/index.html`, FastAPI'nin `/docs`'u, NestJS'in `/api`'si): belge
  adresi sayfadan ve yüklediği script'lerden okunur (springdoc'ta `swagger-config`, NestJS'te sayfaya gömülü belge).
  Birden çok sürüm varsa (v1, v2) seçtirilir.
- Yalnızca sunucu adresi (`https://siparis.sirket.local`, `localhost:5000`): sırayla `/swagger/v1/swagger.json`
  (.NET, Swashbuckle), `/openapi/v1.json` (.NET 9+), `/v3/api-docs` ve `/v2/api-docs` (Spring), `/openapi.json`
  (FastAPI), `/api-json` (NestJS), `/q/openapi` (Quarkus), `/swagger.json`, `/openapi.yaml` denenir.

Etiketler klasör, işlemler istek olur (dosyadan OpenAPI içe aktarmayla aynı kurallar). Belgede sunucu yoksa ya da
göreliyse (`/api`) `baseUrl` belgenin geldiği sunucuya göre doldurulur. Swagger 2.0 belgeleri içeride OpenAPI 3'e
çevrilir (host/basePath → sunucu, body ve formData parametreleri → gövde, `type: file` → dosya alanı); dosyadan
içe aktarmada da kabul edilir.

- **Kim çeker:** web'de sunucu çeker; ağ koruması (`Proxy__AllowPrivateNetworks`, `Proxy__AllowedNetworks`), zaman
  aşımı ve 20 MB sınırı geçerlidir. Masaüstünde belgeyi yerel ajan bu bilgisayardan çeker (proxy ve SSL ayarlarıyla),
  böylece `localhost` ve şirket içi servisler de alınır; sunucuya yalnızca belge gider.
- **Korumalı belgeler:** "Erişim" bölümüne Bearer token ya da header girilir. Saklanmaz ve yalnızca belgenin
  sunucusuna gönderilir (sayfanın işaret ettiği başka bir sunucuya gitmez).
- **Kaynaktan güncelleme:** collection kaynak adresini ve son uygulanan belgeyi hatırlar. Collection menüsündeki
  **Kaynaktan güncelle** belgeyi yeniden çeker ve son uygulanan belgeyle farkını gösterir: yeni, değişen (hangi
  bölümün değiştiğiyle: adres, query, header, gövde, yetkilendirme, açıklama, örnekler) ve kaldırılan uçlar.
  Seçilenler uygulanır; kaldırılan uçlar varsayılan olarak seçili gelmez. Uçlar belgedeki metot + yol ile eşleşir
  (`GET /pets/{id}`), yeniden adlandırılan ya da taşınan istekler de bulunur. Kullanıcının eklediği header ve query
  parametreleri, script'ler ve örnekler korunur; yerelde değiştirilmiş ad ve açıklama korunur; yerelde değiştirilmiş
  değerler (ör. `page=3`) belge yalnızca varsayılanı değiştirdiyse ezilmez. Yerelde değiştirilmiş gövde ya da
  yetkilendirme belgede de değiştiyse uygulanınca belgedekiyle değişir (önizlemede uyarılır).
- **Otomatik kontrol:** kaynak penceresinden saatte bir, 6 saatte bir ya da günde bir. Sunucu belgeyi çeker; son
  uygulanandan farklıysa ağaçta collection'ın yanında rozet çıkar ve kontrolü açan kişiye bildirim gider (aynı
  değişiklik için bir kez). Erişim bilgisi saklanmadığı için yalnızca sunucunun erişebildiği, herkese açık belgelerde
  çalışır; erişilemezse hata kaynak penceresinde gösterilir. Birden fazla API örneğinde iş veritabanından kapılır.
- API: `POST /api/workspaces/{id}/import/url`, `GET|DELETE /api/collections/{id}/source`,
  `PUT …/source/schedule`, `POST …/source/preview`, `POST …/source/apply`; masaüstü ajanında `POST /openapi/fetch`.

## OpenAPI dışa aktarma ve HAR içe aktarma

- Collection menüsünden **Dışa aktar (OpenAPI JSON / YAML)**: `GET /api/collections/{id}/export/openapi` OpenAPI 3.0.3
  belgesi üretir. Baştaki `{{baseUrl}}` (çözülebiliyorsa değeri) sunucu adresi, `:id` / `{{id}}` yol parametresi,
  üst klasör etiket olur; query ve header'lar parametre, body ve kayıtlı örnek yanıtlar örnek (JSON'dan basit şema)
  olarak eklenir; yetkilendirme güvenlik şemasına çevrilir. Aynı method + yol ikinci kez gelirse atlanır ve
  `x-apivator-warnings` içinde belirtilir. YAML'a çeviri tarayıcıda yapılır.
- İçe aktarma penceresi HAR (HTTP Archive 1.2) dosyalarını da kabul eder: tarayıcı geliştirici araçlarından ya da
  proxy'lerden kaydedilen her istek bir istek, yanıtı örnek yanıt olur. Birden çok host varsa host'a göre klasörlenir;
  aynı method + URL tek istekte toplanır (ilk 5 yanıt örnek), resim/stil/script/font istekleri ve bağlantıya özgü
  header'lar atlanır.

## Kimlik doğrulama nasıl çalışır

- **Access token** (JWT, 15 dk) yalnızca bellekte tutulur, her istekte `Authorization: Bearer` ile gönderilir.
- **Refresh token** (14 gün) web'de `httpOnly` cookie'dedir (JavaScript okuyamaz); desktop ve CLI istemcileri
  aynı token'ı yanıt gövdesinden alıp gövdede geri gönderir.
- Refresh token her kullanımda yenilenir (rotasyon). İptal edilmiş bir token tekrar kullanılırsa çalınmış
  sayılır ve kullanıcının tüm oturumları kapatılır. Veritabanında yalnızca SHA-256 özeti saklanır.
- 5 hatalı girişte hesap 5 dakika kilitlenir; auth uçlarında IP başına dakikada 20 istek sınırı vardır.
- Şifre sıfırlanınca tüm açık oturumlar kapatılır.
- Her giriş bir **oturumdur** (rotasyonla aynı kalır); access token'da `sid` claim'i taşınır. Oturum kapatılınca
  (Hesap ayarları › Güvenlik, şifre değişikliği, çıkış) access token'ı da süresini beklemeden geçersiz
  olur: doğrulamada oturumun açık olup olmadığı 30 sn önbellekle kontrol edilir. Rotasyonla değiştirilmemiş
  (çıkış ya da "oturumu kapat" ile iptal edilmiş) bir token'ın tekrar gönderilmesi hırsızlık sayılmaz, yalnızca reddedilir.
- **İki adımlı doğrulama** açıksa `POST /api/auth/login` oturum yerine `{ twoFactorRequired, challengeToken }` döner;
  `POST /api/auth/login/2fa` authenticator kodunu ya da yedek kodu alır. Belirteç 5 dakika geçerlidir ve şifre
  değişince düşer; hatalı kodlar hatalı şifre gibi kilitlenmeye sayılır. CLI ve CI'daki API anahtarları ikinci adım
  istemez (anahtar zaten girişten sonra oluşturulur).

## Yanıtı Excel / CSV olarak kaydetme

Yanıt panelindeki **Tablo olarak kaydet** JSON, XML ve CSV yanıtlarını tabloya çevirir:

- Satır olacak dizi seçilir (kök dizi ya da `data.items` gibi bir yol; en uzun dizi önerilir). İç içe alanlar nokta ile
  düzleşir (`adres.sehir`); iç içe diziler hücrede JSON metni ya da Excel'de ayrı sayfada (`#satır` kolonuyla ana
  satıra bağlı) yer alır. XML'de tekrarlanan öğeler satır, öznitelikler `@ad` kolonu olur.
- Kolonlar seçilip sıralanır; ilk 100 satır önizlenir. Çözümleme ve dosya üretimi Web Worker'da yapılır (6 MB /
  30.000 satırlık yanıtta önizleme ~1 sn, arayüz donmaz). Diyalog, Excel yazıcı ve worker ayrı parçalarda yüklenir.
- **Excel:** başlık satırı kalın ve sabit, otomatik süzgeç, içeriğe göre kolon genişliği; sayı, mantıksal, tarih ve
  tarih-saat hücreleri kendi tipinde (tarih/saat API'nin yazdığı gibi, saat dilimi atılır). 15 haneden uzun sayılar
  ve baştaki sıfırlı değerler (`04800`) metin kalır. Formül yazılmaz. Dış kütüphane kullanılmaz
  (`packages/core/src/xlsx.ts`, `zip.ts`).
- **CSV:** UTF-8 BOM'lu; ayırıcı `;` (Türkçe Excel, ondalık virgül), `,` ya da sekme. `=`, `+`, `-`, `@` ile başlayan
  metinlerin başına `'` eklenir (CSV enjeksiyonu).
- Collection runner sonuçları (iterasyon × istek; ayrı sayfada testler) ve istek geçmişi de **Dışa aktar** menüsüyle
  aynı biçimlerde iner. Geçmişte yanıt gövdeleri saklanmadığı için geçmiş dosyası durum, süre ve boyutu içerir.
- Masaüstü uygulamasında dosyalar "Farklı kaydet" diyaloğuyla kaydedilir (`save_file` komutu, ham gövdeyle).

## Yanıttan model üretme

Yanıt panelindeki **Model** düğmesi yanıttan model sınıfları üretir. Aynı pencere istek gövdesi editöründen, gRPC
editöründen (istek/yanıt mesajı) ve API dokümantasyonundaki örneklerden de açılır.

- **Kaynaklar:** bu yanıt, isteğe kayıtlı örnek yanıtlar (birlikte birleştirilir), istek gövdesi (tırnaksız
  `{{değişken}}` null sayılır), yapıştırılan JSON örneği ya da JSON Schema / OpenAPI belgesi (JSON veya YAML;
  `components.schemas` altındaki tüm şemalar), gRPC mesaj tipleri (sunucu protobuf tanımından JSON Schema çıkarır).
- **Çıkarım:** dizi elemanları ve birden çok örnek tek modelde birleşir; yalnızca bazı örneklerde olan alan
  opsiyonel, `null` görülen alan null olabilir sayılır. Tam sayı / büyük tam sayı / ondalık, tarih, tarih-saat ve
  GUID ayrılır (karışık tarih biçimleri metin kalır). Aynı yapıdaki nesneler tek sınıf olur; dizi alanları tekile
  çevrilerek adlandırılır (`items` → `Item`).
- **Diller:** C# (class/record; System.Text.Json ya da Newtonsoft), Java (POJO/record; Jackson, isteğe bağlı
  Lombok; her tip ayrı dosya, ZIP olarak iner), Kotlin (kotlinx.serialization data class), TypeScript (interface,
  isteğe bağlı zod şeması), Python (Pydantic ya da dataclass), Go (struct + json tag), Swift (Codable), Dart
  (`fromJson`/`toJson`), JSON Schema (2020-12). Ondalıklar isteğe bağlı decimal/BigDecimal/Decimal olur.
- **Adlar:** JSON adları dilin kuralına çevrilir (`order_no` → `OrderNo` / `orderNo`), Türkçe karakterler ASCII'ye
  iner; ayrılmış kelimeler ve yerleşik tiplerle çakışmalar kaçışlanır (`Data` → `DataModel`). Kök sınıf adı istek
  adından gelir ve değiştirilebilir; namespace/paket ve dil seçenekleri tarayıcıda hatırlanır.
- Üretim `@apivator/core/models` içinde (dış kütüphanesiz, ayrı parça); kopyalama ya da dosya olarak indirme.
- gRPC'de 64 bit tam sayılar proto3 JSON kuralı gereği metin (`string`) olarak üretilir.

## Hesap ve profil

**Hesap menüsü › Hesap ayarları** (`/account`):

- **Profil:** ad, profil görseli (istemcide 256×256'ya kırpılır; PNG/JPEG/WebP, en fazla 512 KB, tür dosya
  imzasından anlaşılır; `GET /api/users/{id}/avatar` herkese açıktır), üye olunan organizasyon ve workspace'ler
  ile roller. E-posta değişikliği şifre ister; yeni adrese doğrulama bağlantısı gider, doğrulanana kadar eski adres
  geçerlidir, değişince eski adrese bildirim gider.
- **Güvenlik:** şifre, iki adımlı doğrulama, oturumlar ve güvenlik geçmişi (aşağıda). Şifre: mevcut şifreyle değiştirme (kurallar kayıttakiyle aynı; diğer oturumlar kapanır, e-posta
  bildirimi gider). Açık oturumlar cihaz (tarayıcı · işletim sistemi, masaüstü uygulaması `X-Apivator-App: desktop`
  başlığıyla tanınır), IP ve son kullanım zamanıyla listelenir; tek tek ya da "diğer tüm oturumlardan çık".
- **API anahtarları:** CLI ve CI anahtarları (aşağıda).
- **Tercihler:** tema, açılıştaki varsayılan workspace ve e-posta bildirimleri (bahsetme, birleştirme isteği,
  monitör uyarısı ayrı ayrı) sunucuda saklanır, web ve masaüstünde ortaktır.
- **Veriler ve hesap:** hesap bilgileri ve kişisel workspace'in collection/environment'ları (Postman formatında)
  tek ZIP olarak iner. Hesap silme şifre ve e-postadaki onay bağlantısıyla yapılır (24 saat geçerli; bağlantı
  açılınca değil düğmeyle silinir). Başka üyesi olan bir organizasyonun sahibi önce sahipliği devretmelidir.
  Silmede kişisel veriler temizlenir; kullanıcı kaydı "Silinmiş kullanıcı" olarak kalır, böylece ekip
  workspace'lerindeki collection ve yorumlar bozulmaz.

## Hesap güvenliği

- **İki adımlı doğrulama (TOTP):** Hesap ayarları › Güvenlik › Kur. QR kod (ya da anahtar) Google/Microsoft
  Authenticator, 1Password gibi bir uygulamaya eklenir, üretilen kodla açılır. Açılınca 10 yedek kod bir kez
  gösterilir (kopyala / `.txt` indir); her biri bir kez kullanılır, kod doğrulamasıyla yenilenebilir. Kapatmak şifre ve
  kod (ya da yedek kod) ister. Anahtar sunucuda Data Protection ile şifreli, yedek kodlar yalnızca özetleriyle
  saklanır; aynı kod ikinci kez kabul edilmez, saat kaymasına karşı bir önceki/sonraki 30 saniyelik adım kabul edilir.
  Açma ve kapatmada e-posta bildirimi gider.
- **Organizasyonda zorunlu kılma:** organizasyon sayfası › Güvenlik (yalnızca yöneticiler; yöneticinin kendi 2FA'sı
  açık olmalı). Zorunluyken 2FA'sı kapalı üyeler organizasyonun workspace'lerini göremez (liste, erişim ve API
  anahtarları); uygulamada "Şimdi kur" uyarısı çıkar, kurunca erişim hemen gelir. Zorunlu kılan organizasyon varken
  2FA kapatılamaz; yönetim işlemleri için yöneticilerin de 2FA'sı açık olmalıdır. Üyeler listesinde yöneticiler
  her üyenin 2FA durumunu görür.
- **Güvenlik geçmişi:** son 100 olay: giriş, başarısız giriş, kilitlenme, şifre / e-posta değişikliği, şifre
  sıfırlama, 2FA açma/kapama, yedek kod kullanımı ve yenileme, yönetici işlemleri (cihaz, IP ve yapan yöneticiyle).
  Kayıtlar bir yıl tutulur; hesap silinince silinir.
- **Yeni cihaz uyarısı:** son 180 günde girişi olmayan bir cihazdan (tarayıcı + işletim sistemi ya da uygulama)
  giriş yapılınca e-posta gider.
- **Yönetici işlemleri:** organizasyon sayfasında üyenin yanındaki menüden "Oturumlarını kapat" (tüm cihazlarda
  çıkış) ve "Şifre sıfırlama bağlantısı gönder". Sahibe yalnızca sahip uygulayabilir. Üyeye e-postayla bildirilir ve
  üyenin güvenlik geçmişine yöneticinin adıyla yazılır.

## Yapılandırma

Tüm ayarlar `appsettings.json` içinde; ortam değişkeniyle ezilir (`Bölüm__Anahtar`, örn. `Jwt__SigningKey`).

| Ayar | Açıklama |
| --- | --- |
| `ConnectionStrings__Postgres` | PostgreSQL bağlantı cümlesi |
| `Jwt__SigningKey` | **Zorunlu**, en az 32 karakter. Üretimde mutlaka rastgele bir değer verin. |
| `App__PublicUrl` | Web arayüzünün dış adresi; e-posta linkleri buna göre üretilir |
| `Smtp__Host`, `Smtp__Port`, `Smtp__UserName`, `Smtp__Password`, `Smtp__EnableSsl` | E-posta sunucusu |
| `Email__Mode` | `Smtp` (varsayılan) veya `Console`: e-postaları göndermek yerine API konsoluna yazar. Geliştirmede `Console`. |
| `Proxy__AllowPrivateNetworks` | `true` ise web'den localhost ve iç ağ adreslerine istek atılabilir. Geliştirmede açık, sunucuda kapalı. |
| `Proxy__AllowedNetworks__0`, `__1`… | İç ağ kapalıyken bile izin verilen ağlar (CIDR), ör. `10.20.0.0/16`. Şirket içi API'ler için. Bir değere virgülle birden fazla ağ yazılabilir. |
| `Proxy__TimeoutSeconds`, `Proxy__MaxResponseBytes` | İstek zaman aşımı (varsayılan 30 sn) ve yanıt boyutu sınırı (varsayılan 10 MB) |
| `Proxy__MaxUploadBytes` | Bir istekle gönderilebilecek dosyaların toplam boyutu (varsayılan 20 MB) |
| `Scripts__TimeoutSeconds`, `Scripts__MemoryLimitMb` | Pre-request / post-response script'lerinin bir aşamadaki süre (15 sn) ve bellek (256 MB) sınırı |
| `Scripts__MaxSendRequests` | Bir script aşamasında `pm.sendRequest` ile atılabilecek en fazla istek (10) |
| `Database__MigrateOnStartup` | `true` ise API açılışta migration'ları uygular |
| `RateLimiting__AuthPermitPerMinute` | Auth uçları için IP başına dakikalık limit (varsayılan 20) |
| `Redis__ConnectionString` | Verilirse SignalR mesajları Redis üzerinden dağıtılır; birden fazla API örneği için gerekir |
| `RateLimiting__MockPermitPerMinute` | Mock başına dakikalık istek sınırı (varsayılan 600) |
| `Mocks__MaxCallsPerMock`, `Mocks__MaxRequestBytes` | Mock başına saklanan çağrı kaydı (500) ve mock'a gönderilebilecek en büyük body (1 MB) |
| `Monitors__SchedulerEnabled` | `false` ise bu API örneği monitör çalıştırmaz (varsayılan `true`) |
| `Monitors__MinIntervalMinutes`, `Monitors__RunTimeoutMinutes`, `Monitors__RetentionDays` | İki çalıştırma arası en kısa süre (5 dk), bir çalıştırmanın süre sınırı (10 dk), monitör raporlarının saklanma süresi (30 gün) |
| `Monitors__PollSeconds`, `Monitors__MaxConcurrent` | Zamanı gelen monitörlerin aranma sıklığı (15 sn) ve bir API örneğinde aynı anda çalışan en fazla monitör (4) |
| `SourceChecks__SchedulerEnabled`, `SourceChecks__PollSeconds`, `SourceChecks__MaxConcurrent` | Kaynak belgelerin otomatik kontrolü: kapatma (varsayılan açık), zamanı gelenlerin aranma sıklığı (60 sn) ve aynı anda kontrol edilen en fazla belge (4) |
| `ForwardedHeaders__ForwardLimit` | API'nin önündeki ters proxy sayısı (varsayılan 1; `deploy/` kurulumunda 2) |

## Yeni migration

```bash
cd src/backend
dotnet tool restore
dotnet ef migrations add <Ad> -p src/Apivator.Infrastructure -s src/Apivator.Api -o Persistence/Migrations \
  --context Apivator.Infrastructure.Persistence.AppDbContext
dotnet ef migrations add <Ad> -p src/Apivator.Infrastructure -s src/Apivator.Api -o Persistence/Migrations/Sqlite \
  --context SqliteAppDbContext --namespace Apivator.Infrastructure.Persistence.Migrations.Sqlite
```

Her model değişikliği iki migration ister: PostgreSQL (ekip sunucusu) ve SQLite (kişisel kullanım). PostgreSQL
bağlamı tam adıyla verilmelidir; kısa ad `SqliteAppDbContext` ile karışır. `--namespace` ile EF, snapshot dosyasını
yanlış klasöre yazabilir; `Persistence/Migrations/Sqlite` altına taşıyın.

SQLite için: `Database__Provider=Sqlite`, `ConnectionStrings__Sqlite="Data Source=apivator.db"`. Entegrasyon testleri
`APIVATOR_TEST_PROVIDER=Sqlite` ile geçici bir SQLite dosyasında koşar.

## Script'ler

Pre-request ve post-response script'leri sunucuda, [Jint](https://github.com/sebastienros/jint) JavaScript motorunda
yalıtılmış olarak çalışır: .NET nesnelerine, dosya sistemine ve serbest ağa erişim yoktur; süre, bellek ve komut sayısı
sınırlıdır. Ağ yalnızca `pm.sendRequest` ile, normal isteklerle aynı SSRF korumasından geçerek kullanılabilir.

Desteklenen `pm` API'si: `pm.test`, `pm.expect` (Chai), `pm.response` (`code`, `json()`, `text()`, `size()`,
`headers`, `cookies`, `to.have.status/header/body/jsonBody/jsonSchema`, `to.be.ok/json/...`), `pm.request` (URL,
method, header, body değiştirme), `pm.environment`, `pm.collectionVariables`, `pm.globals`, `pm.variables`,
`pm.iterationData`, `pm.info`, `pm.cookies`, `pm.sendRequest`, `pm.execution.setNextRequest/skipRequest`,
`console.*`, eski `postman.*`, `tests[...]`, `responseBody`, `xml2Json`. Kütüphaneler: `chai`, `lodash` (`_`),
`crypto-js` (`CryptoJS`), `moment`, `tv4`, `uuid`, `atob`/`btoa` (kütüphaneler yalnızca script kullanıyorsa
yüklenir). Lisansları: `src/backend/src/Apivator.Infrastructure/Scripting/Libraries/THIRD-PARTY-NOTICES.md`.

Postman'le aynı sonucu verdiği `compat/` klasöründeki uyumluluk setiyle sürekli kontrol edilir; ekibin dışa
aktardığı collection'lar `compat/collections/` altına konup taranabilir ([compat/README.md](compat/README.md)).

Script'lerin değiştirdiği değişkenler Postman'deki gibi **güncel değer** olarak yalnızca o kullanıcının tarayıcısına
yazılır; ekiple paylaşılan başlangıç değerleri değişmez.

## API anahtarları

CLI ve CI için **Hesap ayarları › API anahtarları** ekranından kişisel anahtar oluşturulur (`apv_…`). Anahtar
`Authorization: Bearer apv_…` ya da `X-Api-Key` header'ıyla gönderilir, sahibinin yetkileriyle ama yalnızca okuma
(GET) ve runner raporu yükleme (`POST /api/runs/report`) için kullanılabilir. Veritabanında yalnızca SHA-256 özeti
saklanır; anahtar oluşturulduğu anda bir kez gösterilir.

## Mock sunucuları

Bir collection'ın örnek yanıtları (Example) `/mock/{anahtar}/...` adresinde sunulur. Gelen istek method, yol
(`:id`, `{id}` ve çözülemeyen `{{değişken}}` parçaları her değere uyar), query ve body'ye göre puanlanır; en
uygun örnek döner. Örnek URL'sindeki host ya da baştaki `{{baseUrl}}` yok sayılır. Seçimi daraltan header'lar:
`x-mock-response-code`, `x-mock-response-name`, `x-mock-response-id`; zorunlu eşitlik için
`x-mock-match-request-body: true` ve `x-mock-match-request-headers: a,b`. Eşleştirme kuralları:
`src/backend/src/Apivator.Application/Mocks/MockMatcher.cs`.

Mock'lar oturum istemez ve her origin'den (CORS) çağrılabilir. Gizli mock, `x-api-key` header'ında workspace
üyesinin API anahtarını ister. Örneklerdeki değişkenler seçilen environment, collection değişkenleri ve globals'tan
çözülür; gizli işaretli değerler asla yanıta yazılmaz. Çağrılar (header'larda yetki bilgisi maskelenerek) mock
başına en yeni 500 kayıtla saklanır.

## Monitörler

Monitör bir collection'ı (isteğe bağlı bir environment'la) cron zamanlamasıyla sunucuda çalıştırır. Zamanlama
IANA saat dilimine göredir (yaz saati geçişleri dahil), iki çalıştırma arası en az 5 dakikadır. Çalıştırma
"başarılı" sayılır: tamamlandıysa, kalan test yoksa ve her istek yanıt aldıysa. Bildirimler e-posta (boşsa
monitörü oluşturana) ve webhook ile (Slack, Teams ya da ayrıntılı JSON: `monitor.failed`, `monitor.recovered`,
`monitor.suspended`) gider; varsayılan olarak yalnızca durum değişince. Webhook istekleri normal istekler gibi
ağ korumasından geçer.

Değişkenler environment ve globals'ın paylaşılan başlangıç değerlerinden gelir (gizli değerler dahil).
Çalıştırmalar monitörü oluşturan kişinin yetkisiyle yapılır; erişimi kalmazsa monitör durur ve bir üye yeniden
açtığında onun adına çalışır. Zamanlanmış çalıştırmalar runner geçmişinde "monitörden" etiketiyle görünür ve
30 gün saklanır. Zamanlayıcı birden fazla API örneğinde güvenle çalışır (`FOR UPDATE SKIP LOCKED`).

## Fork ve merge

Bir collection, düzenleme yetkisi olan herhangi bir workspace'e fork'lanabilir (kaynağı görmek yeter; görüntüleyiciler
de kendi kopyalarında çalışıp öneride bulunabilir). Fork'un her klasörü ve isteği kaynaktaki karşılığına bağlıdır;
her bağ son eşitlemedeki ortak hâli (taban) saklar. Karşılaştırma üç yönlüdür: fork'taki hâl tabandan farklıysa
fork, kaynaktaki farklıysa kaynak değiştirmiştir; ikisi de farklı ve birbirinden de farklıysa çakışmadır.

- **Fork'a çekme:** kaynaktaki değişiklikler fork'a uygulanır; çakışmalarda her öğe için "kaynağınkini al" ya da
  "benimkini koru" seçilir.
- **Merge isteği:** fork'taki değişiklikler istek bazında farklarıyla gösterilir, yorumlanır (mevcut yorum sistemi,
  @bahsetme dahil), kaynağın düzenleyicileri onaylar ve birleştirir ya da reddeder. Çakışma varsa birleştirme kapalıdır;
  önce fork güncellenir. Birleştirmede değişen istekler aynı kimlikle güncellenir (yorumları ve sürüm geçmişi korunur).
- Açılan istek kaynağın düzenleyicilerine, birleştirme ya da red isteği açana bildirim olarak gider.
- Karşılaştırılan alanlar: istekte ad, konum, tanım ve örnek yanıtlar; klasörde ad, konum, yetkilendirme ve
  script'ler; collection'da açıklama, yetkilendirme, değişkenler ve script'ler (adı hariç). Sıralama karşılaştırılmaz.

## Collection rolleri

Workspace rolü varsayılan olarak her collection'da geçerlidir. Workspace yöneticisi collection menüsündeki
**Erişim ve roller** ekranından bir kişiye ya da takıma yalnızca o collection için **Görüntüleyici** veya
**Düzenleyici** rolü verebilir (düzenleyiciyi indirme ya da görüntüleyiciye düzenleme izni verme) ve
**Düzenlemeyi kısıtla** ile collection'ı yalnızca yöneticilere ve Düzenleyici verilenlere açabilir.

- Etkin rol sırası: workspace yöneticisi her zaman yönetici → kişiye verilen rol → takım rollerinin en yükseği →
  kısıtlıysa görüntüleyici → workspace rolü. Kayıt workspace'e erişim vermez; kişisel workspace'lerde kullanılmaz.
- Kontroller sunucudadır: collection, klasör, istek, örnek, sürüm geri yükleme, taşıma/kopyalama ve merge
  birleştirme collection rolüne bakar. Ağaçtaki her collection kullanıcının rolünü (`role`) taşır; arayüz kilit
  simgesi gösterir, editör salt okunur olur (istek değiştirilip gönderilebilir ama kaydedilemez).
- Rol değişiklikleri canlı kanalla açık oturumlara anında yansır.

## Çevrimdışı çalışma

Sunucuya ulaşılamadığında uygulama kapanmaz; bu cihaza indirilen verilerle çalışmaya devam eder.

- Workspace'ler, collection ağaçları, istek tanımları, environment'lar, globals ve geçmiş kullanıcı başına
  IndexedDB'de saklanır (7 gün). Collection ağacı her yüklendiğinde sürümü değişen collection'ların istekleri
  arka planda tek istekle (`GET /api/collections/{id}/requests`) indirilir; hiç açılmamış istekler de çevrimdışı açılır.
- Açılışta sunucuya ulaşılamazsa bu cihazda son oturum açan kullanıcıyla açılır (token saklanmaz; yalnızca kimlik
  ve ad). Üstte "Sunucuya ulaşılamıyor" bandı çıkar; uygulama `GET /api/ping` ile 10 saniyede bir yoklar.
- Çevrimdışıyken kaydedilen değişiklikler cihazda kalır (sekmede bulut simgesi) ve bağlantı gelince sırayla
  kaydedilir. Arada başkası değiştirdiyse mevcut çakışma ekranı açılır. Yeni (hiç kaydedilmemiş) istekler
  çevrimdışıyken collection'a eklenemez; sekmede saklanır.
- Masaüstünde istekler bu bilgisayardan gönderildiği için çevrimdışıyken de gönderilebilir; web'de istek göndermek
  için sunucu gerekir.
- Çıkış yapınca bu cihazdaki önbellek silinir.

## Masaüstünde güncel değerler

Değişkenlerin güncel değerleri (token, parola…) sunucuya gönderilmez. Masaüstünde bunlar AES-256-GCM ile şifreli
saklanır; anahtar işletim sisteminin anahtar zincirindedir (Windows Credential Manager, macOS Keychain, Linux Secret
Service, `Apivator / local_key:variables`). Anahtar zinciri kullanılamazsa eski davranışa (düz metin) düşülür.
Anahtar silinirse şifreli değerler okunamaz ve yeniden girilmesi gerekir. Web'de güncel değerler tarayıcının yerel
deposundadır.
