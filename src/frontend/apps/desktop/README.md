# Apivator masaüstü

Tauri 2 kabuğu, web arayüzünün aynısını çalıştırır. Masaüstündeki farklar şunlar:

- **İstekler bu bilgisayardan gider.** Uygulamayla birlikte gelen yerel .NET ajanı (`apivator-agent`)
  istekleri, script'leri, OAuth token isteklerini, Digest'i ve AWS imzasını web'deki C# koduyla birebir
  aynı şekilde yürütür. Böylece `localhost` ve iç ağ adreslerine erişilebilir.
- **Ajan dışarıya kapalıdır.** Yalnızca `127.0.0.1` üzerinde dinler. Her açılışta üretilen rastgele bir
  token ister ve yalnızca uygulama penceresinin kökenlerine CORS izni verir. Uygulama kapanınca ajan da
  kapanır.
- **Oturum anahtar zincirinde saklanır.** Refresh token, işletim sisteminin anahtar zincirinde (Windows
  Credential Manager / macOS Keychain / Linux Secret Service) sunucu adresine göre tutulur.
- **Değişkenlerin güncel değerleri şifreli.** Token, parola gibi güncel değerler AES-256-GCM ile şifrelenip yerel
  depoda tutulur; anahtar anahtar zincirindedir (`local_key:variables`). Anahtar zinciri yoksa düz metne düşülür.
- **Çevrimdışı çalışır.** Sunucuya ulaşılamazsa uygulama son eşitlenen collection'larla açılır, istekler bu
  bilgisayardan gönderilmeye devam eder; kaydedilen değişiklikler bağlantı gelince sunucuya yazılır.
- **OAuth 2.0 girişi sistem tarayıcısında açılır** (RFC 8252). Sağlayıcı, ajanın loopback adresine
  (`http://127.0.0.1:<port>/oauth/callback`) döner. Sağlayıcıda yönlendirme adresi olarak
  `http://127.0.0.1` kayıtlı olmalıdır; port serbesttir.
- **Sunucu adresi giriş ekranından değiştirilebilir.** Varsayılan `http://localhost:5080`'dir.
  Derlemede `VITE_API_URL` verilirse o kullanılır.

Collection'lar, environment'lar ve ekip verileri her zaman sunucudadır. **Collection runner da bu
bilgisayarda çalışır:**

1. Collection sunucudan alınır.
2. Ajanda yürütülür.
3. Rapor sunucuya kaydedilir ve ekip "masaüstünden" etiketiyle görür. Durdurulan çalıştırmalar o ana kadarki
   sonuçlarla kaydedilir.

## Ağ ayarları

Üst çubuktaki ağ simgesi bu bilgisayardan giden istekler için ayarları açar:

- **Proxy:** sistem ayarı (varsayılan), yok ya da özel proxy. Özel proxy'de kullanıcı adı/şifre ve proxy'ye
  uğramayacak adresler (`localhost`, `*.local`, `10.*`) girilebilir.
- **SSL:** sunucu sertifikası doğrulaması kapatılabilir; daha iyisi şirket CA sertifikasını (PEM/CRT/DER
  dosya yolu) eklemektir. CA eklense de sertifikadaki ad uyuşmazlığı kabul edilmez.
- **İstemci sertifikaları (mTLS):** host'a göre (`api.ornek.com`, `*.ornek.com`) PFX/P12 ya da PEM sertifika
  ve anahtar dosyası.

Parolalar anahtar zincirinde, geri kalanı uygulamanın yerel deposunda saklanır. Ajan ayarları doğrular (dosya
var mı, şifre doğru mu); hatalı ayar kaydedilmez. Kayıtlı ayarlar her açılışta ilk istekten önce uygulanır.

## Windows'ta gereksinimler (bir kez)

1. **Rust:** https://rustup.rs adresinden `rustup-init.exe` indirilir; varsayılan kurulum (MSVC araç
   zinciri) seçilir.
2. **Microsoft C++ Build Tools:** Visual Studio Installer'da "Desktop development with C++" iş yükü
   işaretlenir. Visual Studio (2022 ya da 2026) kuruluysa bu iş yükünü eklemek yeterlidir.
3. **WebView2:** Windows 10/11'de hazır gelir.
4. **.NET 10 SDK** ve **Node 22 + pnpm:** projenin geri kalanı için zaten kurulu olmalı.

## Geliştirme

Önce API çalıştırılır (`src/backend/src/Apivator.Api` içinde `dotnet run --launch-profile http`).
Ardından:

```powershell
cd src\frontend
pnpm install
pnpm --filter @apivator/desktop dev
```

`dev` betiği şunları yapar:

