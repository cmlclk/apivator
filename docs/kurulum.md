# Apivator'ı kendi sunucunuza kurma

Bu kılavuz Apivator'ı şirket içinde tek bir Linux sunucusuna Docker ile kurmayı anlatır. Kurulum dosyaları
`deploy/` klasöründedir. Kurulumdan sonra ekip web arayüzünü tarayıcıdan, masaüstü uygulamasını ve `apivator`
komut satırı aracını da bu sunucuya bağlayarak kullanır.

## Ne kurulur

```
İnternet / şirket ağı
        │ 443 (HTTPS), 80 (yalnızca HTTPS'e yönlendirme)
   ┌────▼────┐
   │  caddy  │  TLS sertifikası, HTTP→HTTPS
   └────┬────┘
   ┌────▼────┐
   │   web   │  nginx: arayüz dosyaları; /api, /hubs, /mock → api
   └────┬────┘
   ┌────▼────┐      ┌──────────┐
   │   api   │──────│ postgres │  tüm veriler (volume: postgres-data)
   └────┬────┘      └────▲─────┘
   ┌────▼────┐      ┌────┴─────┐
   │  redis  │      │  backup  │  her gün pg_dump → deploy/backups
   └─────────┘      └──────────┘
```

Yalnızca `caddy` dışarıya port açar. Veritabanı ve Redis dışarıdan erişilemez.

## Gereksinimler

- Linux sunucu: 2 vCPU, 4 GB RAM, 20 GB disk (50 kişiye kadarlık bir ekip için rahat yeter).
- Docker Engine 24+ ve Docker Compose v2 (`docker compose version`).
- Bir alan adı (ör. `apivator.sirket.com`) ve DNS kaydının bu sunucuyu göstermesi.
- E-posta göndermek için bir SMTP hesabı. Doğrulama, şifre sıfırlama, davet ve bahsetme e-postaları için
  gereklidir. Office 365 için `smtp.office365.com:587`, Google Workspace için `smtp.gmail.com:587`.
- Kaynak kod: sunucuda bu deponun bir kopyası. İmajlar sunucuda derlenir; bunun için internet erişimi
  gerekir (NuGet, npm, Docker Hub).

## Kurulum

```bash
git clone <depo-adresi> apivator && cd apivator/deploy
cp .env.example .env
nano .env
```

`.env` içinde en az şunları doldurun:

| Ayar | Açıklama |
| --- | --- |
| `APIVATOR_DOMAIN` | Alan adı, ör. `apivator.sirket.com` |
| `APIVATOR_PUBLIC_URL` | `https://` + alan adı. E-postalardaki bağlantılar buna göre kurulur. |
| `POSTGRES_PASSWORD` | Rastgele, uzun bir değer: `openssl rand -base64 32` |
| `JWT_SIGNING_KEY` | Oturum token'larını imzalar. Rastgele, en az 32 karakter: `openssl rand -base64 48`. Değiştirilirse herkes yeniden giriş yapar. |
| `SMTP_*` | E-posta sunucusu bilgileri |
| `CADDY_TLS` | Sertifika kaynağı (aşağıya bakın) |

Sonra başlatın:

```bash
docker compose up -d --build
docker compose ps            # hepsi "running", api "healthy" olmalı
docker compose logs -f api   # ilk açılışta veritabanı tabloları oluşturulur
```

`https://apivator.sirket.com` adresini açın ve kayıt olun. İlk kayıt olan kişi de diğerleri gibi kendi kişisel
workspace'iyle başlar. Ekip için **Hesap menüsü › Ekip ve organizasyonlar** ekranından bir organizasyon
oluşturup diğerlerini e-postayla davet edin.

### HTTPS sertifikası (`CADDY_TLS`)

