# Terim sözlüğü

Apivator arayüzünde, sunucu mesajlarında, e-postalarda ve CLI'da terimlerin her dilde nasıl yazılacağı (Faz 8.4). Yeni metin yazarken ya da yeni bir dil eklerken bu tablo esas alınır. Bir terim tabloda yoksa önce buraya eklenir.

## İlkeler

- **Ürün kavramları Türkçede İngilizce kalır.** Ekip API dünyasında bu adlarla konuşuyor ve Postman'den gelenler aynı adları arıyor. Türkçe ekler kesme işaretiyle eklenir: collection'lar, environment'ta, mock'u, workspace'inizde, fork'unuz.
- **Cümle başında büyük, cümle içinde küçük harf:** "Collection oluştur", "bu collection'ı sil". Kenar çubuğu ve sekme başlıkları başlık sayılır.
- **Kullanıcı verisi hiçbir zaman çevrilmez:** collection, istek, değişken ve environment adları, açıklamalar, yorumlar, script içerikleri.
- **Protokol ve standart adları çevrilmez:** HTTP yöntemleri, başlık adları (`Content-Type`), durum metinleri (`Not Found`), OAuth akış adları (Authorization Code, Client Credentials), JSON, XML, GraphQL, gRPC, WebSocket, JWT, cURL.
- **Kod ve komutlar çevrilmez:** `pm.*` API'si, script örneklerindeki fonksiyon adları, CLI seçenekleri (`--lang`), değişken sözdizimi (`{{token}}`).
- **Hitap:** Türkçede "siz", İngilizcede doğrudan ve kısa ("You can…", "Couldn't…"). Düğmeler fiil ile başlar: "Kaydet" / "Save", "Collection oluştur" / "Create collection".

## Ürün kavramları

| Kavram | Türkçe | İngilizce | Not |
| --- | --- | --- | --- |
| Collection | Collection (collection'lar) | Collection | İstek ve klasör kümesi. "Koleksiyon" kullanılmaz. |
| Environment | Environment | Environment | Değişken seti. Genel anlamdaki "test ortamı, canlı ortam" ifadeleri Türkçe kalabilir; ürün nesnesi her zaman Environment'tır. |
| Global değişkenler | Global değişkenler | Globals | |
| Workspace | Workspace | Workspace | Kişisel workspace / takım workspace'i. "Çalışma alanı" kullanılmaz. |
| Takım workspace'i | Takım workspace'i | Team workspace | "Ekip workspace'i" kullanılmaz. Genel anlamda "ekiple paylaşılır" serbesttir. |
| Takım | Takım | Team | Organizasyon içindeki üye grubu (Faz 3). |
| Organizasyon | Organizasyon | Organization | |
| Mock | Mock (mock server) | Mock (mock server) | |
| Örnek yanıt | Örnek yanıt | Example (saved response) | Mock'un döndürdüğü kayıtlı yanıt. |
| Monitor | Monitör | Monitor | Türkçede okunuşa göre "monitör". |
| Runner | Collection runner / Runner | Collection runner / Runner | Çalıştırma sonucu: "çalıştırma" / "run". |
| Fork | Fork, fork'la | Fork | Collection'ın kişisel kopyası; fiil hâli "fork'la". |
| Merge isteği | Merge isteği | Merge request | "Birleştirme isteği" kullanılmaz. Eylem: "Birleştir" / "Merge". |
| Pre-request script | Pre-request script'i | Pre-request script | |
| Test script'i | Test script'i | Test script | Postman'deki "Tests" sekmesi. |
| Snippet | Snippet | Snippet | |
| Geçmiş | Geçmiş | History | |
| Aktivite | Aktivite | Activity | Workspace'in değişiklik akışı. "Etkinlik" kullanılmaz. |
| Denetim kaydı | Denetim kaydı | Audit log | Organizasyon düzeyi. |
| Yayınlanan doküman | Doküman, yayınlanan doküman | Documentation, published documentation | |
| Yerel ajan | Yerel ajan | Local agent | Masaüstündeki .NET süreci. |
| Araçlar | Araçlar | Tools | Faz 7 araçları; araç adları kendi kataloğundadır. |
| API anahtarı | API anahtarı | API key | Kişisel erişim anahtarı (CLI). |

## İstek ve yanıt

| Kavram | Türkçe | İngilizce | Not |
| --- | --- | --- | --- |
| Request | İstek | Request | Sekme başlığı ve metin içinde "istek". |
| Response | Yanıt | Response | |
| Header | Header (header'lar) | Header | "Başlık" kullanılmaz; sayfa başlığıyla karışır. |
| Body | Body | Body | Sekme ve alan adı "Body". Düz metin içinde "gövde" yalnızca bağlam gerektirirse kullanılır. |
| Query parametreleri | Query parametreleri | Query parameters | |
| Auth | Yetkilendirme | Authorization (Auth) | Sekme adı "Auth" kalabilir. |
| Scope | Kapsam (scope) | Scope | OAuth bağlamında. |
| Token | Token | Token | |
| Secret | Gizli (secret) | Secret | Değişken türü; rozette "gizli". |
| Başlangıç / güncel değer | Başlangıç değeri / güncel değer | Initial value / current value | Postman karşılıkları. |
| Miras | Miras alır / üstten | Inherit | Auth türü "Miras" / "Inherit". |
| Status | Durum | Status | HTTP durum kodu: "durum kodu" / "status code". |

## Hesap ve güvenlik

| Kavram | Türkçe | İngilizce | Not |
| --- | --- | --- | --- |
| Password | Şifre | Password | Hesap şifresi. Ağ ayarlarındaki proxy parolası ve kriptografi araçlarındaki passphrase "parola"dır. |
| Session | Oturum | Session | "Oturum aç" / "Sign in", "Oturumu kapat" / "Sign out". |
| Two-factor | İki adımlı doğrulama | Two-factor authentication | |
| Revoke | İptal et | Revoke | API anahtarı ve oturum için. |

## Git

| Kavram | Türkçe | İngilizce | Not |
| --- | --- | --- | --- |
| Branch | Dal | Branch | |
| Commit | Commit | Commit | |
| Pull / push | Al / gönder | Pull / push | Git eşitlemede düğmeler. |

## Çevirmenler için bağlam notları

Kısa ya da birden çok anlama gelebilen anahtarlar (ör. "Open" sıfat mı fiil mi, "Fork" isim mi eylem mi) için notlar `src/frontend/apps/web/src/i18n/locales/notes.json` dosyasındadır: `"ad alanı:anahtar": "not"`. Yeni ve belirsiz bir anahtar eklerken buraya da not yazılır. Test, her notun gerçek bir anahtara ait olduğunu denetler. Sunucu kimlikleri (`L.T("kimlik", ...)`) Türkçe metniyle birlikte kodda durduğu için ayrı not gerekmez.
