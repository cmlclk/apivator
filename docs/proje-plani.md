# Apivator — Proje Planı

Oct 20, 2026 · @ccelik

## Vizyon ve hedefler

Apivator, ekibin API'leri tek yerden tasarlayıp, çağırıp, test edip paylaştığı Postman benzeri bir platformdur. Fark yaratacak nokta: kendi sunucumuzda çalışabilmesi ve tüm verinin ekipte kalması.

- **Bireysel kullanım:** istek oluşturma, collection, environment, test script'leri, geçmiş.
- **Ekip kullanımı:** workspace, takım, rol bazlı yetki, collection paylaşımı, eşzamanlı düzenleme.
- **Otomasyon:** collection runner, CLI ile CI/CD entegrasyonu, zamanlanmış monitörler.
- **Uyumluluk:** Postman collection v2.1, OpenAPI 3.x ve cURL içe/dışa aktarma; ekip mevcut çalışmasını taşıyabilmeli.

Başarı ölçütü: ekip Postman'i bırakıp günlük işini tamamen Apivator'da yapabiliyor.

## Kararlar ve varsayımlar

Platform, teknoloji ve kapsam kararlandı; hosting henüz açık, bu yüzden mimari her iki seçeneğe de uyacak şekilde kuruldu.

| Konu | Karar | Gerekçe / not |
| --- | --- | --- |
| Platform | Web + Desktop | Web her yerden erişim sağlar; desktop CORS'a takılmadan localhost ve iç ağ API'lerini çağırır |
| Backend | ASP.NET Core (.NET 10 LTS) | Ekip tercihi; SignalR ile gerçek zamanlı senkron hazır gelir |
| Frontend | React + TypeScript | Web ve desktop aynı kod tabanını kullanır |
| Hosting | Açık | Varsayım: Docker Compose ile self-hosted kurulabilir, aynı imajlar bulutta (Azure/AWS) da çalışır |
| Kapsam | Tam kapsam, süre esnek | Fazlı ilerleme; her faz kendi başına kullanılabilir sürüm çıkarır |
| Lisans modeli | Varsayım: iç kullanım | Faturalama/abonelik kapsam dışı |

## Özellik kapsamı

Postman'in temel yetenekleri 10 modüle ayrıldı; her modülün hangi fazda geldiği yol haritasında.

