// Sık kullanılan MIME (ortam) türleri; uzantı, açıklama, metin mi ve sıkıştırmaya değer mi. Çevrimdışıdır.
// Satır biçimi: tür|uzantılar (boşlukla)|açıklama|t: metin, b: ikili|c: sıkıştırılabilir, -: zaten sıkıştırılmış/değmez

export const MIME_DATA = `
application/json|json|JSON verisi; REST API'lerin varsayılan gövde türü.|t|c
application/ld+json|jsonld|JSON-LD bağlantılı veri (schema.org yapılandırılmış verisi).|t|c
application/problem+json|json|RFC 9457 hata ayrıntısı (Problem Details) gövdesi.|t|c
application/problem+xml|xml|RFC 9457 hata ayrıntısının XML biçimi.|t|c
application/merge-patch+json|json|JSON Merge Patch (RFC 7396) PATCH gövdesi.|t|c
application/json-patch+json|json|JSON Patch (RFC 6902) işlem listesi.|t|c
application/x-ndjson|ndjson jsonl|Satır başına bir JSON (akış ve toplu veri).|t|c
application/geo+json|geojson|GeoJSON coğrafi veri.|t|c
application/hal+json|json|HAL hipermedya JSON'u (_links, _embedded).|t|c
application/vnd.api+json|json|JSON:API biçimi.|t|c
application/schema+json|json|JSON Schema belgesi.|t|c
application/xml|xml|XML belgesi.|t|c
application/atom+xml|atom|Atom besleme (feed).|t|c
application/rss+xml|rss|RSS besleme.|t|c
application/soap+xml|xml|SOAP 1.2 mesajı.|t|c
application/xhtml+xml|xhtml|XML kurallarıyla yazılmış HTML.|t|c
application/javascript|js mjs|JavaScript (eski tür; yerine text/javascript).|t|c
application/ecmascript|es|ECMAScript (eski tür; yerine text/javascript).|t|c
application/x-www-form-urlencoded||HTML form gönderimi: a=1&b=iki biçiminde gövde.|t|c
application/graphql-response+json|json|GraphQL over HTTP yanıtı.|t|c
application/graphql|graphql gql|GraphQL sorgu metni (eski kullanım).|t|c
application/yaml|yaml yml|YAML belgesi (RFC 9512).|t|c
application/toml|toml|TOML yapılandırma dosyası.|t|c
application/sql|sql|SQL betiği.|t|c
application/wasm|wasm|WebAssembly modülü.|b|c
application/octet-stream|bin|Türü bilinmeyen ikili veri; tarayıcı indirir.|b|-
application/pdf|pdf|PDF belgesi.|b|-
application/zip|zip|ZIP arşivi.|b|-
application/gzip|gz|Gzip ile sıkıştırılmış dosya.|b|-
application/x-tar|tar|Tar arşivi (sıkıştırılmamış).|b|c
application/x-7z-compressed|7z|7-Zip arşivi.|b|-
application/vnd.rar|rar|RAR arşivi.|b|-
application/x-bzip2|bz2|Bzip2 ile sıkıştırılmış dosya.|b|-
application/zstd|zst|Zstandard ile sıkıştırılmış dosya.|b|-
application/java-archive|jar|Java arşivi (JAR).|b|-
application/vnd.android.package-archive|apk|Android uygulama paketi.|b|-
application/x-msdownload|exe dll|Windows çalıştırılabilir dosyası.|b|c
application/x-sh|sh|Kabuk betiği.|t|c
application/msword|doc|Microsoft Word 97–2003 belgesi.|b|c
application/vnd.openxmlformats-officedocument.wordprocessingml.document|docx|Microsoft Word belgesi.|b|-
application/vnd.ms-excel|xls|Microsoft Excel 97–2003 çalışma kitabı.|b|c
application/vnd.openxmlformats-officedocument.spreadsheetml.sheet|xlsx|Microsoft Excel çalışma kitabı.|b|-
application/vnd.ms-powerpoint|ppt|Microsoft PowerPoint 97–2003 sunusu.|b|c
application/vnd.openxmlformats-officedocument.presentationml.presentation|pptx|Microsoft PowerPoint sunusu.|b|-
application/vnd.oasis.opendocument.text|odt|OpenDocument metin belgesi.|b|-
application/vnd.oasis.opendocument.spreadsheet|ods|OpenDocument hesap tablosu.|b|-
application/rtf|rtf|Zengin metin biçimi (RTF).|t|c
application/epub+zip|epub|EPUB e-kitap.|b|-
application/x-protobuf|pb proto|Protocol Buffers ikili mesajı (yaygın, standart dışı ad).|b|c
application/grpc||gRPC mesaj akışı (HTTP/2).|b|-
application/grpc-web+proto||gRPC-Web ikili mesajı.|b|-
application/cbor|cbor|CBOR ikili nesne gösterimi.|b|c
application/msgpack|msgpack|MessagePack ikili serileştirme.|b|c
application/x-pem-file|pem|PEM biçiminde sertifika ya da anahtar.|t|c
application/pkix-cert|cer|DER biçiminde X.509 sertifikası.|b|c
application/x-x509-ca-cert|crt der|CA sertifikası (tarayıcıya yükleme).|b|c
application/pkcs12|p12 pfx|PKCS#12 sertifika ve özel anahtar paketi.|b|-
application/jwt|jwt|JSON Web Token.|t|-
application/jose+json|json|JWS/JWE JSON serileştirmesi.|t|c
application/manifest+json|webmanifest|Web uygulaması bildirimi (PWA manifest).|t|c
application/x-shockwave-flash|swf|Adobe Flash (artık desteklenmiyor).|b|-
application/vnd.ms-fontobject|eot|Embedded OpenType yazı tipi (eski IE).|b|c
text/plain|txt text log|Düz metin.|t|c
text/html|html htm|HTML sayfası.|t|c
text/css|css|CSS stil sayfası.|t|c
text/javascript|js mjs|JavaScript (güncel standart tür, RFC 9239).|t|c
text/csv|csv|Virgülle ayrılmış değerler.|t|c
text/tab-separated-values|tsv|Sekmeyle ayrılmış değerler.|t|c
text/markdown|md markdown|Markdown metni.|t|c
text/xml|xml|XML belgesi (application/xml tercih edilir).|t|c
text/calendar|ics|iCalendar takvim verisi.|t|c
text/vcard|vcf|vCard kişi kartı.|t|c
text/event-stream||Server-Sent Events (SSE) akışı.|t|-
text/yaml|yaml yml|YAML (eski, kayıtsız ad; yerine application/yaml).|t|c
text/x-python|py|Python kaynak kodu (yaygın, kayıtsız).|t|c
text/x-csharp|cs|C# kaynak kodu (yaygın, kayıtsız).|t|c
image/png|png|PNG görüntüsü (kayıpsız).|b|-
image/jpeg|jpg jpeg|JPEG fotoğraf.|b|-
image/gif|gif|GIF görüntüsü ve animasyonu.|b|-
image/webp|webp|WebP görüntüsü.|b|-
image/avif|avif|AVIF görüntüsü (AV1 tabanlı).|b|-
image/svg+xml|svg|SVG vektör görüntüsü (XML metni).|t|c
image/x-icon|ico|Simge (favicon).|b|c
image/vnd.microsoft.icon|ico|Simge (kayıtlı ad).|b|c
image/bmp|bmp|Bitmap görüntüsü.|b|c
image/tiff|tif tiff|TIFF görüntüsü.|b|c
image/heic|heic|HEIC görüntüsü (Apple cihazları).|b|-
audio/mpeg|mp3|MP3 ses.|b|-
audio/ogg|oga ogg|Ogg ses (Vorbis/Opus).|b|-
audio/wav|wav|WAV ses (sıkıştırılmamış).|b|c
audio/webm|weba|WebM ses.|b|-
audio/aac|aac|AAC ses.|b|-
audio/flac|flac|FLAC kayıpsız ses.|b|-
audio/mp4|m4a|MP4 kapsayıcısında ses.|b|-
video/mp4|mp4|MP4 video.|b|-
video/webm|webm|WebM video.|b|-
video/ogg|ogv|Ogg video.|b|-
video/quicktime|mov|QuickTime video.|b|-
video/x-msvideo|avi|AVI video.|b|-
video/mp2t|ts|MPEG aktarım akışı (HLS parçaları).|b|-
application/vnd.apple.mpegurl|m3u8|HLS oynatma listesi.|t|c
application/dash+xml|mpd|MPEG-DASH bildirimi.|t|c
font/woff|woff|WOFF web yazı tipi.|b|-
font/woff2|woff2|WOFF2 web yazı tipi (Brotli ile sıkıştırılmış).|b|-
font/ttf|ttf|TrueType yazı tipi.|b|c
font/otf|otf|OpenType yazı tipi.|b|c
multipart/form-data||Dosya yüklemeli form gönderimi; parçalar boundary ile ayrılır.|b|-
multipart/mixed||Farklı türde parçalardan oluşan gövde (toplu istekler, e-posta).|b|-
multipart/alternative||Aynı içeriğin farklı biçimleri (e-postada düz metin + HTML).|t|-
multipart/byteranges||Birden çok aralık içeren 206 yanıtı.|b|-
message/rfc822|eml|E-posta mesajı.|t|c
message/http||HTTP mesajı (TRACE yanıtı).|t|c
`;