| Değer | Ne zaman |
| --- | --- |
| `auto` | Alan adı internetten erişilebiliyorsa. Caddy, Let's Encrypt'ten sertifikayı kendisi alır ve yeniler. 80 ve 443 portları dışarıya açık olmalı. |
| `files` | Şirket CA'sından ya da satın alınmış bir sertifikanız varsa. `deploy/certs/cert.pem` (ara sertifikalar dahil zincir) ve `deploy/certs/key.pem` dosyalarını koyun. Yenilenince dosyaları değiştirip `docker compose restart caddy`. |
| `internal` | Yalnızca iç ağda, sertifikası olmayan bir deneme kurulumunda. Caddy kendi CA'sını kullanır; tarayıcıların bu CA'ya güvenmesi gerekir: `docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt .` ile alıp bilgisayarlara "Güvenilen Kök Sertifika" olarak dağıtın. |

### Şirket içi API'leri web'den test etmek

Web arayüzünden gönderilen istekler sunucudan çıkar. Güvenlik için sunucu localhost'a, iç ağ adreslerine
(10.x, 172.16–31.x, 192.168.x) ve bulut metadata adreslerine istek atmaz. Böylece Apivator'ı kullanan biri
sunucunun bulunduğu ağı tarayamaz.

İç ağdaki API'lerinizi web'den test etmek istiyorsanız yalnızca o ağları açın:

```dotenv
PROXY_ALLOWED_NETWORKS=10.20.0.0/16, 192.168.10.0/24
```

Masaüstü uygulaması ve `apivator` CLI istekleri kullanıcının kendi bilgisayarından atar. Bu ayardan
etkilenmezler; kullanıcının erişebildiği her adrese erişirler.

## Güncelleme

```bash
cd apivator
git pull
cd deploy
./backup.sh                       # önce elle yedek (önerilir)
docker compose up -d --build
```

Veritabanı değişiklikleri (migration'lar) API açılırken kendiliğinden uygulanır. Güncelleme sırasında birkaç
saniyelik kesinti olur. Açık sayfalar canlı bağlantıyı kendiliğinden yeniden kurar.

Masaüstü uygulaması sunucudan ayrı güncellenir. İmzalı otomatik güncelleme için bkz.
`src/frontend/apps/desktop/README.md`.

## Yedekleme ve geri yükleme

`backup` servisi her gün `BACKUP_HOUR` saatinde veritabanının tam yedeğini alır. Yedekler
`deploy/backups/apivator-YYYYMMDD-HHMMSS.dump` adıyla yazılır ve `BACKUP_KEEP_DAYS` günden eskileri silinir.
Yedek; collection'ları, environment'ları, değişiklik geçmişini, yorumları, kullanıcıları, ekipleri, API
anahtarı özetlerini ve oturum şifreleme anahtarlarını içerir. Uygulamanın tüm durumu veritabanındadır; ayrıca
yedeklenecek dosya yoktur (`.env` hariç; onu güvenli bir yerde ayrıca saklayın).

**Yedekleri sunucunun dışına da kopyalayın.** Sunucunun diski giderse yanındaki yedek de gider. Örnek:

```bash
# Her gece 04:00'te yedekleri başka bir makineye eşitle (crontab -e)
0 4 * * * rsync -a --delete /opt/apivator/deploy/backups/ yedek@nas.sirket.local:/yedekler/apivator/
```

Elle yedek almak için:

```bash
./backup.sh
```

Geri yüklemek için:

```bash
./restore.sh backups/apivator-20261021-030000.dump
```

Betik önce o anki veritabanının yedeğini alır (`backups/before-restore-*.dump`). Sonra API'yi durdurur,
veritabanını yedektekiyle değiştirir ve API'yi yeniden başlatır.

**Geri yüklemeyi deneyin.** Ayda bir, yedeği ayrı bir deneme kurulumuna geri yükleyip açılıp açılmadığına
bakın. Denenmemiş yedek, yedek sayılmaz.

## Sağlık kontrolü ve izleme

| Adres | Ne söyler |
| --- | --- |
| `/health/live` | Süreç ayakta mı (veritabanına bakmaz) |
| `/health/ready` | Hazır mı: `{"status":"Healthy","version":"1.0.0","checks":{"postgres":"Healthy"}}`. Veritabanına ulaşamazsa 503 döner. |

Bu adresler `api` container'ında, 8080 portundadır. Dışarıya açık değildir; Docker kendi sağlık kontrolünde
`/health/ready`'yi kullanır (`docker compose ps` → `healthy`). Bir izleme aracından (Uptime Kuma, Zabbix,
Prometheus blackbox) dışarıdan bakmak isterseniz Caddyfile'a ekleyin:

