# Fazlar

Her faz, kendi başına kullanılabilir bir sürümle ve ölçülebilir bir çıkış kriteriyle kapanır. Görevler iş paketlerine (epic) gruplanmıştır; süreler 2–3 geliştirici varsayımıyla kaba tahmindir.

## Faz 0 · Temel altyapı (tahmini 2 hafta)

**Durum: tamamlandı (20 Ekim 2026).** Backend'de 28 test (11 domain, 17 entegrasyon), frontend'de 16 test geçiyor. Kayıt → e-posta doğrulama → çıkış → giriş akışı gerçek API ve PostgreSQL ile tarayıcıda uçtan uca denendi. Docker olmayan bir ortamda geliştirildiği için `docker compose up` ve CI ilk kez sizin tarafınızda çalışacak. Plandan sapma: .NET 8 yerine .NET 10 LTS kullanıldı (.NET 8 desteği Kasım 2026'da bitiyor).

Hedef: kod yazılmadan önce tekrar üretilebilir geliştirme ortamı, CI ve kimlik doğrulama hazır olur.

**0.1 Repo ve geliştirme ortamı**

- [x] Monorepo: `src/backend` (.NET çözümü), `src/frontend` (pnpm workspace: `apps/web`, `packages/ui`, `packages/core`)
- [x] Clean Architecture projeleri: `Apivator.Domain`, `Application`, `Infrastructure`, `Api`
- [x] Docker Compose: API + PostgreSQL 16 + Redis + Mailpit (yerel e-posta)
- [x] Kod standartları: `.editorconfig`, ESLint + Prettier, `dotnet format`, commit kuralları

**0.2 CI/CD**

- [x] GitHub Actions: build, test, lint (backend ve frontend)
- [x] Docker imajı üretip registry'ye gönderme
- [x] Testcontainers ile entegrasyon testi iskeleti

**0.3 Kimlik doğrulama**

- [x] ASP.NET Identity + PostgreSQL; kayıt, giriş, çıkış
- [x] JWT access token + refresh token rotasyonu
- [x] E-posta doğrulama ve şifre sıfırlama

**0.4 Veri modeli temeli**

- [x] User, Organization, Workspace, WorkspaceMember tabloları (takım özellikleri Faz 3'te gelse de şema ilk günden bunları içerir)
- [x] Kayıtta otomatik kişisel organizasyon + “My Workspace” oluşturma
- [x] EF Core migration düzeni

**0.5 Uygulama kabuğu**

- [x] React + Vite + Tailwind + shadcn/ui kurulumu, açık/koyu tema
- [x] Layout: üst bar (workspace seçici), sol kenar çubuğu, sekmeli ana alan
- [x] Giriş/kayıt sayfaları, korumalı rotalar, API istemcisi (TanStack Query)

**Çıkış kriteri:** Yeni bir geliştirici `docker compose up` ile 15 dakikada ortamı kurar; kayıt olup boş workspace'ini görür; CI yeşil.

## Faz 1 · Çekirdek istemci (tahmini 8–10 hafta)

**Durum: tamamlandı (20 Ekim 2026).** Tüm maddeler bitti: istek editörü (form-data dosya, binary ve GraphQL body dahil), yanıt görüntüleyici (cookie sekmesi, arama, dosyaya kaydetme, örnek kaydetme), sürükle-bırak ve kopyalama, Markdown açıklama, environment'lar, yetkilendirme, geçmiş, Postman içe/dışa aktarma ve cURL. Backend'de 117, frontend'de 87 test geçiyor. Plandan sapmalar: kod editörü Monaco yerine CodeMirror 6; dosyalar istek tanımında saklanmıyor (Postman'deki gibi yalnızca dosya adı), sayfa yenilenince yeniden seçiliyor; body ve header'da değişken vurgulama sonraya kaldı. Sırada çıkış kriteri: ekipten 2–3 kişiyle bir haftalık deneme.

Hedef: tek kişi, web üzerinden Postman'deki günlük istek işlerini Apivator'da yapabilir. En büyük faz budur; ilk gerçek sürüm (v0.1) burada çıkar.

**1.1 İstek yürütme motoru**

- [x] `IRequestExecutor` sözleşmesi: değişken çözümleme → auth → HTTP çağrısı → sonuç (script adımları Faz 2'de eklenir)
- [x] Sunucu proxy'si: `HttpClient` ile istek, süre/boyut ölçümü, redirect, SSL doğrulama ayarı
- [x] SSRF koruması: özel IP aralıkları varsayılan engelli, admin izin listesi, DNS rebinding kontrolü
- [x] Zaman aşımı, yanıt boyutu limiti, kullanıcı başına rate limit

**1.2 İstek editörü**

- [x] Metod seçici, URL çubuğu; query ve path parametrelerinin URL ile iki yönlü senkronu
- [x] Header tablosu (aç/kapa, toplu düzenleme)
- [x] Body: none, raw (JSON/XML/text, Monaco ile), form-data (dosya dahil), x-www-form-urlencoded, binary, GraphQL — *yapıldı: none, raw (CodeMirror), urlencoded, form-data (metin alanları); kalan: dosya yükleme, binary, GraphQL*
- [x] Sekmeli çalışma, kaydedilmemiş değişiklik uyarısı, `Ctrl+Enter` ile gönder

**1.3 Yanıt görüntüleyici**

- [x] Status, süre, boyut; body pretty/raw/preview (HTML, resim)
- [x] Header ve cookie sekmeleri, JSON içinde arama, yanıtı dosyaya kaydetme — *yapıldı: header sekmesi, kopyalama; kalan: cookie, arama, dosyaya kaydetme*
- [x] Yanıtı örnek (Example) olarak kaydetme

**1.4 Collection'lar**

- [x] Collection / klasör / istek CRUD API'si ve ağaç görünümü
- [x] Sürükle-bırak ile sıralama ve taşıma, kopyalama, yeniden adlandırma — *yapıldı: yeniden adlandırma, taşıma API'si; kalan: sürükle-bırak, kopyalama*
- [x] Collection seviyesinde açıklama (Markdown) ve değişkenler

**1.5 Environment ve değişkenler**

- [x] Global, collection, environment kapsamları; öncelik sırası ve `{{degisken}}` çözümleme
- [x] Environment seçici, initial/current value ayrımı, secret değerleri maskeleme
- [x] URL ve body'de değişken vurgulama, üzerine gelince değeri gösterme — *yapıldı: URL'de vurgulama ve çözülmüş önizleme, tanımsız değişken uyarısı; body ve header'da vurgulama sonraya kaldı*

**1.6 Authorization (temel)**

- [x] No auth, API Key, Bearer, Basic
- [x] Collection ve klasörden miras alma (“Inherit from parent”)

**1.7 Geçmiş ve içe aktarma**

- [x] İstek geçmişi (tarihe göre gruplu, collection'a kaydetme)
- [x] Postman collection v2.1 ve environment içe aktarma
- [x] cURL yapıştırarak istek oluşturma; collection'ı Postman v2.1 olarak dışa aktarma

**Çıkış kriteri:** Ekipten 2–3 kişi bir hafta boyunca günlük isteklerini yalnızca Apivator'dan atıyor; ekibin mevcut Postman collection'ları hatasız içe aktarılıyor.

## Faz 2 · Test ve desktop (tahmini 6–8 hafta)

**Durum:** 2.1–2.6 tamamlandı (otomatik güncellemenin bağlanması git aşamasına kaldı, 9.1'e taşındı; uyumluluk test seti ve environment secret'larının şifreli saklanması 22 Ekim 2026'da tamamlandı, bkz. "Kalanlar"). 2.6'da masaüstü uygulaması tamamlandı: Tauri 2 + yerel .NET ajanı (istekler ve collection runner bu bilgisayardan; runner raporu sunucuya "masaüstünden" etiketiyle yazılır), proxy/SSL/istemci sertifikası ayarları, anahtar zincirinde parolalar, sistem tarayıcısında OAuth girişi, Türkçe Windows kurulum paketi ve imzalı güncelleme altyapısı. Bu sırada hız sınırlarının kullanıcı yerine IP başına işlediği bir hata düzeltildi. Testler: backend 16 + 150, frontend 81 + 48, Rust 4; masaüstü akışları gerçek ajan ve Tauri penceresiyle denendi. Sırada Faz 3 (takım çalışması) var.

Hedef: Postman'deki test script'li collection'lar Apivator'da değişmeden çalışır; localhost ve iç ağ API'leri desktop uygulamasından çağrılır.

**2.1 Script sandbox**

- [x] İstemcide QuickJS (WASM), sunucuda Jint; ortak `pm` kütüphanesi (TypeScript, tek kaynak)
- [x] Zaman ve bellek limiti; dosya sistemi ve serbest ağ erişimi yok
- [x] Pre-request ve test script'leri; collection → klasör → istek sırasıyla çalışma

**2.2 `pm` API uyumluluğu**

- [x] `pm.test`, `pm.expect` (Chai uyumlu), `pm.response` (json, text, code, headers, responseTime)
- [x] `pm.environment`, `pm.collectionVariables`, `pm.globals`, `pm.variables` get/set
- [x] `pm.sendRequest`, `pm.request` düzenleme, `console.log` çıktısı
- [x] Uyumluluk test seti: ekibin gerçek collection'larından toplanan script'ler — *yapıldı: `compat/` altında 29 vakalık set ve collection tarayıcısı; ekibin collection'ları `compat/collections/`'a eklendikçe genişler*

**2.3 Test sonuçları ve konsol**

- [x] Yanıt panelinde “Test Results” sekmesi (geçti/kaldı, hata mesajı)
- [x] Alt panelde konsol: istek/yanıt ham verisi, script logları
- [x] Monaco'da `pm.*` IntelliSense ve hazır script şablonları (snippets)

**2.4 Collection runner**

- [x] Seçili istekleri sıralı çalıştırma, iterasyon sayısı, istekler arası gecikme
- [x] CSV/JSON veri dosyasıyla veri odaklı test
- [x] `pm.execution.setNextRequest` ile akış kontrolü
- [x] Run raporu (Run / RunResult tabloları), geçmiş run'ları listeleme

**2.5 Gelişmiş auth ve araçlar**

- [x] OAuth 2.0: authorization code (PKCE), client credentials, password; token yönetimi ve yenileme
- [x] Digest ve AWS Signature v4
- [x] Kod üretimi: cURL, C# HttpClient, JS fetch, Python requests, Go
- [x] OpenAPI 3.x içe aktarma (collection'a dönüştürme)

**2.6 Desktop uygulaması**

- [x] Tauri 2 kabuğu, mevcut React uygulamasını sarar
- [x] Yerel yürütme: uygulamayla gelen .NET ajanı (`apivator-agent`, sidecar) web'deki C# zincirini aynen çalıştırır; CORS yok, localhost ve iç ağ erişimi. *Plan değişikliği: Rust/reqwest ile yeniden yazmak yerine (tek kod, web ile aynı davranış; kurulum \~55 MB büyür).*
- [x] Collection runner'ı masaüstünde ajanla yerel çalıştırma (sonuçlar sunucuya rapor edilir)
- [x] Proxy (sistem/yok/özel, kimlik doğrulama, hariç tutulanlar), SSL doğrulaması ve ek CA, host bazında istemci sertifikaları (PFX/PEM); parolalar ve refresh token OS anahtar zincirinde
- [x] Windows kurulum paketi (NSIS, Türkçe, yönetici izni istemez; ayrıca MSI) ve imzalı otomatik güncelleme altyapısı (`updater` özelliği, GitHub Releases yayın iş akışı)
- [x] ~~Otomatik güncellemeyi bağla: imza anahtarı ve GitHub Releases ayarları; macOS/Linux paketleri~~ — *Faz 9.1'e taşındı*
- [x] Environment secret'larının güncel değerlerini masaüstünde anahtar zincirine taşıma — *yapıldı: değerler AES-256-GCM ile şifreli, anahtar OS anahtar zincirinde (Windows'ta kayıt boyutu sınırı yüzünden değerlerin kendisi değil)*

**Çıkış kriteri:** Ekibin test script'li en az 5 gerçek Postman collection'ı runner'da aynı sonuçlarla çalışıyor; desktop uygulaması localhost API'lerine istek atıyor.

## Faz 3 · Takım çalışması (tahmini 6–8 hafta)

**Durum: 3.1 ve 3.2 tamamlandı (21 Ekim 2026)**; collection seviyesinde rol daraltma açık. Organizasyonlar, takımlar, e-posta davetleri (7 gün geçerli, yeniden gönderme ve iptal, davet linkiyle kayıt) ve takım workspace'leri geldi. Etkin rol, doğrudan üyelik, takım rolleri ve organizasyon yöneticiliğinin en yükseğidir. Kontroller policy yerine her serviste aynı erişim katmanıyla yapılıyor. Ekip sayfası (`/team`), gruplu workspace seçicisi, workspace ayarları ve collection'ı başka workspace'e taşıma ya da kopyalama eklendi. Environment'lar zaten workspace'e bağlı; current value cihazda kalıyor. Bu sırada oturum yenilemenin giriş denemesi sınırına (IP başına dakikada 20) takıldığı görüldü. Aynı ofisten gelen ekipleri etkileyeceği için yenileme ayrı ve daha geniş bir sınıra alındı. Testler: backend 21 + 160, frontend 81 + 49. İki kullanıcılı davet, katılma, takım ve kopyalama akışı tarayıcıda uçtan uca denendi. Sırada 3.3 gerçek zamanlı senkron var.

**3.3 (21 Ekim 2026):** gerçek zamanlı senkron geldi; offline önbellek açık. SignalR hub'ı (`/hubs/workspace`) var. Değişiklikler servislerde değil, EF Core kaydetme anından (interceptor) yayımlanır, bu yüzden bir servisin olayı unutması mümkün değil. Olaylarda yalnızca kimlik ve sürüm taşınır, içerik her zaman yetkili API'den okunur. Açık sekmede kaydedilmemiş değişiklik yoksa istek sessizce güncellenir; varsa farklar gösterilir ve "onlarınkini al / benimkini kaydet" seçilir. Aynı seçim kaydederken alınan 409'da da çıkar. Çevrimiçi kişiler ve kimin hangi isteği açtığı görünür. Erişimi kaldırılan kişi açık bağlantısında da olay almayı bırakır. `Redis:ConnectionString` verilirse olaylar sunucular arası dağılır (iki API ile denendi). Presence sunucu başına bellekte tutuluyor.

**3.4 (21 Ekim 2026):** değişiklik geçmişi ve yorumlar geldi. Collection, klasör, istek, örnek ve environment değişiklikleri aynı kaydetme içinde kayda yazılır (EF interceptor). İstek ve environment için her sürümün anı saklanır, hedef başına en fazla 100 sürüm. İstekte "Sürümler" penceresi kim, ne zaman, ne değiştirdi sorusunu farkla gösterir; eski sürüme dönmek yeni bir sürüm olarak kaydedilir. Silinen istek aynı kimlikle geri getirilebilir, yorumları korunur. Kenar çubuğunda "Aktivite" akışı var; içe aktarma ve kopyalama tek kayıt olarak görünür. İstek ve collection üzerinde yanıtlı, çözülebilir yorumlar ve @bahsetme var. Bahsetmede uygulama içi bildirim ve e-posta, yanıtta bildirim gider; hepsi canlı güncellenir. Görüntüleyiciler yorum yazabilir ama geri yükleyemez. Testler: backend 21 + 175, frontend 81 + 60. Sırada 3.5 CLI runner var.

**3.5 (21 Ekim 2026):** `apivator` CLI geldi (.NET global tool, `Apivator.Cli`). Web ile aynı motoru kullanır. Collection'ı sunucudan (ad ya da kimlikle; environment ve globals dahil) ya da Postman v2.1 dosyasından çalıştırır. Seçenekler newman'a yakın: veri dosyası, iterasyon, klasör, `--bail`, `--env-var`, `--insecure`, `--ca-cert`. CLI, JUnit, JSON ve HTML rapor verir. Çıkış kodları: 0 başarılı, 1 kalan test ya da istek hatası, 2 kullanım hatası. Sonuç sunucuya "CLI'dan" etiketiyle kaydedilir. Kişisel API anahtarları hesap menüsünden yönetilir: yalnızca özet saklanır, anahtar bir kez gösterilir, süresi ayarlanabilir. Anahtarla yalnızca okuma ve rapor gönderme yapılabilir. GitHub Actions ve Azure DevOps örnekleri `docs/ci` altında. NuGet'e yayınlama git aşamasında yapılacak. Sırada 3.6 yayın hazırlığı var.

**3.6 (21 Ekim 2026) — Faz 3 tamamlandı:** Üretim kurulumu `deploy/` altında: Docker Compose (PostgreSQL, Redis, API, web, Caddy, yedekleme servisi), Caddy ile otomatik HTTPS (Let's Encrypt, kendi sertifikanız ya da iç CA). Günlük `pg_dump` yedeği, saklama süresi ayarlanabilir; `backup.sh` ve önce güvenlik yedeği alan `restore.sh` betikleri. API üretimde JSON log yazar; istek logları yol, durum, süre ve kullanıcıyı içerir, sorgu metni (token'lar) asla loglanmaz. `/health/live` ve `/health/ready` sürüm ve kontrol ayrıntılarını JSON döner. Ters proxy zinciri için `ForwardedHeaders:ForwardLimit` ayarı geldi. nginx'e güvenlik header'ları, gzip ve uzun süreli bağlantı ayarları eklendi. Rehberler: `docs/kurulum.md` (kurulum, güncelleme, yedekleme, ölçekleme, güvenlik listesi, sorun giderme) ve `docs/postman-gecis.md` (dışa/içe aktarma, script uyumluluğu, newman → apivator karşılıkları, kontrol listesi). Açık kalanlar: collection düzeyinde rol daraltma, masaüstünde çevrimdışı önbellek, CLI'ın NuGet'e yayını ve masaüstü güncelleyicisi (git aşamasında).

Hedef: ekip aynı collection'lar üzerinde birlikte çalışır ve Postman'i tamamen bırakır. v1.0 bu fazın sonunda çıkar.

**3.1 Organizasyon ve takımlar**

- [x] Organizasyon oluşturma, ayarlar, üye listesi
- [x] Team CRUD ve takım üyeliği
- [x] E-posta ile davet (Invitation: süre, durum, yeniden gönderme), davet linkiyle kayıt

**3.2 Workspace'ler ve roller**

- [x] Takım workspace'i oluşturma; kişi veya takım ekleme
- [x] Roller: Admin / Editor / Viewer; .NET policy-based authorization ile her endpoint'te kontrol
- [x] Collection seviyesinde rol daraltma (ve görüntüleyiciye collection bazında düzenleme izni)
- [x] Collection'ı kişisel workspace'ten takım workspace'ine taşıma veya kopyalama
- [x] Workspace paylaşılan environment'ları (initial value paylaşılır, current value kişide kalır)

**3.3 Gerçek zamanlı senkron**

- [x] SignalR hub: workspace odaları, değişiklik olaylarını diğer istemcilere iletme
- [x] Redis backplane (birden fazla API instance'ı için)
- [x] Optimistic concurrency (`Version`); çakışmada diff ve “benimkini koru / onlarınkini al” seçimi
- [x] Presence: kimin online olduğu, kimin hangi isteği açtığı
- [x] Offline önbellek (IndexedDB / SQLite) ve yeniden bağlanınca senkron — *IndexedDB, web ve masaüstünde aynı*

**3.4 Değişiklik geçmişi ve yorumlar**

- [x] ChangeLog: kim, ne zaman, ne değiştirdi (diff)
- [x] Eski sürüme geri alma
- [x] İstek ve collection üzerinde yorum, @bahsetme ve bildirim
- [x] Aktivite akışı (workspace'te son değişiklikler)

**3.5 CLI runner**

- [x] `apivator run` .NET global tool; API key ile sunucudan collection çekme veya dosyadan çalıştırma
- [x] JUnit XML, JSON ve HTML rapor çıktıları; başarısız testte sıfır olmayan çıkış kodu
- [x] Kişisel API key yönetimi (oluşturma, iptal etme)
- [x] GitHub Actions / Azure DevOps örnek pipeline'ları

**3.6 Yayın hazırlığı**

- [x] Self-hosted kurulum kılavuzu ve production Docker Compose
- [x] Yedekleme/geri yükleme, loglama ve sağlık kontrolü endpoint'leri
- [x] Ekip için Postman'den geçiş rehberi

**Çıkış kriteri:** Tüm ekip iki hafta boyunca Postman'i açmadan çalışıyor; paylaşılan collection'larda veri kaybı yaşanmadı; CI pipeline'ı en az bir collection'ı CLI ile çalıştırıyor.

## Faz 4 · Otomasyon (tahmini 4–6 hafta)

**4.1 (21 Ekim 2026) — Mock server tamamlandı:** Kenar çubuğunda "Mock'lar" bölümü ve collection menüsünde "Mock oluştur" var. Mock, collection'ın örnek yanıtlarını `/mock/{anahtar}/...` adresinde sunar; anahtar tahmin edilemez ve istenince yenilenir. Eşleştirme Postman'e yakın: method, yol (`:id`, `{id}`, çözülemeyen `{{değişken}}` her değere uyar; örnek URL'sindeki host ve `{{baseUrl}}` yok sayılır), query ve body puanlanır, eşitlikte 2xx öne geçer. `x-mock-response-code/name/id` seçimi daraltır, `x-mock-match-request-body` ve `x-mock-match-request-headers` eşitliği zorunlu kılar. Örneklerdeki değişkenler seçilen environment, collection ve globals'tan çözülür; gizli değerler asla yanıta yazılmaz. Gizli mock `x-api-key` ile workspace üyesinin API anahtarını ister. Gecikme (0–60 sn), açma/kapama, her origin'den çağrı (CORS), mock başına dakikada 600 istek sınırı var. Çağrı kayıtları (yetki header'ları maskeli) mock başına en yeni 500 kayıtla tutulur ve arayüzde birkaç saniyede bir tazelenir; mock'un sunduğu uç noktalar curl komutuyla listelenir. Collection taşınınca mock'ları da taşınır. Testler: backend 21 + 216, frontend 81 + 67. Tarayıcıda oluşturma, çağırma (200/404/201/eşleşmeyen) ve çağrı kaydı uçtan uca denendi. Sırada 4.2 monitörler var.

**4.2 (21 Ekim 2026) — Monitörler tamamlandı:** Kenar çubuğunda "Monitörler" bölümü ve collection menüsünde "Monitör oluştur" var. Monitör, collection'ı (isteğe bağlı bir environment'la) hazır sıklıklarla ya da cron ifadesiyle, IANA saat dilimine göre (yaz saati dahil) sunucuda çalıştırır; iki çalıştırma arası en az 5 dakika. Planda Hangfire vardı; yerine API'nin içinde çalışan küçük bir zamanlayıcı yazıldı (Cronos ile zamanlama, PostgreSQL `FOR UPDATE SKIP LOCKED` ile iş kapma). Ek bir servis ya da tablo kümesi gerekmiyor, birden fazla API örneğinde aynı monitör iki kez çalışmaz. Çalıştırma başarılı sayılır: tamamlandıysa, kalan test yoksa ve her istek yanıt aldıysa. Bildirimler e-posta (boşsa oluşturana) ve webhook ile (Slack, Teams ya da ayrıntılı JSON) gider; varsayılan olarak yalnızca durum değişince (ilk başarısızlıkta ve düzelince), istenirse her başarısızlıkta. Değişkenler environment ve globals'ın paylaşılan başlangıç değerlerinden gelir. Çalıştırmalar oluşturanın yetkisiyle yapılır; erişimi kalmazsa monitör durur ve haber verir, bir üye yeniden açınca onun adına çalışır. Ayrıntı ekranında 24 saat / 7 gün / 30 gün için başarı oranı, istek başına ortalama yanıt süresi grafiği (tablo görünümüyle), son çalıştırmalar ve kalan testler var; "Şimdi çalıştır" zamanlamayı bozmaz. Zamanlanmış çalıştırmalar runner geçmişinde "monitörden" görünür ve 30 gün saklanır. Testler: backend 21 + 233, frontend 81 + 74. Tarayıcıda oluşturma, elle çalıştırma, zamanlanmış çalıştırmanın canlı gelmesi ve başarısızlık/düzelme bildirimleri (e-posta ve webhook) uçtan uca denendi. Sırada 4.3 fork ve merge var.

**4.3 (22 Ekim 2026) — Fork ve merge tamamlandı:** Collection menüsünde "Fork'la" var. Kaynağı görebilen herkes (görüntüleyiciler dahil), düzenleyebildiği bir workspace'e fork'layabilir; fork collection'ı ağaçta simgeyle işaretlenir. Her klasör ve istek kaynaktaki karşılığına bağlıdır ve son eşitlemedeki ortak hâli (taban) saklar. Karşılaştırma üç yönlüdür: kim neyi değiştirdi, nerede çakışma var. "Kaynakla karşılaştır" ekranında kaynaktaki değişiklikler fork'a çekilir; çakışmalarda her öğe için "kaynağınkini al / benimkini koru" seçilir. Fork'taki değişikliklerle merge isteği açılır. Kenar çubuğundaki "Merge'ler" bölümünde istek bazında farklar, yorumlar (mevcut yorum sistemi, @bahsetme dahil), onay, birleştirme ve red var. Çakışma varken birleştirme kapalıdır; birleştirmede değişen istekler aynı kimlikle güncellenir, yorumları ve sürüm geçmişi korunur. Açılan istek kaynağın düzenleyicilerine, birleştirme ve red isteği açana bildirim olarak gider; e-postadaki bağlantı isteği doğrudan açar. Karşılaştırılan alanlar: istekte ad, konum, tanım ve örnekler; klasörde ad, konum, yetkilendirme ve script'ler; collection'da açıklama, yetkilendirme, değişkenler ve script'ler. Ad ve sıralama karşılaştırılmaz. Testler: backend 21 + 241, frontend 81 + 80. İki kullanıcıyla tarayıcıda uçtan uca denendi: görüntüleyici fork'ladı, çakışmayı çözdü, istek açtı; sahip bildirimden açıp onayladı ve birleştirdi. Sırada 4.4 ek protokoller var.

**4.4 (22 Ekim 2026) — Ek protokoller ve formatlar tamamlandı; Faz 4'ün geliştirme maddeleri bitti:** İstek editöründe URL'nin solunda tür seçici var: HTTP, SSE, WebSocket. Tür istek tanımında saklanır (ağaçta `SSE` / `WS` rozeti için ayrıca bir kolon eklendi). SSE isteği normal istek gibi hazırlanır (değişkenler, yetkilendirme, OAuth token'ı) ve sunucu yanıtı akıtır: olaylar ad, veri ve kimlikleriyle geldikçe listelenir, "Durdur" bağlantıyı keser. WebSocket'te tarayıcı header gönderemediği ve hedefe kendi ağından çıktığı için bağlantı köprüden kurulur: web'de sunucu, masaüstünde yerel ajan. Köprü normal isteklerle aynı ağ korumasını, proxy ve SSL ayarlarını kullanır. Mesaj geçmişinde gelen/giden mesajlar zaman, boyut ve tam içerikle (JSON biçimli) görünür, aranır ve yöne göre süzülür; ikili mesajlar base64 gönderilir. Sık kullanılan mesajlar istekle birlikte kaydedilir ve ekiple paylaşılır; alt protokoller "Ayarlar"dadır. Runner ve monitörler WebSocket/SSE isteklerini atlar. Postman formatında bu türlerin karşılığı yok; dışa aktarımda `x-apivator` alanında taşınır ve geri okunur. Collection menüsünden OpenAPI 3.0.3 dışa aktarılır (JSON ya da YAML): sunucu adresi, yol parametreleri, etiketler, parametreler, body ve örnek yanıtlardan şema ve örnekler, güvenlik şemaları. İçe aktarma penceresi HAR dosyalarını da alır: host'a göre klasörler, tekrar eden istekler birleşir, statik dosyalar ve bağlantı header'ları atlanır, yanıtlar örnek olur. Denerken bulunan eski bir hata da düzeltildi: ASCII dışı header değerleri (ör. "Ayşe") hata veriyordu; artık Postman'deki gibi UTF-8 gönderiliyor. Testler: backend 21 + 252, frontend 89 + 85. Tarayıcıda SSE akışı (Bearer ile), WebSocket (değişkenli header, alt protokol, kayıtlı ve yazılan mesaj, kaydetme, kesme), OpenAPI YAML indirme ve HAR içe aktarma uçtan uca denendi. Faz 4'ün çıkış kriteri (ekip kullanımı) sahada doğrulanacak.

**Kalanlar (22 Ekim 2026) — collection rolleri, çevrimdışı önbellek ve Faz 2 kalanları tamamlandı:** Collection menüsünde "Erişim ve roller" var. Workspace yöneticisi bir kişiye ya da takıma yalnızca o collection için Görüntüleyici veya Düzenleyici rolü verebilir (daraltma ya da görüntüleyiciye düzenleme izni) ve "Düzenlemeyi kısıtla" ile collection'ı yalnızca yöneticilere ve Düzenleyici verilenlere açabilir. Kişiye verilen rol takım rolünden önce gelir. Kontroller sunucuda: istek, klasör, örnek, sürüm geri yükleme, taşıma/kopyalama ve merge. Arayüzde kilit simgesi var; editör salt okunur olur (istek değiştirilip gönderilebilir ama kaydedilemez). Değişiklik açık oturumlara canlı yansır. Çevrimdışı önbellek: workspace'ler, collection ağaçları, istek tanımları, environment'lar ve geçmiş kullanıcı başına IndexedDB'de saklanır. Değişen collection'ların istekleri arka planda tek istekle indirilir, böylece hiç açılmamış istekler de çevrimdışı açılır. Sunucuya ulaşılamazsa uygulama son oturumla açılır ve bandla bildirir. Çevrimdışı kaydedilenler cihazda bekler, bağlantı gelince sırayla kaydedilir (çakışmada mevcut farklar ekranı açılır); canlı kanal da hemen yeniden bağlanır. Uyumluluk seti `compat/` altında: 29 vaka (yanıt doğrulama, değişkenler, ön istek/imza/token yenileme, eski v1 API, kütüphaneler) ve ekibin dışa aktardığı collection'ları tarayan bir test (söz dizimi hatası ya da desteklenmeyen API'yi istek yoluyla listeler). Set şu eksikleri gösterdi, hepsi eklendi: `pm.cookies`, `pm.response.size()`, `pm.response.to.have.jsonSchema`, `to.be.accepted/withBody/html/xml`, `tv4`, `moment`, `uuid`, `xml2Json`, eski `data`/`iteration`/`request`/`responseBody.has`, 20 dinamik değişken (`$randomEmail` vb.). Ayrıca `set(7)` sonrası `get()` artık Postman gibi sayı dönüyor, kütüphane içinden atılan hatalar kullanıcının satırını gösteriyor. Masaüstünde değişkenlerin güncel değerleri AES-256-GCM ile şifreli saklanıyor; anahtar OS anahtar zincirinde. Değerler doğrudan anahtar zincirine konmadı, çünkü Windows'ta kayıt başına yaklaşık 1280 karakter sınırı var ve uzun JWT'ler sığmıyor. Bu sırada iki eksik fark edildi: kökten sessiz modda çalışan `pnpm -s typecheck` web paketinin hatalarını göstermiyordu; 4.2'den kalan 4 tip hatası düzeltildi ve README'ye not düşüldü. Testler: backend 21 + 287, frontend 92 + 101, Rust 4; üretim derlemesi temiz. Tarayıcıda iki kullanıcıyla collection rolleri (canlı kilitlenme, menü, 403) ve çevrimdışı akış (sunucu kesik açılış, önbellekten istek açma, çevrimdışı kaydetme, bağlantı gelince otomatik kayıt) uçtan uca denendi.

**5.1 (22 Ekim 2026) — Protokoller tamamlandı:** GraphQL body'sinde şema, isteğin kendi adresi, header'ları ve yetkilendirmesiyle introspection sorgusu gönderilerek alınır. Bunun için mevcut istek yolu kullanılır; ayrı bir sunucu ucu yok. Adres yazılmayı bitirince (800 ms) adres başına bir kez istenir ve tarayıcıda (IndexedDB) saklanır. Editörde alan/argüman tamamlama, hata altı çizme ve biçimlendirme var. Şema gezgini kök işlemleri, tipleri ve aramayı gösterir; bir alandan zorunlu argümanları değişkene çeviren örnek işlem eklenir. Introspection'ı kapalı sunucularda bu açıkça söylenir. GraphQL kodu ayrı bir parçada yüklenir, ana paketi büyütmez. gRPC yeni bir istek türü. Tanımlar server reflection'dan (v1, yoksa v1alpha) ya da yüklenen `.proto` dosyalarından gelir; dosyalar istekle kaydedilir, hatalar dosya:satır ile gösterilir. Metot listesi servislere göre gruplanır; her metodun türü (unary, sunucu/istemci/çift yönlü akış), giriş/çıkış tipleri ve örnek mesajı vardır. Mesajlar proto3 JSON eşlemesiyle yazılır ve okunur; iyi bilinen tipler (Timestamp, Duration, wrapper'lar, Struct, Any, FieldMask) dahil. Kodlayıcı resmî Google.Protobuf kütüphanesine karşı test edildi. Tarayıcı HTTP/2 trailer'larına erişemediği için çağrılar WebSocket köprüsünden yapılır: web'de sunucu, masaüstünde yerel ajan. Ağ koruması, proxy ve SSL ayarları geçerlidir. Yanıt metadata'sı, gelen/giden mesajlar, durum ve trailer'lar akış listesinde görünür. İstemci/çift yönlü akışta mesajlar eklenip akış bitirilir; süre sınırı ve iptal var. Metadata isteğin header'larıdır, yetkilendirme metadata'ya çevrilir. Postman dışa aktarımında ayarlar `x-apivator` alanında taşınır; OpenAPI, runner, monitör ve mock gRPC'yi atlar. Bu sırada fark edilen eski bir hata düzeltildi: OAuth akışındaki kullanıcı mesajları (ör. "Giriş penceresi kapatıldı") "Beklenmeyen bir hata" olarak görünüyordu. Testler: backend 21 + 300 (gerçek bir Grpc.AspNetCore sunucusuna karşı dört çağrı türü, reflection, `.proto`, hata/trailer, süre sınırı, iptal, yerel ajan), frontend 95 + 113; üretim derlemesi temiz. Tarayıcıda reflection, metadata ile unary, NOT_FOUND hatası, çift yönlü akış, kaydedip yeniden açma, iptal, `.proto` yükleme ile sunucu akışı ve bozuk `.proto` hatası uçtan uca denendi. Bilinen sınırlar: gRPC isteklerinde script çalışmıyor; proto2 group alanları ve gRPC-Web desteklenmiyor.

**5.2 (22 Ekim 2026) — Dokümantasyon tamamlandı:** Klasörlere ve isteklere Markdown açıklama eklendi (önceden yalnızca collection'da vardı): klasörde menüden, istekte editördeki "Açıklama" bölümünden. Açıklamalar Postman ve OpenAPI içe/dışa aktarmada taşınıyor; OpenAPI'den gelen işlem açıklamaları ve parametre açıklamaları da alınıyor. Collection menüsündeki "Dokümantasyon" sayfası şunları gösteriyor: açıklamalar, değişkenler, yetkilendirme özeti; her istek için adres (değişkenler çözülmüş), parametreler, header'lar, gövde, örnek yanıtlar ve 6 dilde örnek kod. Solda gezinti ve arama var, environment seçilebiliyor. "Yayınla" organizasyon içi (organizasyon üyeleri oturumla) ya da herkese açık (oturumsuz; yalnızca workspace yöneticisi) bir bağlantı üretir. Yayın canlıdır; bağlantı yenilenebilir ve yayından kaldırılabilir. Gizli değişken değerleri, yetkilendirme bilgileri, script'ler ve hassas header/parametre değerleri hiçbir zaman yayınlanmıyor; bu testle doğrulanıyor. Yayın uçları önbelleğe alınmıyor, arama motorlarına kapalı ve IP başına hız sınırlı. Sayfa ayrı parçalarda yükleniyor, ana paketi büyütmüyor. Testler: backend 21 + 305, frontend 95 + 118; üretim derlemesi temiz. Tarayıcıda uçtan uca denendi: klasör ve istek açıklaması yazma, doküman sayfası, arama, kod dili, organizasyon içi yayın (oturumsuz ziyaretçiye giriş istemi), herkese açık yayın, dar ekran (yatay kaydırma yok), yayından kaldırma. Bilinen sınır: sayfanın tasarımı (tema, logo) özelleştirilemiyor.

Hedef: collection'lar insan müdahalesi olmadan çalışır; frontend ekipleri henüz yazılmamış API'lere karşı mock ile geliştirir.

**4.1 Mock server**

- [x] Collection'daki Example'lardan mock endpoint üretme (`/mock/{id}/...`)
- [x] Metod, path ve header'a göre eşleştirme; `x-mock-response-code` ile yanıt seçimi
- [x] Gecikme simülasyonu, çağrı logları

**4.2 Monitörler**

- [x] Collection + environment + zamanlama (cron) tanımı; Hangfire ile çalıştırma
- [x] Başarısızlıkta e-posta, webhook (Slack/Teams) uyarısı
- [x] Monitör geçmişi: başarı oranı ve yanıt süresi grafiği

**4.3 Fork ve merge**

- [x] Collection fork'lama (kaynak bağlantısı korunur)
- [x] Merge isteği: istek bazlı diff, yorum, onay/red
- [x] Kaynaktan güncellemeleri fork'a çekme

**4.4 Ek protokoller ve formatlar**

- [x] WebSocket istekleri: bağlan, mesaj gönder/al, mesaj geçmişi
- [x] Server-Sent Events akışını izleme
- [x] OpenAPI 3.x dışa aktarma, HAR içe aktarma

**Çıkış kriteri:** En az bir ekip API'si monitörle 7/24 izleniyor ve uyarı gerçekten tetiklendi; frontend ekibi bir özelliği mock server'a karşı geliştirdi.

## Faz 5 · Genişleme (sürekli)

Hedef: ekip geri bildirimine göre sıralanan bir özellik havuzu; her madde ayrı küçük sürüm olarak çıkar.

**Durum: 5.1–5.4 tamamlandı (23 Ekim 2026).** Havuzdaki tüm maddeler bitti: denetim kaydı, SSO (OIDC), Helm ve yatay ölçekleme, Yjs ile ortak düzenleme, Git senkronu. Ayrıntılar maddelerin altında; çıkış kriterleri her madde için ekipte doğrulanmalı.

**5.1 Protokoller**

- [x] gRPC: `.proto` yükleme veya server reflection, unary ve streaming çağrılar
- [x] GraphQL: introspection ile şema keşfi, sorgu otomatik tamamlama

**5.2 Dokümantasyon**

- [x] Collection'dan otomatik API dokümantasyonu sayfası
- [x] Organizasyon içi veya public yayınlama linki

**5.2 çıkış kriteri:** En az bir ekip API'sinin dokümanı organizasyon içinde yayınlandı ve başka bir ekip (ör. frontend) entegrasyonda kaynak olarak kullandı. Yayından önce gizli değer, token ve script sızmadığı bağlantı oturumsuz açılarak kontrol edildi.

**5.3 Kurumsal**

- [x] SSO: OIDC (Azure AD / Entra ID, Google Workspace), SAML opsiyonel

**SSO (23 Ekim 2026):** Ekip sayfasında "SSO" sekmesi (yöneticiler görür, yalnızca sahip değiştirir). Organizasyon başına bir OIDC sağlayıcısı: issuer adresi (kaydederken keşif belgesi çekilir; issuer adresle aynı, tüm uçlar https olmalı, Entra'da kiracıya özel adres), client ID ve Data Protection ile şifreli client secret (hiç döndürülmez). IdP'ye kaydedilecek dönüş adresi `{PublicUrl}/api/auth/sso/callback`. Alan adları DNS TXT kaydıyla (`_apivator.<alan>` = `apivator-verification=…`) doğrulanır; doğrulanmış alan adı tek organizasyona aittir ve günde bir yeniden kontrol edilir (DNS hatası sayılmaz, art arda 3 kez bulunamazsa doğrulama kalkar, alan kalmazsa SSO kapanır). Giriş: girişte e-posta yazılınca SSO önerilir; sunucu authorization code + PKCE + state + nonce ile IdP'ye yönlendirir, id_token'ı (imza RS/PS/ES, issuer, audience, süre, nonce) doğrular ve **yalnızca organizasyonun doğruladığı alan adlarındaki** adreslere giriş verir. Dönüşte 60 saniyelik tek kullanımlık kod üretilir; kod yalnızca akışı başlatan istemcinin verifier'ıyla oturuma çevrilir (login CSRF), web ve masaüstü (yerel ajan loopback, RFC 8252) aynı akışı kullanır. Hesap eşleme: kimlik (issuer + sub) daha önce bağlandıysa o hesap; aynı e-postalı doğrulanmış hesap varsa bağlama e-postayla onaylanır (Entra'da e-posta claim'i değiştirilebildiği için; e-postada girişi başlatan IdP kimliği, IP ve zaman yazar, onay oturum açmaz); hiç doğrulanmamış aynı adresli hesap (başkası önceden açmış olabilir) emekliye ayrılır ve temiz hesap açılır; hesap yoksa otomatik açılır ve varsayılan rolle üye yapılır (kapatılabilir). "SSO zorunlu": alan adındaki hesaplar şifreyle giremez ve e-posta değiştiremez, açılınca açık oturumları kapanır; sahip acil durum için şifreyle girebilir. SSO açık alan adında şifreyle hesap açılamaz. Zorunlu SSO'da, o IdP'ye bağlı üyeler için organizasyonun 2FA şartı IdP'ye bırakılır (6.4'teki madde). Tüm adımlar denetim kaydında (`sso.*`, başarısız denemeler IP ile). Migration `AddSso`. Plandan sapmalar: SAML yapılmadı (kullanıcı kararı: yalnızca OIDC); SCIM yok (IdP'den çıkarılan kişinin Apivator oturumu refresh süresince sürer); 2FA muafiyeti oturuma değil kişiye bağlı; Data Protection anahtarları veritabanında şifresiz durur (secret'lar onlarla açılır). Testler: 28 SSO entegrasyon testi (sahte OIDC sağlayıcısıyla: JIT, alan adı dışı adres, bozuk/HS256 id_token, state/kod tekrar ve yarış, masaüstü loopback, hesap bağlama/emekliye ayırma, zorunluluk, yeniden doğrulama); frontend SSO sekmesi, giriş, dönüş ve bağlama sayfaları için testler.
- [x] Denetim kaydı (audit log) ve dışa aktarma

**Denetim kaydı (23 Ekim 2026):** Ekip sayfasında yalnızca sahip ve yöneticilerin gördüğü "Denetim kaydı" sekmesi var. Kayıt; organizasyon (oluşturma, ad, sahiplik devri, 2FA zorunluluğu), üyelik (ekleme, rol, çıkarma, ayrılma, hesap silme), davet, takım, workspace (oluşturma, ad, silme, kişi/takım rolleri), collection erişimi (kısıtlama, collection rolleri, silme, başka workspace'e/organizasyona taşıma), doküman yayını (görünürlük, bağlantı yenileme), mock (görünürlük, adres yenileme), monitör, API anahtarı ve yönetici işlemlerini (oturum kapatma, şifre sıfırlama bağlantısı) kapsar. Her olayda kim (ad, e-posta, API anahtarıyla mı), ne zaman, nereden (IP, cihaz), hangi workspace ve olaya özgü ayrıntı (eski/yeni rol vb.) saklanır; adlar olay anındaki hâliyle tutulur. Olaylar değişiklik kaydı gibi EF Core kaydetme anında (interceptor) yazılır, yani bir servisin unutması mümkün değil ve kayıt değişiklikle aynı işlemde kaydedilir. Bir üst öğeyle birlikte gelen alt değişiklikler tekrar yazılmaz (organizasyon açılırken eklenen sahip ve "Genel" workspace, çıkarılan üyenin takım/workspace üyelikleri). Varlık değişikliği olmayan olaylar (yönetici işlemleri, dışa aktarma, toplu silinen hesap üyelikleri) açıkça yazılır. Kişisel organizasyonlarda kayıt tutulmaz. Liste olay türü, tarih aralığı ve kişi/hedef aramasıyla süzülür, sayfa sayfa yüklenir; CSV (UTF-8 BOM, `;` ayırıcı, Excel formül enjeksiyonuna karşı kaçış) ya da JSON (SIEM için) olarak akıtılarak indirilir ve dışa aktarma da kayda geçer; filtreye uyan kayıt `Audit:MaxExportRows` (100.000) sınırını aşarsa dosya yarıda kesilmez, aralığı daraltmak istenir. Saklama süresi `Audit:RetentionDays` (varsayılan 365, 0 = silinmez); süresi dolanlar listede görünmez ve günlük bir arka plan işi parça parça siler. Denetim kaydı ve SSO ayarları API anahtarıyla okunamaz (yalnızca oturumla). Olay kodları (`member.role_changed` gibi) kararlıdır. Migration `AddAuditLog` (+ `AddGitSync` içinde `created_at` indeksi). Plandan sapmalar: istek/environment içeriği kayda alınmadı (workspace etkinlik akışında zaten var); hesabını silen kişinin adı ve e-postası denetim kayıtlarında saklama süresi boyunca kalır (meşru menfaat; süre dolunca silinir); kişisel API anahtarı olayları sahibinin üye olduğu tüm organizasyonlara yazılır.
- [x] Kubernetes için Helm chart, yatay ölçekleme

**Helm ve yatay ölçekleme (23 Ekim 2026):** `deploy/helm/apivator`: API ve web Deployment'ları, Service, Ingress (TLS, birden fazla API'de SignalR için sticky cookie), HPA ve PDB (isteğe bağlı), Secret (ya da `existingSecret`), ConfigMap, web için şablonlanmış nginx yapılandırması, isteğe bağlı NetworkPolicy. API root olmayan kullanıcıyla, salt okunur dosya sisteminde çalışır. Veritabanı şeması kurulum/güncelleme öncesi bir Helm Job ile güncellenir: API'ye `--migrate-only` modu eklendi (sunucu başlamaz, hata olursa sıfır olmayan çıkış). Birden fazla replikada Redis zorunludur (chart aksi hâlde kurulmaz). Ölçekleme için koddaki düzeltmeler: çevrimiçi listesi (presence) ve ortak düzenleme belgesi Redis'te paylaşılır; denetim kaydı temizliği ve SSO alan adı kontrolü birden fazla örnekte güvenli çalışır (monitör/kaynak zamanlayıcıları zaten `SKIP LOCKED`). Kurulum rehberinde (kurulum.md) "Kubernetes ve Helm" bölümü. Doğrulama: `helm lint` ve `helm template` (varsayılan, 3 replika + Redis + HPA + TLS); gerçek bir kümede denenmedi. Plandan sapmalar ve bilinen sınırlar: hız sınırları sunucu başına bellekte (N replikada etkin sınır N katı; ingress'te sınır önerilir); oturum kapatma diğer sunuculara en geç 30 sn'de yansır; geri dönüşte (rollback) şema yeni sürümde kalır.

**5.4 İleri işbirliği**

- [x] Yjs (CRDT) ile aynı isteği aynı anda düzenleme

**Ortak düzenleme (Yjs, 23 Ekim 2026):** Kayıtlı bir istek birden fazla kişide açıksa taslak ortak bir Yjs belgesi olur: URL, method, header/param/form tabloları, body, script'ler, açıklama ve yetkilendirme alanları birleşir. Alanlar tek tek eşleniyor: metinler `Y.Text` (aynı alanda eşzamanlı yazım karakter karakter birleşir), tablolar satır dizisi (bir satırı eklemek/silmek ya da başka satırı düzenlemek birbirini bozmaz), method/body türü gibi seçimler son yazan kazanır. Canlı kanala (`/hubs/workspace`) `JoinDocument`, `SendUpdate`, `SendAwareness`, `CompactDocument`, `LeaveDocument` eklendi; sunucu içeriği çözmeden sıralı güncelleme günlüğü tutar ve geç gelene verir, katılımda collection yetkisine bakar (görüntüleyici alır ama yazamaz; üyelik/yetki değişince `docRevoked`/`docAccessChanged`). Belgeyi ilk gelen kaydedilmiş sürümden tohumlar (sunucu tohumlama hakkını tek kişiye verir); günlük 40 kaydı aşınca istemci birleştirip geri yazar; son katılımcı çıkınca belge silinir. `Redis:ConnectionString` tanımlıysa günlük Redis'te (sunucular arası paylaşılır, 2 saat yedek süre), değilse bellekte tutulur. Kaydetme eskisi gibi `PUT /api/requests/{id}`: kaydedilen sürüm yalnızca taban olur, ortak taslak ezilmez; başkası kaydedince diğerlerinde çakışma çıkmaz, sekmenin "kaydedilmemiş" durumu yeni sürüme göre yeniden hesaplanır. Kaydedilmemiş yerel değişikliği olan biri, belgede başkaları varken katılırsa sessizce ezilmez: "Ortak taslağa katıl (yerel değişiklikler atılır)" ya da "Tek başıma düzenle" seçtirilir. İstek başlığında birlikte düzenleyenlerin avatarları (imleç rengiyle), body ve script editörlerinde diğer kişilerin imleç ve seçimi, URL alanında kimin yazdığı gösterilir. Başkası aynı metni değiştirince imleç yerinde kalır (editör yalnızca değişen aralığı yazar). Sınırlar: henüz kaydedilmemiş yeni sekmeler tek kişiliktir; ortak taslak dışından yapılan kayıtlar (API, CLI, içe aktarma, git senkronu) etkin bir ortak taslağa birleşmez, sonraki kaydeden onun üzerine yazar; istek adı ve açıklama alanının imleci ortak değildir (içerik birleşir); SignalR mesaj sınırı 2 MB'a çıkarıldı, daha büyük tek güncelleme (çok büyük yapıştırma) reddedilir. Güvenlik: kimlik sunucudan damgalanır (imleç/awareness etiketleri yalnızca görseldir, yetki ya da "kim düzenledi" kaydı için kullanılmaz); belge başına 8 MB ve bağlantı başına hız sınırı; yazma yetkisi 30 sn'de bir yeniden denetlenir; sıkıştırma düzenleyicilere güvenir (sunucu içeriği çözmediği için doğrulayamaz, istemci birleşimi göndermeden önce doğrular). Testler: backend 11 yeni (CollabTests, Redis günlüğü yerel Redis varsa çalışır, yoksa atlandı olarak raporlanır), frontend 15 yeni.
- [x] Git senkronu: collection'ları repoda dosya olarak saklama

**Git senkronu (23 Ekim 2026):** Collection menüsünde "Git senkronu". Workspace yöneticisi collection'ı herhangi bir https Git deposuna (GitHub, GitLab, Azure DevOps, Gitea, Bitbucket) dal + klasör yolu + erişim belirteciyle bağlar; belirteç Data Protection ile şifreli saklanır ve hiçbir yanıtta dönmez (yalnızca "belirteç var"). Düzenleyici ve üstü "Repoya gönder" ve "Repodan al" kullanır. Dosya düzeni: `collection.json`, her klasör için dizin + `folder.json`, her istek için `{ad}.request.json` (örnekler isteğin dosyasında); yazma deterministiktir (sabit alan sırası, varsayılan değerler yazılmaz, çakışan adlara kimlik eki), her dosya kimliği içerir, bu yüzden dosya yeniden adlandırılsa da öğe eşleşir ve alınırken kimlikler korunur; dizin taşımak klasör değiştirmek demektir. Depoya gizli değer yazılmaz: yetkilendirme sırları `{{bearerToken}}` gibi yer tutucuya, gizli değişkenlerin değeri boşluğa çevrilir; alırken yer tutucunun yerine yereldeki gerçek değer korunur (başlık/gövdeye elle yazılmış sırlar tanınamaz). Karşılaştırma fork/merge ile aynı mantıkta üç yönlüdür (son eşitlemedeki ortak hâl = taban, hem yerelde hem uzakta değişen ve farklı olan = çakışma; "depodakini al / benimkini koru / şimdilik dokunma" seçilir, önizlemedeki commit değiştiyse alma reddedilir); gönderme, uzakta alınmamış değişiklik varsa reddedilir (önce al). Sapma: fork motoru veritabanı varlıklarına bağlı olduğundan doğrudan kullanılmadı; aynı kurallar dosya tabanlı bir motorla yeniden yazıldı. Durum ekranı: gönderilecek/alınacak öğe sayısı, son commit, son hata; isteğe bağlı otomatik kontrol (1/6/24 saat, `FOR UPDATE SKIP LOCKED` zamanlayıcı) yalnızca alınacak sayısını günceller, hiçbir şeyi kendiliğinden uygulamaz, bildirim yok. Denetim kaydına `git.connected/disconnected/pushed/pulled` yazılır (denetim kaydı API'sine workspace parametreleri eklendi). SSRF: adres https olmalı (http yalnızca `GitSync:AllowHttp`), adın çözüldüğü her IP `NetworkGuard`'dan geçer; libgit2'nin ağ katmanı kullanılmaz: http/https git istekleri özel bir smart-HTTP aktarımıyla `NetworkGuard`'lı SSRF korumalı HttpClient'tan geçer; bağlantıda çözülen her IP (yönlendirmeler dahil) yeniden denetlenir, böylece DNS rebinding ve yönlendirmeyle iç ağa geçilemez. libgit2 (LibGit2Sharp) geçici çıplak depoyla çalışır: her işlemde dal baştan çekilir (büyük depolarda yavaş olabilir), SSH adresleri desteklenmiyor, masaüstü ajanı desteği yok. Sertleştirme: depo adresi kanonik yazılmalı (kullanıcı bilgisi, `\`, `?`, `#`, boşluk, ondalık/onaltılık/sekizlik IP ve IPv4-eşlenmiş IPv6 reddedilir; yalnızca kanonik metin saklanır); sunucu (host) değişince yeni belirteç girilmedikçe kayıtlı belirteç silinir ve denetim kaydına eski/yeni sunucu yazılır; gönderme sırasında sabit Authorization/Cookie/API anahtarı, Bearer/JWT benzeri değerler uyarı verir (onaylanmadan gitmez), örneklerden Set-Cookie/Cookie/Authorization başlıkları çıkarılır; yalnızca tam `{{ad}}` biçimi yer tutucu sayılır; alınan istekte sunucu değişiyorsa ve istek yetkilendirme kullanıyorsa önizlemede uyarı çıkar; çözülemeyen belirteç sessizce anonim denenmez, "yeniden girin" hatası verilir; ham libgit2 hatası yalnızca workspace yöneticisine gösterilir; `.git*`, `git~1`, aygıt adları ve NTFS akışı gibi adlar dosya adında etkisizleştirilir; kopyalar arası kilit PostgreSQL advisory lock'tur; HTTP(S)'te derinlik 1 çekme, yanıt boyutu sınırı (`GitSync:MaxFetchMegabytes`), açılışta geçici dizin temizliği; otomatik kontrol üst üste 5 hatadan sonra kapanır. Gönderirken her zaman bağlantının belirteci kullanılır (arayüzde not düşüldü). Migration `AddGitSync`. Testler: backend 40 entegrasyon testi (yavaş gövde/ağ hatası/kilit dahil) (gerçek `git http-backend` ile Basic kimlik doğrulamalı http uçtan uca: bağla-gönder-al-çakışma, yanlış belirteç; yerel çıplak depoyla: doğrulama/SSRF, belirteç sızmaması, gizlilik, deterministik dosyalar, alma, çakışma, silme, izinler, denetim, zamanlayıcı, korumalı aktarım: Basic kimlik doğrulama, engelli adrese yönlendirme ve doğrudan engelli adres).

**Çıkış kriteri:** Yok; her madde için çıkış kriteri, havuzdan alındığında yazılır.

## Faz 6 · Yanıtla çalışma ve hesap yönetimi (tahmini 5–7 hafta)

Hedef: yanıt verisi ekibin diğer araçlarına (Excel, kod tabanı) tek adımda taşınır; kullanıcı hesabını destek istemeden uygulama içinden yönetir.

**Durum: 6.4 tamamlandı (23 Ekim 2026) — Faz 6 bitti.** İki adımlı doğrulama: TOTP (RFC 6238; QR kod tarayıcıda üretiliyor, anahtar Data Protection ile şifreli, aynı kod ikinci kez kabul edilmiyor) ve 10 tek kullanımlık yedek kod (yalnızca özetleri saklanıyor, bir kez gösteriliyor, yenilenebiliyor). Giriş iki adımlı: şifreden sonra 5 dakikalık belirteçle kod ya da yedek kod; hatalı kodlar kilitlenmeye sayılıyor. Organizasyon düzeyinde zorunlu kılma: yöneticinin kendi 2FA'sı açık olmalı; zorunluyken 2FA'sı olmayan üyeler organizasyonun workspace'lerini (liste, erişim, API anahtarı) göremiyor ve uygulamada "Şimdi kur" uyarısı alıyor; zorunluyken 2FA kapatılamıyor ve yönetim işlemleri de 2FA istiyor; yöneticiler üyelerin 2FA durumunu görüyor. Güvenlik geçmişi (`security_events`, bir yıl): giriş, başarısız giriş, kilitlenme, şifre/e-posta değişikliği, şifre sıfırlama, 2FA açma/kapama, yedek kod kullanımı/yenileme, yönetici işlemleri; Hesap ayarları › Güvenlik'te listeleniyor. Son 180 günde görülmemiş cihazdan girişte e-posta uyarısı. Yönetici işlemleri: üyenin oturumlarını kapatma ve şifre sıfırlama bağlantısı gönderme (sahibe yalnızca sahip; üyeye e-posta). Migration `AddAccountSecurity`. Plandan sapmalar: denetim kaydı (5.3) henüz olmadığından yönetici işlemleri üyenin güvenlik geçmişine yöneticinin adıyla yazılıyor; SSO (5.3) olmadığından "kimlik sağlayıcıya bırakma" kuralı SSO ile birlikte gelecek; CLI/CI API anahtarları ikinci adım istemiyor (zorunlu organizasyonda 2FA'sı kapalı kullanıcının anahtarı da erişemiyor); "bu cihazı hatırla" yok; güvenlik e-postaları kapatılamıyor. Doğrulama: RFC 6238 test vektörleri; tarayıcıda iki kullanıcıyla uçtan uca (sahibin 2FA kurması, organizasyonda zorunlu kılma, üyenin uyarıyı görüp kurması ve erişimin gelmesi, yöneticinin üyenin oturumlarını kapatması, yedek kodla giriş, güvenlik geçmişi); QR kodu ekran görüntüsünden çözülerek doğrulandı. Testler: backend 21 + 346, frontend 130 + 156, Rust 5. Faz 6 çıkış kriterleri ekipte doğrulanmalı (Excel'de açma, C#/Java modelinin projede derlenmesi, 2FA zorunluluğu, Swagger adresinden içe aktarıp güncelleme).

**Durum: 6.5 tamamlandı (23 Ekim 2026).** İçe aktarma penceresinde "Adres (Swagger)" sekmesi: belge adresi (JSON/YAML), Swagger UI / ReDoc / Scalar sayfası (Swashbuckle, springdoc `swagger-config`, swagger-ui-dist, FastAPI `/docs`, NestJS'in gömülü belgesi) ya da yalnızca sunucu adresi (bilinen yollar sırayla; .NET ve springdoc'ta sürüm listesi de okunur). Birden çok sürümde seçim, korumalı belgeler için Bearer/header (saklanmaz, yalnızca belgenin sunucusuna gider). Sunucuda YAML okuyucu (YamlDotNet; takma ad bombasına karşı düğüm sınırı) ve Swagger 2.0 → OpenAPI 3 çevirici eklendi; Swagger 2.0 dosyadan içe aktarmada da artık kabul ediliyor. Göreli ya da eksik sunucu adresi belgenin geldiği adrese göre tamamlanıyor. Web'de belgeyi sunucu (SSRF korumalı istemciyle), masaüstünde yerel ajan (`POST /openapi/fetch`) çekiyor. Kaynak `collection_sources` tablosunda (son uygulanan belge, özet, sürüm, kontrol ayarları), istekler `source_key` ile (metot + yol) eşleşiyor; migration `AddCollectionSources`. "Kaynaktan güncelle" farkı son uygulanan belge ile yeni belge arasında hesaplıyor (yerel düzenlemeler değişiklik sayılmıyor): yeni / değişen (bölüm bazında) / kaldırılan uçlar, seçilerek uygulanıyor; header ve query parametreleri anahtar bazında birleşiyor, kullanıcının değerleri, script'leri, örnekleri, yerel ad ve açıklaması korunuyor. Otomatik kontrol (1 / 6 / 24 saat) zamanlayıcıyla (FOR UPDATE SKIP LOCKED) çalışıyor; değişiklikte ağaçta rozet ve kontrolü açan kişiye uygulama içi bildirim (aynı değişiklik için bir kez). Kararlar ve sınırlar: yolu değişen uç "kaldırılan + yeni" görünür; yerelde ve belgede birlikte değişen gövde/yetkilendirme uygulanınca belgedekiyle değişir (önizlemede uyarı, birleştirme yok); erişim bilgisi saklanmadığından otomatik kontrol yalnızca herkese açık belgelerde çalışır, masaüstünden alınmış (localhost) kaynaklarda sunucu erişemezse hata gösterilir; bildirim e-postası yok. Doğrulama: gerçek Swashbuckle 10 (.NET 10, iki sürüm) ve FastAPI 0.161 servisleriyle tarayıcıda uçtan uca (sunucu adresinden sürüm seçimi, isteğin servise gitmesi, servis değişince fark ve uygulama, yerel adın korunması, otomatik kontrol bildirimi, FastAPI `/docs`); Spring/NestJS/Quarkus sayfa biçimleri test sunucusunda taklit edildi (Maven erişilemedi). Testler: backend 21 + 337, frontend 129 + 151, Rust 5. 6.4 ile devam edildi.

**Durum: 6.2 tamamlandı (23 Ekim 2026).** Yanıt panelinde, istek gövdesi editöründe, gRPC editöründe ve dokümantasyon sayfasında "Model" penceresi: kaynak (bu yanıt, kayıtlı örnek yanıtlar, istek gövdesi, yapıştırılan JSON ya da JSON Schema/OpenAPI, gRPC istek/yanıt mesajı), dil ve dile özgü seçenekler, kök sınıf adı, namespace/paket; kopyalama ve dosya ya da ZIP (Java) olarak indirme. Üretici `@apivator/core/models` içinde, dış kütüphanesiz ve ayrı parçada: ortak ara temsil (sınıf/enum/tip), JSON örneklerinden çıkarım (birden çok örneği birleştirme, opsiyonel/null ayrımı, integer/long/ondalık, tarih, tarih-saat, GUID; aynı yapıdaki nesneleri tek sınıfta toplama), JSON Schema/OpenAPI'den okuma ($ref, allOf, oneOf, enum, döngüsel tipler) ve dokuz hedef (C#, Java, Kotlin, TypeScript+zod, Python pydantic/dataclass, Go, Swift, Dart, JSON Schema). Sunucuda gRPC metotlarına protobuf tanımından üretilen JSON Schema eklendi (`inputSchema`/`outputSchema`). Doğrulama: aynı 30.000 öğelik yanıttan üretilen modeller C# (derleyip seri durumdan çıkarma), Go (gofmt, vet, çalıştırma), Python (mypy --strict, pydantic ve dataclass ile yükleme) ve TypeScript (strict + exactOptionalPropertyTypes, zod ile ayrıştırma) için derlendi ve gerçek yanıtla çalıştırıldı; model üretimi ~1 sn. Sapmalar: Maven Central erişilemediği için Java ve Kotlin kodu yalnızca Jackson/Lombok/kotlinx taslaklarına karşı derlendi; Swift ve Dart derleyicileri indirilemediği için bu ikisi birim testi ve gözle kontrol edildi (çıkış kriterindeki "kendi projesinde derleme" C# ve Java için ekip tarafından doğrulanmalı). gRPC'de 64 bit tam sayılar proto3 JSON kuralı gereği metin tipinde üretiliyor. Testler: frontend 128 + 146, backend 21 + 326, Rust 5. 6.5 ile devam edildi.

**Durum: 6.1 tamamlandı (23 Ekim 2026).** Yanıt panelinde "Tablo olarak kaydet": JSON, XML ve CSV yanıtlar; satır olacak dizinin seçimi (en uzun dizi önerilir), nokta ile düzleştirme, iç içe diziler hücrede JSON ya da ayrı sayfada (`#satır` ile bağlı), kolon seçme/sıralama ve ilk 100 satır önizleme. Excel ve ZIP yazıcı `@apivator/core` içinde, dış kütüphanesiz yazıldı (CLI'da da kullanılabilir); başlık sabit, otomatik süzgeç, kolon genişliği, sayı/mantıksal/tarih tipleri. CSV'de BOM, `;` varsayılan ayırıcı ve ondalık virgül, formül enjeksiyonuna karşı kaçış. Çözümleme Web Worker'da; diyalog, yazıcı ve worker ayrı parçalarda (ana pakete etkisi yok). Runner sonuçları ve geçmiş "Dışa aktar" menüsüyle iniyor. Masaüstünde "Farklı kaydet" diyaloğu eklendi (`tauri-plugin-dialog`, `save_file` komutu; bu, uygulamadaki tüm dosya indirmelerini kapsar). Plandan sapma: istek geçmişinde yanıt gövdesi saklanmadığından "geçmişten seçilen yanıtları tek dosyada indirme" yerine geçmiş kayıtları (zaman, metot, URL, durum, süre, boyut) dışa aktarılıyor. Doğrulama: üretilen dosyalar openpyxl ve LibreOffice ile açıldı; 6 MB / 30.000 satırlık yanıtta önizleme ~0,85 sn sürdü ve arayüz donmadı. Testler: frontend 115 + 139, Rust 5 (backend değişmedi: 21 + 325). 6.2 ile devam edildi.

**Durum: 6.3 tamamlandı (23 Ekim 2026).** Hesap ayarları sayfası (`/account`) geldi: profil görseli (istemcide 256×256 kırpma, sunucuda dosya imzası kontrolü), ad ve doğrulamalı e-posta değişikliği (eski adrese bildirim), mevcut şifreyle şifre değişikliği (diğer oturumlar kapanır, bildirim gider), oturum listesi (tarayıcı/işletim sistemi, masaüstü uygulaması, IP, son kullanım) ve tek tek ya da toplu oturum kapatma, sunucuda saklanan tercihler (tema, varsayılan workspace, üç ayrı e-posta bildirimi; birleştirme isteği e-postaları da bu sırada eklendi), ZIP olarak veri indirme (hesap bilgisi + kişisel workspace Postman formatında) ve e-postayla onaylanan hesap silme. API anahtarları bu sayfaya taşındı. Oturum kapatılınca access token'ı da süresini beklemeden geçersiz oluyor (token'da `sid`, 30 sn önbellekli kontrol). Kararlar: silinen hesabın kaydı kişisel verileri temizlenerek "Silinmiş kullanıcı" olarak kalıyor (ekip workspace'lerindeki collection ve yorumlar bozulmasın diye); konum için GeoIP veritabanı eklenmedi, yalnızca IP gösteriliyor; çıkış ya da oturum kapatma ile iptal edilen token'ın yeniden gönderilmesi artık hırsızlık sayılıp tüm oturumları kapatmıyor (yalnızca rotasyonla değiştirilmiş token'lar). Testler: backend 21 + 325, frontend 98 + 131, Rust 4. İki cihazlı akış (görsel, ad, şifre değişince diğer cihazın çıkışı, temanın diğer cihaza gelmesi, e-posta değişikliği, dışa aktarma, silme) tarayıcıda uçtan uca denendi.

**Başlangıçtaki durum:** Yanıt yalnızca ham gövde olarak dosyaya kaydediliyor. Kod üretimi yalnızca istek için var (cURL, C#, JS, Python, Go, PowerShell); yanıttan model üretilemiyor. Şifre yalnızca "şifremi unuttum" e-postasıyla değişiyor; ad ve e-posta değiştirilemiyor, profil sayfası yok (hesap menüsünde yalnızca ad, e-posta ve çıkış var). Açık oturumlar görülemiyor, iki adımlı doğrulama yok.

**6.1 Yanıtı tablo olarak dışa aktarma (CSV / Excel)**

- [x] JSON yanıttan tablo: kök dizi ya da seçilen yol (`data.items`) satır olur. İç içe alanlar nokta ile düzleşir (`adres.sehir`); diziler hücrede JSON metni olarak ya da ayrı sayfada yer alır. XML ve CSV yanıtları da kaynak olabilir.
- [x] CSV: UTF-8 BOM, ayırıcı seçimi (Türkçe Excel için `;` varsayılan), tırnaklama. Excel (.xlsx): başlık satırı, sayı/tarih/metin kolon tipleri, sabitlenmiş başlık, otomatik genişlik.
- [x] Önizleme penceresi: kolon seçme/sıralama, ilk 100 satır; büyük yanıtlarda (10 MB sınırına kadar) donmadan yazma.
- [x] Collection runner sonuçlarını (iterasyon × istek: durum, süre, test sonuçları) ve geçmişten seçilen birden çok yanıtı tek dosya olarak indirme.

**6.2 Yanıttan model (sınıf) üretme**

- [x] JSON'dan tip çıkarımı: alan tipleri, null olabilirlik, opsiyonel alanlar. Birden çok örnekten (dizi elemanları, kayıtlı örnek yanıtlar) birleşik model çıkar. Tarih, GUID, tam sayı/ondalık ayrımı yapılır.
- [x] Hedef diller: C# (record/class; System.Text.Json ya da Newtonsoft öznitelikleri), Java (POJO/record; Jackson, isteğe bağlı Lombok), Kotlin (data class), TypeScript (interface; isteğe bağlı zod), Python (dataclass / Pydantic), Go (struct + json tag), Swift (Codable), Dart.
- [x] Ad dönüşümleri (snake_case → PascalCase/camelCase) ve dile göre ayrılmış kelime kaçışı; kök sınıf adı ve namespace/paket seçimi; kopyalama ve dosya olarak indirme.
- [x] İstek gövdesinden, OpenAPI şemasından ve gRPC mesaj tiplerinden de üretme; JSON Schema dışa aktarma; dokümantasyon sayfasında "Model" bölümü.

**6.3 Hesap ve profil**

- [x] Profil sayfası: ad, e-posta, avatar (baş harfler ya da yüklenen görsel), kayıt tarihi, üye olunan organizasyon ve workspace'ler ile roller.
- [x] Ad değiştirme. E-posta değiştirme: yeni adrese doğrulama bağlantısı gider, doğrulanana kadar eskisi geçerli kalır; eski adrese bildirim gider.
- [x] Şifre değiştirme (mevcut şifreyle). Değişince diğer oturumlar kapanır ve e-posta bildirimi gider. Şifre kuralları kayıttakiyle aynıdır.
- [x] Oturumlar: aktif cihaz ve tarayıcılar (masaüstü uygulaması dahil; son kullanım, yaklaşık konum/IP). Tek tek ya da "diğer tüm oturumlardan çık" (refresh token iptali). API anahtarları da aynı sayfaya taşınır.
- [x] Tercihler sunucuda saklanır, cihazlar arası ortak olur: tema, varsayılan workspace, e-posta bildirimleri (bahsetme, merge isteği, monitör uyarısı ayrı ayrı).
- [x] Hesabı silme ve veriyi dışa aktarma (KVKK). Sahibi olunan organizasyonun devri zorunludur; kişisel workspace verisi Postman formatında arşiv olarak indirilir; silme e-postayla onaylanır.

**6.4 Hesap güvenliği**

- [x] İki adımlı doğrulama: TOTP (authenticator uygulaması) ve tek kullanımlık yedek kodlar; organizasyon düzeyinde zorunlu kılma. SSO (5.3) kullanan organizasyonlarda kimlik sağlayıcıya bırakılır.
- [x] Güvenlik geçmişi: giriş, başarısız giriş, kilitlenme, şifre/e-posta değişikliği, 2FA açma/kapama; yeni cihazdan girişte e-posta uyarısı.
- [x] Yönetici işlemleri: organizasyon yöneticisi bir üyenin oturumlarını kapatabilir ve şifre sıfırlama bağlantısı gönderebilir (denetim kaydına, 5.3, yazılır).

**6.5 Swagger / OpenAPI adresinden içe aktarma**

- [x] İçe aktarma penceresinde "URL" sekmesi: belge adresi (`…/swagger/v1/swagger.json`, JSON ya da YAML) verilince tüm uçlar tek collection olarak gelir. Etiketler klasör olur; parametreler, gövde örnekleri, güvenlik şemaları ve örnek yanıtlar da alınır (mevcut OpenAPI içe aktarıcısı).
- [x] Belge adresinin bulunması: Swagger UI sayfası (`…/swagger/index.html`) verilirse belge adresi sayfanın ayarından okunur; birden çok sürüm varsa (v1, v2) seçtirilir. Yalnızca sunucu adresi verilirse bilinen yollar sırayla denenir: `/swagger/v1/swagger.json`, `/openapi/v1.json` (.NET), `/v3/api-docs` ve `/v2/api-docs` (Spring), `/openapi.json` (FastAPI), `/api-json` (NestJS), `/q/openapi` (Quarkus), `/swagger.json`, `/openapi.yaml`.
- [x] Swagger 2.0 desteği: 2.0 belgeleri içeride OpenAPI 3'e çevrilip aynı içe aktarıcıdan geçer (bugün reddediliyor).
- [x] Erişim: belge sunucudan çekilir (ağ koruması, proxy, SSL ayarları geçerli). Masaüstünde yerel ajan çeker, böylece şirket içi ve `localhost` servisleri de alınır. Korumalı belgeler için isteğe bağlı header ya da Bearer token girilir (saklanmaz).
- [x] Kaynaktan güncelleme: collection kaynak adresi hatırlar. "Kaynaktan güncelle" belgeyi tekrar çeker ve yeni, değişen ve kaldırılan uçları fark ekranında gösterir. Seçilenler uygulanır; kullanıcının eklediği script'ler, açıklamalar ve örnekler korunur. İsteğe bağlı olarak belirli aralıklarla kontrol edilir; belge değişince bildirim gelir.

**Teknik notlar:** Excel dosyası tarayıcıda üretilir (lisansı uygun, küçük bir kütüphane ya da yalnızca .xlsx yazan bir modül; ayrı parçada yüklenir). Masaüstünde dosya diyaloğuyla kaydedilir. Model üretimi `@apivator/core` içinde, mevcut kod üretimi gibi saf fonksiyonlarla yazılır; böylece CLI'da da kullanılabilir. Hesap işlemleri ASP.NET Identity'nin mevcut akışları üzerine kurulur (e-posta değiştirme token'ı, güvenlik damgası ile oturum iptali). Oturum listesi için refresh token kayıtlarına cihaz ve son kullanım bilgisi eklenir (migration).

**Çıkış kriteri:** Bir test/analist ekip üyesi bir liste yanıtını Excel'de Türkçe karakterleri ve sayıları doğru biçimde açtı. Bir geliştirici bir yanıttan C# ve Java modeli üretip kendi projesinde değiştirmeden derledi. Kullanıcılar şifre, ad ve e-posta değişikliğini destek istemeden yaptı; en az bir organizasyon 2FA'yı zorunlu kıldı. Bir ekip servisinin collection'ını Swagger adresinden içe aktardı ve servis değişince kaynaktan güncelledi.

## Faz 7 · Geliştirici araçları (tahmini 4–6 hafta)

Hedef: geliştiricinin API ile çalışırken başka bir siteye (base64decode, jwt.io, json-csv dönüştürücüler) gitmeden ihtiyaç duyduğu küçük işleri Apivator'ın içinde yapması. Veri hiçbir zaman sunucuya gönderilmez; token ve müşteri verisi gibi hassas içerik güvenle yapıştırılabilir.

**Durum: Faz 7 tamamlandı (30 Ekim 2026).** Tüm maddeler bitti; ayrıntılar aşağıda sürüm sürüm. Son kapanan iki iş: JSON Schema doğrulaması Web Worker'da çalışır (3 sn sınır, aşırı geri izleyen `pattern` sekmeyi dondurmaz); dinamik değişkenler istemci, runner/monitör (`VariableResolver`) ve script sandbox'ında aynı üreteçten gelir (sandbox ev sahibindeki kriptografik üreteci çağırır; ortak sözleşme `src/shared/dynamic-variables.json`, 35 ad; Türkçe veri listelerinin TS ve C# arasında birebir aynı olduğu da testle doğrulanır; `__hostDynamic` ve `__hostSend` geçersiz argümanda sunucu hatası yerine script hatası verir). Son testler: backend 21 + 473, core 958, web 527 (`app.test.tsx`'teki bilinen 3 hata hariç).

**İlk sürüm (29 Ekim 2026).** Öncelik listesindeki araçlar geldi: Base64, URL kodlama, JWT (çözme, HS/RS/PS/ES doğrulama ve imzalama, `alg: none` ve alg confusion reddi), hash ve HMAC (MD5 dış kütüphanesiz), UUID v4/v7, JSON biçimlendirici (satır/sütunlu hata, "Hataya git", ağaç görünümü, büyük sayı uyarısı), JSON ↔ CSV/Excel/YAML/XML (Excel okuyucu dış kütüphanesiz; zip bombası ve seyrek hücre sınırları), JSONPath (RFC 9535 alt kümesi, `eval` yok, işlem bütçesi), metin ve yapısal JSON farkı, zaman damgası (saat dilimi, ofsetsiz tarih seçilen dilimde) ve regex (Web Worker'da, 1,5 sn sınır); JSON ya da JSON Schema / OpenAPI'dan model sınıfı (6.2'nin üreticisi araç olarak). Altyapı: `/tools` sayfası, arama (Türkçe İ/ı uyumlu), favoriler (son kullanılanlar menüde gösterilmez), girdilerin bu cihazda hatırlanması (toplam 1 MB sınırı; gizli anahtarlar hiç yazılmaz), akıllı yapıştırma, yanıt panelinde "Araçlarda aç", çıktıyı değişkene ya da yeni isteğe aktarma. Saf fonksiyonlar `@apivator/core/tools` altında. Testler: core 250, web 250 (tümü geçiyor; `app.test.tsx`'teki önceden bilinen 3 hata hariç). 7.1 ve 7.2 tamamlandı (29 Ekim 2026): büyük dosyada hash (512 MB) ve Base64 (100 MB) Web Worker'da, ilerleme ve iptal ile; 5 MB üstü Base64 çıktısı indirme olarak sunulur. Araçların ağ isteği yapmadığı her araç için testle doğrulanır. Yeni araçlar: HTML entity, Unicode kaçış (hatalı dizileri olduğu gibi bırakır; isteğe bağlı katı mod), hex ↔ metin, Base32 (RFC 4648, base32hex), string kaçışı (JSON, JavaScript, Java, C#, C# verbatim, SQL, regex), gzip/deflate sıkıştırma (50 MB açma sınırı). Akıllı yapıştırma gzip Base64 (`H4sI`), `\uXXXX` ve HTML entity içeriğini de tanır. 7.3 tamamlandı (29 Ekim 2026): JSON dönüştürücüye CSV ↔ Excel, JSON ↔ query string / form-urlencoded (prototip kirletmeye karşı korumalı) ve JSON ↔ TOML (`smol-toml`) eklendi; yeni araçlar JSON Schema (örnekten şema çıkarma, 2020-12 / draft-07; şemadan ya da OpenAPI'dan örnek veri, tohumlu rastgele mod, dış `$ref` reddedilir, boyut ve özyineleme sınırları), cURL → kod (mevcut kod üretimi, yeni istekte açma) ve HAR görüntüleyici (süzme, sıralama, ayrıntı, cURL olarak kopyalama; 50 MB sınırı, HAR girdisi cihaza kaydedilmez). Akıllı yapıştırma HAR'ı tanır, cURL için "cURL → kod" önerir. 7.4 tamamlandı (29 Ekim 2026): Sorgu aracı JSONPath, JMESPath (tam spesifikasyon, dış kütüphanesiz, işlem ve sonuç boyutu bütçesi) ve XPath (DOCTYPE/ENTITY reddedilir); XML, YAML, SQL (`sql-formatter`, 6 lehçe), GraphQL ve HTML biçimlendirici/küçültücü; JSON Schema aracında "Doğrula" modu (draft-07 / 2020-12, `unevaluated*` dahil, kod üretimi yok, hata yolları); Python girinti düzenleyici (string ve satır devamlarına dokunmaz, `TabError` / `IndentationError` öncesi uyarı); farkta "Geçmişten seç". Not: sunucudaki geçmiş yanıt gövdesi saklamadığı için seçici bu oturumun konsol kayıtlarını ve açık sekmelerdeki yanıtları listeler. 7.5 tamamlandı (29 Ekim 2026): bcrypt üretme/doğrulama (dış kütüphanesiz, Web Worker'da, ilerleme ve iptal; $2a/$2b/$2y, 72 bayt uyarısı), AES-GCM/CBC şifrele/çöz (ham anahtar ya da PBKDF2, birleşik IV biçimi, IV her oturumda yeni), RSA/ECDSA/Ed25519 anahtar çifti (PEM/JWK, parmak izi, RSA-OAEP deneme), X.509 / PEM çözücü (dış kütüphanesiz DER okuyucu; zincir, CSR, anahtarlar, imza doğrulama Web Crypto ile, AIA/CRL adreslerine gidilmez; bozuk veriye karşı fuzz testi), Basic auth, PKCE (RFC 7636), şifre / parola cümlesi / token üretici (sapmasız rastgele seçim). Şifre, anahtar ve kimlik bilgileri cihaza hiç yazılmaz (testle doğrulanır). Akıllı yapıştırma sertifika/PEM ve `Basic` header'ını tanır. 7.6 tamamlandı (29 Ekim 2026): ID üretici (UUID v4/v7, ULID monoton seçenekli, nanoid; 10.000'e kadar toplu üretim satır/JSON/CSV; UUID/ULID inceleme), Türkçe/İngilizce sahte veri (81 il, tutarlı kişi/adres; algoritmaya uygun TCKN, `999xx` banka kodlu IBAN, test önekli Luhn kart; yalnızca örnek alan adları ve belgeleme IP blokları; JSON, CSV, SQL INSERT; TCKN/Luhn/IBAN doğrulayıcı), lorem ipsum (gerçek Türkçe kelimelerle seçenekli), rastgele sayı ve tarih (sapmasız, tekrarsız, saat dilimli), QR kod (`qrcode-generator`, SVG/PNG). İstemcideki `{{$random…}}` dinamik değişkenleri aynı üreteci kullanır ve yeni değişkenler eklendi; sunucu tarafı ayrı madde olarak açık. 7.7 tamamlandı (30 Ekim 2026): Cron açıklayıcı (Cronos 0.13 ile birebir: ayın günü ve haftanın günü birlikte kısıtlıysa ikisi de tutmalı, `L`/`W`/`#`, makrolar, yaz saati kuralları; gerçek Cronos'a karşı ~140 ifadeyle denendi; Türkçe açıklama, seçilen dilimde sonraki çalışmalar) ve monitör ayarları aynı açıklayıcıyı kullanır; sayı tabanı (BigInt, 2–36, ikiye tümleyen, bit görünümü), bayt birimleri (SI/IEC, bit/bayt, tam kesirli hesap, aktarım süresi), renk (HEX/RGB/HSL/HWB/OKLCH, 148 CSS adı, WCAG kontrast, ton paleti). Testlerin yük altında zaman aşımı düzeltildi (ağır biçimlendiriciler önbelleğe alındı, test zaman aşımları yükseltildi). 7.8 tamamlandı (30 Ekim 2026): yeni "Web ve ağ" kategorisi. URL ayrıştırıcı (`{{değişken}}` korunur, düzenlenmeyen adres birebir geri yazılır, parametre tablosu sıralama/devre dışı, punycode RFC 3492 dış kütüphanesiz, yeni istekte açma), HTTP başvuru (64 IANA durum kodu, 90 header, 111 MIME tipi; Türkçe açıklama, çevrimdışı arama), Cookie / Set-Cookie ayrıştırıcı (RFC 6265 tarih algoritması, Max-Age önceliği, SameSite/önek/boyut denetimleri, header enjeksiyonuna kapalı Set-Cookie üretimi; değerler cihaza yazılmaz), User-Agent çözümleyici (dış kütüphanesiz, botlar ve Apivator istemcileri, 4096 karakter sınırı), IP / CIDR hesaplayıcı (IPv4/IPv6 BigInt, aralıktan en küçük CIDR listesi, alt ağa bölme, ters DNS adı). Akıllı yapıştırma Cookie/Set-Cookie, User-Agent ve CIDR'ı tanır. 7.9 tamamlandı (30 Ekim 2026): ad dönüşümü (14 biçim; kısaltma ve rakam duyarlı bölme, Türkçe İ/ı kuralı, kesme işareti korunur, ASCII'ye çevirme), slug üretici (Türkçe harf çevirisi, kelime sınırında kısaltma, dolgu kelimeler), satır işlemleri (zincirlenen adımlar, Türkçe/doğal sıralama, tekilleştirme, sapmasız karıştırma, LF/CRLF korunur, geri al), metin sayacı (grafem/kod noktası/UTF-16, sözcük, bayt, okuma süresi, sık sözcükler), bayt görünümü (UTF-8/UTF-16/Latin-1 hexdump ve ikili, görünmeyen karakterleri satır:sütunla bulma, geri çevirme). 5 MB girdide performans ölçüldü (ad dönüşümünde 108 sn → ~1 sn). Testler: core 922, web 521. Faz 7'nin araç grupları tamamlandı.

**Araştırma özeti:** DevToys (masaüstü, ~30 araç, panodaki içeriğe göre araç öneren "akıllı algılama"), IT-Tools (web, 80+ araç; kategoriler: kripto, dönüştürücü, web, geliştirme, ağ, metin, veri) ve CyberChef (300+ işlem, işlemleri zincirleme "tarif") bu alanın örnekleri. En çok kullanılan ortak çekirdek hepsinde aynı: JSON biçimlendirme, Base64/URL kodlama, JWT çözme, hash, UUID, regex, metin farkı, zaman damgası ve sayı tabanı dönüşümü. Apivator'ın farkı araçların istek ve yanıtlarla bağlı olması: yanıttan bir araca, araçtan değişkene veya isteğe tek tıkla geçilebilmeli.

**7.1 Altyapı ve gezinme**

- [x] Sol menüde **Araçlar** (Tools) bölümü ve `/tools`, `/tools/{araç}` adresleri. Kategoriye göre liste, arama (ad ve anahtar kelime), favoriler, son kullanılanlar.
- [x] Ortak araç düzeni: girdi / çıktı alanları, "yer değiştir" (⇄; encode ↔ decode), dosyadan yükleme ve dosyaya indirme, kopyalama, hata gösterimi. Her aracın son girdisi bu cihazda hatırlanır (isteğe bağlı temizleme).
- [x] Bağlam entegrasyonu: yanıt panelinde "Araçlarda aç" (gövde ya da seçili metin seçilen araca gider). Araç çıktısı "Değişken olarak kaydet" ile environment'a ya da "Yeni istekte kullan" ile gövdeye aktarılır.
- [x] Akıllı yapıştırma: yapıştırılan içerik tanınıp uygun araç önerilir (JWT, Base64, Unix zaman damgası, JSON, URL, UUID, cURL).
- [x] Tamamen istemcide çalışır (web, masaüstü ve çevrimdışı); her araç ayrı parçada yüklenir, ana paketi büyütmez. Uzun işlemler (büyük dosya, bcrypt) arayüzü dondurmamak için Web Worker'da çalışır.

**7.2 Kodlama / çözme**

- [x] Base64: metin ve dosya, URL-safe varyant, satır kırma; çözülen veri görsel ise önizleme, ikili ise dosya olarak indirme.
- [x] URL encode/decode (bileşen ve tam adres), HTML entity, Unicode kaçış (`\u00e7` ↔ ç), hex ↔ metin, Base32.
- [x] String kaçışı: JSON, C#, Java, JavaScript, SQL ve regex için kaçış ve geri çözme.
- [x] Sıkıştırma: gzip / deflate sıkıştırma ve açma (Base64 girdi/çıktı ile; sıkıştırılmış yanıtları incelemek için).

**7.3 Veri dönüştürme**

- [x] JSON ↔ CSV ve JSON ↔ Excel (.xlsx): 6.1'deki motor (düzleştirme, ayırıcı, Türkçe Excel uyumu) aynen kullanılır; CSV ↔ Excel.
- [x] JSON ↔ YAML, JSON ↔ XML, JSON ↔ query string / form-urlencoded, JSON ↔ TOML.
- [x] JSON → model sınıfı (6.2'nin aracı), JSON → JSON Schema, JSON Schema → örnek veri.
- [x] cURL → kod ve kod dili dönüşümü (mevcut kod üretimi), HAR görüntüleyici.

**7.4 Biçimlendirme, sorgu ve karşılaştırma**

- [x] JSON biçimlendir / küçült / doğrula / anahtarları sırala; ağaç görünümü; hatalı JSON'da satır ve sütun gösterimi.
- [x] JSONPath ve JMESPath sorgu deneme (script'lerde kullanılacak ifadeyi canlı denemek için); XPath (XML için).
- [x] Metin farkı ve JSON farkı (anahtar sırasından bağımsız, yapısal; iki yanıtı karşılaştırmak için geçmişten seçme).
- [x] XML, YAML, SQL, GraphQL ve HTML biçimlendirici; JSON Schema doğrulayıcı (şema + veri → hatalar).
- [x] Python girinti düzenleyici: sekme ↔ boşluk dönüşümü, girinti genişliğini değiştirme (2 / 4 / 8), karışık sekme-boşluk girintisini satır numarasıyla gösterme (`TabError` / `IndentationError` öncesi), tutarsız girinti seviyelerini düzeltme, satır sonu boşluklarını ve fazla boş satırları temizleme, satır sonu biçimi (LF / CRLF). Kodun anlamı değişmez; yalnızca boşluklar düzenlenir, değişen satırlar farkla gösterilir.
- [x] Regex deneme: eşleşme vurgusu, gruplar, değiştirme önizlemesi, JavaScript ve .NET sözdizimi farkı notu.

**7.5 Güvenlik ve kimlik**

- [x] JWT çözücü: header, payload, imza algoritması; `exp` / `iat` / `nbf` okunur tarih ve kalan süre; anahtar verilirse imza doğrulama (HS*, RS*, ES*). JWT oluşturma/imzalama (test için).
- [x] Hash: MD5, SHA-1, SHA-256, SHA-384, SHA-512 (metin ve dosya); HMAC; bcrypt üretme ve doğrulama.
- [x] Şifreleme: AES (GCM/CBC) şifrele / çöz, RSA anahtar çifti üretme, PEM / X.509 sertifika çözümleyici (konu, geçerlilik, SAN, parmak izi).
- [x] Kimlik yardımcıları: Basic auth header üretici, OAuth 2.0 PKCE verifier/challenge üretici, güçlü şifre ve rastgele token üretici.

**7.6 Üreteçler ve test verisi**

- [x] UUID (v4, v7), ULID, nanoid; toplu üretim (ör. 100 adet, CSV/JSON olarak).
- [x] Sahte veri: ad, e-posta, telefon, adres, şirket, Türkçe yerelleştirmeli; algoritmaya uygun ama gerçek olmayan test kimlik ve kart numaraları (Luhn ve TCKN algoritması). Script'lerdeki dinamik değişkenlerle (`{{$randomEmail}}`) aynı üreteç.
- [x] Lorem ipsum, QR kod (metin / URL), rastgele sayı ve tarih aralığı.
- [x] Dinamik değişkenlerde sunucu eşitliği: istemcideki `{{$random…}}` listesi (ör. `$randomEmail`, `$randomTckn`, `$randomIban`, `$randomCreditCardNumber`, `$randomCompanyName`) ve biçimleri sunucuya da taşınır. `VariableResolver.cs` (runner ve monitörler) bugün yalnızca `$guid`, `$randomUUID`, `$timestamp`, `$isoTimestamp`, `$randomInt` tanır; script sandbox'ındaki (`sandbox.js`) liste ve biçimler (ör. telefon `5xx-xxx-xxxx`) istemciden farklıdır. Hedef: aynı ad listesi, aynı test-güvenli aralıklar (örnek alan adları, belgeleme IP blokları, test kart önekleri, `999xx` banka kodlu IBAN) ve aynı algoritmalar; üç tarafın aynı çıktı biçimini verdiği ortak test vektörleriyle doğrulanır.

**7.7 Zaman, sayı ve birim**

- [x] Unix zaman damgası ↔ tarih (saniye / milisaniye otomatik tanıma, saat dilimi seçimi, ISO 8601, RFC 1123), iki tarih arası süre.
- [x] Cron ifadesi açıklayıcı ve sonraki çalışma zamanları (monitörlerdeki açıklayıcı ile aynı).
- [x] Sayı tabanı (2 / 8 / 10 / 16), bayt birimleri (KB / MB / KiB), renk (HEX / RGB / HSL).

**7.8 Web ve ağ**

- [x] URL ayrıştırıcı: şema, host, port, yol, query parametreleri tablo olarak; düzenleyip yeniden birleştirme.
- [x] HTTP başvuru: durum kodları, header'lar, MIME tipleri (açıklama ve örneklerle; çevrimdışı).
- [x] Cookie ve `Set-Cookie` ayrıştırıcı, User-Agent çözümleyici, IP / CIDR (alt ağ) hesaplayıcı.

**7.9 Metin**

- [x] Ad dönüşümü: camelCase / PascalCase / snake_case / kebab-case / CONSTANT_CASE; büyük-küçük harf (Türkçe İ/ı kuralına uygun).
- [x] Satır işlemleri: sıralama, tekilleştirme, boşları silme, ters çevirme; karakter / kelime / satır / bayt sayacı.
- [x] Slug üretici (Türkçe karakter dönüşümüyle), metin ↔ ikili/hex görünümü.

**Öncelik:** İlk sürümde en çok kullanılanlar çıkar: 7.1 altyapısı; Base64, URL, JWT, JSON biçimlendirme, JSON ↔ CSV/Excel/YAML/XML, hash, UUID, zaman damgası, metin/JSON farkı, regex, JSONPath. Diğerleri kullanım verisine göre sırayla eklenir.

**Teknik notlar:** Her araç bir kayıt girdisi (kimlik, ad, kategori, anahtar kelimeler, tembel yüklenen bileşen) olarak tanımlanır; yeni araç eklemek tek dosyadır. Dönüştürme ve kodlama fonksiyonları `@apivator/core` içinde saf fonksiyonlar olarak yazılır (test edilebilir, CLI'da da kullanılabilir). Kriptografi için tarayıcının Web Crypto API'si kullanılır. Web Crypto yalnızca güvenli bağlamda (HTTPS, localhost, masaüstü) çalışır; HTTP üzerinden açılan kurulumlarda ilgili araçlar bunu açıklayan bir uyarı gösterir. MD5 ve bcrypt gibi Web Crypto'da olmayanlar için küçük, lisansı uygun kütüphaneler eklenir. Hiçbir araç ağ isteği yapmaz; bu bir testle (araçlar açıkken giden istek olmadığı) doğrulanır.

**Çıkış kriteri:** Ekipte JWT çözme, Base64 ve JSON dönüştürme için dış siteler kullanılmıyor (kısa anketle doğrulanır). İlk sürümdeki araçların her birinin birim testi var. Araçlar çevrimdışı ve masaüstünde çalışıyor; hiçbir girdi sunucuya gitmiyor.

## Faz 8 · Çok dilli arayüz (tahmini 4–6 hafta)

Hedef: Apivator'ı Türkçe bilmeyen ekip üyeleri ve müşteriler de kullanabilsin. Arayüz, sunucu mesajları, e-postalar, masaüstü uygulaması ve CLI kullanıcının seçtiği dilde olur. İlk sürümde Türkçe (varsayılan) ve İngilizce; yeni bir dil eklemek yalnızca çeviri dosyası eklemektir. Faz 7 tamamlandıktan sonra başlar.

**Durum: 8.1 tamamlandı (30 Ekim 2026).** Core metinleri de çevrildi: `@apivator/core` kendi küçük katmanını taşır (`core/src/i18n.ts`): Türkçe kaynak dil olarak kodda kalır (`msg('kimlik', 'Türkçe {x}', { x })`), diğer diller `core/src/locales/<dil>/*.json` kataloglarından gelir; web bunları dil parçasıyla (`core`, `cron`) ya da araçlarla birlikte (`tools*`) yükler ve `setCoreLanguage` çağırır. ICU biçimleyici core'a taşındı (web oradan kullanır). Veri tabloları (HTTP durum/header/MIME, görünmeyen karakter adları, EKU) Türkçe veriyi korur, erişimde `catalogMessage` ile çevrilir; her girdinin İngilizcesi olduğu testle denetlenir. Cron için ayrı İngilizce açıklayıcı (`cronDescribeEn.ts`); monitör zamanlama önayarları ve cron aracı ipuçları çizim anında hesaplanır. Script snippet'lerinin örnek kodu seçilen dilde eklenir. Kullanılmayan Türkçe eşlemeler silindi (`AUDIT_*`, `SSO_*`, `AUTH_TYPE_LABELS`, `VALIDITY_LABELS`, `HTTP_STATUS_CLASS_LABELS` vb.). `core/src/i18n.test.ts` koddaki her `msg` çağrısının katalogda aynı değişkenlerle karşılığı olduğunu tarar. Türkçe veri olarak kalanlar: sahte veri, Türkçe lorem, slug dolgu kelimeleri, harf çevirisi tablosu, örnek değerler. Çeviri altyapısı dış kütüphanesiz (`apps/web/src/i18n`): ICU alt kümesi (değişken, `plural`, `select`, `#`, kesme işaretiyle kaçış), Türkçe dosyalardan türeyen tip güvenli anahtarlar, `useT` / `translate` / `t.rich` (metin içi `<b>`, `<link>` etiketleri; kullanıcı verisindeki `<` etiket sayılmaz). 34 ad alanı; açılışta dil başına tek parça (~104 KB, gzip 37 KB), araç metinleri (`tools*`, 4 ad alanı) araçlar açılınca tembel yüklenir; dil değişince açık olan tembel ad alanları önce yüklenir, sonra arayüz yenilenmeden yeni dille çizilir. Dil sırası: sunucudaki tercih (bu cihazda da hatırlanır) → tarayıcı dili → Türkçe; giriş/kayıt sayfasında küçük seçici, hesap ayarlarında "Dil"; sunucuda tercih yokken giriş sayfasında seçilen dil oraya yazılır (sunucuda tercih varsa o kazanır). Sunucu: `UserPreferences.Language` (`tr`/`en`, null = tarayıcı dili; doğrulamalı, JSON sütunu olduğu için migration gerekmedi). Biçimler `i18n/format.ts`'te (tarih, saat, göreli zaman, sayı, yüzde, bayt, liste, etkin dile göre büyük/küçük harf ve sıralama); kodda doğrudan `tr-TR` kalmadı (HAR ve renk aracındaki `toFixed` de düzeltildi). Dışa aktarılan etiket eşlemeleri (`WORKSPACE_ROLE_LABELS` vb.) aynı API ile erişim anında çeviren getter'lara dönüştü. CI kontrolü: `locales.test.ts` her dilde Türkçe ile aynı anahtarları, aynı değişkenleri (ICU ayrıştırıcısıyla) ve geçerli ICU'yu denetler. Her alan için İngilizce duman testi eklendi (12 dosya). Testler: web 589/592 (`app.test.tsx`'teki bilinen 3 hata), core 1001, backend AccountTests 26.

**Durum: 8.2 tamamlandı (31 Ekim 2026).** Sunucuda dış kütüphanesiz katman: `Apivator.Application/Common/Localization` (`L.T("kimlik", "Türkçe {x}", ("x", değer))`, `Lang`). Türkçe kodda kalır, diğer diller `Application/Localization/locales/<dil>/*.json` gömülü kataloglarından gelir (~580 kimlik, 30 dosya); yer tutucular `{ad}` / `{ad:N0}`, biçim etkin dilin kültürüyle. Metin çağrı anında seçildiği için metin taşıyan `static readonly Error` alanları özelliğe (`=>`) çevrildi. Etkin dil `AsyncLocal`'da (işletim sistemi kültürüne bakılmaz); istek dili: `?lang=` (canlı kanal) → `Accept-Language` → kayıtlı tercih (başlıksız istemciler için, 1 dk önbellek) → Türkçe. Web her istekte etkin dili `Accept-Language` ile, canlı kanal `?lang=` ile gönderir; hub dili bağlantı anında saklar. Hata kodları (`code`) değişmedi; runner'daki "durduruldu" metin eşleşmesi kaldırıldı (`summary.status` yeterli). Çevrilenler: `Error` mesajları ve doğrulama ayrıntıları, Identity hataları (`LocalizedIdentityErrorDescriber`), yürütme/ağ/gRPC/WebSocket/Git uzak depo hataları, import uyarıları, hub hataları, değişken kuralları (Domain artık ihlal türü döndürür, metni `VariableRuleMessages` üretir). Arka plan işleri ilgili kişinin dilinde çalışır (monitör: oluşturan; kaynak kontrolü: kuran). E-postalar: hesap e-postaları isteğin dilinde; bahsetme, birleştirme ve monitör bildirimleri alıcının kayıtlı dili → organizasyon dili → Türkçe; davet gönderenin seçtiği dilde (davette saklanır, yeniden gönderimde korunur), seçilmezse organizasyon dili; tarih Türkçede TSİ, İngilizcede UTC. Organizasyon: `default_language` (yöneticiler değiştirir, yeni organizasyon oluşturanın dilini alır; ekip sayfasında seçici, davet formunda dil seçimi); davetle katılan ve dil tercihi olmayan üyeye organizasyon dili yazılır. Denetim kaydı CSV başlıkları ve dosya adı, hesap verisi indirmesindeki README isteyenin dilinde (JSON alan adları değişmedi). `LocalizationTests`: her `L.T` çağrısının her dilde aynı yer tutucularla karşılığı, kullanılmayan kimlik olmaması, aynı kimliğin farklı Türkçe metinle kullanılmaması ve düz dize sabiti zorunluluğu. Kapsam dışı kalanlar: CLI, script mesajları ve masaüstü ajanı (8.3); DB'ye yazılan metinler o anki dilde kalır (güvenlik ve denetim kaydı ayrıntıları, "Sistem" aktörü, etkinlikteki "başka workspace'e", silinmiş kullanıcının görünen adı, monitör ve çalıştırma durdurma nedenleri); runner raporu HTML/JSON sunucuda değil CLI'da üretiliyor (8.3). Migration'lar: `OrganizationDefaultLanguage`, `InvitationLanguage`. Testler: backend 21 + 496 (1 atlanan), core 1001, web 589/592 (bilinen 3 hata).

**Durum: 8.3 tamamlandı (31 Ekim 2026).** Masaüstü: Rust komutları hatayı metin yerine `{"code","params"}` JSON'u olarak döner, arayüz etkin dilde gösterir (`lib/desktop.ts` → `common.desktop.*`); böylece ajanın açılışta verdiği hata da sonradan seçilen dilde görünür. Uygulamada pencere/tepsi menüsü ve sistem bildirimi yok; güncelleme iletileri arayüzde zaten çevriliydi. NSIS kurulum paketi açılışta Türkçe/İngilizce seçtirir. Yerel ajan: dil ara katmanı (`?lang=` → `Accept-Language` → Türkçe); web ajana giden isteklerde `Accept-Language`, WebSocket/gRPC köprülerinde (yerel ve sunucu) `lang=` gönderir; OAuth dönüş sayfası ve ajan hataları çevrildi. SSL ipucu sabit metin yerine anahtar (`Proxy:SslErrorHint`: `desktop`/`cli`), metni `NetworkErrors` üretir. CLI: `--lang` → `APIVATOR_LANG` → işletim sistemi dili → Türkçe (`--lang` ayrıştırmadan önce okunur, yardım ve kullanım hataları da o dilde); yardım, ilerleme, özet ve HTML rapor çevrildi, sunucuya `Accept-Language` gönderilir; JSON raporun alan adları ve yapısal değerleri (durum, sayılar), çıkış kodları ve JUnit yapısı dilden bağımsız (testle); hata ve durdurma metinleri seçilen dilde. Atlanan istek metinle değil `RunResultEntry.Skipped` bayrağıyla tanınır. Yayınlanan doküman sayfasına ziyaretçi için dil seçici eklendi; dil değişince sunucuda üretilen metinler (yetkilendirme özeti) yeniden alınır. Script'ler: chai/`pm.expect` iletileri İngilizce kalır; Apivator'ın yazdığı iletiler (`pm.response.to.*`, ortam/istek kısıtları, XML ayrıştırıcı, modül, zaman aşımı, bellek, `sendRequest`, pre-request/skip) etkin dilde: sandbox `__msg(kimlik, {…})` ev sahibi fonksiyonunu çağırır, `ScriptMessages.cs` kimliği `L.T` sabitine eşler (sandbox.js 1199 → 1180 satır). Yeni kataloglar: `agent.json`, `script.json` (62), `cli.json` (106). Testler: backend 21 + 501 (1 atlanan), core 1001, web 591/594 (bilinen 3 hata), Rust 7.

**Durum: 8.4 tamamlandı (31 Ekim 2026). Faz 8 tamamlandı.** Eksik anahtar politikası: web, core ve backend testleri dilleri `locales/` klasörlerinden bulur; `en`'de eksik anahtar hata, diğer dillerde uyarı (vitest `console.warn`, xUnit çıktısı); fazla anahtar, değişken uyuşmazlığı ve geçersiz ICU her dilde hata. Çalışma anında geri dönüş: dil → İngilizce → Türkçe (web `translate`, core `msg`, backend `L.T`). Lint: yerel ESLint eklentisi (`src/frontend/eslint-rules`): `apivator/no-literal-jsx-text` (harf içeren JSX metni ve `title`/`placeholder`/`aria-label`/`alt`/`label` sabitleri; marka ve teknik terimler tek bir izin listesinde, kod görünümlü belirteçler muaf; 10 gerekçeli satır içi istisna) ve `apivator/no-physical-direction` (otomatik düzeltmeli; `left-1/2` + `translate-x` eşleşmesini düzeltmeden bildirir). 136 gömülü metin ihlali giderildi (10 metin dil dosyasına taşındı, gerisi izin listesindeki teknik terimler). Kural testleri (55 durum) web vitest'iyle koşar. Fiziksel yön sınıfları (`ml-`, `pr-`, `left-`, `border-l`…) mantıksal karşılıklarına çevrildi (195 düzeltme); CSS'te fiziksel özellik yoktu; satır içi hesaplanan konumlar (açılır menü) bilerek fiziksel kaldı. Sözde dil: `i18n/pseudo.ts` İngilizce kataloğu aksanlı, ~%35 uzun ve `[!! … !!]` içinde üretir (ICU yapısı korunur, core katalogları dahil); geliştirme modunda dil seçicide "Pseudo" (üretim paketine girmez, sunucuya yazılmaz, `<html lang="en-XA">`). Test yardımcıları `i18n/testing/pseudo.ts` (`usePseudoLanguage`, `expectNoUntranslatedText`) ve `pseudoScan.test.tsx` 9 ekranı tarar; kalan düz metinler sözlükteki çevrilmeyen terimler ve İngilizce cron açıklayıcısı (katalog dışı). Terim sözlüğü: `docs/terimler.md`; çevirmen notları `apps/web/src/i18n/locales/notes.json` (26 anahtar, testle var olan anahtara bağlı). Sözlüğe göre düzeltilenler: "Birleştirme isteği" → "Merge isteği" (e-postalar ve hesap ayarları), "Ekip workspace'i" → "Takım workspace'i", "etkinlik akışı" → "aktivite akışı". Taşma taraması: headless Chrome ile giriş/kayıt, hesap, ekip, araçlar, kenar çubuğunun tüm bölümleri ve istek editörü 1280 ve 1024 genişlikte İngilizce ve sözde dille ölçüldü; İngilizcede taşma yok, sözde dilde (~%35 uzun) bulunanlar düzeltildi: düğmeler tek satır (`Button` `whitespace-nowrap`), Send düğmesi sabit yerine en az genişlik, sol ikon çubuğu etiketleri kelime içinden bölünür, boş collection panelindeki düğmeler alt satıra geçer; kalanlar tasarım gereği "…" ile kısalan alanlar (sekme adı, environment seçici, araç açıklamaları). Faz sonu incelemesi (Opus): yüksek/orta bulgu yok; 4 düşük bulgu düzeltildi (script mesaj değerleri JS `String()` ile, atlanan istek bayrakla, CLI `--lang` ön taraması başka seçeneğin değerini dil saymaz, core `catalogMessage` İngilizceye geri döner). Ayrıca: lorem aracının Türkçe seçeneği uydurma heceler yerine gerçek Türkçe kelimeler kullanır (cümle fiille biter); araçlar sayfasının sol menüsü etkin dile göre alfabetik. Testler: backend 21 + 502 (1 atlanan), core 1003, web 662/665 (bilinen 3 `app.test.tsx` hatası, aralıklı `noNetwork` → lorem [9.2] ve yük altında zaman aşımına düşen yeni doküman dil testi; süreleri uzatılıp düzeltildi).

**Başlangıçtaki durum:** Tüm metinler Türkçe ve kodun içine gömülü (JSX, hata mesajları, e-posta şablonları, Windows kurulum paketi). Tarih ve sayı biçimleri yaklaşık 25 dosyada doğrudan `tr-TR` ile yazılmış; `<html lang="tr">` sabit. Sunucuda yerelleştirme altyapısı yok; API hata ve doğrulama mesajları Türkçe metin olarak dönüyor. Hesap ayarlarında sunucuda saklanan tercihler (6.3) var; dil tercihi bunlara eklenecek.

**8.1 Altyapı ve dil seçimi**

- [x] Frontend'de çeviri altyapısı: anahtar tabanlı metinler, özellik başına ad alanı (ör. `requests`, `tools`, `account`), çoğul ve değişkenli metinler (ICU biçimi), tip güvenli anahtarlar (yanlış anahtar derlemede hata verir). Dil dosyaları ayrı parçada ve yalnızca seçilen dil yüklenir; ana paket büyümez.
- [x] Dil seçimi: hesap ayarlarında "Dil" (sunucudaki tercihlere eklenir, cihazlar arasında taşınır); giriş ve kayıt sayfalarında küçük dil seçici; ilk açılışta tarayıcı dili. Sıra: kullanıcı tercihi → tarayıcı dili → Türkçe. Dil değişince sayfa yenilenmeden uygulanır; `<html lang>` güncellenir.
- [x] Biçimlendirme tek yerden: tarih, saat, göreli zaman ("3 saat önce"), sayı, para, bayt boyutu ve liste biçimleri etkin dile göre `Intl` ile. Doğrudan `tr-TR` yazılan yerler bu yardımcıya taşınır. Arama ve sıralamadaki büyük/küçük harf kuralları (Türkçe İ/ı) etkin dile göre çalışır.
- [x] Mevcut tüm arayüz metinlerinin anahtara taşınması: istek editörü, yanıt paneli, collection/environment/geçmiş panelleri, mock ve monitörler, ekip ve hesap sayfaları, dokümantasyon, araçlar (Faz 7), diyaloglar, boş durumlar, hata ve başarı mesajları, klavye kısayolu ipuçları.
- [x] `@apivator/core`'un ürettiği Türkçe metinler: araç hata mesajları (`ToolError`, `CurlParseError`, `DataFileError`), cron açıklaması (`describeCron`, monitör zamanlama önayarları), HTTP başvuru verisi (açıklama, kullanım, notlar), cookie/URL/CIDR/User-Agent uyarıları, HAR MIME ve zamanlama etiketleri, Python girinti uyarıları, `formatBytes`/`formatDuration`, istek farkı bölüm başlıkları. Core CLI'da da kullanıldığından dile bağlı metin yerine kod + parametre döndürmesi (çeviri arayüzde) ya da dil parametresi alması gerekir. Web'de artık kullanılmayan Türkçe eşlemeler (`AUDIT_CATEGORIES`, `AUDIT_DATA_LABELS`, `auditActionLabel`, `SSO_LINK_SENT_MESSAGE`, `ssoErrorMessage`, `VALIDITY_LABELS`, `AUTH_TYPE_LABELS`, `strengthLabel`) bu sırada kaldırılır.
- [x] Script snippet'lerindeki örnek kod (test adları, `anahtar`/`değer`) seçilen dilde eklenir; bugün yalnızca snippet başlıkları çevriliyor.

**8.2 Sunucu: hata mesajları ve e-postalar**

- [x] API hata ve doğrulama mesajları isteğin diline göre (`Accept-Language`; oturum açmış kullanıcıda kayıtlı tercih). Yanıtlarda değişmeyen bir hata kodu da döner; istemciler metne değil koda bakar. Runner'ın "durduruldu" metin eşleşmesi kaldırıldı.
- [x] E-posta şablonları (doğrulama, şifre sıfırlama, davet, e-posta değişikliği, güvenlik bildirimleri, monitör uyarıları, birleştirme istekleri) her dilde. Alıcının kayıtlı dili kullanılır; henüz hesabı olmayan davetliye daveti gönderenin seçtiği dil (varsayılan: organizasyon dili).
- [x] Organizasyon düzeyinde varsayılan dil (yöneticiler ayarlar); yeni üyelerin ve organizasyon e-postalarının başlangıç dili.
- [x] Sunucunun ürettiği dosyalar: denetim kaydı dışa aktarımı, veri indirme (6.3) başlıkları ve etiketleri isteyenin dilinde. Runner raporu (HTML/JSON) CLI'da üretildiği için 8.3'e taşındı.

**8.3 Masaüstü, CLI ve yayınlanan içerik**

- [x] Masaüstü uygulaması: pencere ve tepsi menüleri, sistem bildirimleri, güncelleme iletileri ve yerel ajanın hata mesajları seçilen dilde. Windows kurulum paketi Türkçe ve İngilizce (kurulumda seçilir).
- [x] CLI: mesajlar ve yardım metinleri `--lang` seçeneğine ya da işletim sistemi diline göre; makine tarafından okunan çıktılar (JSON raporu, çıkış kodları) dilden bağımsız kalır.
- [x] Yayınlanan dokümantasyon sayfası (5.2): sayfanın kendi metinleri (menü, "Örnek yanıt", arama) ziyaretçinin dilinde; kullanıcının yazdığı içerik çevrilmez.
- [x] Script'lerdeki test ve hata mesajları: Postman uyumluluğu için `pm.*` assertion mesajları İngilizce kalır; Apivator'ın kendi ek açıklamaları seçilen dilde.

**8.4 Çeviri süreci ve kalite**

- [x] Çeviri dosyaları depoda (frontend için JSON, sunucu için kaynak dosyaları). CI'da eksik ya da fazla anahtar kontrolü: bir dilde eksik anahtar varsa derleme uyarı verir, Türkçe ve İngilizce için hata.
- [x] Gömülü metin denetimi: JSX içinde çevrilmemiş metin bırakılmasını yakalayan lint kuralı; testler için "sözde dil" (her metni `[!! Ţëšţ !!]` gibi işaretleyen) ile ekran ekran tarama.
- [x] Uzunluk ve yön: İngilizce ve Almanca gibi daha uzun metinlerde taşma kontrolü (düğmeler, sekmeler, kenar çubuğu); ileride sağdan sola diller için yerleşimin mantıksal CSS özellikleriyle (`start`/`end`) yazılması.
- [x] Terim sözlüğü: Collection, Environment, Mock, Monitor, Workspace gibi alışılmış terimlerin her dilde nasıl yazılacağı (Türkçede bugünkü kullanım korunur); çevirmenler için anahtar başına kısa bağlam notu.

**Öncelik:** İlk sürüm: 8.1'in tamamı, API hata mesajları ve e-postalar (8.2), Türkçe + İngilizce. Masaüstü menüleri, kurulum paketi, CLI ve yayınlanan dokümantasyon ikinci adımda. Üçüncü bir dil (ör. Almanca) talebe göre, yalnızca çeviri dosyası olarak eklenir.

**Teknik notlar:** Metin anahtarları cümle değil anlam taşır (`requests.send`, `account.password.changed`); metin birleştirerek cümle kurulmaz, değişkenli tek metin kullanılır (dillerde kelime sırası farklı). Türkçede çoğul eki sayıyla değişmez, İngilizcede değişir; bu ICU çoğul kurallarıyla çözülür. Kullanıcı verisi (collection adları, açıklamalar, değişkenler) hiçbir zaman çevrilmez. Mevcut testler varsayılan olarak Türkçe ile çalışmaya devam eder; her ekran için en az bir İngilizce duman testi eklenir. Sunucuda yerelleştirme .NET'in standart altyapısıyla yapılır; hata kodları domain katmanında sabit tanımlanır, metne çeviri yalnızca API sınırında yapılır.

**Çıkış kriteri:** Uygulama İngilizce seçildiğinde sözde dil taramasında hiç Türkçe metin kalmıyor; API hataları ve e-postalar seçilen dilde geliyor; CI'daki eksik anahtar kontrolü yeşil. Türkçe bilmeyen bir kişi kayıt → istek gönderme → collection paylaşma → monitör kurma akışını yardımsız tamamlıyor.

## Faz 9 · Bakım ve iyileştirmeler

Hedef: önceki fazlarda açık kalan ya da çalışırken ortaya çıkan, tek başına faz olmayacak kadar küçük işleri toplamak. Sıra serbesttir; Faz 8'den önce ya da onunla birlikte yapılabilir.

**9.1 Yayın ve dağıtım**

- [x] Depo git'e alındı (31 Ekim 2026): `github.com/cmlclk/apivator`, `main` dalı. İlk push öncesi CI'ın yeşil başlaması için `dotnet format` (using sıralaması, `LibGitRemote` alan adı), Prettier (9 dosya) ve yeni clippy uyarısı (`files.rs`) düzeltildi.
- [x] Yayın iş akışı `.github/workflows/desktop-release.yml`: `desktop-v*` etiketiyle sürüm uyumu denetimi → taslak sürüm → Windows x64, macOS arm64 (ad-hoc imza; Intel Actions kotası için çıkarıldı), Linux x64 (AppImage/deb/rpm, Ubuntu 22.04) paralel derleme → `latest.json`da platform denetimi. `build-agent.mjs --target` ile ajan çapraz derlenir.
- [ ] İmza anahtarını üret, GitHub secret/variable'larını gir, ilk sürümü (`desktop-v0.1.0`) yayınlayıp kurulu uygulamada güncellemeyi uçtan uca dene (adımlar: `apps/desktop/README.md` → "Bir kez yapılacaklar").
- [ ] (İsteğe bağlı) macOS notarization ve Windows Authenticode imzası: sertifika alınınca.

**9.2 Test ve kod sağlığı** — tamamlandı (31 Ekim 2026). Testler: backend 21 + 502 (1 atlanan), core 1044, web 678/678 (ilk kez hatasız).

- [x] `apps/web/src/app.test.tsx`'teki 3 hata giderildi: test kurulumu (`src/test/setup.ts`) Request'i sinyalsiz kurup jsdom sinyalini `signal` olarak gösterir (Node 24 undici jsdom AbortSignal'ını reddediyordu).
- [x] Ana paket 795 KB → 480 KB (gzip 233 → 149 KB), Vite uyarısı yok: seyrek sayfalar (ekip, davet, kayıt/şifre/e-posta, SSO ve OAuth dönüşleri) route `lazy`; collection diyalogları (runner, mock, monitör, fork, git, içe aktarma), kenar çubuğunun mock/monitör/merge/aktivite bölümleri, ağ ve workspace ayarları `React.lazy`; SignalR canlı kanal açılırken, Yjs ortak düzenleme oturumu gerektiğinde yüklenir (`diffRange` Yjs'siz dosyaya, monitör cron açıklayıcısı `monitorSchedule.ts`'e taşındı). Eager kodda `@apivator/core/tools` barrel import'u kalmadı; ana pakette kalan araç kodu dinamik değişkenler (fakeData) ve araç kaydı.
- [x] `sandbox.js` `Scripting/Sandbox/` altında 5 parçaya bölündü (en büyüğü 372 satır); `ScriptSandbox` parçaları ada göre birleştirip tek "sandbox.js" kaynağı olarak hazırlar (kapanış ve kullanıcı satır eşlemesi değişmedi).
- [x] `RunnerDialog.tsx` 390 satır (+ `RunResults.tsx`, `RunHistory.tsx`); `jsonSchemaValidate.ts` 497 satır (+ `jsonSchemaValidateTypes.ts`, `jsonSchemaValidateKeywords.ts`).
- [x] `noNetwork` → lorem: sebep testte değil üreteçteydi; klasik başlangıçta rastgele virgül ~%11 olasılıkla "dolor,"/"sit," sonrasına düşüp "Lorem ipsum dolor sit amet" kalıbını bozuyordu. Virgül artık klasik kelimelere düşmez (300 tohumlu regresyon testi). Ayrıca `aes.test.ts`'teki rastgele yanlış anahtar ~1/256 olasılıkla geçerli dolgu verdiğinden sabit anahtara çevrildi.
- [x] Faz 2 durum notu düzeltildi.

**9.3 Özellik eksikleri**

- [x] Geçmişte yanıt gövdelerinin saklanması (31 Ekim 2026): Hesap ayarları → Tercihler → "Yanıt gövdelerini geçmişte sakla" (`UserPreferences.SaveHistoryResponses`, varsayılan kapalı; kapatınca saklananlar silinir). Yalnızca metin gövdeler, en çok 256 K karakter (istemci ve sunucu kısaltır, vekil çifti bölünmez); ayrı tablo `request_history_responses` (kayıtla birlikte silinir, liste sorgusu gövde yüklemez, `hasResponse` döner). Sunucu tercihi kendisi de denetler; gövde `GET /api/history/{id}/response` ile yalnızca sahibine verilir. Saklama süresi `History:ResponseRetentionDays` (varsayılan 30; `HistoryResponseRetention` günde bir siler, kayıt kalır). Farktaki "Geçmişten seç" önceki oturumların saklanan yanıtlarını tarihleriyle listeler (bu oturumda konsolda olanlar tekrarlanmaz, gövde seçilince indirilir); tercih kapalıyken nasıl açılacağı yazar. Testler: backend 21 + 505 (1 atlanan), core 1050, web 686/686.

- [x] CSV / Excel → SQL INSERT aracı (31 Ekim 2026): CSV yapıştırma (ayırıcı otomatik) ya da .csv/.tsv/.xlsx dosyası; PostgreSQL, MySQL, SQL Server, SQLite, Oracle; lehçeye göre tanımlayıcı ve metin kaçışı (MySQL'de ters bölü, SQL Server'da `N'…'`), çok satırlı INSERT (SQL Server 1000, Oracle `INSERT ALL`), kolon tipi çıkarımı (virgüllü ondalık, başında sıfır ve büyük tamsayılar korunur), boş hücre NULL/boş metin, isteğe bağlı CREATE TABLE ve işlem bloğu; 200.000 satır sınırı, 5 MB üstü çıktı indirilir.

**9.4 Araç ayrıntıları (Faz 7)**

- [x] Bayt birimleri: tamamı küçük harfle yazılan `kb`/`mb`/`gb` bit yerine bayt okunur ("KB/MB/GB = 1024" seçiliyken 1024 tabanlı; `Gb`/`Mb` ve yalın `b` bit kalır); bant genişliğinde küçük `b`li `bps` her zaman bit, `MBps` bayt (31 Ekim 2026).
- [x] Bayt birimleri: tek ayraçtan sonra tam üç rakam varsa ve ayraç etkin dilin binlik ayracıysa binlik okunur (Türkçede `1.000 GB` = 1000 GB, İngilizcede `1,000 GB`); diğer tek ayraçlar ondalık kalır (`1.5`, `1,5`, `1.50`). Araçtaki ipucu metni güncellendi (31 Ekim 2026).
- [x] Cron açıklaması: tek saat ya da en çok 3 ayrı saat bloğu aralık olarak yazılır: `*/5 9 * * *` → "09:00–09:59 arasında her 5 dakikada bir", `*/10 9-11,17 * * *` → "09:00–11:59 ve 17:00–17:59 arasında…" (İngilizcesi "between 09:00 and 09:59" / "during 09:00–11:59 and 17:00–17:59"); daha dağınık saatlerde eski liste biçimi (31 Ekim 2026).
- [x] Metin sayacı: 100.000 karakteri aşan metin yazma beklendikten sonra Web Worker'da sayılır (`textStatsWorker.ts`, `useTextStats.ts`); metin değişince süren sayım Worker sonlandırılarak bırakılır, Worker yoksa ya da yüklenemezse aynı iş parçacığında sayılır. Küçük metin eskisi gibi anında sayılır (31 Ekim 2026). Web testleri 680/680.

## Faz 10 · Kişisel kullanım: yerel mod (tahmini 2–3 hafta)

Hedef: masaüstü uygulaması sunucu kurmadan ve giriş yapmadan, tek kişilik kullanım için çalışabilsin. İlk açılışta "Kişisel kullanım (bu bilgisayarda)" ya da "Sunucuya bağlan" seçilir. Yerel modda API uygulamanın içinde çalışır, veriler bu bilgisayardaki bir SQLite dosyasında durur. Ekip modu olduğu gibi kalır.

**Başlangıçtaki durum:** Masaüstü her zaman bir Apivator sunucusuna (PostgreSQL) bağlanır; giriş, collection'lar ve environment'lar sunucudadır, yalnızca istekler yerel ajandan gider. Backend'de PostgreSQL'e özgü kod az: `jsonb` kullanan 6 dosya, 1 `EF.Functions` kullanımı, 3 zamanlayıcıda `FOR UPDATE SKIP LOCKED`, 29 PostgreSQL migration'ı. Redis zaten isteğe bağlı.

**10.1 Veritabanı sağlayıcısı**

- [x] EF Core'da sağlayıcı seçimi (`Database:Provider` = `Postgres` | `Sqlite`); SQLite için ayrı migration seti (`Persistence/Migrations/Sqlite`).
- [x] PostgreSQL'e özgü kodun sağlayıcıdan bağımsız hâle getirilmesi: `jsonb` sütunları → JSON metni (`HasJsonConversion` sağlayıcıya göre), `ILike` → büyük/küçük harf duyarsız `LIKE`, varsayılan değer SQL'i.
- [x] Zamanlayıcılar (monitör, Git kontrolü, kaynak kontrolü): SQLite'ta tek süreç olduğu için satır kilidi yok; sağlayıcıya göre dallanır.
- [x] Entegrasyon testlerinin SQLite'ta da koşması (sağlayıcıya özgü testler işaretlenir).

  Yapılan: `SqliteAppDbContext` (ayrı bağlam tipi → ayrı migration seti; `DateTimeOffset` UTC tick olarak INTEGER, `jsonb` → TEXT), WAL pragma'sı, zamanlayıcılarda IMMEDIATE işlemle seç-kilitle, Git kilidi süreç içi semafor, denetim kaydı aramasında `LIKE` ve sayfalamada açık koşul. Testler: `APIVATOR_TEST_PROVIDER=Sqlite` → 505/506 geçti (PostgreSQL'de de 505/506); sağlayıcıya özel işaretlenecek test çıkmadı, testlerdeki iki ham `interval` SQL'i LINQ'e çevrildi. CI'da SQLite koşusu henüz yok.

**10.2 API'de yerel mod**

- [x] `LocalMode` ayarı: ilk açılışta sabit yerel kullanıcı ve kişisel workspace otomatik oluşturulur; giriş, kayıt, e-posta doğrulama yok.
- [x] Kimlik doğrulama: masaüstünün her açılışta ürettiği rastgele token ile (ajandaki gibi); API yalnızca `127.0.0.1`'de dinler, CORS yalnızca uygulama kökenleri.
- [x] Ekip uçlarının kapatılması: organizasyon, takım, davet, SSO, e-posta, 2FA, ortak düzenleme (Yjs/SignalR), denetim kaydı. Çalışmaya devam edenler: collection'lar, environment'lar, geçmiş, runner, mock sunucuları, Git senkronu, araçlar, içe/dışa aktarma; monitörler uygulama açıkken.
- [x] Sunucu, istemciye yerel modda olduğunu bildirir (ör. `/api/info` → `localMode: true`).

  Yapılan (31 Ekim 2026): `LocalMode:Enabled` + `LocalMode:Token` (en az 32 karakter, yoksa açılmaz) + `LocalMode:Port` (0 = boş port). Açılışta migration uygulanır, sabit `LocalUser` (local@apivator.local, şifresiz) kişisel organizasyon/workspace ile oluşturulur; hazır olunca stdout'a `APIVATOR_API_READY {"port":N}` (ajandaki desen). Kimlik: yalnızca `LocalToken` şeması (Bearer; `/hubs` köprülerinde `access_token`), JWT/API anahtarı yok; JWT imza anahtarı her açılışta rastgele, e-posta `Console`. Kestrel yalnızca 127.0.0.1, `AllowedHosts` = localhost;127.0.0.1 (DNS rebinding), CORS yalnızca Tauri kökenleri (`LocalMode:AllowedOrigins` ile değiştirilebilir). Kapalı uçlar 404 `local_mode.unavailable`: `/api/auth/*` (SSO dahil), organizasyon (yalnızca liste GET açık), takım, davet, API anahtarı, 2FA, e-posta/şifre, oturumlar, güvenlik olayları, hesap silme, workspace üyeleri, `/hubs/workspace`. Testler: `LocalModeTests` 26 + 1 (SQLite dosyasında); backend 21 + 532 (1 atlanan) PostgreSQL'de geçti, SQLite'ta da (tek düşen `AwsSigV4_IsAppliedToRequests` yük altında zamana bağlı, tek başına 3/3 geçiyor).

**10.3 Masaüstü**

- [x] API'nin ikinci sidecar olarak paketlenmesi (tek dosya, kendi .NET çalışma zamanıyla) ve `agent.rs` deseniyle başlatılıp kapatılması; hazır sinyali, port ve token.
- [x] Veri klasörü: `%APPDATA%\Apivator\apivator.db` (macOS `~/Library/Application Support/Apivator`, Linux `~/.local/share/Apivator`); ilk açılışta oluşur, güncellemelerde migration'lar otomatik uygulanır, migration öncesi dosya yedeklenir.
- [x] İlk açılışta mod seçim ekranı; sonradan Ayarlar'dan değiştirilebilir (yerel veri silinmez).
- [x] Yayın iş akışı: API sidecar'ı dört platform için derlenir; paket boyutu ölçülür (tahmini ~55 → ~100 MB). İleride API ile ajanın tek süreçte birleştirilmesi değerlendirilir.

  Yapılan (31 Ekim 2026): `Apivator.Api` `-r <rid>` ile tek dosya, kendi çalışma zamanıyla yayınlanır (win-x64: 57 MB; ajan 52 MB). `scripts/build-agent.mjs` → `build-sidecars.mjs` (ikisini de derler, `--only agent|api`); `tauri.conf.json` `externalBin`e `apivator-api` eklendi. Rust: ortak süreç yönetimi `sidecar.rs` (kuşak sayacı: durdurulan sürecin geç olayı yenisini ezmez), `local_mode.rs` (`app_mode`, `set_app_mode`, `local_api_info`; ayarlar veri klasöründe `desktop.json`). API ortam değişkenleriyle başlar (token, `LocalMode__ParentPid`, SQLite yolu; appsettings dosyası gerekmez); yerel modda varsayılan sağlayıcı SQLite, `Proxy:AllowPrivateNetworks` açık (runner/monitör localhost'a gidebilsin), uygulama çökerse API 2 sn içinde kendini kapatır. Sürüm değişince (migration'lardan önce) `apivator.db` (+WAL) `backups/apivator-<eski sürüm>-<zaman>.db` olarak kopyalanır, en yeni 5 kalır; yedek alınamazsa API başlatılmaz. Arayüz: ilk açılışta `ModeChoice` (mod seçilmeden uygulama açılmaz), Hesap → Tercihler'de "Çalışma modu" ve giriş ekranında "Kişisel kullanıma geç"; değişince uygulama yeniden yüklenir, yerel veriler silinmez. Yayın iş akışı API'yi de çapraz derler, `verify` işi paket boyutlarını iş özetine yazar (gerçek boyut ilk yayında görülecek). Elle doğrulandı: yerel modla açılışta veritabanı oluştu, uygulama zorla kapatılınca API ve ajan kapandı, sürüm değişince yedek alındı. **Henüz yok (10.4):** arayüz yerel modda hâlâ sunucu adresine gider ve giriş ekranını gösterir; yerel API'ye bağlanma (`localApiInfo` + token) 10.4'te. Testler: Rust 10, web 689/689 (+3 `ModeChoice`).

**10.4 Web arayüzü**

- [x] Yerel modda giriş ekranı atlanır; ekip menüleri (organizasyon, takım, davet, aktivite, yorumlar, merge istekleri) ve hesap ayarlarının ilgisiz bölümleri gizlenir.
- [x] Yerel veriyi ekibe taşıma: collection/environment dışa aktarma → sunucuda içe aktarma (mevcut); ileride tek tıkla "sunucuya yükle".

  Yapılan (31 Ekim 2026): açılışta (`main.tsx` → `lib/localMode.ts` `bootDesktopMode`) yerel moddaysa API hazır olana kadar beklenir, adres ve token alınır; başlatılamazsa `LocalApiFailed` ekranı (tekrar dene / sunucuya bağlan). `serverUrl()` yerel API'yi döner; core istemcisine `sessionSource` seçeneği eklendi: yerel modda oturum refresh yerine token + `/api/me` ile kurulur (anahtar zinciri kullanılmaz). Çevrimdışı önbellek ve son kullanıcı kaydı yerel modda sabit `local` anahtarıyla tutulur (port her açılışta değişir). Gizlenenler: çevrimiçi listesi, bildirimler, e-posta/2FA/davet uyarıları, canlı kanal (SignalR), kullanıcı menüsünde ekip/çıkış ve e-posta, kenar çubuğunda Merge'ler/Aktivite, istek ve collection yorumları, hesap ayarlarında Güvenlik ve API anahtarları sekmeleri, profilde e-posta ve üyelikler, veri sekmesinde hesap silme; `/team` ve `/invite` ana ekrana döner. Tercihler → Çalışma modu'nda ekibe taşıma notu. Gerçek yerel API'ye karşı denendi: Tauri kökeninden CORS ön isteği, `/api/me`, tercihler, profil, organizasyon listesi 200. Testler: core 1051 (+1), web 691/691 (+2 yerel mod). **Elle denenmedi:** kurulu masaüstü uygulamasında uçtan uca akış (çıkış kriteri: temiz makinede kurulum → collection, istek, runner; güncellemeden sonra verilerin korunması).

**Çıkış kriteri:** temiz bir makinede kurulum sonrası sunucu ve hesap olmadan collection oluşturma, istek gönderme, runner çalıştırma; uygulama güncellendikten sonra verilerin korunması; PostgreSQL ve SQLite'ta entegrasyon testlerinin geçmesi.
