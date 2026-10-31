// Sık kullanılan HTTP başlıkları; Türkçe açıklama, örnek değer ve kaynak (bağlantı değil, metin). Çevrimdışıdır.
// Satır biçimi: ad|yön (request/response/both)|grup|açıklama|örnek değer|kaynak

export const HTTP_HEADER_DATA = `
Accept|request|İçerik müzakeresi|İstemcinin kabul ettiği ortam türleri ve öncelikleri (q).|application/json, text/plain;q=0.9|RFC 9110 §12.5.1
Accept-Charset|request|İçerik müzakeresi|Kabul edilen karakter kümeleri; günümüzde tarayıcılar göndermez.|utf-8|RFC 9110 §12.5.2
Accept-Encoding|request|İçerik müzakeresi|Kabul edilen sıkıştırma kodlamaları.|gzip, deflate, br, zstd|RFC 9110 §12.5.3
Accept-Language|request|İçerik müzakeresi|Tercih edilen diller.|tr-TR, tr;q=0.9, en;q=0.8|RFC 9110 §12.5.4
Accept-Patch|response|İçerik müzakeresi|PATCH için kabul edilen gövde türleri.|application/merge-patch+json|RFC 5789 §3.1
Accept-Ranges|response|Aralık|Sunucunun aralık (Range) isteklerini destekleyip desteklemediği.|bytes|RFC 9110 §14.3
Access-Control-Allow-Credentials|response|CORS|Çapraz kaynak isteğinde çerez ve kimlik bilgisi gönderilmesine izin verir.|true|Fetch Standard
Access-Control-Allow-Headers|response|CORS|Ön kontrol yanıtında izin verilen istek başlıkları.|Content-Type, Authorization|Fetch Standard
Access-Control-Allow-Methods|response|CORS|Ön kontrol yanıtında izin verilen metotlar.|GET, POST, PUT, DELETE|Fetch Standard
Access-Control-Allow-Origin|response|CORS|Yanıtı okuyabilecek kaynak (origin); * herkese açıktır.|https://app.ornek.com|Fetch Standard
Access-Control-Expose-Headers|response|CORS|Tarayıcı betiklerinin okuyabileceği ek yanıt başlıkları.|X-Total-Count, ETag|Fetch Standard
Access-Control-Max-Age|response|CORS|Ön kontrol yanıtının saniye cinsinden önbellekte kalma süresi.|600|Fetch Standard
Access-Control-Request-Headers|request|CORS|Ön kontrol isteğinde asıl istekte kullanılacak başlıklar.|content-type, authorization|Fetch Standard
Access-Control-Request-Method|request|CORS|Ön kontrol isteğinde asıl istekte kullanılacak metot.|PUT|Fetch Standard
Age|response|Önbellek|Yanıtın önbellekte kaç saniyedir beklediği.|120|RFC 9111 §5.1
Allow|response|Bilgi|Kaynağın desteklediği metotlar (405 yanıtında zorunlu).|GET, HEAD, OPTIONS|RFC 9110 §10.2.1
Alt-Svc|response|Bağlantı|Aynı kaynağa erişilebilecek alternatif hizmetler (ör. HTTP/3).|h3=":443"; ma=86400|RFC 7838
Authorization|request|Kimlik doğrulama|İstemcinin kimlik bilgileri (Bearer, Basic, Digest…).|Bearer eyJhbGciOiJIUzI1NiJ9…|RFC 9110 §11.6.2
Cache-Control|both|Önbellek|Önbellekleme yönergeleri: süre, paylaşım, yeniden doğrulama.|no-cache, max-age=0|RFC 9111 §5.2
Clear-Site-Data|response|Güvenlik|Tarayıcıdan bu siteye ait çerez, depolama ve önbelleğin silinmesini ister.|"cookies", "storage"|W3C Clear Site Data
Connection|both|Bağlantı|Bağlantıya özel seçenekler; HTTP/2'de kullanılmaz.|keep-alive|RFC 9110 §7.6.1
Content-Disposition|response|İçerik|Gövdenin satır içi mi ek (indirme) olarak mı gösterileceği ve dosya adı.|attachment; filename="rapor.pdf"|RFC 6266
Content-Encoding|both|İçerik|Gövdeye uygulanan sıkıştırma.|gzip|RFC 9110 §8.4
Content-Language|both|İçerik|Gövdenin hedef kitlesinin dili.|tr-TR|RFC 9110 §8.5
Content-Length|both|İçerik|Gövdenin bayt cinsinden uzunluğu.|348|RFC 9110 §8.6
Content-Location|response|İçerik|Döndürülen temsilin doğrudan adresi.|/belgeler/42.json|RFC 9110 §8.7
Content-Range|response|Aralık|Kısmi yanıttaki aralık ve toplam boyut.|bytes 0-1023/5000|RFC 9110 §14.4
Content-Security-Policy|response|Güvenlik|Sayfanın yükleyebileceği kaynakları kısıtlar (XSS'e karşı).|default-src 'self'; img-src *|W3C CSP Level 3
Content-Security-Policy-Report-Only|response|Güvenlik|CSP'yi uygulamadan yalnızca ihlalleri raporlar.|default-src 'self'; report-to csp|W3C CSP Level 3
Content-Type|both|İçerik|Gövdenin ortam türü ve karakter kümesi.|application/json; charset=utf-8|RFC 9110 §8.3
Cookie|request|Çerez|Sunucunun daha önce Set-Cookie ile verdiği çerezler.|oturum=abc123; tema=koyu|RFC 6265 §5.4
Cross-Origin-Embedder-Policy|response|Güvenlik|Çapraz kaynak öğelerin yalnızca açık izinle yüklenmesini zorunlu kılar.|require-corp|HTML Standard
Cross-Origin-Opener-Policy|response|Güvenlik|Pencerenin çapraz kaynak açıcılarla aynı tarama bağlamını paylaşmasını engeller.|same-origin|HTML Standard
Cross-Origin-Resource-Policy|response|Güvenlik|Kaynağın hangi origin'lerce yüklenebileceğini sınırlar.|same-site|Fetch Standard
Date|both|Bilgi|Mesajın oluşturulduğu tarih ve saat (GMT).|Thu, 30 Oct 2026 08:00:00 GMT|RFC 9110 §6.6.1
DNT|request|Gizlilik|"Beni izleme" tercihi; artık önerilmez.|1|W3C Tracking Preference (geri çekildi)
ETag|response|Koşullu istek|Kaynağın sürüm etiketi; önbellek doğrulama ve iyimser kilitlemede kullanılır.|"33a64df551425fcc"|RFC 9110 §8.8.3
Expect|request|Bağlantı|Sunucudan beklenen davranış; yalnızca 100-continue tanımlı.|100-continue|RFC 9110 §10.1.1
Expires|response|Önbellek|Yanıtın bayatlayacağı tarih; Cache-Control max-age öncelikli.|Thu, 30 Oct 2026 09:00:00 GMT|RFC 9111 §5.3
Forwarded|request|Proxy|İstemci ve proxy zinciri bilgisi (X-Forwarded-* başlıklarının standardı).|for=192.0.2.60; proto=https; by=203.0.113.43|RFC 7239
From|request|Bilgi|İsteği yapan kullanıcının e-posta adresi (botlar için).|bot@ornek.com|RFC 9110 §10.1.2
Host|request|Bağlantı|Hedef sunucunun adı ve portu; HTTP/1.1'de zorunlu.|api.ornek.com:8443|RFC 9110 §7.2
If-Match|request|Koşullu istek|Yalnızca ETag eşleşirse işlem yapılır (412 aksi hâlde).|"33a64df551425fcc"|RFC 9110 §13.1.1
If-Modified-Since|request|Koşullu istek|Kaynak bu tarihten sonra değiştiyse gövde döner, yoksa 304.|Wed, 29 Oct 2026 08:00:00 GMT|RFC 9110 §13.1.3
If-None-Match|request|Koşullu istek|ETag eşleşmezse gövde döner, eşleşirse 304.|"33a64df551425fcc"|RFC 9110 §13.1.2
If-Range|request|Aralık|Kaynak değişmediyse aralık, değiştiyse tamamı döner.|"33a64df551425fcc"|RFC 9110 §13.1.5
If-Unmodified-Since|request|Koşullu istek|Kaynak bu tarihten sonra değişmediyse işlem yapılır.|Wed, 29 Oct 2026 08:00:00 GMT|RFC 9110 §13.1.4
Keep-Alive|both|Bağlantı|Kalıcı bağlantının zaman aşımı ve en fazla istek sayısı.|timeout=5, max=1000|RFC 2068 §19.7.1
Last-Modified|response|Koşullu istek|Kaynağın son değiştirilme tarihi.|Wed, 29 Oct 2026 08:00:00 GMT|RFC 9110 §8.8.2
Link|response|Bilgi|İlişkili kaynaklara bağlantılar (sayfalama, ön yükleme).|</kullanicilar?sayfa=3>; rel="next"|RFC 8288
Location|response|Yönlendirme|Yönlendirme hedefi ya da yeni oluşturulan kaynağın adresi.|/kullanicilar/42|RFC 9110 §10.2.2
Max-Forwards|request|Proxy|TRACE/OPTIONS isteğinin geçebileceği en fazla proxy sayısı.|10|RFC 9110 §7.6.2
Origin|request|CORS|İsteği başlatan sayfanın kaynağı (şema, host, port).|https://app.ornek.com|RFC 6454 §7
Permissions-Policy|response|Güvenlik|Kamera, konum gibi tarayıcı özelliklerinin kullanımını sınırlar.|camera=(), geolocation=(self)|W3C Permissions Policy
Pragma|both|Önbellek|HTTP/1.0 dönemi önbellek yönergesi; yerine Cache-Control.|no-cache|RFC 9111 §5.4 (kaldırıldı)
Prefer|request|Bilgi|Sunucudan tercih edilen davranış (yanıt biçimi, asenkron işleme).|return=minimal, respond-async|RFC 7240
Preference-Applied|response|Bilgi|Prefer başlığındaki hangi tercihlerin uygulandığı.|return=minimal|RFC 7240
Proxy-Authenticate|response|Kimlik doğrulama|Proxy'nin beklediği kimlik doğrulama yöntemi (407 ile).|Basic realm="kurum"|RFC 9110 §11.7.1
Proxy-Authorization|request|Kimlik doğrulama|Proxy için kimlik bilgileri.|Basic YWxpOnNpZnJl|RFC 9110 §11.7.2
Range|request|Aralık|Kaynağın yalnızca bir kısmını ister.|bytes=0-1023|RFC 9110 §14.2
Referer|request|Bilgi|İsteğe yol açan sayfanın adresi (yazım hatası standartta kalmıştır).|https://ornek.com/urunler|RFC 9110 §10.1.3
Referrer-Policy|response|Güvenlik|Referer başlığında ne kadar bilgi gönderileceği.|strict-origin-when-cross-origin|W3C Referrer Policy
Retry-After|response|Bilgi|Yeniden denemeden önce beklenecek süre (saniye ya da tarih); 429/503 ile.|120|RFC 9110 §10.2.3
Sec-Fetch-Dest|request|Güvenlik|Tarayıcının bildirdiği isteğin hedef türü.|document|W3C Fetch Metadata
Sec-Fetch-Mode|request|Güvenlik|İsteğin modu (cors, navigate, no-cors…).|cors|W3C Fetch Metadata
Sec-Fetch-Site|request|Güvenlik|İsteği başlatanla hedef arasındaki ilişki.|same-origin|W3C Fetch Metadata
Sec-WebSocket-Accept|response|Bağlantı|WebSocket el sıkışmasında sunucunun anahtar onayı.|s3pPLMBiTxaQ9kYGzzhZRbK+xOo=|RFC 6455 §11.3.3
Sec-WebSocket-Key|request|Bağlantı|WebSocket el sıkışmasında istemcinin rastgele anahtarı.|dGhlIHNhbXBsZSBub25jZQ==|RFC 6455 §11.3.1
Sec-WebSocket-Protocol|both|Bağlantı|WebSocket alt protokolü seçimi.|graphql-ws|RFC 6455 §11.3.4
Server|response|Bilgi|Yanıtı üreten sunucu yazılımı.|nginx/1.27.0|RFC 9110 §10.2.4
Server-Timing|response|Bilgi|Sunucu tarafı süre ölçümleri (tarayıcı geliştirici araçlarında görünür).|db;dur=53, app;dur=47.2|W3C Server Timing
Set-Cookie|response|Çerez|İstemciye çerez kaydettirir; Secure, HttpOnly, SameSite özellikleriyle.|oturum=abc123; Path=/; HttpOnly; Secure; SameSite=Lax|RFC 6265 §4.1
Strict-Transport-Security|response|Güvenlik|Tarayıcının siteye bir süre yalnızca HTTPS ile bağlanmasını sağlar (HSTS).|max-age=31536000; includeSubDomains|RFC 6797
TE|request|Bağlantı|Kabul edilen aktarım kodlamaları; HTTP/2'de yalnızca trailers.|trailers|RFC 9110 §10.1.4
Trailer|both|Bağlantı|Parçalı gövdenin sonunda gönderilecek başlıklar.|Server-Timing|RFC 9110 §6.6.2
Transfer-Encoding|both|Bağlantı|Gövdenin aktarım biçimi; HTTP/1.1'de chunked.|chunked|RFC 9112 §6.1
Upgrade|both|Bağlantı|Başka bir protokole geçiş isteği (101 ile).|websocket|RFC 9110 §7.8
User-Agent|request|Bilgi|İstemci yazılımı ve sürümü.|Mozilla/5.0 (Windows NT 10.0; Win64; x64) …|RFC 9110 §10.1.5
Vary|response|Önbellek|Önbellek anahtarına katılan istek başlıkları.|Accept-Encoding, Origin|RFC 9110 §12.5.5
Via|both|Proxy|Mesajın geçtiği ara sunucular.|1.1 vegur, 2 proxy.ornek.com|RFC 9110 §7.6.3
WWW-Authenticate|response|Kimlik doğrulama|Kaynağa erişim için beklenen kimlik doğrulama yöntemi (401 ile).|Bearer realm="api", error="invalid_token"|RFC 9110 §11.6.1
X-Content-Type-Options|response|Güvenlik|Tarayıcının Content-Type'ı tahmin etmesini (MIME sniffing) engeller.|nosniff|Fetch Standard
X-Correlation-ID|both|Bilgi|Bir isteği servisler arasında izlemek için kimlik (standart dışı, yaygın).|7f9c2e4a-1b3d-4c5e-9f0a-2b4c6d8e0f12|Yaygın kullanım (standart dışı)
X-Forwarded-For|request|Proxy|Proxy zincirindeki istemci IP adresleri (standart dışı, yaygın).|203.0.113.195, 70.41.3.18|Yaygın kullanım (yerine Forwarded)
X-Forwarded-Host|request|Proxy|İstemcinin istediği asıl Host (standart dışı, yaygın).|ornek.com|Yaygın kullanım (yerine Forwarded)
X-Forwarded-Proto|request|Proxy|İstemcinin kullandığı asıl şema (standart dışı, yaygın).|https|Yaygın kullanım (yerine Forwarded)
X-Frame-Options|response|Güvenlik|Sayfanın iframe içinde gösterilmesini sınırlar (clickjacking); yerine CSP frame-ancestors.|DENY|RFC 7034
X-RateLimit-Limit|response|Bilgi|Zaman penceresindeki istek sınırı (standart dışı, yaygın; taslak: RateLimit).|1000|Yaygın kullanım (standart dışı)
X-RateLimit-Remaining|response|Bilgi|Penceredeki kalan istek hakkı (standart dışı, yaygın).|998|Yaygın kullanım (standart dışı)
X-Request-ID|both|Bilgi|İsteğin benzersiz kimliği; günlüklerde eşleştirme için (standart dışı, yaygın).|req_8b1f2c|Yaygın kullanım (standart dışı)
X-Requested-With|request|Bilgi|AJAX isteklerini işaretlemek için (standart dışı).|XMLHttpRequest|Yaygın kullanım (standart dışı)
`;