```caddyfile
handle /health/* {
	reverse_proxy api:8080
}
```

## Loglar

```bash
docker compose logs -f api        # uygulama: JSON, satır başına bir olay
docker compose logs -f web        # nginx erişim logu
docker compose logs backup        # yedekleme sonuçları
```

API logları JSON biçimindedir; Loki, ELK ya da Graylog gibi araçlara doğrudan alınabilir. Her istek için tek
satır yazılır: yöntem, yol, durum kodu, süre, kullanıcı kimliği. Örnek:

```json
{"Timestamp":"2026-10-21T17:00:29.553Z","LogLevel":"Information","Category":"Apivator.Requests","Message":"HTTP GET /api/workspaces 200 12 ms 01a15f68-…"}
```

Loglara sorgu dizgileri, istek gövdeleri, token'lar ve parolalar yazılmaz. Container logları 5 × 20 MB ile
sınırlıdır; eskileri kendiliğinden silinir. İstek satırlarını kapatmak için `api` servisine
`Logging__LogLevel__Apivator.Requests: Warning` ekleyin.

## Ölçekleme

Tek API container'ı yüzlerce eşzamanlı kullanıcıya yeter. Daha fazlası gerekirse:

```bash
docker compose up -d --scale api=3
```

Canlı güncellemeler Redis üzerinden tüm API container'larına dağıtılır. Oturum şifreleme anahtarları
veritabanında olduğu için kullanıcılar hangi container'a düşerse düşsün oturumları geçerlidir. Bilinen bir
sınır var: dakika başına istek sınırları container başınadır. "Kim çevrimiçi" bilgisi Redis'te tutulur ve
container'lar arasında paylaşılır.

Monitörler API container'larının içinde çalışır. Her container zamanı gelen monitörleri veritabanından "kapar";
aynı monitör iki kez çalışmaz, yük container'lara dağılır. Bir container çökerse onun çalıştırdığı monitör
birkaç dakika sonra başka bir container'da yeniden çalışır. Monitörleri belirli container'larda çalıştırmamak için
o container'a `Monitors__SchedulerEnabled: "false"` verin. Monitör bildirimleri SMTP ile gönderilir; e-posta
ayarları yapılmadıysa yalnızca webhook bildirimleri çalışır.

## Kubernetes ve Helm

Kubernetes kullanıyorsanız `deploy/helm/apivator` klasöründeki Helm chart'ı kullanın. Chart API ve web
Deployment'larını, Service'leri, Ingress'i, isteğe bağlı HPA ve PodDisruptionBudget'ı kurar. PostgreSQL ve Redis
chart ile **kurulmaz**: yönetilen bir servis ya da kendi kurulumunuzun adresi verilir. Gereksinimler: Kubernetes
1.25+, Helm 3, PostgreSQL 16+, bir Ingress controller (hazır ayarlar nginx içindir) ve imajların bir registry'de olması.

```bash
# İmajları derleyip registry'nize gönderin (docker-compose ile aynı Dockerfile'lar)
docker build -t registry.sirket.com/apivator-api:1.0.0 src/backend
docker build -t registry.sirket.com/apivator-web:1.0.0 src/frontend

# Değerler: deploy/helm/apivator/values.yaml içindeki yorumlara bakın
cat > my-values.yaml <<'EOF'
publicUrl: https://apivator.sirket.com
api:
  image: { repository: registry.sirket.com/apivator-api, tag: "1.0.0" }
web:
  image: { repository: registry.sirket.com/apivator-web, tag: "1.0.0" }
externalDatabase: { host: postgres.sirket.local }
smtp: { host: smtp.sirket.com, fromAddress: no-reply@sirket.com }
ingress:
  className: nginx
  host: apivator.sirket.com
  tls: { enabled: true }
EOF

helm upgrade --install apivator deploy/helm/apivator -n apivator --create-namespace -f my-values.yaml \
  --set secrets.dbPassword="$(openssl rand -hex 16)" \
  --set secrets.jwtSigningKey="$(openssl rand -hex 32)"
```

