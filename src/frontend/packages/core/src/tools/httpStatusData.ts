// IANA HTTP durum kodu kaydı (RFC 9110 ve ekleri); Türkçe ad, açıklama ve tipik kullanım. Çevrimdışıdır.
// Satır biçimi: kod|İngilizce standart ifade|Türkçe ad|açıklama|tipik kullanım|kaynak|not (isteğe bağlı)

export const HTTP_STATUS_DATA = `
100|Continue|Devam|İstemcinin başlıkları kabul edildi; gövdeyi göndermeye devam edebilir.|Büyük yüklemede istemci "Expect: 100-continue" gönderir, sunucu onaylarsa gövde yollanır.|RFC 9110 §15.2.1
101|Switching Protocols|Protokol değiştiriliyor|Sunucu, istemcinin Upgrade başlığıyla istediği protokole geçiyor.|HTTP bağlantısının WebSocket'e yükseltilmesi (Upgrade: websocket).|RFC 9110 §15.2.2
102|Processing|İşleniyor|İstek alındı ve işleniyor, henüz yanıt yok; istemcinin zaman aşımına düşmesini önler.|Uzun süren WebDAV işlemleri.|RFC 2518|Kullanımdan kalktı; yerine 103 ya da asenkron 202 tercih edilir.
103|Early Hints|Erken ipuçları|Son yanıt hazırlanırken istemcinin önceden yükleyebileceği kaynakları bildirir.|Link: </app.css>; rel=preload başlıklarıyla CSS/JS ön yüklemesi.|RFC 8297
104|Upload Resumption Supported|Yükleme sürdürülebilir|Sunucu, kesilen yüklemenin kaldığı yerden sürdürülmesini desteklediğini bildirir.|Büyük dosya yüklemelerinde devam ettirilebilir yükleme taslağı.|draft-ietf-httpbis-resumable-upload|Geçici (temporary) kayıt.
200|OK|Başarılı|İstek başarıyla işlendi; gövdenin anlamı metoda göre değişir.|GET ile kaynak okuma, POST ile işlem sonucu döndürme.|RFC 9110 §15.3.1
201|Created|Oluşturuldu|İstek sonucunda yeni bir kaynak oluşturuldu; adresi genellikle Location başlığındadır.|POST /kullanicilar sonrası Location: /kullanicilar/42.|RFC 9110 §15.3.2
202|Accepted|Kabul edildi|İstek işlenmek üzere kabul edildi ama işlem henüz tamamlanmadı.|Kuyruğa alınan rapor üretimi; durum adresi gövdede ya da Location'da verilir.|RFC 9110 §15.3.3
203|Non-Authoritative Information|Yetkili olmayan bilgi|Yanıt başarılı, ancak bir ara sunucu (proxy) içeriği değiştirdi.|Dönüştürücü proxy'nin başlık ya da gövde eklemesi.|RFC 9110 §15.3.4
204|No Content|İçerik yok|İstek başarılı, döndürülecek gövde yok.|DELETE ya da PUT sonrası boş yanıt; CORS ön kontrol (OPTIONS) yanıtı.|RFC 9110 §15.3.5
205|Reset Content|İçeriği sıfırla|İstek başarılı; istemci, isteği gönderen formu ya da görünümü sıfırlamalı.|Form gönderildikten sonra alanların temizlenmesi.|RFC 9110 §15.3.6
206|Partial Content|Kısmi içerik|Range başlığıyla istenen aralık döndürüldü.|Video akışı, kesilen indirmenin sürdürülmesi (Content-Range: bytes 0-1023/5000).|RFC 9110 §15.3.7
207|Multi-Status|Çoklu durum|Gövde, birden çok kaynağın ayrı ayrı durumlarını içerir (XML).|WebDAV PROPFIND ve toplu işlemler.|RFC 4918 §11.1
208|Already Reported|Zaten bildirildi|Bir DAV bağlamasının üyeleri yanıtın önceki kısmında listelendi; tekrar edilmez.|WebDAV bağlama (binding) döngüleri.|RFC 5842 §7.1
226|IM Used|IM uygulandı|Sunucu, kaynağa bir veya daha fazla örnek düzenlemesi (delta) uyguladı.|A-IM başlığıyla delta kodlamalı yanıt.|RFC 3229 §10.4.1
300|Multiple Choices|Birden çok seçenek|Kaynağın birden çok temsili var; istemci ya da kullanıcı birini seçmeli.|Farklı dil ya da biçimdeki belgelere bağlantı listesi.|RFC 9110 §15.4.1
301|Moved Permanently|Kalıcı olarak taşındı|Kaynak kalıcı olarak Location'daki adrese taşındı.|http → https yönlendirmesi, eski sayfa adreslerinin yenisine bağlanması.|RFC 9110 §15.4.2|Tarayıcılar POST'u GET'e çevirebilir; metodu korumak için 308.
302|Found|Bulundu (geçici yönlendirme)|Kaynak geçici olarak başka adreste; sonraki isteklerde asıl adres kullanılmalı.|Oturum açma sonrası yönlendirme.|RFC 9110 §15.4.3|Tarayıcılar POST'u GET'e çevirebilir; metodu korumak için 307.
303|See Other|Diğerine bak|Sonuç Location'daki adreste; oraya GET ile gidilmeli.|Form POST'undan sonra sonuç sayfasına yönlendirme (Post/Redirect/Get).|RFC 9110 §15.4.4
304|Not Modified|Değişmedi|Koşullu istekteki kaynak değişmedi; istemci önbellekteki kopyayı kullanabilir.|If-None-Match / If-Modified-Since ile önbellek doğrulama.|RFC 9110 §15.4.5
305|Use Proxy|Proxy kullan|Kaynağa Location'daki proxy üzerinden erişilmeli.|Kullanılmaz.|RFC 9110 §15.4.6|Güvenlik nedeniyle kullanımdan kaldırıldı.
306|(Unused)|(Kullanılmıyor)|Eski bir taslakta "Switch Proxy" idi; artık kullanılmayan, ayrılmış kod.|Kullanılmaz.|RFC 9110 §15.4.7|Ayrılmış (reserved).
307|Temporary Redirect|Geçici yönlendirme|Kaynak geçici olarak başka adreste; istemci metodu ve gövdeyi değiştirmeden tekrarlamalı.|Bakım sırasında POST isteklerini başka sunucuya yönlendirme.|RFC 9110 §15.4.8
308|Permanent Redirect|Kalıcı yönlendirme|Kaynak kalıcı olarak taşındı; metot ve gövde değiştirilmeden tekrarlanmalı.|API uç noktasının yeni sürüm adresine kalıcı taşınması.|RFC 9110 §15.4.9
400|Bad Request|Hatalı istek|Sunucu, istemci hatası nedeniyle isteği işleyemiyor (bozuk sözdizimi, geçersiz alan).|Geçersiz JSON gövdesi, eksik zorunlu parametre.|RFC 9110 §15.5.1
401|Unauthorized|Kimlik doğrulanmadı|Geçerli kimlik bilgisi yok; yanıt WWW-Authenticate başlığı içermelidir.|Eksik ya da süresi dolmuş Bearer token.|RFC 9110 §15.5.2
402|Payment Required|Ödeme gerekli|Gelecekte kullanım için ayrılmış; bazı API'ler kota ya da ödeme hatası için kullanır.|Abonelik süresi dolan API anahtarı.|RFC 9110 §15.5.3
403|Forbidden|Yasak|Sunucu isteği anladı ama yetki vermiyor; yeniden kimlik doğrulama sonucu değiştirmez.|Yetkisi olmayan kullanıcının yönetici uç noktasına erişmesi.|RFC 9110 §15.5.4
404|Not Found|Bulunamadı|Kaynak bulunamadı ya da sunucu varlığını açıklamak istemiyor.|Olmayan kayıt kimliği, yanlış yazılmış adres.|RFC 9110 §15.5.5
405|Method Not Allowed|Metoda izin verilmiyor|Metot bu kaynakta desteklenmiyor; yanıt Allow başlığını içermelidir.|Salt okunur kaynağa DELETE gönderilmesi.|RFC 9110 §15.5.6
406|Not Acceptable|Kabul edilemez|Accept başlıklarına uyan bir temsil üretilemiyor.|Yalnızca JSON dönen API'ye Accept: application/xml.|RFC 9110 §15.5.7
407|Proxy Authentication Required|Proxy kimlik doğrulaması gerekli|401 gibi, ancak kimlik doğrulama proxy için gerekli (Proxy-Authenticate).|Kurumsal proxy arkasından dış istek.|RFC 9110 §15.5.8
408|Request Timeout|İstek zaman aşımı|Sunucu, istemcinin isteği tamamlamasını beklerken süre doldu.|Yavaş bağlantıda yarım kalan gövde.|RFC 9110 §15.5.9
409|Conflict|Çakışma|İstek, kaynağın güncel durumuyla çakışıyor.|Aynı e-postayla ikinci kayıt, sürüm çakışan güncelleme.|RFC 9110 §15.5.10
410|Gone|Kalıcı olarak yok|Kaynak artık yok ve geri gelmeyecek.|Kaldırılan API sürümü, silinmiş içerik.|RFC 9110 §15.5.11
411|Length Required|Uzunluk gerekli|Sunucu Content-Length başlığı olmadan isteği kabul etmiyor.|Chunked gövdeyi kabul etmeyen sunucuya yükleme.|RFC 9110 §15.5.12
412|Precondition Failed|Ön koşul sağlanamadı|If-Match gibi koşullu başlıklardaki koşul sağlanmadı.|ETag değişmiş kaynağa If-Match ile PUT (iyimser kilitleme).|RFC 9110 §15.5.13
413|Content Too Large|İçerik çok büyük|Gövde sunucunun kabul ettiği sınırdan büyük.|Boyut sınırını aşan dosya yüklemesi.|RFC 9110 §15.5.14|Eski adı: Payload Too Large / Request Entity Too Large.
414|URI Too Long|Adres çok uzun|İstek adresi sunucunun işleyebileceğinden uzun.|Çok uzun query string; veriyi POST gövdesine taşıyın.|RFC 9110 §15.5.15
415|Unsupported Media Type|Desteklenmeyen ortam türü|Gövdenin Content-Type'ı ya da kodlaması desteklenmiyor.|JSON bekleyen uca form verisi göndermek.|RFC 9110 §15.5.16
416|Range Not Satisfiable|Aralık karşılanamıyor|Range başlığındaki aralık kaynağın boyutu dışında.|5000 baytlık dosyadan bytes=6000- istemek.|RFC 9110 §15.5.17
417|Expectation Failed|Beklenti karşılanamadı|Expect başlığındaki beklenti karşılanamıyor.|100-continue desteklemeyen sunucu.|RFC 9110 §15.5.18
418|(Unused)|(Kullanılmıyor) "Ben bir çaydanlığım"|1998 şakası HTCPCP'deki "I'm a teapot"; IANA'da ayrılmış, kullanılmayan kod.|Kullanılmaz; bazı servisler şaka ya da bot engeli olarak döndürür.|RFC 9110 §15.5.19|Ayrılmış (reserved).
421|Misdirected Request|Yanlış yönlendirilmiş istek|İstek, yanıt üretemeyen bir sunucuya geldi (ör. TLS bağlantısı başka host için).|HTTP/2 bağlantı yeniden kullanımında farklı alan adı.|RFC 9110 §15.5.20
422|Unprocessable Content|İşlenemeyen içerik|Sözdizimi doğru, ancak içerik anlamsal olarak işlenemiyor.|Doğrulama hataları: geçersiz e-posta biçimi, negatif miktar.|RFC 9110 §15.5.21|Eski adı: Unprocessable Entity.
423|Locked|Kilitli|Kaynak kilitli.|WebDAV'da başka kullanıcının kilitlediği dosya.|RFC 4918 §11.3
424|Failed Dependency|Bağımlılık başarısız|Bağlı olduğu başka bir işlem başarısız olduğu için istek yapılamadı.|WebDAV toplu işlemlerinde zincirleme hata.|RFC 4918 §11.4
425|Too Early|Çok erken|Sunucu, tekrar oynatılabilecek (TLS 1.3 erken veri) isteği işlemek istemiyor.|0-RTT ile gelen ödeme isteği.|RFC 8470 §5.2
426|Upgrade Required|Yükseltme gerekli|Sunucu, istemci başka bir protokole geçmeden isteği işlemiyor (Upgrade başlığı).|Yalnızca HTTP/2 ya da TLS kabul eden uç.|RFC 9110 §15.5.22
428|Precondition Required|Ön koşul gerekli|Sunucu isteğin koşullu olmasını (If-Match) zorunlu tutuyor.|Kayıp güncellemeleri önlemek için ETag'siz PUT'u reddetme.|RFC 6585 §3
429|Too Many Requests|Çok fazla istek|İstemci belirli sürede çok fazla istek gönderdi (hız sınırı).|API kotası aşıldı; Retry-After kadar bekleyin.|RFC 6585 §4
431|Request Header Fields Too Large|Başlık alanları çok büyük|Başlıklar (tek tek ya da toplamda) çok büyük.|Aşırı büyümüş Cookie başlığı.|RFC 6585 §5
451|Unavailable For Legal Reasons|Yasal nedenlerle erişilemiyor|Kaynağa yasal bir talep nedeniyle erişim engellendi.|Mahkeme kararıyla erişimi engellenen içerik.|RFC 7725 §3
500|Internal Server Error|Sunucu iç hatası|Sunucu beklenmeyen bir durumla karşılaştı.|Yakalanmamış istisna, hatalı yapılandırma.|RFC 9110 §15.6.1
501|Not Implemented|Uygulanmadı|Sunucu isteği karşılamak için gereken işlevi desteklemiyor.|Tanınmayan HTTP metodu.|RFC 9110 §15.6.2
502|Bad Gateway|Hatalı ağ geçidi|Ağ geçidi ya da proxy, arkadaki sunucudan geçersiz yanıt aldı.|Uygulama sunucusu çöktüğünde nginx yanıtı.|RFC 9110 §15.6.3
503|Service Unavailable|Hizmet kullanılamıyor|Sunucu geçici olarak isteği işleyemiyor (aşırı yük, bakım).|Bakım modu; Retry-After ile ne zaman denenebileceği bildirilir.|RFC 9110 §15.6.4
504|Gateway Timeout|Ağ geçidi zaman aşımı|Ağ geçidi ya da proxy, arkadaki sunucudan zamanında yanıt alamadı.|Yavaş veritabanı sorgusu yüzünden yük dengeleyici zaman aşımı.|RFC 9110 §15.6.5
505|HTTP Version Not Supported|HTTP sürümü desteklenmiyor|İstekteki HTTP ana sürümü desteklenmiyor.|Yalnızca HTTP/1.x bilen sunucuya HTTP/2 ya da HTTP/3 isteği.|RFC 9110 §15.6.6
506|Variant Also Negotiates|Varyant da müzakere ediyor|İçerik müzakeresi yapılandırması döngüye giriyor.|Hatalı şeffaf içerik müzakeresi yapılandırması.|RFC 2295 §8.1
507|Insufficient Storage|Yetersiz depolama|Sunucu isteği tamamlamak için gereken veriyi saklayamıyor.|WebDAV'da dolu disk.|RFC 4918 §11.5
508|Loop Detected|Döngü algılandı|Sunucu işlemi sırasında sonsuz döngü algıladı.|WebDAV bağlamalarında Depth: infinity döngüsü.|RFC 5842 §7.2
510|Not Extended|Genişletilmemiş|İsteği karşılamak için ek uzantılar gerekli.|HTTP uzantı çerçevesi (RFC 2774).|RFC 2774 §7|Kullanımdan kaldırıldı (obsoleted).
511|Network Authentication Required|Ağ kimlik doğrulaması gerekli|Ağa erişmek için kimlik doğrulama gerekli.|Otel ya da kafe Wi-Fi'ında giriş (captive portal) sayfası.|RFC 6585 §6
`;