| Modül | Özellikler | Faz |
| --- | --- | --- |
| **İstek editörü** | Tüm HTTP metodları; URL, query, path değişkenleri; header; body (raw JSON/XML/text, form-data, x-www-form-urlencoded, binary, GraphQL); yanıt görüntüleyici (pretty/raw/preview, header, cookie, süre, boyut); sekmeli çalışma | 1 |
| **Authorization** | No auth, API Key, Bearer, Basic, OAuth 2.0 (auth code, client credentials, PKCE), Digest, AWS Sig v4; collection/klasörden miras alma | 1–2 |
| **Collection** | Collection → klasör → istek ağacı; sürükle-bırak; kopyala; collection seviyesinde değişken, auth ve script; açıklama (Markdown) | 1 |
| **Environment ve değişkenler** | Global, collection, environment, local kapsamları; `{{degisken}}` çözümleme; initial/current value ayrımı; gizli (secret) değişkenler | 1 |
| **Script ve test** | Pre-request ve test script'leri (JavaScript, sandbox); `pm.*` uyumlu API (`pm.test`, `pm.expect`, `pm.environment.set`, `pm.sendRequest`); test sonuç paneli | 2 |
| **Collection runner** | Sıralı çalıştırma, iterasyon, CSV/JSON veri dosyası, gecikme, rapor; CLI (Newman benzeri) ile CI/CD | 2–3 |
| **İçe/dışa aktarma** | Postman collection v2.1 ve environment, OpenAPI 3.x, cURL, HAR; kod üretimi (cURL, C#, JS fetch, Python vb.) | 1–2 |
| **Takım ve paylaşım** | Organizasyon, workspace (kişisel/takım), davet, roller, collection paylaşımı, yorumlar, değişiklik geçmişi, fork/merge, gerçek zamanlı senkron | 3 |
| **Mock server ve monitör** | Örnek yanıtlardan mock endpoint; zamanlanmış collection çalıştırma ve uyarı (e-posta/webhook) | 4 |
| **Gelişmiş protokoller** | WebSocket, Server-Sent Events, gRPC, GraphQL şema keşfi; API dokümantasyonu yayınlama | 4–5 |

Yardımcı özellikler (tüm fazlarda): istek geçmişi, cookie yöneticisi, proxy ve SSL sertifika ayarları, klavye kısayolları, açık/koyu tema.

## Mimari

&#91;embedded content: Apivator mimarisi · 3 istemci, 4 sunucu servisi\]

Tüm istemciler aynı REST API ve SignalR hub'ı kullanır; tek fark isteğin hedefe kimin tarafından atıldığıdır.

- **İstek yürütme motoru** ortak bir sözleşmedir (`IRequestExecutor`): değişken çözümleme → auth uygulama → pre-request script → HTTP çağrısı → test script → sonuç. Desktop'ta Rust tarafı, web'de sunucu proxy'si, CLI ve monitörde .NET tarafı bu sözleşmeyi uygular.
- **Offline-first istemci:** Collection'lar istemcide IndexedDB'de (desktop'ta SQLite) önbelleğe alınır; bağlantı yokken de çalışılır, dönüşte senkronlanır.
- **Modüler monolit:** Başlangıçta tek API servisi; Identity, Workspace, Collection, Execution, Runner modülleri ayrı projelerde. İhtiyaç olursa proxy ve worker ayrı servise çıkarılır.

## Teknoloji yığını

Tek monorepo; backend .NET çözümü, frontend pnpm workspace. Web ve desktop aynı React paketini kullanır.

| Katman | Teknoloji | Not |
| --- | --- | --- |
| Web UI | React 18+, TypeScript, Vite | Paket: `apps/web` |
| UI bileşenleri | Tailwind + shadcn/ui (Radix) | Erişilebilir, temalanabilir |
| Kod editörü | Monaco Editor | Body, script ve JSON yanıt için; IntelliSense ile `pm.*` tanımları |
| State | Zustand (UI) + TanStack Query (sunucu verisi) |  |
| Desktop | Tauri 2 (Rust) | Electron'a göre küçük kabuk; istekleri uygulamayla gelen yerel .NET ajanı yürütür (web ile aynı C# zinciri), CORS yok. Ekipte Rust bilgisi gerekmez: Rust kodu yalnızca ajanı başlatır ve anahtar zincirine erişir |
| API | ASP.NET Core 10, Minimal API | Clean Architecture: Domain / Application / Infrastructure / Api |
| Gerçek zamanlı | SignalR | Collection değişiklik bildirimleri, kimin online olduğu |
| Veritabanı | PostgreSQL 16 + EF Core | Collection içeriği için JSONB kolonlar |
| Cache / kuyruk | Redis | SignalR backplane, oturum, rate limit |
| Arka plan işleri | Hangfire veya Quartz.NET | Monitörler, zamanlanmış run'lar |
| Kimlik | ASP.NET Identity + JWT; OIDC/SSO (Azure AD, Google) opsiyonel | Refresh token, e-posta doğrulama |
| Script çalıştırma | İstemcide: QuickJS (WASM) sandbox; sunucuda: Jint | Aynı `pm` kütüphanesi her iki tarafta |
| CLI runner | .NET global tool (`apivator run`) | CI/CD'de collection çalıştırma, JUnit/HTML rapor |
| Test | xUnit + Testcontainers; Vitest; Playwright (E2E) |  |
| Dağıtım | Docker imajları, Docker Compose; ileride Helm chart | GitHub Actions ile CI |

## Veri modeli

Hiyerarşi: Organizasyon → Workspace → Collection → Klasör → İstek. Yetki workspace seviyesinde verilir, collection seviyesinde daraltılabilir.

| Varlık | Ana alanlar | İlişki |
| --- | --- | --- |
| User | Id, Email, Name, PasswordHash, AvatarUrl | Birçok Organization ve Workspace üyeliği |
| Organization | Id, Name, Slug, OwnerId | Takımlar ve workspace'ler |
| Team | Id, OrganizationId, Name | User'lar (TeamMember) |
| Workspace | Id, OrganizationId, Name, Type (Personal / Team / Public) | Collection, Environment, üyelikler |
| WorkspaceMember | WorkspaceId, UserId veya TeamId, Role | Rol: Admin / Editor / Viewer |
| Collection | Id, WorkspaceId, Name, Description, Auth (JSONB), Variables (JSONB), Scripts, Version | Klasör ve istekler |
| Folder | Id, CollectionId, ParentFolderId, Name, SortOrder, Auth, Scripts | İç içe klasör |
| Request | Id, CollectionId, FolderId, Name, Method, Url, Headers, Body, Auth, Scripts (JSONB), SortOrder | Örnek yanıtlar (Example) |
| Example | Id, RequestId, Name, StatusCode, Headers, Body | Mock server buradan beslenir |
| Environment | Id, WorkspaceId, Name, Variables (JSONB: key, initialValue, type, isSecret) | Current value yalnız kullanıcıda tutulur |
| ChangeLog | Id, EntityType, EntityId, UserId, Diff (JSONB), Version, CreatedAt | Değişiklik geçmişi ve geri alma |
| Comment | Id, EntityType, EntityId, UserId, Body, ParentId | İstek/collection üzerinde yorum |
| Run / RunResult | Id, CollectionId, EnvironmentId, Trigger (Manual/CLI/Monitor), Stats; her istek için sonuç | Runner ve monitör raporları |
| Monitor, MockServer, ApiKey, Invitation | Zamanlama, URL, token, davet durumu | Faz 3–4 |

İlke: **initial value** sunucuda paylaşılır, **current value** ve secret değerler istemcide (desktop'ta işletim sistemi keychain'i) kalır. Secret'lar sunucuda tutulacaksa AES-256 ile şifrelenir.

## Takım, yetkilendirme ve paylaşım

Paylaşım birimi workspace'tir: bir collection'ı paylaşmak, onu bir takım workspace'ine taşımak veya o collection'a tek tek kişi/takım eklemek demektir.

**Roller ve izinler**

| Yetki | Org Owner | Admin | Editor | Viewer |
| --- | --- | --- | --- | --- |
| Organizasyon ayarları, üye silme | ✓ |  |  |  |
| Workspace oluşturma, üye davet, rol atama | ✓ | ✓ |  |  |
| Collection / environment oluşturma, düzenleme, silme | ✓ | ✓ | ✓ |  |
| İstek çalıştırma, runner, dışa aktarma | ✓ | ✓ | ✓ | ✓ |
| Yorum yazma | ✓ | ✓ | ✓ | ✓ |
| Fork alma | ✓ | ✓ | ✓ | ✓ |
| Fork'tan gelen merge isteğini onaylama | ✓ | ✓ | ✓ |  |

**Paylaşım akışları**

1. **Davet:** Admin e-posta ile davet gönderir; kişi linkten kayıt olur ve workspace'e rolüyle eklenir.
2. **Takım bazlı erişim:** Bir Team'i workspace'e eklemek tüm üyelerine aynı rolü verir.
3. **Collection bazlı erişim:** Workspace rolünü collection seviyesinde kısıtlama (örn. herkes Viewer, iki kişi Editor).
4. **Fork ve merge:** Viewer veya başka workspace'teki biri fork alır, değişiklik yapar, merge isteği açar; diff görünümüyle onaylanır.
5. **Paylaşım linki:** Organizasyon içinde salt-okunur link; opsiyonel olarak public dokümantasyon linki (Faz 5).

**Eşzamanlı düzenleme:** Her istek/klasör ayrı kayıt ve `Version` alanı taşır. Kaydetmede optimistic concurrency uygulanır; çakışmada kullanıcıya diff gösterilir. SignalR, değişikliği diğer açık istemcilere anında iter. Aynı isteği aynı anda karakter karakter düzenleme (CRDT) kapsam dışıdır; gerekirse Faz 5'te Yjs ile eklenir.

## Yol haritası

&#91;embedded content: Yol haritası · 6 faz, her biri bir çıkış kriteriyle\]

Faz 0–3 toplamda kabaca 22–28 hafta sürer ve ekibin Postman'den tamamen geçmesiyle biter. Her faz bir çıkış kriteriyle kapanır; kriter sağlanmadan sonraki faza geçilmez. Takım özellikleri Faz 3'te gelse de veri modeli ilk günden organizasyon ve workspace içerir, sonradan taşıma gerekmez.

Her fazın iş paketleri ve görevleri: Fazlar

## Riskler, açık sorular ve sonraki adımlar

En büyük teknik risk, web sürümünde istek yürütmenin güvenliğidir (SSRF); proxy bu yüzden ilk günden kısıtlı tasarlanır.

| Risk | Etki | Önlem |
| --- | --- | --- |
| SSRF: web proxy üzerinden iç ağa istek atılması | Yüksek | Varsayılan engelli IP aralıkları (169.254.x, 10.x vb.) admin tarafından açılır; localhost için desktop veya hafif yerel agent |
| Script sandbox'ından kaçış | Yüksek | QuickJS/Jint, zaman ve bellek limiti, dosya/ağ erişimi yok (yalnız `pm.sendRequest`) |
| Postman script uyumluluğu | Orta | `pm` API'sinin en çok kullanılan %80'i hedeflenir; gerçek ekip collection'larıyla uyumluluk test seti |
| Secret sızıntısı | Yüksek | Current/secret değerler sunucuya gitmez; loglarda maskeleme |
| Eşzamanlı düzenleme çakışmaları | Orta | Versiyon + diff; ChangeLog ile geri alma |
| Kapsamın büyüklüğü | Orta | Her faz sonunda ekip gerçekten kullanır; geri bildirimle sonraki faz yeniden önceliklendirilir |

**Açık sorular**

- [ ] Hosting: şirket içi sunucu mu, bulut mu? (Docker imajları her ikisine uyar; karar Faz 3 öncesi gerekli)
- [ ] SSO gerekiyor mu (Azure AD / Google Workspace)?
- [x] Desktop için Tauri mi Electron mu? — *Karar (20 Ekim 2026): Tauri 2 + yerel .NET ajanı.*
- [ ] Kaç geliştirici çalışacak? Faz süreleri buna göre netleşecek.

**Sonraki adımlar**

- [ ] Monorepo iskeletini kur: .NET çözümü, React/Vite uygulaması, Docker Compose (API + PostgreSQL + Redis)
- [ ] Kimlik doğrulama ve Workspace/Collection/Request CRUD'u ile ilk dikey dilimi bitir
- [ ] İstek yürütme proxy'sini SSRF korumasıyla yaz, ilk isteği uçtan uca gönder