Gizli değerleri komut satırında vermek yerine kendi Secret'ınızı oluşturup `existingSecret: adi` verin. Secret'ta
`jwt-signing-key`, `db-password` ve isteğe bağlı olarak `smtp-password` ile `redis-password` anahtarları olmalıdır.
Aynı `jwt-signing-key` her güncellemede korunmalıdır; değişirse herkes oturumdan düşer.

**Veritabanı şeması.** Varsayılan `migration.mode: job` ile her `helm install/upgrade` öncesinde tek seferlik bir Job
şemayı günceller; API pod'ları şemaya dokunmaz. Bu yüzden birden fazla pod aynı anda migration çalıştırmaz ve hatalı bir
migration yeni sürümün yayına çıkmasını engeller. Job, API imajını `dotnet Apivator.Api.dll --migrate-only` komutuyla
çalıştırır. Tek replica ile basit kurulum için `migration.mode: startup` (pod açılışta kendisi yapar) ya da migration'ı
kendiniz yönetecekseniz `none` seçin.

**Ölçekleme.** `api.replicaCount` ya da `api.autoscaling.enabled: true` (CPU'ya göre HPA) ile API çoğaltılır. 1'den
fazla replica için `externalRedis.host` **zorunludur**; verilmezse `helm` kurulumu açıklayıcı bir hatayla durdurur.
Birden fazla replica varken bilmeniz gerekenler:

- Canlı kanal (SignalR) ilk istekte bağlantı kurar, sonraki WebSocket/SSE isteği aynı pod'a gitmelidir. Chart nginx
  Ingress'te cookie tabanlı affinity açar (`ingress.nginx.stickySessions`). Başka bir Ingress controller kullanıyorsanız
  `ingress.annotations` ile kendi affinity ayarınızı verin.
- Dakika başına istek sınırları pod başınadır, yani sınırlar pod sayısıyla çarpılır. "Kim çevrimiçi" bilgisi Redis'te
  tutulduğu için pod'lar arasında paylaşılır. Monitörler ve kaynak belge kontrolleri ise veritabanı kilidiyle
  pod'lar arasında güvenle paylaşılır.
- Oturum kapatma başka pod'larda en geç 30 saniye içinde geçerli olur.
- Uygulama `X-Forwarded-For` başlığına güvenir; küme içindeki başka pod'ların API'ye doğrudan erişip IP'yi
  (denetim kaydı, hız sınırı) sahteleyememesi için `networkPolicy.enabled: true` verin (CNI desteklemeli;
  `networkPolicy.ingressControllerNamespaceSelector` ile ingress controller'ın namespace'ini belirtin).
- Veritabanı ve Redis şifreleri bağlantı dizgisine yazıldığı için `;` `=` `,` tırnak ve boşluk içeremez
  (chart bunu kontrol eder); `openssl rand -hex 16` gibi üretin. Üretimde `existingSecret` önerilir.
- Bir sürüme geçişte migration çalıştıktan sonra eski imaja geri dönmek (rollback) şemayı eski sürümden ileride bırakır;
  geri dönmeden önce yedekten dönmeyi ya da şemanın geriye uyumlu olduğunu doğrulayın.
- Oturum şifreleme (Data Protection) anahtarları veritabanında tutulur ve tüm replica'lar paylaşır; pod başına
  ayrı anahtar deposu (volume, dosya) eklemeyin.
- `Sso__RequireDomainVerification` varsayılanı `true`'dur; çok kiracılı kurulumda `api.config` ile `false` yapmayın.
- Kapanırken pod'lara 70 sn tanınır (açık canlı bağlantılar için); `PodDisruptionBudget` çoklu replica'da en az bir
  pod'u ayakta tutar.

**Ingress.** `/api`, `/hubs` (WebSocket dahil) ve `/mock` doğrudan API Service'ine, diğer her şey web Service'ine gider.
Hepsini web (nginx) üzerinden geçirmek isterseniz `ingress.apiRouting: web` verin (istemci IP'si için iki proxy sayılır,
chart bunu kendisi ayarlar). Sertifika için `ingress.tls.enabled: true` ve cert-manager kullanıyorsanız
`ingress.annotations` içine `cert-manager.io/cluster-issuer` ekleyin. Sunucuda iç ağ adreslerine web'den istek atmak
için `api.proxyAllowedNetworks`, diğer uygulama ayarları (SSO, hız sınırları vb.) için `api.config` kullanılır
(örn. `Sso__...: değer`).

Doğrulama: `helm lint deploy/helm/apivator -f my-values.yaml` ve `helm template apivator deploy/helm/apivator -f my-values.yaml`.

## Güvenlik kontrol listesi

- [ ] `.env` dosyası yalnızca root tarafından okunabilir: `chmod 600 .env`
- [ ] `POSTGRES_PASSWORD` ve `JWT_SIGNING_KEY` rastgele üretildi; örnek değerler kullanılmıyor
- [ ] Sunucuda yalnızca 80 ve 443 açık (`ufw allow 80,443/tcp`); 5432 ve 6379 dışarıya kapalı
- [ ] Yedekler sunucunun dışına kopyalanıyor ve geri yükleme denendi
- [ ] `PROXY_ALLOWED_NETWORKS` yalnızca test edilecek ağları içeriyor
- [ ] Ayrılan çalışanlar organizasyondan çıkarılıyor. Çıkarılan kişi organizasyonun verilerine ne arayüzden ne
  de API anahtarıyla erişebilir; açık sayfası da anında olay almayı bırakır
- [ ] Docker ve işletim sistemi güncellemeleri düzenli yapılıyor
- [ ] Mock'lar (`/mock/...`) oturum gerektirmez: adresi bilen çağırabilir. İnternete açık bir sunucuda gerçek
  veri içeren örnekler için mock'u **gizli** yapın (çağıran API anahtarı gönderir). Gizli işaretli değişkenler
  hiçbir mock yanıtına yazılmaz. Mock başına dakikada 600 istek sınırı vardır (`RateLimiting__MockPermitPerMinute`)

## Sorun giderme

| Belirti | Neden ve çözüm |
| --- | --- |
| `api` sürekli yeniden başlıyor | `docker compose logs api`. Çoğunlukla eksik ya da kısa `JWT_SIGNING_KEY` ya da yanlış `POSTGRES_PASSWORD`. Not: veritabanı ilk kurulumda oluşturulduysa sonradan `.env`'de şifreyi değiştirmek yetmez; şifreyi PostgreSQL içinde de değiştirin. |
| E-postalar gelmiyor | `docker compose logs api` içinde "gönderilemedi" geçen satırlar. SMTP bilgilerini, portun sunucudan dışarı açık olduğunu ve gönderen adresin yetkili olduğunu kontrol edin. STARTTLS'li 587 (ya da 25) kullanın; yalnızca 465 (doğrudan SSL) sunan sağlayıcılar desteklenmez. |
| Sertifika alınamıyor (`auto`) | `docker compose logs caddy`. Alan adı bu sunucuyu göstermeli ve 80 portu internetten erişilebilir olmalı. İç ağdaysanız `files` ya da `internal` kullanın. |
| Sayfa açılıyor ama "Çevrimdışı" yazıyor | Canlı kanal (WebSocket) kurulamıyor. Önünde başka bir proxy ya da load balancer varsa WebSocket'i (Upgrade başlığını) iletmesi gerekir. |
| Web'den istek "engellendi" hatası veriyor | Hedef bir iç ağ adresi. `PROXY_ALLOWED_NETWORKS` ile açın ya da masaüstü uygulamasını kullanın. |
| Herkes oturumdan düştü | `JWT_SIGNING_KEY` değişmiş. Bu beklenen davranıştır; yeniden giriş yapılır. |