1. Sidecar'lar yoksa onları bu platform için yayınlar: `src-tauri/binaries/apivator-agent-<hedef>.exe`
   (yerel ajan) ve `apivator-api-<hedef>.exe` (kişisel kullanım modunun API'si).
2. Vite geliştirme sunucusunu başlatır.
3. Uygulama penceresini açar.

Ajanın ya da API'nin C# kodu değişince `pnpm --filter @apivator/desktop sidecars` ile yeniden yayınlanır
(yalnızca biri için `-- --only agent` / `-- --only api`). İlk Rust
derlemesi birkaç dakika sürer.

Geliştirmede API'nin CORS listesinde (`appsettings.Development.json`) Tauri kökenleri
(`tauri://localhost`, `http://tauri.localhost`) zaten tanımlıdır. Kurulu bir sunucuda bunlar
`Cors:AllowedOrigins` ayarına eklenmelidir.

## Kurulum paketi

```powershell
pnpm --filter @apivator/desktop package
```

Çıktı `src-tauri/target/release/bundle/` altında oluşur. Windows'ta iki paket çıkar:

- `nsis/Apivator_<sürüm>_x64-setup.exe`: önerilen paket. Sihirbaz Türkçe ve İngilizcedir (dil kurulumun başında seçilir), kullanıcı başına kurulur
  ve yönetici izni istemez.
- `msi/…msi`: grup ilkesiyle dağıtım içindir.

Ajan, kendi .NET çalışma zamanıyla tek dosya olarak pakete eklenir (~55 MB; sıkıştırılmış kurulumda daha
küçük). Kullanıcının makinesinde .NET kurulu olması gerekmez.

Yerel derlemelerde otomatik güncelleme kapalıdır.

## Yayın ve otomatik güncelleme

Güncelleme kodu `updater` Cargo özelliğinin arkasındadır. `.github/workflows/desktop-release.yml`, `desktop-v*`
etiketiyle tetiklenir ve şunları yapar:

- Etiketin, `tauri.conf.json` ve `package.json` sürümüyle aynı olduğunu denetler, GitHub Releases'te taslak açar.
- Bu özellik açık, imzalı paketleri paralel üretir:

  | Platform                                  | Paketler                    | Otomatik güncellenen |
  | ----------------------------------------- | --------------------------- | -------------------- |
  | Windows x64                               | NSIS `.exe`, `.msi`         | NSIS ve MSI          |
  | macOS Apple Silicon (`aarch64`)           | `.dmg`, `.app.tar.gz`       | `.app`               |
  | Linux x64 (Ubuntu 22.04 ile; glibc 2.35+) | `.AppImage`, `.deb`, `.rpm` | yalnızca AppImage    |

- Her platformu ve imzasını `latest.json`'a ekler. Son adım üç platformun da orada olduğunu denetler.

Taslak yayınlanınca kurulu uygulamalar açılışta yeni sürümü görür ve üstte "Şimdi güncelle" çıkar. `.deb`/`.rpm`
ile kurulanlar güncellemeyi paket yöneticisinden alır.

macOS paketleri Apple Developer sertifikası olmadan **ad-hoc imzalıdır**. Gatekeeper ilk açılışta uyarır; kullanıcı
Finder'da sağ tık → Aç ile (ya da `xattr -dr com.apple.quarantine /Applications/Apivator.app`) bir kez onaylar.
Güncellemeler bundan etkilenmez, Tauri imzasıyla doğrulanır. Notarization için ileride `APPLE_*` secret'ları
eklenebilir. Windows paketleri de Authenticode imzasızdır; SmartScreen ilk kurulumda uyarabilir.

Bir kez yapılacaklar:

1. İmza anahtarını oluşturun. Özel anahtarı ve parolasını güvenli bir yerde saklayın; kaybolursa kurulu
   uygulamalar güncelleme alamaz.
   ```powershell
   cd src\frontend\apps\desktop
   pnpm tauri signer generate -w $HOME\.apivator\updater.key
   ```
2. GitHub deposunda **Settings > Secrets and variables > Actions** altında şunları ekleyin:
   - Secret `TAURI_SIGNING_PRIVATE_KEY`: `updater.key` dosyasının içeriği
   - Secret `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: parola
   - Variable `TAURI_UPDATER_PUBKEY`: `updater.key.pub` dosyasının içeriği
   - Variable `APIVATOR_API_URL` (isteğe bağlı): uygulamanın varsayılan sunucu adresi
3. Yeni sürüm için `src-tauri/tauri.conf.json` ve `package.json` içindeki `version` alanını artırın.
   Ardından etiketi gönderin ve iş akışı bitince taslağı GitHub'da yayınlayın:
   ```powershell
   git tag desktop-v0.2.0
   git push origin desktop-v0.2.0
   ```

Güncellemeler imzalıdır; uygulama, açık anahtarla doğrulayamadığı paketi kurmaz.

## Klasörler

- `src-tauri/src/sidecar.rs`: .NET sidecar'larını başlatır/kapatır, hazır satırından portu okur, oturum token'ı üretir.
- `src-tauri/src/agent.rs`: ajan (`APIVATOR_AGENT_READY {"port":…}`), `agent_info` komutu.
- `src-tauri/src/local_mode.rs`: çalışma modu (`app_mode`, `set_app_mode`, `local_api_info`). Yerel modda
  API sidecar'ı (`APIVATOR_API_READY`) veri klasöründeki SQLite dosyasıyla başlar: Windows `%APPDATA%Apivator`,
  macOS `~/Library/Application Support/Apivator`, Linux `~/.local/share/Apivator` (`apivator.db`, `desktop.json`).
  Uygulama sürümü değiştiyse API başlamadan veritabanı `backups/` altına kopyalanır (en yeni 5 yedek kalır).
- `src-tauri/src/secrets.rs`: anahtar zinciri komutları (yalnızca izin verilen anahtar adları).
- `src-tauri/src/updates.rs`: güncelleme denetimi ve kurulumu (`updater` özelliğiyle).
- `src-tauri/src/lib.rs`: `open_external` komutunu (yalnızca http/https) ve uygulama yaşam döngüsünü
  içerir.
- `scripts/build-sidecars.mjs`: ajanı ve API'yi yayınlar, Tauri'nin beklediği adla kopyalar.
- Ajanın kaynağı: `src/backend/src/Apivator.Agent`; yerel API: `src/backend/src/Apivator.Api` (`LocalMode`).
